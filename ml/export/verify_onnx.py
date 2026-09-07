"""
Read-only verification of ml/onnx_export/accessibility_detr/model.onnx against
the verified PyTorch checkpoint ml/checkpoints/accessibility_detr_best.
Does not modify the ONNX file, the PyTorch checkpoint, or any application code.
"""

import json
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from PIL import Image
from transformers import AutoImageProcessor, DetrForObjectDetection

CKPT_DIR = Path("ml/checkpoints/accessibility_detr_best")
ONNX_PATH = Path("ml/onnx_export/accessibility_detr/model.onnx")
LABELS_PATH = Path("ml/onnx_export/accessibility_detr/labels.json")
TEST_IMAGE_DIR = Path("ml/data/prepared/test/images")


def main():
    print("=" * 70)
    print("1. onnx.checker.check_model")
    print("=" * 70)
    onnx_model = onnx.load(str(ONNX_PATH))
    onnx.checker.check_model(onnx_model)
    print("PASSED: onnx.checker raised no errors.")

    print("=" * 70)
    print("2. Load with ONNX Runtime")
    print("=" * 70)
    session = ort.InferenceSession(str(ONNX_PATH), providers=["CPUExecutionProvider"])
    print("PASSED: onnxruntime.InferenceSession created successfully.")
    print("ONNX Runtime version:", ort.__version__)

    print("=" * 70)
    print("3. Input names / shapes / types")
    print("=" * 70)
    for inp in session.get_inputs():
        print(f"  name={inp.name!r} shape={inp.shape} type={inp.type}")

    print("=" * 70)
    print("4. Output names / shapes / types")
    print("=" * 70)
    for out in session.get_outputs():
        print(f"  name={out.name!r} shape={out.shape} type={out.type}")

    print("=" * 70)
    print("5. Explicit label mapping file (not relying on ONNX metadata)")
    print("=" * 70)
    labels = json.loads(LABELS_PATH.read_text())
    print("labels.json contents:", labels)
    expected = {"0": "wheelchair", "1": "white_cane", "2": "pothole"}
    assert labels["id2label"] == expected, f"MISMATCH: {labels['id2label']} != {expected}"
    print("PASSED: id2label in labels.json matches required 0=wheelchair,1=white_cane,2=pothole.")
    # ONNX graph itself carries no label metadata for a raw torch.onnx.export
    # (unlike a HF `optimum` export's config.json) -- confirm that explicitly
    # rather than assuming, since the checker only validates graph structure.
    meta_keys = [p.key for p in onnx_model.metadata_props]
    print(f"ONNX model.metadata_props keys found: {meta_keys} "
          f"(expected: none — labels.json above is the source of truth, by design)")

    print("=" * 70)
    print("6. PyTorch vs ONNX Runtime numerical comparison (same test image)")
    print("=" * 70)
    processor = AutoImageProcessor.from_pretrained(CKPT_DIR)
    pt_model = DetrForObjectDetection.from_pretrained(CKPT_DIR)
    pt_model.eval()

    img_path = sorted(TEST_IMAGE_DIR.glob("*"))[0]
    print(f"Test image: {img_path.name}")
    image = Image.open(img_path).convert("RGB")
    inputs = processor(images=image, return_tensors="pt")
    pixel_values = inputs["pixel_values"]
    pixel_mask = inputs["pixel_mask"]

    with torch.no_grad():
        pt_out = pt_model(pixel_values=pixel_values, pixel_mask=pixel_mask, return_dict=True)
    pt_logits = pt_out.logits.numpy()
    pt_boxes = pt_out.pred_boxes.numpy()

    ort_inputs = {
        "pixel_values": pixel_values.numpy().astype(np.float32),
        "pixel_mask": pixel_mask.numpy().astype(np.int64),
    }
    ort_logits, ort_boxes = session.run(["logits", "pred_boxes"], ort_inputs)

    logits_max_abs_diff = np.max(np.abs(pt_logits - ort_logits))
    boxes_max_abs_diff = np.max(np.abs(pt_boxes - ort_boxes))
    print(f"logits shape: pt={pt_logits.shape} onnx={ort_logits.shape}")
    print(f"pred_boxes shape: pt={pt_boxes.shape} onnx={ort_boxes.shape}")
    print(f"logits max abs diff: {logits_max_abs_diff:.8f}")
    print(f"pred_boxes max abs diff: {boxes_max_abs_diff:.8f}")

    logits_ok = np.allclose(pt_logits, ort_logits, atol=1e-3, rtol=1e-3)
    boxes_ok = np.allclose(pt_boxes, ort_boxes, atol=1e-3, rtol=1e-3)
    print(f"logits allclose(atol=1e-3, rtol=1e-3): {logits_ok}")
    print(f"pred_boxes allclose(atol=1e-3, rtol=1e-3): {boxes_ok}")
    if not (logits_ok and boxes_ok):
        print("WARNING: numerical outputs diverge beyond normal fp32 tolerance.")

    print("=" * 70)
    print("7. Post-processed detections: PyTorch vs ONNX")
    print("=" * 70)
    target_sizes = torch.tensor([image.size[::-1]])

    pt_results = processor.post_process_object_detection(pt_out, target_sizes=target_sizes, threshold=0.3)[0]
    print(f"PyTorch detections (>0.3): {len(pt_results['scores'])}")
    for s, l, b in zip(pt_results["scores"], pt_results["labels"], pt_results["boxes"]):
        print(f"  {pt_model.config.id2label[l.item()]:12s} score={s.item():.3f} box={[round(x,1) for x in b.tolist()]}")

    class DummyOnnxOutput:
        def __init__(self, logits, pred_boxes):
            self.logits = logits
            self.pred_boxes = pred_boxes

    onnx_out_wrapped = DummyOnnxOutput(torch.from_numpy(ort_logits), torch.from_numpy(ort_boxes))
    onnx_results = processor.post_process_object_detection(onnx_out_wrapped, target_sizes=target_sizes, threshold=0.3)[0]
    print(f"ONNX detections (>0.3): {len(onnx_results['scores'])}")
    id2label = {int(k): v for k, v in labels["id2label"].items()}
    for s, l, b in zip(onnx_results["scores"], onnx_results["labels"], onnx_results["boxes"]):
        print(f"  {id2label[l.item()]:12s} score={s.item():.3f} box={[round(x,1) for x in b.tolist()]}")

    same_count = len(pt_results["scores"]) == len(onnx_results["scores"])
    same_labels = pt_results["labels"].tolist() == onnx_results["labels"].tolist()
    score_diffs = (pt_results["scores"] - onnx_results["scores"]).abs().tolist() if same_count else None
    box_diffs = (pt_results["boxes"] - onnx_results["boxes"]).abs().max().item() if same_count else None
    print(f"Same detection count: {same_count}")
    print(f"Same labels (in order): {same_labels}")
    print(f"Per-detection score abs diffs: {score_diffs}")
    print(f"Max box coordinate abs diff: {box_diffs}")

    print("=" * 70)
    print("VERIFICATION SUMMARY")
    print("=" * 70)
    all_ok = logits_ok and boxes_ok and same_count and same_labels
    print(f"Overall PyTorch vs ONNX match: {'PASS' if all_ok else 'DISCREPANCY FOUND'}")


if __name__ == "__main__":
    main()
