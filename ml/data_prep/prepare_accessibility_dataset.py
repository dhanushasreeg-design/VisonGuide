"""
VisionGuideAI accessibility detector — dataset preparation (PREP ONLY, no training).

Merges three Roboflow Universe exports (YOLOv8 format) into one unified
3-class dataset: wheelchair, white_cane, pothole.

This script does NOT train anything, does NOT touch the deployed
Xenova/detr-resnet-50 ONNX model, and does NOT modify any application code.
It only reads raw Roboflow exports from ml/data/raw/<dataset>/ and writes a
filtered, remapped dataset to ml/data/prepared/.

Approved source -> final class mapping (VisionGuideAI gate, 2026-08-26):

  hijsmom/wheelchair-stroller-6hfsm (CC BY 4.0)
    wheelchair          -> wheelchair
    people_wheelchair   -> wheelchair   (person actively using a wheelchair;
                                          kept because it's still the
                                          accessibility signal we care about)
    person              -> DROP
    stroller            -> DROP

  tra-nguyen1/white-cane-3 v7 (MIT)
    whiteCane           -> white_cane
    umbrella            -> DROP         (umbrella is annotated as its own
                                          box, never merged with whiteCane;
                                          images with both a cane and an
                                          umbrella keep the cane box and
                                          simply drop the umbrella line —
                                          no re-annotation needed since the
                                          two objects are separate boxes)

  brad-dwyer/pothole-voxrl / Chitholian (ODbL v1.0)
    pothole             -> pothole      (no mapping needed)

Final class order (fixed, do not reorder without re-running training):
  0 = wheelchair
  1 = white_cane
  2 = pothole

Usage (after manually downloading each Roboflow export in YOLOv8 format into
ml/data/raw/<key>/ — see ml/data_prep/README.md):

    python prepare_accessibility_dataset.py

Output:
  ml/data/prepared/{train,valid,test}/images/*
  ml/data/prepared/{train,valid,test}/labels/*
  ml/data/prepared/data.yaml
  ml/data/prepared/report.json   <- exact counts, drops, manual-review list
"""

import json
import random
import shutil
from pathlib import Path

RANDOM_SEED = 42
SPLIT_RATIOS = {"train": 0.70, "valid": 0.20, "test": 0.10}

FINAL_CLASSES = ["wheelchair", "white_cane", "pothole"]

# key -> (raw export subfolder under ml/data/raw/, {source_class_name: final_class_name or None to drop})
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
    },
    "white_cane": {
        "raw_dir": "white_cane",
        "source": "tra-nguyen1/white-cane-3 (v7)",
        "license": "MIT",
        "class_map": {
            "whiteCane": "white_cane",
            "umbrella": None,
        },
    },
    "pothole": {
        "raw_dir": "pothole",
        "source": "brad-dwyer/pothole-voxrl (Chitholian, via Kaggle)",
        "license": "ODbL v1.0 (share-alike applies to the dataset itself, not model weights)",
        "class_map": {
            "pothole": "pothole",
        },
    },
}

RAW_ROOT = Path(__file__).resolve().parent.parent / "data" / "raw"
OUT_ROOT = Path(__file__).resolve().parent.parent / "data" / "prepared"


def load_yolo_classes(raw_dir: Path):
    """Read classes from a Roboflow YOLOv8 export's data.yaml."""
    import yaml  # pyyaml

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


def filter_and_remap(dataset_key: str, cfg: dict, final_class_to_id: dict, report: dict):
    raw_dir = RAW_ROOT / cfg["raw_dir"]
    if not raw_dir.exists():
        report["datasets"][dataset_key] = {
            "status": "MISSING_RAW_DATA",
            "expected_path": str(raw_dir),
        }
        return []

    source_classes = load_yolo_classes(raw_dir)
    id_to_name = {i: name for i, name in enumerate(source_classes)}

    unmapped = [c for c in source_classes if c not in cfg["class_map"]]
    if unmapped:
        report["datasets"][dataset_key] = {
            "status": "STOP_UNMAPPED_CLASSES",
            "unmapped_classes_found_in_raw_export": unmapped,
            "note": "Raw export contains classes not covered by the approved "
                    "mapping. Refusing to guess — update DATASETS[...]['class_map'] "
                    "and re-run.",
        }
        return []

    kept_items = []
    dropped_images_all_filtered = 0
    total_source_images = 0
    manual_review = []

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
                continue  # dropped class (person / stroller / umbrella)
            final_id = final_class_to_id[final_name]
            kept_lines.append(" ".join([str(final_id)] + parts[1:]))

        if not kept_lines:
            dropped_images_all_filtered += 1
            continue

        kept_items.append((img_path, kept_lines))

    report["datasets"][dataset_key] = {
        "status": "OK",
        "source": cfg["source"],
        "license": cfg["license"],
        "original_classes": source_classes,
        "class_mapping": cfg["class_map"],
        "original_images_in_export": total_source_images,
        "images_dropped_no_kept_classes": dropped_images_all_filtered,
        "images_needing_manual_review": manual_review,
        "usable_images_after_filtering": len(kept_items),
    }
    return kept_items


def write_split(items, out_root: Path):
    random.seed(RANDOM_SEED)
    items = items[:]
    random.shuffle(items)

    n = len(items)
    n_train = int(n * SPLIT_RATIOS["train"])
    n_valid = int(n * SPLIT_RATIOS["valid"])
    splits = {
        "train": items[:n_train],
        "valid": items[n_train:n_train + n_valid],
        "test": items[n_train + n_valid:],
    }

    for split_name, split_items in splits.items():
        img_out = out_root / split_name / "images"
        lbl_out = out_root / split_name / "labels"
        img_out.mkdir(parents=True, exist_ok=True)
        lbl_out.mkdir(parents=True, exist_ok=True)
        for img_path, kept_lines in split_items:
            shutil.copy2(img_path, img_out / img_path.name)
            (lbl_out / (img_path.stem + ".txt")).write_text(
                "\n".join(kept_lines) + "\n", encoding="utf-8"
            )

    return {k: len(v) for k, v in splits.items()}


def main():
    final_class_to_id = {name: i for i, name in enumerate(FINAL_CLASSES)}
    report = {"classes": FINAL_CLASSES, "random_seed": RANDOM_SEED, "datasets": {}}

    all_items = []
    for key, cfg in DATASETS.items():
        items = filter_and_remap(key, cfg, final_class_to_id, report)
        all_items.extend(items)

    if any(d.get("status") != "OK" for d in report["datasets"].values()):
        OUT_ROOT.mkdir(parents=True, exist_ok=True)
        (OUT_ROOT / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print("STOPPED before writing prepared dataset — see report.json for the reason "
              "(missing raw data and/or unmapped classes).")
        print(json.dumps(report, indent=2))
        return

    if OUT_ROOT.exists():
        shutil.rmtree(OUT_ROOT)
    split_counts = write_split(all_items, OUT_ROOT)
    report["final_split_counts"] = split_counts
    report["final_total_images"] = sum(split_counts.values())

    data_yaml = {
        "train": "train/images",
        "val": "valid/images",
        "test": "test/images",
        "nc": len(FINAL_CLASSES),
        "names": FINAL_CLASSES,
    }
    import yaml
    (OUT_ROOT / "data.yaml").write_text(yaml.safe_dump(data_yaml), encoding="utf-8")
    (OUT_ROOT / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps(report, indent=2))
    print(f"\nPrepared dataset written to: {OUT_ROOT}")
    print("No training was performed. No application files were touched.")


if __name__ == "__main__":
    main()
