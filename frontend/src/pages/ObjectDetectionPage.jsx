import React, { useState, useRef, useEffect, useCallback } from "react";
import { useAccessibility } from "../context/AccessibilityContext";
import DashboardLayout from "../components/DashboardLayout";

const COLORS = ["#22c55e","#facc15","#ef4444","#60a5fa","#a78bfa","#f472b6","#fb923c","#34d399"];
const SCORE_THRESHOLD = 0.35; // balanced — avoids false positives while catching real objects
const LIVE_THRESHOLD  = 0.40; // slightly stricter for real-time camera to reduce flicker
const MOBILENET_TOPK  = 7;    // top-7 from MobileNet (1000 ImageNet classes)

// ── Accessibility hazard detector (wheelchair / white_cane / pothole) ──
// Additive, independent 3-class DETR model, separate from the general COCO
// detector above. Uploaded-image detection only for now — not wired into
// the live-camera loop yet. Local model served from public/models/, so it
// loads via Transformers.js's local-model path rather than the HF Hub.
const ACCESSIBILITY_MODEL_ID  = "accessibility-detr-v1";
const ACCESSIBILITY_THRESHOLD = 0.40; // conservative starting point; tune after real-world testing

export default function ObjectDetectionPage() {
  const { settings, speak } = useAccessibility();
  const isDark = settings.theme === "dark";

  const [scriptReady,    setScriptReady]    = useState(false);
  const [scriptError,    setScriptError]    = useState(false);
  const [modelReady,     setModelReady]     = useState(false);
  const [detrReady,      setDetrReady]      = useState(false);
  const [detrLoading,    setDetrLoading]    = useState(false);
  const [detecting,      setDetecting]      = useState(false);
  const [predictions,    setPredictions]    = useState([]);
  const [classifications,setClassifications]= useState([]); // MobileNet results
  const [imgSrc,         setImgSrc]         = useState(null);
  const [mode,           setMode]           = useState("camera");
  const [tab,            setTab]            = useState("object");
  const [cameraActive,   setCameraActive]   = useState(false);
  const [liveDetecting,  setLiveDetecting]  = useState(false);
  const [ocrText,        setOcrText]        = useState("");
  const [ocrProgress,    setOcrProgress]    = useState(0);
  const [ocrRunning,     setOcrRunning]     = useState(false);
  const [aiDescription,  setAiDescription]  = useState("");
  const [aiAnalyzing,    setAiAnalyzing]    = useState(false);
  const [accessibilityReady,       setAccessibilityReady]       = useState(false);
  const [accessibilityLoading,     setAccessibilityLoading]     = useState(false);
  const [accessibilityPredictions, setAccessibilityPredictions] = useState([]);

  const modelRef      = useRef(null); // COCO-SSD (live camera)
  const detrRef       = useRef(null); // DETR-ResNet-50 (uploaded images, high accuracy)
  const accessibilityDetrRef = useRef(null); // custom 3-class accessibility DETR (uploaded images only)
  const captionRef    = useRef(null); // ViT-GPT2 image captioning (local, no API key)
  const mobileNetRef  = useRef(null);
  const imgRef        = useRef(null);
  const canvasRef     = useRef(null);
  const videoRef      = useRef(null);
  const camCanvasRef  = useRef(null);
  const streamRef     = useRef(null);
  const intervalRef   = useRef(null);
  const lastSpokenRef = useRef("");

  const C = {
    bg:         isDark ? "#111827" : "#ffffff",
    border:     isDark ? "#1f2937" : "rgba(0,0,0,0.1)",
    text:       isDark ? "#f9fafb" : "#0f172a",
    sub:        isDark ? "#9ca3af" : "#64748b",
    input:      isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
    inBorder:   isDark ? "#374151" : "rgba(0,0,0,0.12)",
    dropBg:     isDark ? "rgba(167,139,250,0.06)" : "rgba(167,139,250,0.08)",
    dropBorder: isDark ? "rgba(167,139,250,0.25)" : "rgba(167,139,250,0.35)",
  };

  /* ── Load TF.js + COCO-SSD + MobileNet via npm (dynamic import) ── */
  useEffect(() => {
    const load = async () => {
      try {
        await import("@tensorflow/tfjs");
        setScriptReady(true);
      } catch (e) {
        console.error("TF.js load failed:", e);
        setScriptError(true);
      }
    };
    load();
    return () => { stopCamera(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Pre-load COCO-SSD + MobileNet, then DETR in background ── */
  useEffect(() => {
    if (!scriptReady || modelRef.current) return;
    const loadModels = async () => {
      try {
        const [cocoSsd, mobilenet] = await Promise.all([
          import("@tensorflow-models/coco-ssd"),
          import("@tensorflow-models/mobilenet"),
        ]);
        const [cocoModel, mobileModel] = await Promise.all([
          cocoSsd.load({ base: "mobilenet_v2" }),
          mobilenet.load({ version: 2, alpha: 1.0 }),
        ]);
        modelRef.current     = cocoModel;
        mobileNetRef.current = mobileModel;
        setModelReady(true);

        // Load DETR in the background — higher accuracy for uploaded images
        setDetrLoading(true);
        try {
          const { pipeline, env } = await import("@huggingface/transformers");
          env.allowLocalModels = false;
          const detrModel = await pipeline("object-detection", "Xenova/detr-resnet-50", {
            quantized: true, // smaller download
          });
          detrRef.current = detrModel;
          setDetrReady(true);
          setDetrLoading(false);
        } catch (e) {
          console.warn("DETR load failed, using COCO-SSD only:", e.message);
          setDetrLoading(false);
        }
      } catch (err) {
        console.error("Model load failed:", err);
        speak("Model load failed. Check internet and refresh.");
      }
    };
    loadModels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptReady]);

  /* ── Load the accessibility hazard detector (wheelchair/white_cane/pothole) ──
     Independent of the COCO-SSD/DETR/MobileNet loading above in terms of
     model/logic, but deliberately gated to start only AFTER the DETR
     loading attempt above has finished (modelReady && !detrLoading) rather
     than on scriptReady directly. Reason: both this effect and the DETR
     effect mutate the shared global `env.allowLocalModels` singleton
     around their own pipeline() calls; Transformers.js re-reads that flag
     per-file (config.json / preprocessor_config.json / the ONNX file), not
     once per call, so firing both loaders concurrently on the same trigger
     let DETR's `env.allowLocalModels = false` land in between this loader's
     own file fetches, making it wrongly attempt (and fail) a remote fetch
     for a nonexistent Hub repo — this silently broke accessibility model
     loading (confirmed by reproduction) while leaving DETR unaffected.
     Sequencing after DETR's own attempt has concluded (success or failure)
     removes the race without changing the DETR/caption loading code at all. */
  useEffect(() => {
    if (!modelReady || detrLoading || accessibilityDetrRef.current) return;
    const loadAccessibilityModel = async () => {
      setAccessibilityLoading(true);
      try {
        // Deliberately NOT using pipeline("object-detection", ...) here.
        // pipeline() decides whether to load a processor/tokenizer at all by
        // probing https://huggingface.co (get_file_metadata) for
        // preprocessor_config.json / tokenizer_config.json — a REMOTE-ONLY
        // check, regardless of env.allowLocalModels. For a purely-local model
        // id with no real Hub repo, that probe can't succeed, so pipeline()
        // silently skips loading the processor — and that (mis)resolution
        // gets memoized in-module, surviving HMR/page state until a full
        // reload. Confirmed directly by reading the installed
        // transformers.web.js and reproducing over real HTTP against this
        // dev server. Calling AutoModelForObjectDetection/AutoProcessor
        // directly bypasses that unreliable auto-discovery entirely — same
        // classes, same preprocessing/post-processing pipeline() would have
        // used internally (see ObjectDetectionPipeline._call in the library),
        // just without the remote-existence gate.
        const { AutoModelForObjectDetection, AutoProcessor, RawImage, env } =
          await import("@huggingface/transformers");
        env.allowLocalModels = true;
        const model = await AutoModelForObjectDetection.from_pretrained(ACCESSIBILITY_MODEL_ID, {
          dtype: "fp32", // verified FP32 checkpoint — no quantized variant shipped
          local_files_only: true,
        });
        const processor = await AutoProcessor.from_pretrained(ACCESSIBILITY_MODEL_ID, {
          local_files_only: true,
        });
        // Wrap into the same (img, {threshold}) -> [{label, score, box:{xmin,ymin,xmax,ymax}}]
        // shape pipeline("object-detection", ...) returns, so detectImage()
        // and all drawing/UI code below need zero changes.
        const accessibilityModel = async (img, { threshold = 0.5 } = {}) => {
          // RawImage.read() (this installed @huggingface/transformers version)
          // only accepts RawImage | string | URL | Blob | HTMLCanvasElement |
          // OffscreenCanvas — NOT an <img> element. detectImage() passes
          // imgRef.current (an HTMLImageElement), so RawImage.read(img) hits
          // its `else` branch and throws "Unsupported input type: object"
          // (confirmed by reading utils/image.js RawImage.read/prepareImages).
          // Draw the already-decoded <img> onto an offscreen canvas — no
          // network refetch, no extra CORS exposure, same pixels already in
          // memory — and read from that instead, which RawImage.read()
          // explicitly supports via RawImage.fromCanvas().
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          canvas.getContext("2d").drawImage(img, 0, 0);
          const image = await RawImage.read(canvas);
          const { pixel_values, pixel_mask } = await processor(image);
          const output = await model({ pixel_values, pixel_mask });
          const [processed] = processor.image_processor.post_process_object_detection(
            output, threshold, [[image.height, image.width]]
          );
          const { id2label } = model.config;
          return processed.boxes.map((box, i) => ({
            score: processed.scores[i],
            label: id2label[processed.classes[i]],
            box: {
              xmin: box[0] | 0, ymin: box[1] | 0,
              xmax: box[2] | 0, ymax: box[3] | 0,
            },
          }));
        };
        accessibilityDetrRef.current = accessibilityModel;
        setAccessibilityReady(true);
      } catch (e) {
        console.warn("Accessibility hazard model load failed, continuing without it:", e.message);
      }
      setAccessibilityLoading(false);
    };
    loadAccessibilityModel();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelReady, detrLoading]);

  /* ── Upload image ── */
  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImgSrc(url);
    setPredictions([]);
    setClassifications([]);
    setAiDescription("");
    setOcrText("");
    setOcrProgress(0);
    // Bug fix: this was missing, so the accessibility hazard results LIST
    // (right-hand panel, independent of the canvas cleared below) could
    // keep showing a stale wheelchair/white_cane/pothole entry from the
    // PREVIOUS image until the user re-ran detection on the new one.
    setAccessibilityPredictions([]);
    const cv = canvasRef.current;
    if (cv) cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
  };

  /* ── Normalize prediction to {label, score, x, y, w, h} regardless of source ── */
  const normPred = (p, imgW, imgH) => {
    if (p.box) {
      // DETR format: { label, score, box: { xmin, ymin, xmax, ymax } } — coords are absolute pixels
      const { xmin, ymin, xmax, ymax } = p.box;
      return { label: p.label, score: p.score, x: xmin, y: ymin, w: xmax - xmin, h: ymax - ymin };
    }
    // COCO-SSD format: { class, score, bbox: [x, y, w, h] }
    const [x, y, w, h] = p.bbox;
    return { label: p.class, score: p.score, x, y, w, h };
  };

  /* ── Non-Maximum Suppression: remove overlapping duplicate boxes ── */
  const computeIoU = (a, b) => {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = a.w * a.h + b.w * b.h - inter;
    return union > 0 ? inter / union : 0;
  };

  const applyNMS = useCallback((rawPreds, imgW, imgH, iouThreshold = 0.45) => {
    if (rawPreds.length <= 1) return rawPreds;
    const normed = rawPreds.map(p => ({ ...normPred(p, imgW, imgH), _orig: p }));
    const sorted = [...normed].sort((a, b) => b.score - a.score);
    const keep = [];
    const suppressed = new Set();
    for (let i = 0; i < sorted.length; i++) {
      if (suppressed.has(i)) continue;
      keep.push(sorted[i]._orig);
      for (let j = i + 1; j < sorted.length; j++) {
        if (!suppressed.has(j) && computeIoU(sorted[i], sorted[j]) > iouThreshold) suppressed.add(j);
      }
    }
    return keep;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Overlap coefficient (a.k.a. IoMA — intersection / area of the SMALLER
     box). Unlike IoU, this stays high when one box is nested almost entirely
     inside a much larger one — exactly the pattern the accessibility model
     produces (a tight box + a looser box around the same wheelchair/cane/
     pothole), which standard IoU under-counts because the union is inflated
     by the larger box's extra area. ── */
  const computeOverlapCoef = (a, b) => {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const minArea = Math.min(a.w * a.h, b.w * b.h);
    return minArea > 0 ? inter / minArea : 0;
  };

  /* ── NMS for the accessibility hazard detector ONLY (wheelchair/white_cane/
     pothole) — never used by COCO DETR or COCO-SSD, which keep calling the
     plain applyNMS above unchanged. Two differences from applyNMS, both
     scoped to this detector's own known duplicate-box behavior:
       1. Class-aware: suppression only ever compares boxes of the SAME
          label, so a wheelchair box can never suppress (or be suppressed
          by) a white_cane/pothole box.
       2. Adds a containment-based suppression check (overlap coefficient
          >= 0.90) alongside the existing IoU > 0.45 rule, so a lower-scored
          box nested almost entirely inside a higher-scored same-class box
          is also removed, even when their IoU is below 0.45. Only the
          lower-scored box of a pair is ever suppressed — same greedy
          highest-score-wins behavior as applyNMS.
     Investigated and simulated against captured raw predictions before
     implementing — see prior investigation. ── */
  const applyAccessibilityNMS = useCallback((rawPreds, imgW, imgH, iouThreshold = 0.45, overlapThreshold = 0.90) => {
    if (rawPreds.length <= 1) return rawPreds;
    const byLabel = new Map();
    rawPreds.forEach(p => {
      const label = p.label ?? p.class;
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push(p);
    });
    const keep = [];
    for (const group of byLabel.values()) {
      const normed = group.map(p => ({ ...normPred(p, imgW, imgH), _orig: p }));
      const sorted = [...normed].sort((a, b) => b.score - a.score);
      const suppressed = new Set();
      for (let i = 0; i < sorted.length; i++) {
        if (suppressed.has(i)) continue;
        keep.push(sorted[i]._orig);
        for (let j = i + 1; j < sorted.length; j++) {
          if (suppressed.has(j)) continue;
          if (computeIoU(sorted[i], sorted[j]) > iouThreshold || computeOverlapCoef(sorted[i], sorted[j]) >= overlapThreshold) {
            suppressed.add(j);
          }
        }
      }
    }
    return keep;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Suppress general COCO/DETR detections that spatially conflict with an
     accessibility hazard detection ──
     ROOT CAUSE this addresses: real test images showed the general
     detector (DETR-ResNet-50, an off-the-shelf 91-class COCO model that has
     never seen wheelchair/white_cane/pothole in training — those are not
     COCO classes) mislabeling the SAME physical object the accessibility
     model had already correctly identified — "Bottle 92%"/"Bicycle 75%" on
     a wheelchair image, "Baseball Bat 66%/57%" on white_cane images — not a
     random unrelated object elsewhere in frame. (Separately confirmed by
     code inspection: the general DETR pipeline's `{quantized:true}` option
     is dead in the installed @huggingface/transformers v4.2.0 — that API
     was replaced by `dtype` — so it silently runs the library's own WASM
     default (8-bit "q8") instead, which is a real, evidence-based
     contributing factor to misclassification accuracy, documented in this
     session's report; not changed here since raising it to fp32 has a real
     ~125MB extra download cost that needs your call, not mine.)
     When a general detection's box majority-overlaps an accessibility
     hazard's box, the specialized detector wins for that exact region and
     the conflicting general label is dropped for DISPLAY only — neither
     detector's own model, threshold, or NMS is touched, and general
     detections anywhere else in the frame (i.e. actually different
     objects) are completely unaffected. This only ever activates when the
     accessibility model has ALSO positively identified something in that
     same spot, so ordinary (non-hazard) photos are never filtered. ── */
  const CONFLICT_OVERLAP_THRESHOLD = 0.5;
  const filterConflictingGeneralDetections = useCallback((generalPreds, hazardPreds, imgW, imgH) => {
    if (hazardPreds.length === 0 || generalPreds.length === 0) return generalPreds;
    const hazardBoxes = hazardPreds.map(p => normPred(p, imgW, imgH));
    return generalPreds.filter(gp => {
      const gBox = normPred(gp, imgW, imgH);
      return !hazardBoxes.some(hBox => computeOverlapCoef(gBox, hBox) >= CONFLICT_OVERLAP_THRESHOLD);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Draw bounding boxes on IMAGE canvas (handles COCO-SSD + DETR) ── */
  const drawBoxesOnImage = (preds, imgEl) => {
    const cv = canvasRef.current;
    if (!cv || !imgEl) return;
    const dW = imgEl.offsetWidth  || imgEl.clientWidth  || 640;
    const dH = imgEl.offsetHeight || imgEl.clientHeight || 480;
    const nW = imgEl.naturalWidth  || dW;
    const nH = imgEl.naturalHeight || dH;
    cv.width = dW; cv.height = dH;
    const scaleX = dW / nW, scaleY = dH / nH;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, dW, dH);
    preds.forEach((p, i) => {
      const { label, score, x, y, w, h } = normPred(p, nW, nH);
      const sx = x * scaleX, sy = y * scaleY, sw = w * scaleX, sh = h * scaleY;
      const color = COLORS[i % COLORS.length];
      ctx.strokeStyle = color; ctx.lineWidth = 3;
      ctx.strokeRect(sx, sy, sw, sh);
      const txt = `${label} ${Math.round(score * 100)}%`;
      ctx.font = "bold 14px Inter, sans-serif";
      const tw = ctx.measureText(txt).width;
      ctx.fillStyle = color;
      ctx.fillRect(sx, Math.max(0, sy - 22), tw + 10, 22);
      ctx.fillStyle = "#000";
      ctx.fillText(txt, sx + 5, Math.max(14, sy - 5));
    });
  };

  /* ── Draw accessibility-hazard boxes on IMAGE canvas ──
     Appends to the same canvas AFTER drawBoxesOnImage (does not clear it),
     using a distinct dashed red style so hazard boxes are visually
     separable from general COCO/DETR detections drawn above. ── */
  const drawAccessibilityBoxesOnImage = (preds, imgEl) => {
    const cv = canvasRef.current;
    if (!cv || !imgEl || preds.length === 0) return;
    const dW = imgEl.offsetWidth  || imgEl.clientWidth  || 640;
    const dH = imgEl.offsetHeight || imgEl.clientHeight || 480;
    const nW = imgEl.naturalWidth  || dW;
    const nH = imgEl.naturalHeight || dH;
    const scaleX = dW / nW, scaleY = dH / nH;
    const ctx = cv.getContext("2d");
    preds.forEach((p) => {
      const { label, score, x, y, w, h } = normPred(p, nW, nH);
      const sx = x * scaleX, sy = y * scaleY, sw = w * scaleX, sh = h * scaleY;
      ctx.save();
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 5]);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.restore();
      const txt = `⚠ ${label} ${Math.round(score * 100)}%`;
      ctx.font = "bold 14px Inter, sans-serif";
      const tw = ctx.measureText(txt).width;
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(sx, Math.max(0, sy - 22), tw + 10, 22);
      ctx.fillStyle = "#fff";
      ctx.fillText(txt, sx + 5, Math.max(14, sy - 5));
    });
  };

  /* ── Draw bounding boxes on CAMERA canvas ── */
  const drawBoxesOnCamera = (preds, videoEl) => {
    const cv = camCanvasRef.current;
    if (!cv || !videoEl) return;
    const dW = videoEl.offsetWidth  || videoEl.clientWidth  || 640;
    const dH = videoEl.offsetHeight || videoEl.clientHeight || 480;
    const nW = videoEl.videoWidth  || dW;
    const nH = videoEl.videoHeight || dH;
    cv.width = dW; cv.height = dH;
    const scaleX = dW / nW, scaleY = dH / nH;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, dW, dH);
    preds.forEach((p, i) => {
      const [x, y, w, h] = p.bbox;
      const sx = x * scaleX, sy = y * scaleY, sw = w * scaleX, sh = h * scaleY;
      const color = COLORS[i % COLORS.length];
      ctx.strokeStyle = color; ctx.lineWidth = 3;
      ctx.strokeRect(sx, sy, sw, sh);
      const label = `${p.class} ${Math.round(p.score * 100)}%`;
      ctx.font = "bold 14px Inter, sans-serif";
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = color;
      ctx.fillRect(sx, Math.max(0, sy - 22), tw + 10, 22);
      ctx.fillStyle = "#000";
      ctx.fillText(label, sx + 5, Math.max(14, sy - 5));
    });
  };

  const ensureModel = async () => {
    if (modelRef.current) return modelRef.current;
    const cocoSsd = await import("@tensorflow-models/coco-ssd");
    const m = await cocoSsd.load({ base: "mobilenet_v2" });
    modelRef.current = m;
    setModelReady(true);
    return m;
  };

  /* ── Local image-captioning model (ViT-GPT2), loaded once and cached ──
     Runs fully in the browser via @huggingface/transformers.js — no API
     key, no network call to any AI provider. Lazy-loaded on first use
     (same pattern as ensureModel() below) so it never slows down the
     page's initial object-detection load. */
  const ensureCaptionModel = async () => {
    if (captionRef.current) return captionRef.current;
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    const captioner = await pipeline(
      "image-to-text",
      "Xenova/vit-gpt2-image-captioning",
      { quantized: true } // smaller download
    );
    captionRef.current = captioner;
    return captioner;
  };

  /* ── AI Vision: local scene-description caption (no backend/API key) ── */
  const analyzeWithAI = useCallback(async (imgEl) => {
    setAiAnalyzing(true);
    setAiDescription("");
    try {
      const captioner = await ensureCaptionModel();
      const output = await captioner(imgEl);
      const desc = (Array.isArray(output) ? output[0]?.generated_text : output?.generated_text) || "";
      setAiDescription(desc);
      return desc;
    } catch (err) {
      console.warn("[AI Vision] local captioning failed:", err.message);
      return "";
    } finally {
      setAiAnalyzing(false);
    }
  }, []);

  /* ── Detect objects in uploaded image ──
     Uses DETR-ResNet-50 (transformer, high accuracy) when loaded,
     falls back to COCO-SSD + MobileNet otherwise.              ── */
  const detectImage = useCallback(async () => {
    if (!scriptReady) { speak("AI model is still loading. Please wait."); return; }
    if (!imgSrc)      { speak("Please upload an image first."); return; }
    setDetecting(true);
    setPredictions([]);
    setClassifications([]);
    setAiDescription("");
    setAccessibilityPredictions([]);
    try {
      const img = imgRef.current;
      if (!img.complete || img.naturalWidth === 0) {
        await new Promise(res => { img.onload = res; });
      }
      const nW = img.naturalWidth, nH = img.naturalHeight;

      // Run bounding-box detection + AI vision description + accessibility
      // hazard detection in parallel. The accessibility branch is fully
      // independent — its own NMS pass, own threshold, own failure handling
      // — and never affects the general-object detection branch above it.
      const [detResult, aiResult, accessibilityResult] = await Promise.allSettled([
        (async () => {
          if (detrRef.current) {
            // DETR pipeline() -> prepareImages() -> RawImage.read() (this
            // installed @huggingface/transformers version) rejects an
            // HTMLImageElement with "Unsupported input type: object" — same
            // root cause already fixed for the accessibility detector below.
            // Convert the already-decoded <img> to a canvas (RawImage.read()
            // explicitly supports HTMLCanvasElement) before handing it to
            // the DETR pipeline. Model, config, and threshold are untouched.
            const detrCanvas = document.createElement("canvas");
            detrCanvas.width = nW;
            detrCanvas.height = nH;
            detrCanvas.getContext("2d").drawImage(img, 0, 0);
            // Bug fix: the pipeline's own threshold (0.30) is a generation
            // param, not the app's declared display threshold — SCORE_THRESHOLD
            // (0.35, "avoids false positives") was already applied to the
            // COCO-SSD fallback branch below but was never actually wired
            // into this DETR branch, even though DETR is the one active
            // whenever it's loaded (the common case). Filtering here makes
            // both branches apply the same declared threshold consistently.
            // Model, weights, and DETR's own 0.30 generation threshold are
            // untouched — this only affects which of DETR's own already-
            // computed results get displayed.
            const raw = await detrRef.current(detrCanvas, { threshold: 0.30 });
            return applyNMS(raw.filter(p => p.score >= SCORE_THRESHOLD), nW, nH);
          }
          const model = await ensureModel();
          const raw   = await model.detect(img);
          return applyNMS(raw.filter(p => p.score >= SCORE_THRESHOLD), nW, nH);
        })(),
        analyzeWithAI(img),
        (async () => {
          if (!accessibilityDetrRef.current) return [];
          const raw = await accessibilityDetrRef.current(img, { threshold: ACCESSIBILITY_THRESHOLD });
          return applyAccessibilityNMS(raw, nW, nH); // class-aware NMS within this detector's own output only
        })(),
      ]);

      const rawPreds    = detResult.status === "fulfilled" ? detResult.value : [];
      const aiDesc      = aiResult.status  === "fulfilled" ? aiResult.value  : "";
      const accessPreds = accessibilityResult.status === "fulfilled" ? accessibilityResult.value : [];
      if (accessibilityResult.status === "rejected") {
        console.warn("Accessibility hazard detection failed for this image:", accessibilityResult.reason?.message);
      }

      // Drop any general detection that spatially conflicts with an
      // accessibility hazard detection (see filterConflictingGeneralDetections
      // above) — applied once here so state, the drawn boxes, and the
      // spoken results below all agree on the same filtered list.
      const preds = filterConflictingGeneralDetections(rawPreds, accessPreds, nW, nH);

      setPredictions(preds);
      setAccessibilityPredictions(accessPreds);
      drawBoxesOnImage(preds, img);
      drawAccessibilityBoxesOnImage(accessPreds, img);

      // MobileNet supplementary classification (1000+ categories)
      let classifs = [];
      if (mobileNetRef.current) {
        classifs = await mobileNetRef.current.classify(img, MOBILENET_TOPK);
        setClassifications(classifs);
      }

      // Bug fix: accessibility hazards (wheelchair/white_cane/pothole) are
      // the one thing this app is specifically trained to catch, but the
      // speech logic below previously only ever read from `preds` (the
      // general COCO/DETR branch) — a correctly-detected hazard appeared
      // in the sidebar list but was NEVER spoken aloud, while the general
      // detector's unverified guesses always were. Spoken first, in its
      // own sentence, so it isn't diluted among general-object names.
      const hazardNames = [...new Set(accessPreds.map(p => p.label))];
      const hazardPhrase = hazardNames.length
        ? `Accessibility alert: ${hazardNames.map(n => n.replace(/_/g, " ")).join(", ")} detected. `
        : "";

      // Speech: combine the caption (natural-language scene summary) with
      // the detector's specific object labels — the caption model is small
      // and can be vague, while DETR/COCO-SSD are far more precise about
      // exactly what's in frame. Previously the caption alone was spoken
      // and the detected object list was silently discarded whenever a
      // caption existed, even though it was already computed and correct.
      const mainNames  = [...new Set(preds.map(p => p.label ?? p.class))];
      const mobileNames = classifs.slice(0, 3).map(c => c.className.split(",")[0].trim());
      if (aiDesc) {
        speak(
          hazardPhrase +
          (mainNames.length
            ? `${aiDesc} I can also specifically identify: ${mainNames.join(", ")}.`
            : aiDesc)
        );
      } else {
        if (mainNames.length === 0 && classifs.length === 0) {
          speak(hazardPhrase || "No objects detected. Try a clearer photo with better lighting.");
        } else if (mainNames.length === 0) {
          speak(hazardPhrase + mobileNames.join(", "));
        } else {
          const extra = mobileNames.filter(n => !mainNames.some(m => m.toLowerCase().includes(n.toLowerCase().split(" ")[0])));
          speak(hazardPhrase + [...mainNames, ...extra.slice(0, 2)].join(", "));
        }
      }
    } catch (err) {
      console.error(err);
      speak("Detection failed. Please try again.");
    }
    setDetecting(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptReady, imgSrc, speak, detrReady, analyzeWithAI, applyNMS, applyAccessibilityNMS, filterConflictingGeneralDetections]);

  /* ── Preprocess canvas for better OCR ── */
  const preprocessForOCR = (src) => {
    let w = 0, h = 0;
    if (src instanceof HTMLCanvasElement)     { w = src.width;  h = src.height; }
    else if (src instanceof HTMLImageElement) { w = src.naturalWidth || src.width; h = src.naturalHeight || src.height; }
    else if (src instanceof HTMLVideoElement) { w = src.videoWidth; h = src.videoHeight; }
    else return src;
    if (!w || !h) return src;
    const scale = Math.max(1, 800 / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext("2d");
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const id = ctx.getImageData(0, 0, c.width, c.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.round(0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]);
      const v = Math.min(255, Math.max(0, Math.round((g - 128) * 1.4 + 128)));
      d[i] = d[i+1] = d[i+2] = v;
    }
    ctx.putImageData(id, 0, 0);
    return c;
  };

  /* ── OCR ── */
  const runOCR = useCallback(async (source) => {
    const raw = source || imgRef.current || null;
    if (!raw) { speak("Please upload an image first."); return; }
    setOcrRunning(true); setOcrText(""); setOcrProgress(0);
    speak("Reading text from image, please wait…");
    try {
      const target = preprocessForOCR(raw);
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        logger: (m) => { if (m.status === "recognizing text") setOcrProgress(Math.round(m.progress * 100)); },
      });
      const { data: { text, confidence } } = await worker.recognize(target);
      await worker.terminate();
      const trimmed = text.replace(/[^\S\n]+/g, " ").trim();
      setOcrProgress(100);
      if (trimmed && confidence > 20) {
        setOcrText(trimmed);
        speak(`Text found: ${trimmed}`);
      } else if (trimmed) {
        setOcrText(trimmed);
        speak("Text detected but quality is low. Results may not be accurate.");
      } else {
        speak("No readable text found. Try a clearer image.");
      }
    } catch (err) {
      console.error(err);
      speak("Text reading failed. Please try again.");
    }
    setOcrRunning(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speak]);

  /* ── Camera: Start ── */
  const startCamera = async () => {
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (e1) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" },
          });
        } catch (e2) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
      }
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        v.setAttribute("autoplay", "true");
        v.setAttribute("playsinline", "true");
        v.setAttribute("muted", "true");
        try { await v.play(); } catch (_) {}
      }
      setCameraActive(true);
      lastSpokenRef.current = "";
      // Live camera never runs the accessibility detector — clear any stale
      // hazard result left over from a previous image upload so it can't
      // leak into and persist through the live-camera results panel.
      setAccessibilityPredictions([]);
      if (tab === "object") {
        speak("Camera started. Live object detection is running.");
        startLiveDetection();
      } else {
        speak("Camera started. Click Read Text to extract text from the frame.");
      }
    } catch {
      speak("Could not access camera. Please grant camera permission and try again.");
    }
  };

  /* ── Camera: Stop ── */
  const stopCamera = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    const cv = camCanvasRef.current;
    if (cv) cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
    setLiveDetecting(false);
    setPredictions([]);
    setClassifications([]);
    setAccessibilityPredictions([]); // no stale upload-time hazard result survives past a camera session
    lastSpokenRef.current = "";
  };

  /* ── Live detection loop every 800ms (COCO-SSD + MobileNet covers 1000+ object types) ── */
  const startLiveDetection = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setLiveDetecting(true);

    intervalRef.current = setInterval(async () => {
      const v = videoRef.current;
      if (!v || v.readyState < 2 || v.paused || v.ended) return;
      try {
        const model = await ensureModel();

        // Run both models in parallel for speed
        const [cocoPreds, classifs] = await Promise.all([
          model.detect(v),
          mobileNetRef.current ? mobileNetRef.current.classify(v, MOBILENET_TOPK) : Promise.resolve([]),
        ]);

        const filtered = cocoPreds.filter(p => p.score >= LIVE_THRESHOLD);
        const preds = applyNMS(filtered, v.videoWidth || 640, v.videoHeight || 480);
        setPredictions(preds);
        setClassifications(classifs);
        drawBoxesOnCamera(preds, v);

        // Build a single description from both models
        const cocoNames = [...new Set(preds.map(p => p.class))];
        const mobileTop = classifs.slice(0, 3).map(c => c.className.split(",")[0].trim());
        // Prefer COCO names (have bounding boxes); supplement with MobileNet for unknown objects
        const mobileExtra = mobileTop.filter(n => !cocoNames.some(c => c.toLowerCase().includes(n.toLowerCase().split(" ")[0])));
        const allNames = [...cocoNames, ...mobileExtra.slice(0, 2)].join(", ");

        if (allNames && allNames !== lastSpokenRef.current) {
          lastSpokenRef.current = allNames;
          speak(allNames);
        } else if (!allNames) {
          lastSpokenRef.current = "";
        }
      } catch (err) {
        console.error("Live detection error:", err);
      }
    }, 800);
  };

  /* ── Tab change while camera active ── */
  useEffect(() => {
    if (!cameraActive) return;
    if (tab === "object") {
      startLiveDetection();
    } else {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      setLiveDetecting(false);
      setPredictions([]);
      const cv = camCanvasRef.current;
      if (cv) cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /* ── Capture camera frame and run OCR ── */
  const captureAndReadText = async () => {
    const v = videoRef.current;
    if (!v || !cameraActive) { speak("Camera not active."); return; }
    const offscreen = document.createElement("canvas");
    offscreen.width  = v.videoWidth;
    offscreen.height = v.videoHeight;
    offscreen.getContext("2d").drawImage(v, 0, 0);
    await runOCR(offscreen); // pass canvas directly for preprocessing
  };

  const speakAllResults = () => {
    if (!predictions.length && !classifications.length && !aiDescription && !accessibilityPredictions.length) {
      speak("No detection results yet."); return;
    }
    // Bug fix: same gap as detectImage() above — this button read from
    // `predictions` (general COCO/DETR) only, so a detected accessibility
    // hazard was never included when the user asked to hear all results.
    // Spoken first, in its own sentence, ahead of the general names.
    const hazardNames = [...new Set(accessibilityPredictions.map(p => p.label))];
    const hazardPhrase = hazardNames.length
      ? `Accessibility alert: ${hazardNames.map(n => n.replace(/_/g, " ")).join(", ")} detected. `
      : "";
    if (aiDescription) {
      // Same reasoning as detectImage() above — don't let the (small,
      // sometimes-vague) caption model silently hide the detector's own,
      // more precise object labels when both are available.
      const names = [...new Set(predictions.map(p => p.label ?? p.class))];
      speak(
        hazardPhrase +
        (names.length
          ? `${aiDescription} I can also specifically identify: ${names.join(", ")}.`
          : aiDescription)
      );
      return;
    }
    const parts = [];
    if (predictions.length) {
      parts.push(predictions.map(p => p.label ?? p.class).join(", "));
    }
    if (classifications.length) {
      const extra = classifications
        .map(c => c.className.split(",")[0].trim())
        .filter(n => !predictions.some(p => (p.label ?? p.class).toLowerCase() === n.toLowerCase()));
      if (extra.length) parts.push(extra.join(", "));
    }
    speak(hazardPhrase + parts.join(", "));
  };

  return (
    <DashboardLayout>
      <div className="fade-in">
        <div className="page-header">
          <h1>🔍 Object Detection & Text Reader</h1>
          <p>Upload an image or use your camera — AI detects objects and reads text aloud.</p>
        </div>

        {scriptError && (
          <div className="alert alert-error">
            ⚠️ Could not load AI model. Check your internet connection and refresh.
          </div>
        )}
        {!scriptReady && !scriptError && (
          <div className="alert alert-info">⏳ Loading AI (TensorFlow.js + COCO-SSD + MobileNet)…</div>
        )}
        {scriptReady && (
          <div className="alert alert-success">
            ✅ {detrReady
              ? "DETR-ResNet-50 ready — high-accuracy transformer model active"
              : modelReady
                ? `Fast detection ready${detrLoading ? " — loading high-accuracy DETR model in background…" : " — DETR unavailable, using COCO-SSD"}`
                : "Loading AI models…"}
          </div>
        )}
        {/* Bug fix: the accessibility hazard detector (wheelchair/white_cane/
            pothole) loads in the background after the banner above already
            says "ready" — it's sequenced behind DETR specifically to avoid a
            model-loading race (see the loadAccessibilityModel effect below).
            Nothing previously told the user this safety-critical detector
            might still be loading, so clicking Detect early silently skipped
            hazard detection with no indication anything was missing. This is
            UI-only: no change to the model, its threshold, or its NMS. */}
        {scriptReady && !accessibilityReady && (
          <div className="alert alert-info">
            {accessibilityLoading
              ? "⏳ Loading safety hazard detector (wheelchair / white cane / pothole)… detection results won't include hazard alerts until this finishes."
              : "⏳ Safety hazard detector queued to load…"}
          </div>
        )}

        {/* Tab switcher */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
          {[{ key: "object", label: "🔍 Detect Objects" }, { key: "ocr", label: "📝 Read Text (OCR)" }].map(t => (
            <button key={t.key} className={`btn ${tab === t.key ? "btn-green" : "btn-ghost"}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Mode switcher - Live Camera prioritized for Visually Impaired Users */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "20px", flexWrap: "wrap" }}>
          {[
            { key: "camera", label: "🎥 Live Camera Scanner (Primary)" },
            { key: "upload", label: "📁 Upload Photo (Optional)" },
          ].map(m => (
            <button key={m.key} className={`btn ${mode === m.key ? "btn-green" : "btn-ghost"}`}
              style={{ minHeight: "44px", fontSize: "14px", fontWeight: 700 }}
              onClick={() => {
                setMode(m.key);
                if (m.key === "upload") {
                  stopCamera();
                  speak("Switched to Upload Image mode.");
                } else {
                  setAccessibilityPredictions([]);
                  speak("Switched to Live Camera Detection mode.");
                }
              }}>
              {m.label}
            </button>
          ))}
        </div>

        <div className="obj-layout">

          {/* Left: media + controls */}
          <div style={{ ...st.imgBox, background: C.bg, border: `1px solid ${C.border}` }}>

            {mode === "upload" ? (
              <>
                {!imgSrc ? (
                  <label style={{ ...st.dropZone, background: C.dropBg, border: `2px dashed ${C.dropBorder}`, cursor: "pointer" }}>
                    <span style={{ fontSize: "52px" }}>🖼️</span>
                    <span style={{ color: C.text, fontWeight: 700, fontSize: "16px" }}>Click to upload an image</span>
                    <span style={{ color: C.sub, fontSize: "13px" }}>JPG, PNG, WEBP — any object or scene</span>
                    <input type="file" accept="image/*" onChange={onFileChange} style={{ display: "none" }} />
                  </label>
                ) : (
                  <div style={{ position: "relative", display: "inline-block", width: "100%" }}>
                    <img ref={imgRef} src={imgSrc} alt="Uploaded for object detection"
                      style={{ width: "100%", borderRadius: "10px", display: "block" }}
                      crossOrigin="anonymous" />
                    {tab === "object" && (
                      <canvas ref={canvasRef}
                        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
                    )}
                  </div>
                )}

                <div style={{ display: "flex", gap: "10px", marginTop: "14px", flexWrap: "wrap" }}>
                  <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>
                    🔄 Change Image
                    <input type="file" accept="image/*" onChange={onFileChange} style={{ display: "none" }} />
                  </label>
                  {tab === "object" ? (
                    <button className="btn btn-green" onClick={detectImage}
                      disabled={!imgSrc || detecting || !scriptReady}>
                      {detecting ? "🔄 Detecting…" : "🔍 Detect All Objects"}
                    </button>
                  ) : (
                    <button className="btn btn-green" onClick={() => runOCR(null)}
                      disabled={!imgSrc || ocrRunning}>
                      {ocrRunning ? `📖 Reading… ${ocrProgress}%` : "📝 Read Text"}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div>
                <div style={{ position: "relative", background: "#000", borderRadius: "10px", overflow: "hidden", minHeight: "280px" }}>
                  <video ref={videoRef}
                    style={{ width: "100%", display: cameraActive ? "block" : "none" }}
                    autoPlay
                    muted
                    playsInline />
                  <canvas ref={camCanvasRef}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
                  {!cameraActive && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "280px", color: "#9ca3af", flexDirection: "column", gap: "12px", textAlign: "center", padding: "20px" }}>
                      <span style={{ fontSize: "56px" }}>🎥</span>
                      <span style={{ fontSize: "16px", fontWeight: 700, color: "#f8fafc" }}>Live Obstacle & Object Camera</span>
                      <span style={{ fontSize: "13px", color: "#94a3b8", maxWidth: "360px" }}>Tap Start Camera below. The camera will stream live video and speak out people, chairs, doors, and obstacles in front of you.</span>
                    </div>
                  )}
                  {cameraActive && tab === "object" && liveDetecting && (
                    <div style={{ position: "absolute", top: "10px", left: "10px", background: "rgba(34,197,94,0.9)", color: "#000", padding: "4px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: 800, display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#000", display: "inline-block" }} />
                      LIVE DETECTOR ACTIVE
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: "10px", marginTop: "14px", flexWrap: "wrap" }}>
                  {!cameraActive ? (
                    <button className="btn btn-green" onClick={startCamera} style={{ minHeight: "52px", fontSize: "16px", fontWeight: 800, flex: 1 }}>
                      🎥 Start Live Camera Detection
                    </button>
                  ) : (
                    <>
                      <button className="btn btn-red" onClick={stopCamera} style={{ minHeight: "52px", fontSize: "15px", fontWeight: 700 }}>
                        ⏹ Stop Camera
                      </button>
                      {tab === "ocr" && (
                        <button className="btn btn-green" onClick={captureAndReadText} disabled={ocrRunning} style={{ minHeight: "52px", fontSize: "15px", fontWeight: 700, flex: 1 }}>
                          {ocrRunning ? `📖 Reading… ${ocrProgress}%` : "📝 Read Text from Frame"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right: results panel */}
          <div style={{ ...st.resultsBox, background: C.bg, border: `1px solid ${C.border}` }}>

            {tab === "object" ? (
              <>
                <div style={{ fontWeight: 700, fontSize: "15px", color: C.text, marginBottom: "14px" }}>
                  🎯 Detection Results
                  {cameraActive && liveDetecting && (
                    <span style={{ marginLeft: "8px", fontSize: "11px", color: "#22c55e", fontWeight: 600 }}>(live)</span>
                  )}
                </div>

                {predictions.length === 0 && classifications.length === 0 ? (
                  <div style={{ textAlign: "center", color: C.sub, padding: "24px 0" }}>
                    <div style={{ fontSize: "36px", marginBottom: "8px" }}>🔍</div>
                    <div style={{ fontSize: "13px" }}>No results yet</div>
                    <div style={{ fontSize: "11px", marginTop: "4px" }}>
                      {mode === "camera" && cameraActive ? "Live detection running…" : "Upload an image and click Detect All Objects"}
                    </div>
                  </div>
                ) : (
                  <>
                    <button className="btn btn-yellow btn-sm btn-full" onClick={speakAllResults} style={{ marginBottom: "12px" }}>
                      🔊 Read All Aloud
                    </button>

                    {/* COCO-SSD bounding-box results */}
                    {predictions.length > 0 && (
                      <>
                        <div style={{ fontSize: "11px", color: "#22c55e", fontWeight: 700, marginBottom: "6px", textTransform: "uppercase" }}>
                          Objects with Location ({predictions.length}) {detrReady ? "· DETR ✦" : "· COCO-SSD"}
                        </div>
                        {/* General-purpose scene detector, not trained on this app's
                            accessibility classes — its guesses can be wrong (e.g. a
                            wheelchair's frame/wheels misread as "bicycle"). Kept
                            distinct from the accessibility-specific section below,
                            which is what this app is purpose-built to detect. */}
                        <div style={{ fontSize: "11px", color: C.sub, marginBottom: "8px" }}>
                          General AI guesses — may include mistakes, not verified.
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
                          {predictions.map((p, i) => {
                            const name = p.label ?? p.class;
                            return (
                              <div key={i}
                                style={{ padding: "10px 12px", borderRadius: "10px", background: `${COLORS[i % COLORS.length]}14`, border: `1px solid ${COLORS[i % COLORS.length]}30`, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                                onClick={() => speak(name)}>
                                <span style={{ fontWeight: 700, color: COLORS[i % COLORS.length], textTransform: "capitalize", fontSize: "14px" }}>
                                  {name}
                                </span>
                                <span style={{ fontSize: "12px", color: C.sub, fontWeight: 700, background: `${COLORS[i % COLORS.length]}20`, padding: "2px 8px", borderRadius: "20px" }}>
                                  {Math.round(p.score * 100)}%
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}

                    {/* Accessibility hazard detections — kept visually and
                        structurally separate from general COCO/DETR results
                        above (own model, own threshold, own list) */}
                    {accessibilityPredictions.length > 0 && (
                      <>
                        <div style={{ fontSize: "11px", color: "#ef4444", fontWeight: 700, marginBottom: "6px", textTransform: "uppercase" }}>
                          ⚠️ Accessibility Hazards ({accessibilityPredictions.length}) · experimental
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
                          {accessibilityPredictions.map((p, i) => {
                            const name = p.label ?? p.class;
                            return (
                              <div key={i}
                                style={{ padding: "10px 12px", borderRadius: "10px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                                onClick={() => speak(name)}>
                                <span style={{ fontWeight: 700, color: "#ef4444", textTransform: "capitalize", fontSize: "14px" }}>
                                  {name}
                                </span>
                                <span style={{ fontSize: "12px", color: C.sub, fontWeight: 700, background: "rgba(239,68,68,0.15)", padding: "2px 8px", borderRadius: "20px" }}>
                                  {Math.round(p.score * 100)}%
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}

                    {/* AI Vision description */}
                    {(aiAnalyzing || aiDescription) && (
                      <div style={{ marginBottom: "12px" }}>
                        <div style={{ fontSize: "11px", color: "#f472b6", fontWeight: 700, marginBottom: "6px", textTransform: "uppercase" }}>
                          AI Scene Analysis · Local Vision Model {aiAnalyzing ? "⏳" : "✦"}
                        </div>
                        {aiAnalyzing ? (
                          <div style={{ color: C.sub, fontSize: "12px", padding: "8px 0" }}>Analyzing scene…</div>
                        ) : (
                          <div
                            style={{ padding: "10px 12px", borderRadius: "10px", background: "rgba(244,114,182,0.07)", border: "1px solid rgba(244,114,182,0.2)", fontSize: "13px", color: C.text, lineHeight: 1.6, cursor: "pointer" }}
                            onClick={() => speak(aiDescription)}>
                            {aiDescription}
                          </div>
                        )}
                      </div>
                    )}

                    {/* MobileNet scene classification results */}
                    {classifications.length > 0 && (
                      <>
                        <div style={{ fontSize: "11px", color: "#a78bfa", fontWeight: 700, marginBottom: "6px", textTransform: "uppercase" }}>
                          Scene Analysis — humans · animals · plants · vehicles · tools · food · 1000+ types
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          {classifications.map((c, i) => (
                            <div key={i}
                              style={{ padding: "8px 12px", borderRadius: "10px", background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                              onClick={() => speak(`${c.className.split(",")[0]}, ${Math.round(c.probability * 100)} percent`)}>
                              <span style={{ fontSize: "13px", color: C.text, textTransform: "capitalize" }}>
                                {c.className.split(",")[0].trim()}
                              </span>
                              <span style={{ fontSize: "12px", color: "#a78bfa", fontWeight: 700, background: "rgba(167,139,250,0.15)", padding: "2px 8px", borderRadius: "20px" }}>
                                {Math.round(c.probability * 100)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <div style={{ fontWeight: 700, fontSize: "15px", color: C.text, marginBottom: "14px" }}>
                  📝 Recognized Text
                </div>
                {ocrRunning && (
                  <div style={{ textAlign: "center", padding: "20px 0" }}>
                    <div style={{ color: C.sub, fontSize: "13px" }}>Reading text… {ocrProgress}%</div>
                    <div style={{ width: "100%", background: C.inBorder, borderRadius: "4px", height: "6px", marginTop: "12px", overflow: "hidden" }}>
                      <div style={{ width: `${ocrProgress}%`, background: "#22c55e", height: "100%", transition: "width 0.3s", borderRadius: "4px" }} />
                    </div>
                  </div>
                )}
                {!ocrRunning && !ocrText && (
                  <div style={{ textAlign: "center", color: C.sub, padding: "24px 0" }}>
                    <div style={{ fontSize: "36px", marginBottom: "8px" }}>📄</div>
                    <div style={{ fontSize: "13px" }}>No text read yet</div>
                    <div style={{ fontSize: "11px", marginTop: "4px" }}>Upload an image with text, then click Read Text</div>
                  </div>
                )}
                {!ocrRunning && ocrText && (
                  <>
                    <button className="btn btn-yellow btn-sm btn-full" onClick={() => speak(ocrText)} style={{ marginBottom: "10px" }}>
                      🔊 Read Text Aloud
                    </button>
                    <div style={{ background: C.input, border: `1px solid ${C.inBorder}`, borderRadius: "10px", padding: "12px", maxHeight: "320px", overflowY: "auto" }}>
                      <pre style={{ color: C.text, fontSize: "13px", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontFamily: "Inter, sans-serif", lineHeight: 1.6 }}>
                        {ocrText}
                      </pre>
                    </div>
                    <button className="btn btn-ghost btn-sm btn-full" onClick={() => { setOcrText(""); setOcrProgress(0); }} style={{ marginTop: "10px" }}>
                      🗑️ Clear
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

const st = {
  imgBox:     { borderRadius: "16px", padding: "20px" },
  dropZone:   { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", padding: "48px 20px", borderRadius: "12px", width: "100%", boxSizing: "border-box" },
  resultsBox: { borderRadius: "16px", padding: "18px" },
};
