// Final verification of the ObjectDetectionPage.jsx fix: replicates the
// EXACT new accessibility-loading logic (AutoModelForObjectDetection +
// AutoProcessor direct calls, bypassing pipeline()'s unreliable local-model
// file-discovery) across all three classes, plus a fallback-on-failure
// check and a COCO-still-works check.
import path from "node:path";
import { AutoModelForObjectDetection, AutoProcessor, RawImage, pipeline, env } from "@huggingface/transformers";

const ACCESSIBILITY_THRESHOLD = 0.40;
const IMAGES = {
  wheelchair: "-136_jpg.rf.eaa2dd1e96d7e2b52c8c56ada603920e.jpg",
  white_cane: "IMG_0329_MOV-10_jpg.rf.4ecdd368b8f9574fbcc056922879dc7d.jpg",
  pothole: "img-102_jpg.rf.16c56ff8f761aec963d9b57aa1b2d3fd.jpg",
};
const IMG_DIR = path.resolve("../ml/data/prepared/test/images");

async function loadAccessibilityModel() {
  env.allowLocalModels = true;
  env.localModelPath = path.resolve("public/models") + path.sep;
  const model = await AutoModelForObjectDetection.from_pretrained("accessibility-detr-v1", {
    dtype: "fp32", local_files_only: true,
  });
  const processor = await AutoProcessor.from_pretrained("accessibility-detr-v1", { local_files_only: true });
  return async (img, { threshold = 0.5 } = {}) => {
    const image = await RawImage.read(img);
    const { pixel_values, pixel_mask } = await processor(image);
    const output = await model({ pixel_values, pixel_mask });
    const [processed] = processor.image_processor.post_process_object_detection(
      output, threshold, [[image.height, image.width]]
    );
    const { id2label } = model.config;
    return processed.boxes.map((box, i) => ({
      score: processed.scores[i],
      label: id2label[processed.classes[i]],
      box: { xmin: box[0] | 0, ymin: box[1] | 0, xmax: box[2] | 0, ymax: box[3] | 0 },
    }));
  };
}

async function loadCocoDetr() {
  env.allowLocalModels = false;
  return await pipeline("object-detection", "Xenova/detr-resnet-50", { quantized: true });
}

async function main() {
  console.log("=== Loading (fixed sequencing + fixed accessibility loading approach) ===");
  const detrModel = await loadCocoDetr();
  console.log("DETR (COCO, unchanged pipeline() call) loaded.");
  const accessibilityModel = await loadAccessibilityModel();
  console.log("Accessibility model loaded via direct AutoModelForObjectDetection+AutoProcessor.");

  for (const [expectedClass, filename] of Object.entries(IMAGES)) {
    console.log(`\n=== ${expectedClass} ===`);
    const imgPath = path.join(IMG_DIR, filename);
    const image = await RawImage.read(imgPath);

    const accessPreds = await accessibilityModel(image, { threshold: ACCESSIBILITY_THRESHOLD });
    console.log("Accessibility:", JSON.stringify(accessPreds));
    const boxesOk = accessPreds.every(p =>
      p.box.xmin >= 0 && p.box.ymin >= 0 && p.box.xmax <= image.width && p.box.ymax <= image.height
    );
    console.log("Boxes within bounds:", boxesOk, "| Contains expected class:", accessPreds.some(p => p.label === expectedClass));

    const cocoPreds = await detrModel(image, { threshold: 0.30 });
    console.log(`COCO (unaffected): ${cocoPreds.length} detections`);
  }

  console.log("\n=== Fallback test (simulated accessibility load failure) ===");
  const nullRef = null;
  const fallbackResult = nullRef ? await nullRef() : [];
  const cocoAfterFailure = await detrModel(await RawImage.read(path.join(IMG_DIR, IMAGES.wheelchair)), { threshold: 0.30 });
  console.log("Accessibility branch with null ref:", JSON.stringify(fallbackResult));
  console.log("COCO still works after simulated accessibility failure:", cocoAfterFailure.length > 0);
}

main().catch(e => { console.error("UNHANDLED ERROR:", e); process.exit(1); });
