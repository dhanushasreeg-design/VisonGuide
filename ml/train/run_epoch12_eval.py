"""
Evaluation-only: score the already-existing Phase 4 epoch-12 checkpoint
(ml/checkpoints/accessibility_detr_v2_exp1_final_last/, saved automatically
every epoch regardless of "best" status -- confirmed via its resume-state
file's last_completed_epoch: 12) against ml/data/prepared_v2/test, using
the identical pipeline (threshold=0.40, same accessibility NMS) already
used for the OLD-vs-epoch-8 comparison.

No training. No file writes except this report. Does not touch
accessibility_detr_best/, the epoch-8 checkpoint, ONNX, or any app code.
"""
import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import evaluate as eval_module  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = ROOT / "data" / "prepared_v2"
EPOCH12_CKPT = ROOT / "checkpoints" / "accessibility_detr_v2_exp1_final_last"
OUT_PATH = ROOT / "train" / "epoch12_eval_report.json"


def main():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")
    print(f"\n=== Evaluating EPOCH-12 checkpoint: {EPOCH12_CKPT} ===")
    results = eval_module.evaluate_checkpoint(EPOCH12_CKPT, DATA_ROOT, "test", device)
    print(json.dumps(results["per_class"], indent=2))
    print("stratified_recall:", json.dumps(results["stratified_recall"], indent=2))
    print("confidence_distribution:", json.dumps(results["confidence_distribution"], indent=2))
    print("total_duplicate_detections:", results["total_duplicate_detections"])

    OUT_PATH.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nReport written to {OUT_PATH}")


if __name__ == "__main__":
    main()
