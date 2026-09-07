"""
Phase 4 final evaluation: OLD (accessibility_detr_best, v1, trained on the
leaky prepared/ split) vs NEW (accessibility_detr_v2_exp1_final's selected
best checkpoint, epoch 8, trained on leakage-safe prepared_v2 with
augmentation) -- both evaluated identically, once, against the genuinely
held-out ml/data/prepared_v2/test split (never used for training or
checkpoint selection for either model).

Uses the same evaluate.py matching/AP/NMS code that was hand-verified
against a toy example in evaluate.py's _selftest() before being trusted.

Read-only: loads checkpoints and runs inference only. No training, no
ONNX export, no file writes except this comparison report.
"""
import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import evaluate as eval_module  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = ROOT / "data" / "prepared_v2"
OLD_CKPT = ROOT / "checkpoints" / "accessibility_detr_best"
NEW_CKPT = ROOT / "checkpoints" / "accessibility_detr_v2_exp1_final"
OUT_PATH = ROOT / "train" / "old_vs_new_eval_report.json"


def main():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    print(f"\n=== Evaluating OLD checkpoint: {OLD_CKPT} ===")
    old_results = eval_module.evaluate_checkpoint(OLD_CKPT, DATA_ROOT, "test", device)
    print(json.dumps(old_results["per_class"], indent=2))

    print(f"\n=== Evaluating NEW checkpoint: {NEW_CKPT} ===")
    new_results = eval_module.evaluate_checkpoint(NEW_CKPT, DATA_ROOT, "test", device)
    print(json.dumps(new_results["per_class"], indent=2))

    report = {
        "data_root": str(DATA_ROOT),
        "split_evaluated": "test",
        "threshold": eval_module.PRODUCTION_THRESHOLD,
        "nms": {"iou_threshold": eval_module.NMS_IOU_THRESHOLD, "overlap_threshold": eval_module.NMS_OVERLAP_THRESHOLD},
        "old": old_results,
        "new": new_results,
    }
    OUT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nReport written to {OUT_PATH}")


if __name__ == "__main__":
    main()
