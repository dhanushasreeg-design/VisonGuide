"""
Dynamic INT8 quantization of the verified FP32 ONNX export
(ml/onnx_export/accessibility_detr/model.onnx) into a SEPARATE artifact.

Method chosen after inspecting the graph (2367 nodes: 54 Conv, 136 MatMul,
31 LayerNormalization, 18 Softmax -- a hybrid CNN+Transformer, as expected
for DETR): ONNX Runtime's dynamic quantization (`quantize_dynamic`), which
is the tool's own recommended default for transformer-containing models --
no calibration dataset required (unlike static quantization), and it does
not require retraining or touching the original weights file.

Uses only onnxruntime.quantization, already installed as part of
onnxruntime 1.25.1 -- no new dependency.

Reads only ml/onnx_export/accessibility_detr/model.onnx (never modified).
Writes only under ml/onnx_export/accessibility_detr_int8/.
"""

import shutil
from pathlib import Path

from onnxruntime.quantization import QuantType, quantize_dynamic
from onnxruntime.quantization.shape_inference import quant_pre_process

FP32_MODEL = Path("ml/onnx_export/accessibility_detr/model.onnx")
FP32_LABELS = Path("ml/onnx_export/accessibility_detr/labels.json")
OUT_DIR = Path("ml/onnx_export/accessibility_detr_int8")
PREPROCESSED_MODEL = OUT_DIR / "model_preprocessed.onnx"
INT8_MODEL = OUT_DIR / "model.onnx"


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Source FP32 model (untouched): {FP32_MODEL.resolve()}")
    print(f"FP32 size: {FP32_MODEL.stat().st_size} bytes ({FP32_MODEL.stat().st_size/1e6:.2f} MB)")

    print("Step 1: quant_pre_process (shape inference + optimizations recommended "
          "before quantization, per ONNX Runtime docs) -> intermediate file, "
          "original FP32 file not touched.")
    # skip_symbolic_shape=True: ORT's documented recovery path when symbolic
    # shape inference raises "Incomplete symbolic shape inference" on graphs
    # with data-dependent shapes (hit on the first attempt with this DETR
    # graph, likely from the CumSum/Sin/Cos position-embedding pattern).
    quant_pre_process(
        input_model_path=str(FP32_MODEL),
        output_model_path=str(PREPROCESSED_MODEL),
        skip_symbolic_shape=True,
    )
    print(f"Preprocessed model written to: {PREPROCESSED_MODEL.resolve()}")

    print("Step 2: quantize_dynamic (INT8 weights, MatMul/Gemm-class ops -- "
          "ORT's default op set for dynamic quantization; Conv left as-is, "
          "which is standard for dynamic mode since Conv dynamic quantization "
          "is not well supported / not part of ORT's default dynamic op set).")
    quantize_dynamic(
        model_input=str(PREPROCESSED_MODEL),
        model_output=str(INT8_MODEL),
        weight_type=QuantType.QInt8,
    )
    print(f"Quantized model written to: {INT8_MODEL.resolve()}")

    int8_size = INT8_MODEL.stat().st_size
    fp32_size = FP32_MODEL.stat().st_size
    print(f"INT8 size: {int8_size} bytes ({int8_size/1e6:.2f} MB)")
    print(f"Size reduction: {fp32_size/int8_size:.2f}x ({(1 - int8_size/fp32_size)*100:.1f}% smaller)")

    labels_dst = OUT_DIR / "labels.json"
    shutil.copy2(FP32_LABELS, labels_dst)
    print(f"Copied labels.json to: {labels_dst.resolve()}")

    print("Quantization step finished. Original FP32 model file untouched.")


if __name__ == "__main__":
    main()
