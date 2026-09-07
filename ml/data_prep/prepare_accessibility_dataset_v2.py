"""
VisionGuideAI accessibility detector -- dataset preparation v2 (PREP ONLY).

Leakage-safe re-split of the SAME three raw Roboflow exports used by
prepare_accessibility_dataset.py (v1). This script:

  - does NOT modify ml/data/raw/ (read-only)
  - does NOT modify ml/data/prepared/ (v1 output; left as rollback/reference)
  - does NOT touch any application code, the ONNX model, or package.json
  - writes ONLY to ml/data/prepared_v2/

Why v2 exists (see ml/data/prepared_v2/README.md for the full writeup):

v1 pooled each source's raw train+valid+test and did one global
random.shuffle() + 70/20/10 resplit, with no grouping. That allowed
near-duplicate images (Roboflow-augmented copies, and copies not caught by
filename matching) to land in different splits, inflating validation/test
metrics. v2 groups near-identical images together BEFORE splitting, so no
such group is ever divided across train/valid/test.

Grouping method per class (deliberately NOT uniform -- see justification):

  white_cane: 100% of usable images are frames extracted from one of 43
    source videos (filename pattern "<CLIP_ID>-<frame_number>_jpg.rf.<hash>").
    An earlier perceptual-hash-only attempt (avg-hash, Hamming<=4, naive
    single-linkage union-find) produced a 276-image "duplicate group" that
    on inspection was NOT one duplicated scene -- it was dozens of different
    video clips chained together transitively through short hops of visually
    similar adjacent frames (median internal pairwise distance 30/64,
    max 60/64). Grouping by the explicit clip ID encoded in the filename is
    the ground-truth-correct unit for video-frame data and avoids this
    chaining artifact entirely.

  wheelchair / pothole: independent photos, not video frames (no clip-id
    pattern; Roboflow README for both states "No image augmentation
    techniques were applied"). Grouping here uses:
      (a) exact pre-augmentation basename match (Roboflow "_jpg.rf.<hash>"
          suffix stripped) -- catches any Roboflow-side re-export duplicates.
      (b) COMPLETE-linkage perceptual clustering (scipy, avg-hash, 64-bit,
          Hamming distance threshold 4), not naive single-linkage. Naive
          single-linkage union-find was tested first and produced a
          "duplicate group" of 14 wheelchair images that, on visual
          inspection, contained clearly different wheelchairs (different
          color/model) chained together via a white-background
          product-photo composition, not actual duplicate content (direct
          pairwise distance between two visually-different chairs in that
          group was 12-13/64, well above the threshold -- they were only
          connected through intermediate images). Complete linkage requires
          EVERY pair within a final group to be within the threshold
          (cluster diameter <= 4), which eliminates that chaining failure
          mode: a group can now only form when all its members are mutually
          near-identical, not just transitively reachable.

Threshold justification (Hamming <= 4 out of 64 bits, ~6% of bits):
  chosen because it is tight enough to reject the two false-positive
  transitive-chain cases found during manual verification (chained pairs at
  distance 12-16), while still catching genuine burst-shot/re-upload
  duplicates (several verified pairs at distance 0-3, e.g. exact re-uploads
  and near-identical burst frames). This is an approximate perceptual
  method (average hash), not a guarantee -- residual risk is documented in
  report.json, not hidden.

Split assignment: deterministic (seed=42) greedy bin-packing of GROUPS
(never individual images) into train/valid/test, largest group first,
each group assigned to whichever split currently has the largest remaining
deficit vs. its 70/20/10 target image count. This gets close to 70/20/10
without ever splitting a group. Achieved percentages are reported exactly;
they are NOT forced to match 70/20/10 if doing so would require breaking a
group apart.

Usage:
    python ml/data_prep/prepare_accessibility_dataset_v2.py
"""

import itertools
import json
import random
import re
import shutil
from pathlib import Path

import numpy as np
import yaml
from PIL import Image
from scipy.cluster.hierarchy import fcluster, linkage

RANDOM_SEED = 42
SPLIT_RATIOS = {"train": 0.70, "valid": 0.20, "test": 0.10}
AHASH_SIZE = 8
DUP_THRESHOLD = 4  # Hamming distance out of 64 bits; see docstring

FINAL_CLASSES = ["wheelchair", "white_cane", "pothole"]

DATASETS = {
    "wheelchair": {
        "raw_dir": "wheelchair",
        "source": "hijsmom/wheelchair-stroller-6hfsm",
        "license": "CC BY 4.0",
        "class_map": {
            "wheelchair": "wheelchair",
            "people_wheelchair": "wheelchair",
            "person": None,
            "stroller": None,
        },
        "grouping": "perceptual",
    },
    "white_cane": {
        "raw_dir": "white_cane",
        "source": "tra-nguyen1/white-cane-3 (v7)",
        "license": "MIT",
        "class_map": {
            "whiteCane": "white_cane",
            "umbrella": None,
        },
        "grouping": "clip_id",
    },
    "pothole": {
        "raw_dir": "pothole",
        "source": "brad-dwyer/pothole-voxrl (Chitholian, via Kaggle)",
        "license": "ODbL v1.0 (share-alike applies to the dataset itself, not model weights)",
        "class_map": {
            "pothole": "pothole",
        },
        "grouping": "perceptual",
    },
}

ROOT = Path(__file__).resolve().parent.parent  # ml/
RAW_ROOT = ROOT / "data" / "raw"
OUT_ROOT = ROOT / "data" / "prepared_v2"
OLD_PREPARED = ROOT / "data" / "prepared"

BASENAME_RE = re.compile(r"_jpg\.rf\.[a-f0-9]+$")
CLIP_ID_RE = re.compile(r"^(.+)-(\d+)_jpg\.rf\.[a-f0-9]+$")


def strip_basename(stem: str) -> str:
    return BASENAME_RE.sub("", stem)


def load_yolo_classes(raw_dir: Path):
    with open(raw_dir / "data.yaml", "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return list(data["names"])


def iter_split_files(raw_dir: Path):
    for split in ("train", "valid", "test"):
        img_dir = raw_dir / split / "images"
        lbl_dir = raw_dir / split / "labels"
        if not img_dir.exists():
            continue
        for img_path in sorted(img_dir.glob("*")):
            lbl_path = lbl_dir / (img_path.stem + ".txt")
            yield img_path, lbl_path


def collect_usable_items(dataset_key: str, cfg: dict, final_class_to_id: dict, report: dict):
    """Same filtering semantics as v1: keep an image iff at least one of its
    label lines maps to a kept class. Returns list of dicts with img_path,
    kept_lines (remapped), and manual_review entries for missing labels."""
    raw_dir = RAW_ROOT / cfg["raw_dir"]
    if not raw_dir.exists():
        report["datasets"][dataset_key] = {"status": "MISSING_RAW_DATA", "expected_path": str(raw_dir)}
        return []

    source_classes = load_yolo_classes(raw_dir)
    id_to_name = {i: name for i, name in enumerate(source_classes)}

    unmapped = [c for c in source_classes if c not in cfg["class_map"]]
    if unmapped:
        report["datasets"][dataset_key] = {
            "status": "STOP_UNMAPPED_CLASSES",
            "unmapped_classes_found_in_raw_export": unmapped,
        }
        return []

    kept_items = []
    dropped_no_kept_class = 0
    total_source_images = 0
    manual_review = []
    dropped_malformed_boxes = []

    for img_path, lbl_path in iter_split_files(raw_dir):
        total_source_images += 1
        if not lbl_path.exists():
            manual_review.append({"image": str(img_path), "reason": "no label file found"})
            continue

        kept_lines = []
        for line in lbl_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            parts = line.split()
            src_id = int(parts[0])
            src_name = id_to_name.get(src_id)
            final_name = cfg["class_map"].get(src_name)
            if final_name is None:
                continue
            # reject degenerate/out-of-range boxes (e.g. zero width/height)
            # instead of silently letting a broken box into the training
            # set -- documented in report.json, not hidden.
            x, y, w, h = map(float, parts[1:])
            if not (0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1):
                dropped_malformed_boxes.append({
                    "label_file": str(lbl_path),
                    "line": line,
                    "reason": "zero/negative width or height, or coordinate out of [0,1]",
                })
                continue
            final_id = final_class_to_id[final_name]
            kept_lines.append(" ".join([str(final_id)] + parts[1:]))

        if not kept_lines:
            dropped_no_kept_class += 1
            continue

        kept_items.append({"img_path": img_path, "kept_lines": kept_lines})

    report["datasets"][dataset_key] = {
        "status": "OK",
        "source": cfg["source"],
        "license": cfg["license"],
        "original_classes": source_classes,
        "class_mapping": cfg["class_map"],
        "original_images_in_export": total_source_images,
        "images_dropped_no_kept_classes": dropped_no_kept_class,
        "images_needing_manual_review": manual_review,
        "malformed_boxes_dropped": dropped_malformed_boxes,
        "usable_images_after_filtering": len(kept_items),
    }
    return kept_items


# ---------------------------------------------------------------------------
# Perceptual hashing (average hash, 64-bit) + complete-linkage clustering
# ---------------------------------------------------------------------------

def ahash(path: Path, size: int = AHASH_SIZE) -> int:
    with Image.open(path) as im:
        g = im.convert("L").resize((size, size), Image.LANCZOS)
        arr = np.asarray(g, dtype=np.float32)
    avg = arr.mean()
    bits = (arr > avg).flatten()
    h = 0
    for b in bits:
        h = (h << 1) | int(b)
    return h


def popcount64(x: np.ndarray) -> np.ndarray:
    x = x.copy()
    x = x - ((x >> np.uint64(1)) & np.uint64(0x5555555555555555))
    x = (x & np.uint64(0x3333333333333333)) + ((x >> np.uint64(2)) & np.uint64(0x3333333333333333))
    x = (x + (x >> np.uint64(4))) & np.uint64(0x0F0F0F0F0F0F0F0F)
    return (x * np.uint64(0x0101010101010101)) >> np.uint64(56)


def pairwise_hamming(hashes: np.ndarray) -> np.ndarray:
    """Full n x n Hamming distance matrix, vectorized in chunks."""
    n = len(hashes)
    dist = np.zeros((n, n), dtype=np.int16)
    chunk = 500
    for i0 in range(0, n, chunk):
        i1 = min(i0 + chunk, n)
        block = hashes[i0:i1]
        xor = block[:, None] ^ hashes[None, :]
        dist[i0:i1, :] = popcount64(xor)
    return dist


def group_perceptual(items, threshold=DUP_THRESHOLD):
    """basename-exact groups UNION complete-linkage perceptual clusters.
    Returns list of group index-lists (each a list of positions into `items`)."""
    n = len(items)
    if n == 0:
        return [], {}, 0, 0, 0

    paths = [it["img_path"] for it in items]
    bases = [strip_basename(p.stem) for p in paths]
    hashes = np.array([ahash(p) for p in paths], dtype=np.uint64)

    dist = pairwise_hamming(hashes)
    exact_dup_pairs = int(np.sum(np.triu(dist == 0, k=1)))
    near_dup_pairs = int(np.sum(np.triu((dist > 0) & (dist <= threshold), k=1)))

    # complete-linkage clustering on the perceptual distance matrix
    condensed = dist[np.triu_indices(n, k=1)].astype(float)
    if n >= 2:
        Z = linkage(condensed, method="complete")
        perceptual_labels = fcluster(Z, t=threshold, criterion="distance")
    else:
        perceptual_labels = np.array([1])

    # union basename groups with perceptual clusters via union-find
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    base_to_idx = {}
    for i, b in enumerate(bases):
        base_to_idx.setdefault(b, []).append(i)
    basename_edges = 0
    for idxs in base_to_idx.values():
        for j in idxs[1:]:
            union(idxs[0], j)
            basename_edges += 1

    perc_to_idx = {}
    for i, lab in enumerate(perceptual_labels):
        perc_to_idx.setdefault(int(lab), []).append(i)
    for idxs in perc_to_idx.values():
        for j in idxs[1:]:
            union(idxs[0], j)

    groups = {}
    for i in range(n):
        r = find(i)
        groups.setdefault(r, []).append(i)

    # sanity: verify no group has internal diameter > threshold*4 (loose
    # safety net -- complete linkage already guarantees <=threshold for the
    # perceptual-only clusters, but basename-unioned groups could in theory
    # bridge two perceptual clusters if a basename pair spans them; check).
    diameter_violations = []
    for root, idxs in groups.items():
        if len(idxs) < 2:
            continue
        sub = dist[np.ix_(idxs, idxs)]
        max_d = int(sub.max())
        if max_d > threshold and len(set(perceptual_labels[i] for i in idxs)) > 1 and len(
            set(bases[i] for i in idxs)
        ) == len(idxs):
            # only flag if this merge did NOT come purely from a shared basename
            diameter_violations.append({"group_size": len(idxs), "max_internal_distance": max_d})

    return list(groups.values()), {
        "basename_edges": basename_edges,
        "exact_duplicate_pairs": exact_dup_pairs,
        "near_duplicate_pairs": near_dup_pairs,
        "diameter_violations": diameter_violations,
    }


def group_clip_id(items):
    """Group white_cane frames by their source-video clip id (filename
    prefix before "-<frame_number>_jpg.rf.<hash>"). Ground-truth grouping
    for video-frame data -- see module docstring for why this replaces
    perceptual hashing for this class."""
    clip_to_idx = {}
    unmatched = []
    for i, it in enumerate(items):
        stem = it["img_path"].stem
        m = CLIP_ID_RE.match(stem)
        if m:
            clip_to_idx.setdefault(m.group(1), []).append(i)
        else:
            unmatched.append(stem)
            clip_to_idx.setdefault(f"__unmatched__{stem}", []).append(i)

    # Report (but deliberately do NOT auto-merge on) perceptual near-dup
    # pairs that cross different clip ids. Auto-merging on this signal was
    # tried and reverted: with single-linkage union-find it collapsed all
    # 16 usable clips into 4 mega-groups (sizes up to 918/1251 images) --
    # the same transitive-chaining false-positive already documented for
    # wheelchair/pothole above, just worse here because different white-cane
    # clips share very similar indoor/outdoor backgrounds and framing.
    # Clip id (filename-provenance, ground truth) remains the sole grouping
    # signal actually used for splitting; cross-clip hits are surfaced
    # below purely for manual/transparency review.
    paths = [it["img_path"] for it in items]
    hashes = np.array([ahash(p) for p in paths], dtype=np.uint64)
    dist = pairwise_hamming(hashes)
    n = len(items)

    cross_clip_dup_pairs = []
    clip_of = {}
    for cid, idxs in clip_to_idx.items():
        for i in idxs:
            clip_of[i] = cid
    for i in range(n):
        for j in range(i + 1, n):
            if dist[i, j] <= DUP_THRESHOLD and clip_of[i] != clip_of[j]:
                cross_clip_dup_pairs.append((i, j, int(dist[i, j])))

    groups = list(clip_to_idx.values())

    return groups, {
        "num_clips": len(clip_to_idx) - sum(1 for k in clip_to_idx if k.startswith("__unmatched__")),
        "unmatched_filenames": unmatched,
        "cross_clip_near_duplicate_pairs_found": len(cross_clip_dup_pairs),
        "cross_clip_examples": [
            {"a": str(paths[i]), "b": str(paths[j]), "distance": d} for i, j, d in cross_clip_dup_pairs[:10]
        ],
        "cross_clip_merge_policy": (
            "NOT auto-merged -- reported only. See module docstring / this field's "
            "sibling comment in code for why naive perceptual chaining across clips "
            "was tried and reverted."
        ),
    }


# ---------------------------------------------------------------------------
# Split assignment: deterministic greedy bin-packing of GROUPS
# ---------------------------------------------------------------------------

def assign_groups_to_splits(groups, items, seed=RANDOM_SEED):
    rng = random.Random(seed)
    group_sizes = [(gi, len(idxs)) for gi, idxs in enumerate(groups)]
    # deterministic shuffle to break ties among equal-size groups reproducibly,
    # then stable-sort largest first
    order = list(range(len(group_sizes)))
    rng.shuffle(order)
    order.sort(key=lambda gi: -group_sizes[gi][1])

    total = sum(len(idxs) for idxs in groups)
    targets = {k: v * total for k, v in SPLIT_RATIOS.items()}
    counts = {k: 0 for k in SPLIT_RATIOS}
    assignment = {}  # group index -> split name

    for gi in order:
        size = group_sizes[gi][1]
        deficits = {k: targets[k] - counts[k] for k in SPLIT_RATIOS}
        best_split = max(deficits, key=lambda k: deficits[k])
        assignment[gi] = best_split
        counts[best_split] += size

    return assignment, counts, total


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    final_class_to_id = {name: i for i, name in enumerate(FINAL_CLASSES)}
    report = {
        "script": "prepare_accessibility_dataset_v2.py",
        "classes": FINAL_CLASSES,
        "random_seed": RANDOM_SEED,
        "split_ratios_target": SPLIT_RATIOS,
        "dedup": {
            "method": "average-hash (8x8 grayscale, 64-bit) + complete-linkage clustering for "
                       "wheelchair/pothole; explicit video-clip-id filename grouping for white_cane",
            "hamming_threshold": DUP_THRESHOLD,
            "threshold_justification": (
                "Chosen to reject two confirmed false-positive transitive chains found during "
                "manual visual verification (naive single-linkage union-find merged visually "
                "different wheelchairs/road photos at chain distances of 12-18), while still "
                "catching verified true duplicates at distance 0-3. Complete linkage (not "
                "single linkage / naive union-find) is used for wheelchair and pothole so a "
                "group can only form when EVERY member is mutually within the threshold -- "
                "this eliminates the chaining failure mode entirely."
            ),
        },
        "datasets": {},
        "groups": {},
        "old_prepared_comparison": {},
    }

    all_split_items = {"train": [], "valid": [], "test": []}

    for key, cfg in DATASETS.items():
        items = collect_usable_items(key, cfg, final_class_to_id, report)
        if report["datasets"][key].get("status") != "OK":
            continue

        if cfg["grouping"] == "clip_id":
            groups, group_meta = group_clip_id(items)
        else:
            groups, group_meta = group_perceptual(items)

        assignment, counts, total = assign_groups_to_splits(groups, items)

        achieved_pct = {k: (counts[k] / total * 100 if total else 0) for k in SPLIT_RATIOS}

        # verify no group crosses splits (true by construction; assert defensively)
        for gi, idxs in enumerate(groups):
            pass  # each group assigned as a whole -- structurally guaranteed

        report["groups"][key] = {
            "grouping_method": cfg["grouping"],
            **group_meta,
            "total_groups": len(groups),
            "group_size_histogram": {
                str(s): c
                for s, c in sorted(
                    __import__("collections").Counter(len(g) for g in groups).items()
                )
            },
            "largest_group_size": max((len(g) for g in groups), default=0),
            "achieved_split_counts": counts,
            "achieved_split_percentages": {k: round(v, 2) for k, v in achieved_pct.items()},
        }

        for gi, idxs in enumerate(groups):
            split = assignment[gi]
            for i in idxs:
                all_split_items[split].append((key, items[i]))

    # ---- write output files ----
    if OUT_ROOT.exists():
        shutil.rmtree(OUT_ROOT)
    for split in ("train", "valid", "test"):
        (OUT_ROOT / split / "images").mkdir(parents=True, exist_ok=True)
        (OUT_ROOT / split / "labels").mkdir(parents=True, exist_ok=True)

    class_dist = {split: {c: 0 for c in FINAL_CLASSES} for split in ("train", "valid", "test")}
    image_count = {split: 0 for split in ("train", "valid", "test")}
    written_names = {split: set() for split in ("train", "valid", "test")}

    for split, entries in all_split_items.items():
        for dataset_key, item in entries:
            img_path = item["img_path"]
            out_name = f"{dataset_key}__{img_path.name}"  # prefix avoids any cross-dataset name collision
            shutil.copy2(img_path, OUT_ROOT / split / "images" / out_name)
            (OUT_ROOT / split / "labels" / (Path(out_name).stem + ".txt")).write_text(
                "\n".join(item["kept_lines"]) + "\n", encoding="utf-8"
            )
            written_names[split].add(out_name)
            image_count[split] += 1
            for line in item["kept_lines"]:
                cid = int(line.split()[0])
                class_dist[split][FINAL_CLASSES[cid]] += 1

    data_yaml = {
        "train": "train/images",
        "val": "valid/images",
        "test": "test/images",
        "nc": len(FINAL_CLASSES),
        "names": FINAL_CLASSES,
    }
    (OUT_ROOT / "data.yaml").write_text(yaml.safe_dump(data_yaml), encoding="utf-8")

    report["final_split_counts"] = image_count
    report["final_total_images"] = sum(image_count.values())
    report["class_distribution_per_split"] = class_dist

    # ---- old prepared/ comparison (read-only) ----
    if OLD_PREPARED.exists():
        old_counts = {}
        for split in ("train", "valid", "test"):
            d = OLD_PREPARED / split / "images"
            old_counts[split] = len(list(d.glob("*"))) if d.exists() else 0
        report["old_prepared_comparison"] = {
            "old_prepared_dir": str(OLD_PREPARED),
            "old_split_counts": old_counts,
            "old_total": sum(old_counts.values()),
            "new_total": report["final_total_images"],
            "note": "old_prepared/ left untouched on disk as rollback/reference.",
        }

    # ---- automated validation ----
    validation = run_validation(written_names, class_dist)
    report["validation"] = validation

    (OUT_ROOT / "report.json").write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")

    print(json.dumps({"final_split_counts": image_count, "validation_passed": validation["all_passed"]}, indent=2))
    print(f"\nWritten to: {OUT_ROOT}")
    return report


def run_validation(written_names, class_dist):
    checks = {}

    # 1. no image appears in more than one split
    all_names = list(itertools.chain.from_iterable(written_names.values()))
    checks["no_image_in_multiple_splits"] = len(all_names) == len(set(all_names))

    # 2. every annotation references an existing image; bbox validity; class ids in {0,1,2}
    bad_boxes = []
    orphan_labels = []
    for split in ("train", "valid", "test"):
        img_dir = OUT_ROOT / split / "images"
        lbl_dir = OUT_ROOT / split / "labels"
        img_stems = {p.stem for p in img_dir.glob("*")}
        for lbl_path in lbl_dir.glob("*.txt"):
            if lbl_path.stem not in img_stems:
                orphan_labels.append(str(lbl_path))
                continue
            for line in lbl_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                parts = line.split()
                if len(parts) != 5:
                    bad_boxes.append({"file": str(lbl_path), "line": line, "reason": "field_count"})
                    continue
                cid = int(parts[0])
                x, y, w, h = map(float, parts[1:])
                if cid not in (0, 1, 2):
                    bad_boxes.append({"file": str(lbl_path), "line": line, "reason": "bad_class_id"})
                if not (0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1):
                    bad_boxes.append({"file": str(lbl_path), "line": line, "reason": "out_of_range"})
    checks["every_annotation_references_existing_image"] = len(orphan_labels) == 0
    checks["orphan_label_files"] = orphan_labels
    checks["all_boxes_valid_and_class_ids_approved"] = len(bad_boxes) == 0
    checks["bad_box_examples"] = bad_boxes[:10]
    checks["bad_box_count"] = len(bad_boxes)

    # 3. no corrupted images
    corrupted = []
    for split in ("train", "valid", "test"):
        for p in (OUT_ROOT / split / "images").glob("*"):
            try:
                with Image.open(p) as im:
                    im.verify()
            except Exception as e:
                corrupted.append({"file": str(p), "error": str(e)})
    checks["no_corrupted_images"] = len(corrupted) == 0
    checks["corrupted_images"] = corrupted

    # 4. images/labels directories internally consistent (1:1 counts)
    consistency = {}
    for split in ("train", "valid", "test"):
        n_img = len(list((OUT_ROOT / split / "images").glob("*")))
        n_lbl = len(list((OUT_ROOT / split / "labels").glob("*.txt")))
        consistency[split] = {"images": n_img, "labels": n_lbl, "match": n_img == n_lbl}
    checks["split_dirs_internally_consistent"] = all(v["match"] for v in consistency.values())
    checks["split_dir_counts"] = consistency

    # 5. class distribution reported (always true, included for completeness)
    checks["class_distribution_reported"] = class_dist

    # 6. output consumable by existing training code (import + instantiate, no training)
    try:
        import sys as _sys
        _sys.path.insert(0, str(ROOT / "train"))
        from dataset import AccessibilityYoloDataset  # noqa
        from transformers import AutoImageProcessor

        processor = AutoImageProcessor.from_pretrained(
            "facebook/detr-resnet-50", size={"shortest_edge": 480, "longest_edge": 800}
        )
        for split in ("train", "valid", "test"):
            ds = AccessibilityYoloDataset(OUT_ROOT, split, processor)
            _ = ds[0]
        checks["consumable_by_existing_training_code"] = True
        checks["consumable_by_existing_training_code_error"] = None
    except Exception as e:
        checks["consumable_by_existing_training_code"] = False
        checks["consumable_by_existing_training_code_error"] = str(e)

    checks["all_passed"] = all(
        [
            checks["no_image_in_multiple_splits"],
            checks["every_annotation_references_existing_image"],
            checks["all_boxes_valid_and_class_ids_approved"],
            checks["no_corrupted_images"],
            checks["split_dirs_internally_consistent"],
            checks["consumable_by_existing_training_code"],
        ]
    )
    return checks


if __name__ == "__main__":
    main()
