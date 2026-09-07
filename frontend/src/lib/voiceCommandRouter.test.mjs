// Focused test matrix for the Voice Assistant app-page shortcut matcher.
// Plain Node ESM script (no test framework dependency) — run with:
//   node src/lib/voiceCommandRouter.test.mjs
// from the frontend/ directory.

import { matchAppShortcut } from "./voiceCommandRouter.js";

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .trim()
    .replace(/[.!?,]+$/, "")
    .trim()
    .replace(/\s+/g, " ");
}

const cases = [
  // ── OBJECT DETECTION ──
  ["object detection", "/dashboard/objects"],
  ["open object detection", "/dashboard/objects"],
  ["go to object detection", "/dashboard/objects"],
  ["detect objects", "/dashboard/objects"],
  ["detect objects for me", "/dashboard/objects"],
  ["identify objects", "/dashboard/objects"],
  ["what objects are around me", "/dashboard/objects"],
  ["what is in this image", "/dashboard/objects"],
  ["analyze this image", "/dashboard/objects"],
  ["photo object detection", "/dashboard/objects"],
  ["detect objects in photo", "/dashboard/objects"],
  ["read objects", "/dashboard/objects"],
  ["tell me what objects you see", "/dashboard/objects"],
  ["please open object detection", "/dashboard/objects"], // filler word "please"

  // ── CAMERA / TEXT READER / OCR ──
  ["camera text reader", "/dashboard/camera"],
  ["open camera text reader", "/dashboard/camera"],
  ["go to camera text reader", "/dashboard/camera"],
  ["read text", "/dashboard/camera"],
  ["read this text", "/dashboard/camera"],
  ["read the text", "/dashboard/camera"],
  ["scan text", "/dashboard/camera"],
  ["scan this", "/dashboard/camera"],
  ["scan a document", "/dashboard/camera"],
  ["read document", "/dashboard/camera"],
  ["text reader", "/dashboard/camera"],
  ["open text reader", "/dashboard/camera"],
  ["ocr", "/dashboard/camera"],
  ["camera ocr", "/dashboard/camera"],

  // ── NAVIGATION ──
  ["navigation", "/dashboard/navigation"],
  ["open navigation", "/dashboard/navigation"],
  ["go to navigation", "/dashboard/navigation"], // must keep working (pre-existing)
  ["start navigation", "/dashboard/navigation"],
  ["navigate", "/dashboard/navigation"],
  ["help me navigate", "/dashboard/navigation"],
  ["where am i", "/dashboard/navigation"],
  ["find nearby places", "/dashboard/navigation"],
  ["find places near me", "/dashboard/navigation"],

  // ── DASHBOARD / SETTINGS ──
  ["dashboard", "/dashboard"],
  ["home", "/dashboard"],
  ["open dashboard", "/dashboard"],
  ["settings", "/dashboard/settings"],
  ["open settings", "/dashboard/settings"],

  // ── Additional aliases from the follow-up accessibility usability pass ──
  ["what objects are there", "/dashboard/objects"],
  ["open object detector", "/dashboard/objects"],
  ["read text from camera", "/dashboard/camera"],
  ["camera reader", "/dashboard/camera"],

  // ── COLLISION / AMBIGUITY REGRESSION CASES (explicit in the report) ──
  ["open camera text reader", "/dashboard/camera"],       // must NOT hit Object Detection
  ["photo object detection", "/dashboard/objects"],        // must NOT hit Camera
  ["read this text", "/dashboard/camera"],                 // must NOT hit Object Detection or Articles
  ["go to navigation", "/dashboard/navigation"],            // must NOT hit Dashboard/Settings

  // ── SHOULD NOT MATCH (fall through to other intents / no shortcut) ──
  ["hospital near me", null],
  ["read articles", null],
  ["read saved locations", null],
  ["send sos", null],
  ["hello there", null],
  ["what time is it", null],
];

let pass = 0, fail = 0;
for (const [input, expectedPath] of cases) {
  const hit = matchAppShortcut(normalize(input));
  const gotPath = hit ? hit.path : null;
  const ok = gotPath === expectedPath;
  if (ok) pass++; else fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  "${input}"  ->  expected=${expectedPath}  got=${gotPath}`
  );
}

console.log(`\n${pass} passed, ${fail} failed, ${cases.length} total`);
process.exit(fail === 0 ? 0 : 1);
