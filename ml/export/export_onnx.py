"""
Direct torch.onnx.export of the verified accessibility-detector checkpoint
(ml/checkpoints/accessibility_detr_best) — no `optimum` exporter used
(deliberately avoided; installing optimum-onnx would have downgraded
optimum 2.3.0 -> 2.1.0, which was not approved).

Verified forward signature (transformers 4.57.3,
DetrForObjectDetection.forward), inspected before writing this wrapper:

    forward(self, pixel_values, pixel_mask=None, decoder_attention_mask=None,
            encoder_outputs=None, inputs_embeds=None, decoder_inputs_embeds=None,
            labels=None, output_attentions=None, output_hidden_states=None,
            return_dict=None) -> DetrObjectDetectionOutput

    With labels=None, the model computes:
        logits     = class_labels_classifier(sequence_output)   # (B, 100, num_labels+1)
        pred_boxes = bbox_predictor(sequence_output).sigmoid()  # (B, 100, 4)

The image processor (DetrImageProcessor, do_pad=True) always produces a
pixel_mask alongside pixel_values, so both are wired through explicitly
rather than relying on the model's internal all-ones default.

Reads only from ml/checkpoints/accessibility_detr_best (never written to).
Writes only under ml/onnx_export/ (separate, new directory).
"""

import json
import sys
from pathlib import Path

import onnx
import torch
from PIL import Image
from transformers import AutoImageProcessor, DetrForObjectDetection

CKPT_DIR = Path("ml/checkpoints/accessibility_detr_best")
OUT_DIR = Path("ml/onnx_export/accessibility_detr")
OUT_PATH = OUT_DIR / "model.onnx"
TEST_IMAGE = Path("ml/data/prepared/test/images")
OPSET = 17


class DetrOnnxWrapper(torch.nn.Module):
    """Returns exactly (logits, pred_boxes) — nothing else — for a clean ONNX graph."""

    def __init__(self, model: DetrForObjectDetection):
        super().__init__()
        self.model = model

    def forward(self, pixel_values, pixel_mask):
        out = self.model(pixel_values=pixel_values, pixel_mask=pixel_mask, return_dict=True)
        return out.logits, out.pred_boxes


def main():
    print(f"Loading verified checkpoint from: {CKPT_DIR.resolve()}")
    processor = AutoImageProcessor.from_pretrained(CKPT_DIR)
    model = DetrForObjectDetection.from_pretrained(CKPT_DIR)
    model.eval()

    id2label = model.config.id2label
    print("id2label from loaded model.config:", id2label)
    expected = {0: "wheelchair", 1: "white_cane", 2: "pothole"}
    actual = {int(k): v for k, v in id2label.items()}
    if actual != expected:
        print(f"FAIL: id2label mismatch. expected={expected} actual={actual}")
        sys.exit(1)
    print("Class mapping verified OK before export:", actual)

    img_path = sorted(TEST_IMAGE.glob("*"))[0]
    print(f"Using held-out test image for tracing + comparison: {img_path.name}")
    image = Image.open(img_path).convert("RGB")
    inputs = processor(images=image, return_tensors="pt")
    pixel_values = inputs["pixel_values"]
    pixel_mask = inputs["pixel_mask"]
    print(f"Preprocessed input shapes: pixel_values={tuple(pixel_values.shape)}, "
          f"pixel_mask={tuple(pixel_mask.shape)}")

    wrapper = DetrOnnxWrapper(model)
    wrapper.eval()

    with torch.no_grad():
        pt_logits, pt_pred_boxes = wrapper(pixel_values, pixel_mask)
    print(f"PyTorch wrapper forward OK. logits={tuple(pt_logits.shape)}, "
          f"pred_boxes={tuple(pt_pred_boxes.shape)}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Exporting to ONNX (opset {OPSET}) at: {OUT_PATH.resolve()}")
    torch.onnx.export(
        wrapper,
        (pixel_values, pixel_mask),
        str(OUT_PATH),
        input_names=["pixel_values", "pixel_mask"],
        output_names=["logits", "pred_boxes"],
        dynamic_axes={
            "pixel_values": {0: "batch", 2: "height", 3: "width"},
            "pixel_mask": {0: "batch", 1: "height", 2: "width"},
            "logits": {0: "batch"},
            "pred_boxes": {0: "batch"},
        },
        opset_version=OPSET,
        do_constant_folding=True,
    )
    print("torch.onnx.export completed without raising.")

    # Persist class mapping alongside the ONNX file explicitly (do not rely on
    # ONNX graph metadata alone, per instructions) so any future loader has an
    # unambiguous, human-checkable source of truth.
    labels_path = OUT_DIR / "labels.json"
    labels_path.write_text(json.dumps({"id2label": expected, "label2id": {v: k for k, v in expected.items()}}, indent=2))
    print(f"Wrote explicit label mapping to: {labels_path.resolve()}")

    size_bytes = OUT_PATH.stat().st_size
    print(f"ONNX file size: {size_bytes} bytes ({size_bytes / 1e6:.2f} MB)")
    print("Export step finished. No PyTorch checkpoint files were modified.")


if __name__ == "__main__":
    main()
