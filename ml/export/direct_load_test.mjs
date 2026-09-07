// Tests bypassing pipeline()'s unreliable local-model file-discovery by
// calling AutoModel.from_pretrained + AutoProcessor.from_pretrained directly
// -- same classes, same preprocessing/postprocessing pipeline() would have
// used internally, just skipping the remote-only hasProcessor/hasTokenizer
// heuristic that pipeline() applies before deciding whether to load them.
import { AutoModelForObjectDetection, AutoProcessor, RawImage } from "@huggingface/transformers";
import path from "node:path";

const env = (await import("@huggingface/transformers")).env;
env.useFS = false; // force real HTTP fetch, same code path as the browser
env.allowLocalModels = true;
env.localModelPath = "http://localhost:3000/models/";
const realFetch = env.fetch;
env.fetch = async (url, opts) => {
  const res = await realFetch(url, opts);
  console.log(`[fetch] ${url} -> ${res.status} (${res.headers.get("content-type")})`);
  return res;
};

const MODEL_ID = "accessibility-detr-v1";

const model = await AutoModelForObjectDetection.from_pretrained(MODEL_ID, { dtype: "fp32", local_files_only: true });
console.log("Model loaded:", model.constructor.name);

const processor = await AutoProcessor.from_pretrained(MODEL_ID, { local_files_only: true });
console.log("Processor loaded:", processor.constructor.name);

const imgPath = path.resolve("../ml/data/prepared/test/images");
const fs = await import("node:fs");
const files = fs.readdirSync(imgPath);
const image = await RawImage.read(path.join(imgPath, files.find(f => f.startsWith("-136"))));
console.log("Image:", image.width, image.height);

const inputs = await processor(image);
const output = await model(inputs);
console.log("Model output keys:", Object.keys(output));

console.log("processor.image_processor exists:", !!processor.image_processor);
const results = processor.image_processor.post_process_object_detection(output, 0.40, [[image.height, image.width]])[0];
console.log("raw results:", JSON.stringify(results));

