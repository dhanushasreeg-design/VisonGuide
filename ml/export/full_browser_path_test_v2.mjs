// Full end-to-end test of the FIXED loading sequence + inference on three
// real held-out test images (one per accessibility class), using the exact
// pipeline() calls/options ObjectDetectionPage.jsx now uses.
import path from "node:path";
import { pipeline, env, RawImage } from "@huggingface/transformers";

const ACCESSIBILITY_THRESHOLD = 0.40;
const IMAGES = {
  wheelchair: "-136_jpg.rf.eaa2dd1e96d7e2b52c8c56ada603920e.jpg",
  white_cane: "IMG_0329_MOV-10_jpg.rf.4ecdd368b8f9574fbcc056922879dc7d.jpg",
  pothole: "img-102_jpg.rf.16c56ff8f761aec963d9b57aa1b2d3fd.jpg",
};
const IMG_DIR = path.resolve("../ml/data/prepared/test/images");

async function loadCocoDetr() {
  await new Promise(r => setTimeout(r, 50));
  env.allowLocalModels = false;
  const m = await pipeline("object-detection", "Xenova/detr-resnet-50", { quantized: true });
  return m;
}

async function loadAccessibilityModel() {
  env.allowLocalModels = true;
  env.localModelPath = path.resolve("public/models") + path.sep;
  const m = await pipeline("object-detection", "accessibility-detr-v1", { dtype: "fp32", local_files_only: true });
  return m;
}

async function main() {
  console.log("=== Loading (fixed sequencing: DETR first, then accessibility) ===");
  const detrModel = await loadCocoDetr();
  console.log("DETR loaded.");
  const accessibilityModel = await loadAccessibilityModel();
  console.log("Accessibility model loaded.");

  for (const [expectedClass, filename] of Object.entries(IMAGES)) {
    console.log(`\n=== Test image: ${expectedClass} (${filename}) ===`);
    const imgPath = path.join(IMG_DIR, filename);
    const image = await RawImage.read(imgPath);
    console.log(`Image size: ${image.width}x${image.height}`);

    const accessPreds = await accessibilityModel(image, { threshold: ACCESSIBILITY_THRESHOLD });
    console.log(`Accessibility predictions (threshold=${ACCESSIBILITY_THRESHOLD}):`, JSON.stringify(accessPreds));

    const cocoPreds = await detrModel(image, { threshold: 0.30 });
    console.log(`COCO predictions (threshold=0.30): ${cocoPreds.length} found -- `,
      cocoPreds.map(p => `${p.label}(${p.score.toFixed(2)})`).join(", "));

    // bbox bounds check
    const boxesOk = accessPreds.every(p =>
      p.box.xmin >= 0 && p.box.ymin >= 0 &&
      p.box.xmax <= image.width + 1 && p.box.ymax <= image.height + 1 &&
      p.box.xmax > p.box.xmin && p.box.ymax > p.box.ymin
    );
    console.log(`Accessibility boxes within image bounds: ${boxesOk}`);
    const hasExpected = accessPreds.some(p => p.label === expectedClass);
    console.log(`Contains expected class "${expectedClass}": ${hasExpected}`);
  }

  console.log("\n=== Fallback test: simulated accessibility model failure ===");
  const brokenAccessibility = null; // simulates accessibilityDetrRef.current === null
  const testImg = await RawImage.read(path.join(IMG_DIR, IMAGES.wheelchair));
  const accessBranch = brokenAccessibility
    ? await brokenAccessibility(testImg, { threshold: ACCESSIBILITY_THRESHOLD })
    : []; // mirrors: if (!accessibilityDetrRef.current) return [];
  const cocoStillWorks = await detrModel(testImg, { threshold: 0.30 });
  console.log("Accessibility branch result when ref is null:", JSON.stringify(accessBranch));
  console.log("COCO still works when accessibility ref is null:", cocoStillWorks.length > 0);
}

main().catch(e => {
  console.error("UNHANDLED ERROR:", e);
  process.exit(1);
});
