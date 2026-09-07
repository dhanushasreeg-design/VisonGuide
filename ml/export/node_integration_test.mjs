// Node-side integration smoke test for the ObjectDetectionPage.jsx accessibility
// integration. Uses the REAL @huggingface/transformers package bundled in
// frontend/node_modules (same version/code path the browser uses), pointed at
// the same local model files served from frontend/public/models/.
//
// Why Node instead of a real browser: the Claude-in-Chrome extension is not
// connected in this environment, so a live UI click-through isn't possible
// right now. This exercises the actual model-loading, label-mapping, and
// post-processing logic end-to-end on a real image -- it does not exercise
// React rendering, canvas drawing, or button clicks.
//
// Run from frontend/ so node_modules resolves: node ../ml/export/node_integration_test.mjs

import path from "node:path";
import { pipeline, env, RawImage } from "@huggingface/transformers";

const TEST_IMAGE = path.resolve(
  "../ml/data/prepared/test/images",
);
const ACCESSIBILITY_THRESHOLD = 0.40;

async function main() {
  const fs = await import("node:fs");
  const files = fs.readdirSync(TEST_IMAGE);
  const imgPath = path.join(TEST_IMAGE, files[0]);
  console.log("Test image:", imgPath);
  const image = await RawImage.read(imgPath);
  console.log(`Loaded image: ${image.width}x${image.height}`);

  console.log("\n=== Accessibility detector (local model) ===");
  env.allowLocalModels = true;
  env.localModelPath = path.resolve("public/models") + path.sep;
  let accessibilityOk = false;
  let accessibilityPreds = [];
  try {
    const accessibilityModel = await pipeline("object-detection", "accessibility-detr-v1", {
      dtype: "fp32",
    });
    accessibilityOk = true;
    console.log("PASSED: accessibility-detr-v1 pipeline loaded.");
    accessibilityPreds = await accessibilityModel(image, { threshold: ACCESSIBILITY_THRESHOLD });
    console.log(`Detections (>${ACCESSIBILITY_THRESHOLD}):`, JSON.stringify(accessibilityPreds, null, 2));
  } catch (e) {
    console.error("FAILED: accessibility model load/inference error:", e.message);
    console.error(e.stack);
  }

  console.log("\n=== Existing COCO detector (remote Xenova model, unchanged config) ===");
  env.allowLocalModels = false; // exactly what the existing DETR load block sets
  let cocoOk = false;
  try {
    const detrModel = await pipeline("object-detection", "Xenova/detr-resnet-50", {
      quantized: true,
    });
    cocoOk = true;
    console.log("PASSED: Xenova/detr-resnet-50 pipeline loaded (remote, unaffected by local-model changes).");
    const cocoPreds = await detrModel(image, { threshold: 0.30 });
    console.log(`COCO detections (>0.30): ${cocoPreds.length} found. First few:`,
      JSON.stringify(cocoPreds.slice(0, 3), null, 2));
  } catch (e) {
    console.error("FAILED: COCO/Xenova model load/inference error:", e.message);
  }

  console.log("\n=== SUMMARY ===");
  console.log("Accessibility model loaded + ran:", accessibilityOk);
  console.log("Accessibility detections found:", accessibilityPreds.length);
  console.log("Existing COCO/Xenova model loaded + ran (unaffected):", cocoOk);

  const expectedLabels = new Set(["wheelchair", "white_cane", "pothole"]);
  const labelsOk = accessibilityPreds.every(p => expectedLabels.has(p.label));
  console.log("All accessibility labels within {wheelchair, white_cane, pothole}:", labelsOk);

  const boxesOk = accessibilityPreds.every(p =>
    p.box.xmin >= 0 && p.box.ymin >= 0 &&
    p.box.xmax <= image.width + 1 && p.box.ymax <= image.height + 1 &&
    p.box.xmax > p.box.xmin && p.box.ymax > p.box.ymin
  );
  console.log(`Boxes within image bounds (${image.width}x${image.height}) and well-formed:`, boxesOk);
}

main().catch(e => {
  console.error("UNHANDLED ERROR:", e);
  process.exit(1);
});
