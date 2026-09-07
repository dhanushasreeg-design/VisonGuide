// Verifies the fix: accessibility loading now only starts after the DETR
// loading attempt has fully concluded (mirroring the new `modelReady &&
// !detrLoading` gate), so there is no window where both loaders' async
// file-fetches can interleave and race on env.allowLocalModels.
import path from "node:path";
import { pipeline, env } from "@huggingface/transformers";

async function loadCocoDetr() {
  await new Promise(r => setTimeout(r, 50)); // simulate coco-ssd/mobilenet load
  console.log("[detr] starting, setting allowLocalModels=false");
  env.allowLocalModels = false;
  try {
    const m = await pipeline("object-detection", "Xenova/detr-resnet-50", { quantized: true });
    console.log("[detr] SUCCESS: pipeline loaded");
    return m;
  } catch (e) {
    console.log("[detr] FAILED:", e.message);
    return null;
  } finally {
    console.log("[detr] loading attempt concluded (this is when the real detrLoading flips false)");
  }
}

async function loadAccessibilityModel() {
  console.log("[accessibility] starting, setting allowLocalModels=true");
  env.allowLocalModels = true;
  env.localModelPath = path.resolve("public/models") + path.sep;
  try {
    const m = await pipeline("object-detection", "accessibility-detr-v1", { dtype: "fp32" });
    console.log("[accessibility] SUCCESS: pipeline loaded");
    return m;
  } catch (e) {
    console.log("[accessibility] FAILED:", e.message);
    return null;
  }
}

// FIXED sequencing: detr loads first (to completion), THEN accessibility
// starts -- exactly matching the new `modelReady && !detrLoading` gate.
const detrModel = await loadCocoDetr();
const accessibilityModel = await loadAccessibilityModel();

console.log("\n=== RESULT ===");
console.log("detr model loaded:", !!detrModel);
console.log("accessibility model loaded:", !!accessibilityModel);
