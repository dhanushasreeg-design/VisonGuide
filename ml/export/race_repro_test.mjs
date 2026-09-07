// Reproduces the ObjectDetectionPage.jsx loading pattern EXACTLY as React
// runs it: two effects both firing on the same `scriptReady` trigger, each
// an async IIFE that mutates the shared global `env.allowLocalModels`
// around its own pipeline() call, running CONCURRENTLY (not sequentially
// awaited, unlike the earlier flawed Node integration test).
import path from "node:path";
import { pipeline, env } from "@huggingface/transformers";

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

async function loadCocoDetr() {
  // mimic the real component: this only starts AFTER coco-ssd/mobilenet
  // "load" (simulated delay), same as the real effect's await chain.
  await new Promise(r => setTimeout(r, 50));
  console.log("[detr] starting, setting allowLocalModels=false");
  env.allowLocalModels = false;
  try {
    const m = await pipeline("object-detection", "Xenova/detr-resnet-50", { quantized: true });
    console.log("[detr] SUCCESS: pipeline loaded");
    return m;
  } catch (e) {
    console.log("[detr] FAILED:", e.message);
    return null;
  }
}

const [accessibilityModel, detrModel] = await Promise.all([
  loadAccessibilityModel(),
  loadCocoDetr(),
]);

console.log("\n=== RESULT ===");
console.log("accessibility model loaded:", !!accessibilityModel);
console.log("detr model loaded:", !!detrModel);
console.log("final env.allowLocalModels:", env.allowLocalModels);
