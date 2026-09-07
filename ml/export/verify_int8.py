"""
Read-only verification of the INT8 dynamically-quantized ONNX model against
the verified FP32 ONNX export. Does not modify either model.
"""

import json
import time
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from PIL import Image
from transformers import AutoImageProcessor

CKPT_DIR = Path("ml/checkpoints/accessibility_detr_best")
FP32_PATH = Path("ml/onnx_export/accessibility_detr/model.onnx")
INT8_PATH = Path("ml/onnx_export/accessibility_detr_int8/model.onnx")
LABELS_PATH = Path("ml/onnx_export/accessibility_detr_int8/labels.json")
TEST_IMAGE_DIR = Path("ml/data/prepared/test/images")


def load_and_check(path, name):
    print(f"--- {name}: onnx.checker ---")
    m = onnx.load(str(path))
    onnx.checker.check_model(m)
    print(f"PASSED: {name} passes onnx.checker.")
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    print(f"PASSED: {name} loads in ONNX Runtime.")
    print(f"{name} inputs:")
    for inp in sess.get_inputs():
        print(f"  name={inp.name!r} shape={inp.shape} type={inp.type}")
    print(f"{name} outputs:")
    for out in sess.get_outputs():
        print(f"  name={out.name!r} shape={out.shape} type={out.type}")
    return sess


def timed_run(sess, ort_inputs, n=20):
    # warmup
    for _ in range(3):
        sess.run(["logits", "pred_boxes"], ort_inputs)
    times = []
    for _ in range(n):
        t0 = time.perf_counter()
        sess.run(["logits", "pred_boxes"], ort_inputs)
        times.append(time.perf_counter() - t0)
    return times


def main():
    print("=" * 70)
    print("1+2+3+4. onnx.checker + ONNX Runtime load + input/output signatures")
    print("=" * 70)
    fp32_sess = load_and_check(FP32_PATH, "FP32")
    int8_sess = load_and_check(INT8_PATH, "INT8")

    print("=" * 70)
    print("Sizes")
    print("=" * 70)
    fp32_size = FP32_PATH.stat().st_size
    int8_size = INT8_PATH.stat().st_size
    print(f"FP32: {fp32_size} bytes ({fp32_size/1e6:.2f} MB)")
    print(f"INT8: {int8_size} bytes ({int8_size/1e6:.2f} MB)")
    print(f"Ratio: {fp32_size/int8_size:.2f}x smaller")

    print("=" * 70)
    print("5. Same held-out test image -> preprocessed inputs")
    print("=" * 70)
    processor = AutoImageProcessor.from_pretrained(CKPT_DIR)
    img_path = sorted(TEST_IMAGE_DIR.glob("*"))[0]
    print(f"Test image: {img_path.name}")
    image = Image.open(img_path).convert("RGB")
    inputs = processor(images=image, return_tensors="pt")
    ort_inputs = {
        "pixel_values": inputs["pixel_values"].numpy().astype(np.float32),
        "pixel_mask": inputs["pixel_mask"].numpy().astype(np.int64),
    }

    print("=" * 70)
    print("6. FP32 ONNX vs INT8 ONNX raw output comparison")
    print("=" * 70)
    fp32_logits, fp32_boxes = fp32_sess.run(["logits", "pred_boxes"], ort_inputs)
    int8_logits, int8_boxes = int8_sess.run(["logits", "pred_boxes"], ort_inputs)

    logits_diff = np.abs(fp32_logits - int8_logits)
    boxes_diff = np.abs(fp32_boxes - int8_boxes)
    print(f"logits shape: fp32={fp32_logits.shape} int8={int8_logits.shape}")
    print(f"pred_boxes shape: fp32={fp32_boxes.shape} int8={int8_boxes.shape}")
    print(f"logits max abs diff: {logits_diff.max():.4f}, mean abs diff: {logits_diff.mean():.4f}")
    print(f"pred_boxes max abs diff: {boxes_diff.max():.4f}, mean abs diff: {boxes_diff.mean():.4f}")
    logits_close_loose = np.allclose(fp32_logits, int8_logits, atol=0.5, rtol=0.1)
    print(f"logits allclose(atol=0.5, rtol=0.1) [loose, INT8-appropriate]: {logits_close_loose}")

    print("=" * 70)
    print("7. Post-processing at threshold=0.30: FP32 vs INT8")
    print("=" * 70)
    target_sizes = torch.tensor([image.size[::-1]])
    labels = json.loads(LABELS_PATH.read_text())
    id2label = {int(k): v for k, v in labels["id2label"].items()}

    class OutWrap:
        def __init__(self, logits, boxes):
            self.logits = torch.from_numpy(logits)
            self.pred_boxes = torch.from_numpy(boxes)

    fp32_results = processor.post_process_object_detection(
        OutWrap(fp32_logits, fp32_boxes), target_sizes=target_sizes, threshold=0.30)[0]
    int8_results = processor.post_process_object_detection(
        OutWrap(int8_logits, int8_boxes), target_sizes=target_sizes, threshold=0.30)[0]

    print(f"FP32 detections (>0.30): {len(fp32_results['scores'])}")
    for s, l, b in zip(fp32_results["scores"], fp32_results["labels"], fp32_results["boxes"]):
        print(f"  {id2label[l.item()]:12s} score={s.item():.4f} box={[round(x,1) for x in b.tolist()]}")

    print(f"INT8 detections (>0.30): {len(int8_results['scores'])}")
    for s, l, b in zip(int8_results["scores"], int8_results["labels"], int8_results["boxes"]):
        print(f"  {id2label[l.item()]:12s} score={s.item():.4f} box={[round(x,1) for x in b.tolist()]}")

    print("=" * 70)
    print("8. Detection-level comparison")
    print("=" * 70)
    same_count = len(fp32_results["scores"]) == len(int8_results["scores"])
    same_labels = fp32_results["labels"].tolist() == int8_results["labels"].tolist()
    print(f"Same detection count: {same_count} (fp32={len(fp32_results['scores'])}, int8={len(int8_results['scores'])})")
    print(f"Same labels in same order: {same_labels}")
    if same_count:
        score_diffs = (fp32_results["scores"] - int8_results["scores"]).abs().tolist()
        box_diffs = (fp32_results["boxes"] - int8_results["boxes"]).abs()
        print(f"Per-detection score abs diffs: {[round(x,4) for x in score_diffs]}")
        print(f"Max box coordinate abs diff: {box_diffs.max().item():.2f} px")
        print(f"Mean box coordinate abs diff: {box_diffs.mean().item():.2f} px")

    print("=" * 70)
    print("9. Inference timing (CPUExecutionProvider, same input, 20 runs after 3 warmup)")
    print("=" * 70)
    fp32_times = timed_run(fp32_sess, ort_inputs)
    int8_times = timed_run(int8_sess, ort_inputs)
    print(f"FP32: mean={np.mean(fp32_times)*1000:.1f}ms median={np.median(fp32_times)*1000:.1f}ms "
          f"min={np.min(fp32_times)*1000:.1f}ms max={np.max(fp32_times)*1000:.1f}ms")
    print(f"INT8: mean={np.mean(int8_times)*1000:.1f}ms median={np.median(int8_times)*1000:.1f}ms "
          f"min={np.min(int8_times)*1000:.1f}ms max={np.max(int8_times)*1000:.1f}ms")
    print(f"Speedup (mean): {np.mean(fp32_times)/np.mean(int8_times):.2f}x")

    print("=" * 70)
    print("SUMMARY")
    print("=" * 70)
    verdict = "CONSISTENT" if (same_count and same_labels) else "DISCREPANCY FOUND -- see above"
    print(f"FP32 vs INT8 detection-level match: {verdict}")


if __name__ == "__main__":
    main()
