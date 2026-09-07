// Forces the SAME HTTP-fetch code path the real browser uses (env.useFS=false
// disables Node's filesystem shortcut for local model resolution), hitting
// the ACTUAL running Vite dev server over real HTTP -- not reading files off
// disk like the earlier (misleading) Node tests did. This is the first test
// in this whole debugging session that genuinely exercises the same code
// path as the browser.
import { pipeline, env } from "@huggingface/transformers";

env.useFS = false; // force env.fetch() (real HTTP) instead of the Node fs shortcut
env.useBrowserCache = false; // this uses window.caches, unavailable in Node anyway
env.allowLocalModels = true;
env.localModelPath = "http://localhost:3000/models/";

// Log every single fetch this process makes, with status + content-type,
// so we get definitive evidence of exactly which URL is requested and what
// comes back -- no guessing. Patching env.fetch directly (not globalThis.fetch)
// since the library captures its own bound reference to fetch at module load.
const realFetch = env.fetch;
env.fetch = async (url, opts) => {
  const res = await realFetch(url, opts);
  console.log(`[fetch] ${url} -> ${res.status} (${res.headers.get("content-type")})`);
  return res;
};

try {
  const m = await pipeline("object-detection", "accessibility-detr-v1", {
    dtype: "fp32",
    local_files_only: true,
  });
  console.log("SUCCESS: pipeline loaded via real HTTP against localhost:3000");
} catch (e) {
  console.log("FAILED:", e.message);
  console.log(e.stack);
}
