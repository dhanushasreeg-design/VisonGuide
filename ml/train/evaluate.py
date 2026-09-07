"""
Phase 4 evaluation: standard IoU-matching precision/recall/F1/AP@0.5,
duplicate-detection accounting, and a Python port of the production
`applyAccessibilityNMS` logic from ObjectDetectionPage.jsx (mirrored here
read-only for evaluation purposes -- this file does not import or modify
any frontend code).

No pycocotools dependency (not installed in this environment) -- this is a
self-contained, standard single-IoU-threshold (0.5) precision/recall/AP
implementation (VOC2010-style monotonic precision envelope), sanity-checked
against a hand-computed toy example in `_selftest()` before being trusted
for checkpoint selection or final reporting.

All boxes in this module are absolute-pixel xyxy: (x1, y1, x2, y2).
"""

import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image

CLASSES = ["wheelchair", "white_cane", "pothole"]

PRODUCTION_THRESHOLD = 0.40
NMS_IOU_THRESHOLD = 0.45
NMS_OVERLAP_THRESHOLD = 0.90


def iou_xyxy(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def overlap_coefficient(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    area_a = max(1e-9, (ax2 - ax1) * (ay2 - ay1))
    area_b = max(1e-9, (bx2 - bx1) * (by2 - by1))
    return inter / min(area_a, area_b)


def apply_accessibility_nms(detections, iou_threshold=NMS_IOU_THRESHOLD, overlap_threshold=NMS_OVERLAP_THRESHOLD):
    """Python port of applyAccessibilityNMS in ObjectDetectionPage.jsx:
    class-aware, greedy highest-score-first, suppress a lower-scored box if
    IoU > iou_threshold OR overlap-coefficient >= overlap_threshold against
    an already-kept higher-scored box of the SAME class."""
    by_class = {}
    for d in detections:
        by_class.setdefault(d["label"], []).append(d)

    kept_all = []
    for label, dets in by_class.items():
        sorted_dets = sorted(dets, key=lambda d: -d["score"])
        suppressed = [False] * len(sorted_dets)
        for i in range(len(sorted_dets)):
            if suppressed[i]:
                continue
            kept_all.append(sorted_dets[i])
            for j in range(i + 1, len(sorted_dets)):
                if suppressed[j]:
                    continue
                if (
                    iou_xyxy(sorted_dets[i]["box"], sorted_dets[j]["box"]) > iou_threshold
                    or overlap_coefficient(sorted_dets[i]["box"], sorted_dets[j]["box"]) >= overlap_threshold
                ):
                    suppressed[j] = True
    return kept_all


def match_detections_to_gt(detections, gts, iou_threshold=0.5):
    """
    detections: list of {label, score, box} sorted by score is NOT required
      (this function sorts internally, per class).
    gts: list of {label, box}
    Returns: list of per-detection outcome dicts (in score-descending order)
      with keys: label, score, outcome in {"tp", "fp_duplicate", "fp_other"}
      plus the count of unmatched (false-negative) GTs.
    A detection is "tp" if it matches an unclaimed GT of the same class at
    IoU >= threshold (best-IoU unclaimed GT is claimed).
    A detection is "fp_duplicate" if its best-IoU-eligible GT of the same
    class is already claimed by an earlier (higher- or equal-score) TP
    detection -- i.e. it is a redundant second detection of an object
    already found.
    Otherwise "fp_other" (does not sufficiently overlap any GT of its class).
    """
    results = []
    by_class_gt = {}
    for gi, g in enumerate(gts):
        by_class_gt.setdefault(g["label"], []).append(gi)
    claimed = set()

    dets_sorted = sorted(detections, key=lambda d: -d["score"])
    for d in dets_sorted:
        cand_idxs = by_class_gt.get(d["label"], [])
        best_iou, best_gi, best_unclaimed = 0.0, None, False
        for gi in cand_idxs:
            iou = iou_xyxy(d["box"], gts[gi]["box"])
            if iou > best_iou:
                best_iou = iou
                best_gi = gi
                best_unclaimed = gi not in claimed
        if best_gi is not None and best_iou >= iou_threshold:
            if best_gi not in claimed:
                claimed.add(best_gi)
                results.append({"label": d["label"], "score": d["score"], "outcome": "tp"})
            else:
                results.append({"label": d["label"], "score": d["score"], "outcome": "fp_duplicate"})
        else:
            results.append({"label": d["label"], "score": d["score"], "outcome": "fp_other"})

    num_gt_by_class = {c: len(idxs) for c, idxs in by_class_gt.items()}
    num_matched_by_class = {}
    for gi in claimed:
        lbl = gts[gi]["label"]
        num_matched_by_class[lbl] = num_matched_by_class.get(lbl, 0) + 1
    fn_by_class = {c: num_gt_by_class.get(c, 0) - num_matched_by_class.get(c, 0) for c in num_gt_by_class}

    return results, fn_by_class, num_gt_by_class


def compute_ap(scored_outcomes, num_gt):
    """scored_outcomes: list of (score, is_tp: bool), any order.
    Returns AP using VOC2010-style monotonic precision envelope."""
    if num_gt == 0:
        return None
    items = sorted(scored_outcomes, key=lambda x: -x[0])
    tp_cum, fp_cum = 0, 0
    precisions, recalls = [], []
    for score, is_tp in items:
        if is_tp:
            tp_cum += 1
        else:
            fp_cum += 1
        precisions.append(tp_cum / (tp_cum + fp_cum))
        recalls.append(tp_cum / num_gt)

    if not precisions:
        return 0.0

    # monotonic envelope (non-increasing precision as recall decreases, from the right)
    for i in range(len(precisions) - 2, -1, -1):
        precisions[i] = max(precisions[i], precisions[i + 1])

    ap = 0.0
    prev_recall = 0.0
    for p, r in zip(precisions, recalls):
        ap += (r - prev_recall) * p
        prev_recall = r
    return ap


def _selftest():
    """Hand-computed toy example, verified by hand before trusting this
    module for checkpoint selection. Run via `python evaluate.py --selftest`."""
    gts = [
        {"label": "wheelchair", "box": (0, 0, 10, 10)},   # GT1, area 100
        {"label": "wheelchair", "box": (100, 100, 110, 108)},  # GT2, area 80
    ]
    detections = [
        {"label": "wheelchair", "score": 0.9, "box": (0, 0, 10, 10)},        # perfect match to GT1 -> TP
        {"label": "wheelchair", "score": 0.8, "box": (100, 100, 110, 104)},  # IoU with GT2: overlap 10x4=40, union 80+40-40=80 -> IoU=0.5 -> TP (>=0.5 threshold)
        {"label": "wheelchair", "score": 0.5, "box": (1, 1, 11, 11)},        # overlaps GT1 (already claimed) IoU = (9*9)/(100+100-81)=81/119=0.68 -> fp_duplicate
    ]
    results, fn_by_class, num_gt_by_class = match_detections_to_gt(detections, gts, iou_threshold=0.5)
    outcomes = [r["outcome"] for r in results]
    print("Hand-computed expectation: ['tp', 'tp', 'fp_duplicate']")
    print("Got:                       ", outcomes)
    assert outcomes == ["tp", "tp", "fp_duplicate"], f"MATCHING LOGIC FAILED: {outcomes}"

    tp = sum(1 for o in outcomes if o == "tp")
    fp = sum(1 for o in outcomes if o != "tp")
    fn = fn_by_class.get("wheelchair", 0)
    precision = tp / (tp + fp)
    recall = tp / num_gt_by_class["wheelchair"]
    print(f"TP={tp} FP={fp} FN={fn} precision={precision:.3f} recall={recall:.3f}")
    assert tp == 2 and fp == 1 and fn == 0
    assert abs(precision - 2 / 3) < 1e-9
    assert abs(recall - 1.0) < 1e-9

    scored = [(d["score"], o == "tp") for d, o in zip(detections, outcomes)]
    ap = compute_ap(scored, num_gt=2)
    print(f"AP@0.5 = {ap:.4f} (expected 1.0 -- the PR curve reaches precision=1.0 at recall=1.0, "
          f"so the monotonic envelope is 1.0 across the whole recall range, per standard VOC-style AP)")
    assert abs(ap - 1.0) < 1e-9

    # IoU / overlap-coefficient sanity
    assert abs(iou_xyxy((0, 0, 10, 10), (0, 0, 10, 10)) - 1.0) < 1e-9
    assert abs(iou_xyxy((0, 0, 10, 10), (20, 20, 30, 30)) - 0.0) < 1e-9
    assert abs(overlap_coefficient((0, 0, 10, 10), (2, 2, 8, 8)) - 1.0) < 1e-9  # small box fully inside big one

    # NMS containment rule: a small box 92% contained in a bigger lower-score... construct opposite (higher score kept)
    dets = [
        {"label": "pothole", "score": 0.9, "box": (0, 0, 20, 20)},
        {"label": "pothole", "score": 0.6, "box": (2, 2, 18, 18)},  # fully inside -> overlap_coef=1.0 -> suppressed
    ]
    kept = apply_accessibility_nms(dets)
    assert len(kept) == 1 and kept[0]["score"] == 0.9, f"NMS containment rule failed: {kept}"

    print("\nSELFTEST PASSED -- matching/AP/NMS logic verified against hand-computed values.")


def _size_bucket(w, h):
    area = w * h
    if area < 0.02:
        return "small"
    elif area < 0.10:
        return "medium"
    return "large"


def _instance_bucket(n):
    if n == 1:
        return "1"
    elif n <= 4:
        return "2-4"
    return "5+"


def load_yolo_gts(lbl_path):
    boxes = []
    if lbl_path.exists():
        for line in lbl_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            c, cx, cy, w, h = line.split()
            boxes.append((int(c), float(cx), float(cy), float(w), float(h)))
    return boxes


@torch.no_grad()
def evaluate_checkpoint(checkpoint_dir, data_root, split, device, threshold=PRODUCTION_THRESHOLD):
    """Runs inference over every image in data_root/split, applies the
    production accessibility NMS, matches against ground truth at IoU 0.5,
    and returns a full metrics dict: overall + per-class + size-bucket +
    instance-count-bucket + duplicate-detection counts. Loads a fresh
    model/processor from checkpoint_dir -- use evaluate_loaded_model
    instead when you already have a model in memory (e.g. mid-training)."""
    from transformers import AutoImageProcessor, DetrForObjectDetection

    processor = AutoImageProcessor.from_pretrained(checkpoint_dir)
    model = DetrForObjectDetection.from_pretrained(checkpoint_dir)
    model.to(device)
    model.eval()
    return evaluate_loaded_model(model, processor, data_root, split, device, threshold, checkpoint_label=str(checkpoint_dir))


@torch.no_grad()
def evaluate_loaded_model(model, processor, data_root, split, device, threshold=PRODUCTION_THRESHOLD, checkpoint_label="<in-memory>"):
    """Same as evaluate_checkpoint but takes an already-loaded model/processor
    (caller is responsible for .eval()/.to(device) as needed; this function
    restores model.eval() on exit-equivalent by leaving mode as the caller
    had it -- caller should call model.train() again afterward if resuming
    training)."""
    was_training = model.training
    model.eval()

    img_dir = Path(data_root) / split / "images"
    lbl_dir = Path(data_root) / split / "labels"
    img_paths = sorted(p for p in img_dir.glob("*") if p.is_file())

    # accumulators
    all_scored = {c: [] for c in CLASSES}          # (score, is_tp) for AP
    tp = {c: 0 for c in CLASSES}
    fp_dup = {c: 0 for c in CLASSES}
    fp_other = {c: 0 for c in CLASSES}
    fn = {c: 0 for c in CLASSES}
    num_gt_total = {c: 0 for c in CLASSES}
    confidences_tp, confidences_fp = [], []

    bucket_stats = {}  # (dim, key) -> {tp,fp,fn}
    def bump(dim, key, field):
        bucket_stats.setdefault((dim, key), {"tp": 0, "fp": 0, "fn": 0})[field] += 1

    for img_path in img_paths:
        lbl_path = lbl_dir / (img_path.stem + ".txt")
        raw_gts = load_yolo_gts(lbl_path)
        if not raw_gts:
            continue
        image = Image.open(img_path).convert("RGB")
        w, h = image.size

        gts = []
        gt_meta = []  # (label, size_bucket) per gt, for stratification
        n_instances_by_class = {}
        for cid, cx, cy, bw, bh in raw_gts:
            n_instances_by_class[cid] = n_instances_by_class.get(cid, 0) + 1
        for cid, cx, cy, bw, bh in raw_gts:
            label = CLASSES[cid]
            x1, y1 = (cx - bw / 2) * w, (cy - bh / 2) * h
            x2, y2 = (cx + bw / 2) * w, (cy + bh / 2) * h
            gts.append({"label": label, "box": (x1, y1, x2, y2)})
            gt_meta.append((label, _size_bucket(bw, bh), _instance_bucket(n_instances_by_class[cid])))
            num_gt_total[label] += 1

        inputs = processor(images=image, return_tensors="pt").to(device)
        outputs = model(**inputs)
        target_sizes = torch.tensor([[h, w]])
        processed = processor.post_process_object_detection(outputs, threshold=threshold, target_sizes=target_sizes)[0]

        raw_dets = []
        for score, label_id, box in zip(processed["scores"], processed["labels"], processed["boxes"]):
            lid = int(label_id.item())
            if lid >= len(CLASSES):
                continue
            raw_dets.append({
                "label": CLASSES[lid],
                "score": float(score.item()),
                "box": tuple(box.tolist()),
            })

        kept_dets = apply_accessibility_nms(raw_dets)
        results, fn_by_class, num_gt_by_class = match_detections_to_gt(kept_dets, gts, iou_threshold=0.5)

        for r in results:
            c = r["label"]
            all_scored[c].append((r["score"], r["outcome"] == "tp"))
            if r["outcome"] == "tp":
                tp[c] += 1
                confidences_tp.append(r["score"])
            elif r["outcome"] == "fp_duplicate":
                fp_dup[c] += 1
                confidences_fp.append(r["score"])
            else:
                fp_other[c] += 1
                confidences_fp.append(r["score"])

        for c, n in fn_by_class.items():
            fn[c] += n

        # per-image bucket stratification: approximate by assigning each
        # matched/unmatched GT to its own size/instance bucket
        claimed_gt_boxes = set()
        for det in kept_dets:
            best_iou, best_idx = 0.0, None
            for gi, g in enumerate(gts):
                if g["label"] != det["label"] or gi in claimed_gt_boxes:
                    continue
                iou = iou_xyxy(det["box"], g["box"])
                if iou > best_iou:
                    best_iou, best_idx = iou, gi
            if best_idx is not None and best_iou >= 0.5:
                claimed_gt_boxes.add(best_idx)
                label, size_b, inst_b = gt_meta[best_idx]
                bump("size", size_b, "tp")
                bump("instances", inst_b, "tp")
        for gi, (label, size_b, inst_b) in enumerate(gt_meta):
            if gi not in claimed_gt_boxes:
                bump("size", size_b, "fn")
                bump("instances", inst_b, "fn")

    per_class = {}
    for c in CLASSES:
        n_tp, n_fpd, n_fpo, n_fn = tp[c], fp_dup[c], fp_other[c], fn[c]
        n_fp = n_fpd + n_fpo
        precision = n_tp / (n_tp + n_fp) if (n_tp + n_fp) > 0 else None
        recall = n_tp / (n_tp + n_fn) if (n_tp + n_fn) > 0 else None
        f1 = (2 * precision * recall / (precision + recall)) if precision and recall and (precision + recall) > 0 else None
        ap = compute_ap(all_scored[c], num_gt_total[c])
        per_class[c] = {
            "tp": n_tp, "fp_duplicate": n_fpd, "fp_other": n_fpo, "fp_total": n_fp, "fn": n_fn,
            "num_gt": num_gt_total[c],
            "precision": precision, "recall": recall, "f1": f1, "ap_at_0.5": ap,
        }

    stratified = {}
    for (dim, key), counts in bucket_stats.items():
        t, f = counts["tp"], counts["fn"]
        recall = t / (t + f) if (t + f) > 0 else None
        stratified.setdefault(dim, {})[key] = {"tp": t, "fn": f, "recall": recall}

    if was_training:
        model.train()

    return {
        "checkpoint": checkpoint_label,
        "split": split,
        "threshold": threshold,
        "per_class": per_class,
        "stratified_recall": stratified,
        "confidence_distribution": {
            "tp_mean": float(np.mean(confidences_tp)) if confidences_tp else None,
            "tp_count": len(confidences_tp),
            "fp_mean": float(np.mean(confidences_fp)) if confidences_fp else None,
            "fp_count": len(confidences_fp),
        },
        "total_duplicate_detections": sum(fp_dup.values()),
        "total_images_evaluated": len(img_paths),
    }


if __name__ == "__main__":
    import sys
    if "--selftest" in sys.argv:
        _selftest()
    else:
        print("Run with --selftest to verify the evaluation logic, or import evaluate_checkpoint() "
              "from this module for actual model evaluation.")
