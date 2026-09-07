// Verifies the cross-detector conflict-filter ALGORITHM added to
// ObjectDetectionPage.jsx (filterConflictingGeneralDetections /
// CONFLICT_OVERLAP_THRESHOLD / computeOverlapCoef / normPred) against
// synthetic bounding boxes reconstructing the reported real test cases.
//
// IMPORTANT: this is a geometric/algorithmic test of the filter logic in
// isolation (faithful copy of the same three pure functions from the
// component, hand-verified identical below). It does NOT run the actual
// ONNX/DETR models — that requires a browser and remains a manual test
// item (Chrome automation unavailable this session). This test proves the
// filter WOULD suppress a general detection whose box occupies the same
// region as an accessibility hazard's box, and proves it leaves everything
// else untouched.
//
// Run: node src/lib/detectionConflictFilter.test.mjs

function normPred(p, imgW, imgH) {
  if (p.box) {
    const { xmin, ymin, xmax, ymax } = p.box;
    return { label: p.label, score: p.score, x: xmin, y: ymin, w: xmax - xmin, h: ymax - ymin };
  }
  const [x, y, w, h] = p.bbox;
  return { label: p.class, score: p.score, x, y, w, h };
}

function computeOverlapCoef(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const minArea = Math.min(a.w * a.h, b.w * b.h);
  return minArea > 0 ? inter / minArea : 0;
}

const CONFLICT_OVERLAP_THRESHOLD = 0.5;

function filterConflictingGeneralDetections(generalPreds, hazardPreds, imgW, imgH) {
  if (hazardPreds.length === 0 || generalPreds.length === 0) return generalPreds;
  const hazardBoxes = hazardPreds.map(p => normPred(p, imgW, imgH));
  return generalPreds.filter(gp => {
    const gBox = normPred(gp, imgW, imgH);
    return !hazardBoxes.some(hBox => computeOverlapCoef(gBox, hBox) >= CONFLICT_OVERLAP_THRESHOLD);
  });
}

let pass = 0, fail = 0;
function check(name, actualLabels, expectedLabels) {
  const a = actualLabels.slice().sort().join(",");
  const e = expectedLabels.slice().sort().join(",");
  const ok = a === e;
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  expected=[${e}]  got=[${a}]`);
}

// ── TEST A: wheelchair image (your real test) ──
// Wheelchair occupies a large central region; "bottle" is a small box
// nested inside it (e.g. a reflective part); "bicycle" is a large box
// mostly overlapping the wheelchair's wheels/frame. "person" is a
// genuinely separate object elsewhere in frame and must survive.
{
  const hazards = [{ label: "wheelchair", score: 0.74, box: { xmin: 200, ymin: 150, xmax: 600, ymax: 550 } }];
  const general = [
    { label: "bottle",  score: 0.92, box: { xmin: 520, ymin: 200, xmax: 580, ymax: 340 } }, // nested inside wheelchair box
    { label: "bicycle", score: 0.75, box: { xmin: 210, ymin: 300, xmax: 590, ymax: 540 } }, // majority-overlaps wheelchair box
    { label: "person",  score: 0.88, box: { xmin: 0,   ymin: 0,   xmax: 150, ymax: 400 } }, // no overlap — real, separate object
  ];
  const kept = filterConflictingGeneralDetections(general, hazards, 800, 600);
  check("TEST A — wheelchair image", kept.map(p => p.label), ["person"]);
}

// ── TEST B: white_cane image (your real test) ──
// The cane is a long thin region; "baseball bat" is (per your report) the
// exact same shape misclassified — nearly identical box. "person" is
// elsewhere in frame and must survive.
{
  const hazards = [{ label: "white_cane", score: 0.98, box: { xmin: 300, ymin: 100, xmax: 340, ymax: 580 } }];
  const general = [
    { label: "baseball bat", score: 0.66, box: { xmin: 305, ymin: 120, xmax: 335, ymax: 560 } }, // same region as cane
    { label: "person",       score: 0.90, box: { xmin: 400, ymin: 50,  xmax: 700, ymax: 590 } }, // separate, real object
  ];
  const kept = filterConflictingGeneralDetections(general, hazards, 800, 600);
  check("TEST B — white_cane image", kept.map(p => p.label), ["person"]);
}

// ── TEST B2: second white_cane image (your real test, lower confidence) ──
{
  const hazards = [{ label: "white_cane", score: 0.97, box: { xmin: 280, ymin: 80, xmax: 320, ymax: 560 } }];
  const general = [
    { label: "baseball bat", score: 0.57, box: { xmin: 285, ymin: 100, xmax: 315, ymax: 540 } },
  ];
  const kept = filterConflictingGeneralDetections(general, hazards, 800, 600);
  check("TEST B2 — second white_cane image", kept.map(p => p.label), []);
}

// ── TEST C: pothole image, legitimate nearby-but-distinct object survives ──
{
  const hazards = [{ label: "pothole", score: 0.55, box: { xmin: 300, ymin: 500, xmax: 420, ymax: 560 } }]; // ground-level
  const general = [
    { label: "car", score: 0.81, box: { xmin: 50, ymin: 100, xmax: 400, ymax: 400 } }, // upper frame, no overlap with pothole box
  ];
  const kept = filterConflictingGeneralDetections(general, hazards, 800, 600);
  check("TEST C — pothole image, unrelated car survives", kept.map(p => p.label), ["car"]);
}

// ── TEST D: ordinary photo, NO accessibility hazard at all ──
// Filter must be a complete no-op — general COCO detection fully preserved.
{
  const hazards = [];
  const general = [
    { label: "car",    score: 0.85, box: { xmin: 50,  ymin: 100, xmax: 400, ymax: 400 } },
    { label: "person", score: 0.90, box: { xmin: 420, ymin: 80,  xmax: 600, ymax: 590 } },
  ];
  const kept = filterConflictingGeneralDetections(general, hazards, 800, 600);
  check("TEST D — ordinary photo, no hazard, nothing filtered", kept.map(p => p.label), ["car", "person"]);
}

// ── TEST E: partial/weak overlap must NOT be suppressed (avoid over-triggering) ──
{
  const hazards = [{ label: "wheelchair", score: 0.70, box: { xmin: 200, ymin: 150, xmax: 400, ymax: 350 } }];
  const general = [
    // Only ~20% of this box's area overlaps the hazard box — a genuinely
    // different, merely-adjacent object, must survive.
    { label: "backpack", score: 0.60, box: { xmin: 380, ymin: 150, xmax: 480, ymax: 350 } },
  ];
  const kept = filterConflictingGeneralDetections(general, hazards, 800, 600);
  check("TEST E — weak/partial overlap survives (not over-triggered)", kept.map(p => p.label), ["backpack"]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
