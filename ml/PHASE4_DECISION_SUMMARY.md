# Phase 4 Decision Summary — Accessibility Detector Retraining

**Decision: REJECTED. Production model unchanged.**
`ml/checkpoints/accessibility_detr_best/` remains the production candidate. Neither
Phase 4 epoch 8 nor epoch 12 is promoted. No further ML experiments are authorized
pending explicit approval of a next-phase plan.

This document is a record of what was tried, what was measured, and why the result
was rejected — not a new investigation. All numbers below are taken directly from
`ml/train/old_vs_new_eval_report.json`, `ml/train/epoch12_eval_report.json`, and
`ml/train/training_log_accessibility_detr_v2_exp1_final.json`, already computed in
this session.

---

## 1. Why Phase 4 was rejected

Phase 4 fixed a real, confirmed problem (train/valid/test leakage in the original
dataset split — see `ml/data/prepared_v2/README.md`) and added conservative,
justified augmentation. The resulting model was evaluated honestly against a
genuinely held-out test set and the original production model, using identical
threshold (0.40) and NMS logic for both. On that evaluation, the new model:

- **did not improve wheelchair recall at all** (the one thing this project set out
  to fix), and
- **substantially regressed white_cane and pothole precision**.

4 of 5 pre-agreed acceptance criteria failed. Per the standing priority order
(correctness > trustworthy metrics > safety > accuracy > speed), a model that is
measurably worse in aggregate and doesn't solve the target problem does not get
promoted, regardless of how much engineering effort produced it.

## 2. Why epoch 8 was rejected

Epoch 8 was the checkpoint selected automatically during training (best
minimum-per-class-recall on validation). Evaluated on `prepared_v2/test`:

| class | metric | OLD | epoch 8 |
|---|---|---|---|
| wheelchair | recall | 0.775 | 0.775 (tied, not improved) |
| white_cane | F1 | 0.938 | 0.872 (regressed) |
| pothole | precision | 0.377 | **0.198** (collapsed) |
| pothole | F1 | 0.464 | 0.287 (regressed) |
| overall | precision | 0.575 | 0.386 (collapsed) |
| duplicate detections | | 0 | 2 (increased) |

Root cause, confirmed by replaying the full 12-epoch validation history: pothole's
false-positive count oscillated wildly across training (238 → 313 → 242 → 415 → 359
→ 375 → **661** → 787 → **1083** → 878 → 260), and epoch 8 was selected right as the
model entered that unstable region — not at a stable optimum. The
minimum-per-class-recall selection metric has no visibility into precision, so it
could not tell an unstable, over-firing epoch apart from a genuinely improved one.

## 3. Why epoch 12 was rejected

Three independent alternative selection criteria (min per-class F1, macro F1, min
recall with a precision floor ≥0.30), replayed on the *same already-computed*
validation history with no retraining, all converged on epoch 12 as the best
checkpoint from this run — a real, confirmed methodology flaw in the original
selection metric. Epoch 12's weights were still physically saved
(`accessibility_detr_v2_exp1_final_last/`, confirmed via its resume-state file's
`last_completed_epoch: 12`), so it was evaluated on `prepared_v2/test` with no
retraining required. Result:

| class | metric | OLD | epoch 8 | epoch 12 |
|---|---|---|---|---|
| wheelchair | recall | 0.775 | 0.775 | **0.675 (worse)** |
| white_cane | F1 | 0.938 | 0.872 | 0.840 (still regressed, slightly worse than epoch 8) |
| pothole | precision | 0.377 | 0.198 | **0.369 (recovered)** |
| pothole | F1 | 0.464 | 0.287 | 0.417 (largely recovered) |
| overall | precision | 0.575 | 0.386 | **0.568 (recovered)** |
| duplicate detections | | 0 | 2 | **0 (recovered)** |
| small-object recall (aggregate) | | 0.513 | 0.504 | **0.357 (worse)** |
| 5+-instance recall (aggregate) | | 0.608 | 0.588 | **0.505 (worse)** |

Acceptance criteria: 2 of 5 passed (up from 1 of 5 for epoch 8), but the criterion
that mattered most — wheelchair recall — went from "tied" to "worse." Epoch 12
trades wheelchair recall (and a little white_cane) for a large pothole precision
recovery, rather than improving everything as the validation numbers had suggested.
This is exactly the validation/test generalization gap that keeping a genuinely
held-out test set is meant to catch, and it did.

## 4. Final OLD-vs-NEW metrics (all three, side by side)

**Per-class (precision / recall / F1 / AP@0.5), `prepared_v2/test`, threshold=0.40, same NMS:**

| class | OLD | epoch 8 | epoch 12 |
|---|---|---|---|
| wheelchair | 0.596 / 0.775 / 0.674 / 0.690 | 0.674 / 0.775 / 0.721 / 0.640 | 0.711 / 0.675 / 0.692 / 0.617 |
| white_cane | 0.932 / 0.943 / 0.938 / 0.939 | 0.864 / 0.881 / 0.872 / 0.824 | 0.824 / 0.855 / 0.840 / 0.804 |
| pothole | 0.377 / 0.602 / 0.464 / 0.477 | 0.198 / 0.516 / 0.287 / 0.299 | 0.369 / 0.478 / 0.417 / 0.355 |

**Overall (micro-averaged):**

| | OLD | epoch 8 | epoch 12 |
|---|---|---|---|
| precision | 0.575 | 0.386 | 0.568 |
| recall | 0.761 | 0.694 | 0.655 |
| F1 | 0.655 | 0.496 | 0.608 |
| duplicate detections | 0 | 2 | 0 |

## 5. Evidence that wheelchair recall is the unresolved problem

- Dataset composition (Phase 1/2 audit, unaffected by anything in Phase 4): 220
  wheelchair images, 82% single-instance, only one 14-instance outlier, only 5.4%
  small/distant boxes, zero images containing another class alongside a wheelchair.
- Phase 4 empirical result: wheelchair recall on test was **tied** between OLD and
  epoch 8 (31/40 both) despite augmentation specifically targeting the small-object
  gap (scale jitter 380–480px), and **worse** at epoch 12 (27/40).
- No configuration tried in Phase 4 — leakage-safe split, conservative augmentation,
  three different checkpoint-selection criteria — produced a single measurable
  wheelchair recall improvement on held-out data.

## 6. Evidence that additional wheelchair data is likely required

- The dataset audit gap (82% single-instance, 5.4% small boxes, zero multi-class
  co-occurrence) describes exactly the marathon/crowd scenario that motivated this
  project, and augmentation cannot manufacture new object diversity from photos
  that were never taken.
- Aggregate small-object recall (dominated by pothole's larger GT volume, so not a
  clean wheelchair-only signal, but the only figure the current evaluation
  supports): 0.513 (OLD) → 0.504 (epoch 8) → 0.357 (epoch 12) — flat-to-declining,
  never improving.
- Aggregate 5+-instance (crowded-scene) recall: 0.608 (OLD) → 0.588 (epoch 8) →
  0.505 (epoch 12) — same pattern.
- Conclusion carried forward from Phase 1/2/3, now empirically confirmed rather
  than merely predicted: no training-side change (split, augmentation, or
  checkpoint selection) fixes this. It requires new, licensed wheelchair images
  with genuine crowd/small/distant/occluded content.

## 7. Checkpoint-selection flaw discovered during Phase 4

Minimum-per-class-recall, used with no precision counterpart, cannot distinguish a
genuinely-improved epoch from one caught mid-instability with an inflated false
positive count. Confirmed by replaying the full validation history: three
alternative criteria (min F1, macro F1, min-recall-with-precision-floor) all
selected epoch 12 instead of epoch 8. This is a real, fixable methodology gap,
independent of the wheelchair data problem — worth correcting in any future
training attempt regardless of the data question.

## 8. Files and checkpoints — what's safe to keep, what stays quarantined

**Safe to keep, in active use:**
- `ml/checkpoints/accessibility_detr_best/` — production model, untouched throughout.
- `ml/onnx_export/accessibility_detr/` and `ml/onnx_export/accessibility_detr_int8/`
  — untouched throughout (int8 remains unused/inert, per standing instruction).
- `ml/data/prepared_v2/` — the leakage-safe dataset split itself is sound and
  reusable for any future training attempt; the rejection is about the trained
  model and selection criterion, not the data pipeline.
- `ml/data_prep/prepare_accessibility_dataset_v2.py`, `ml/train/dataset.py`,
  `ml/train/augmentations.py`, `ml/train/evaluate.py`, `ml/train/train.py` — all
  verified working code (augmentation sanity-checked, evaluator hand-verified,
  resume mechanism bug found and fixed). Reusable starting points for a future
  attempt, not to be blindly rerun as-is given the selection-metric flaw in §7.

**Experimental artifacts, kept quarantined (not deleted, not in use):**
- `ml/checkpoints/_quarantine_20260829_203739/` — the original contaminated
  concurrent-process run (two training processes wrote to the same files
  undetected; see prior session record).
- `ml/checkpoints/_smoketest_artifacts/` — throwaway code-verification runs.
- `ml/checkpoints/accessibility_detr_v2_exp1_clean_test1*`,
  `accessibility_detr_v2_exp1_clean_test2_resumed*` — isolation/resume mechanism
  verification runs, not real experiments.
- `ml/checkpoints/accessibility_detr_v2_exp1_INCOMPLETE_killed_epoch1/` — leftover
  from the very first (environment-killed) launch attempt.
- `ml/checkpoints/accessibility_detr_v2_exp1_final/` (epoch 8) and
  `accessibility_detr_v2_exp1_final_last/` (epoch 12) — the two real candidates
  evaluated and rejected in this report. Kept for reference/audit trail, not
  promoted, not deleted.

**Total disk footprint of quarantined/experimental checkpoints is significant
(multiple ~330MB resume-state files plus ~166MB model files each) — worth a
housekeeping pass at some point, but that's a storage decision, not a modeling
one, and is deferred pending your instruction.**

## 9. Production integrity — confirmed unchanged

- `ml/checkpoints/accessibility_detr_best/config.json` — timestamp Aug 27 13:55,
  unchanged since before this session began.
- `ml/onnx_export/accessibility_detr/model.onnx` — timestamp Aug 27 14:28,
  unchanged.
- `git status` for the tracked repository — identical to the state at the start of
  this session (same 8 modified files, all pre-existing and unrelated to ML work).
- Frontend (`ObjectDetectionPage.jsx`, live-camera code), the 0.40 confidence
  threshold, the accessibility NMS logic, and the COCO detector were never touched
  at any point in Phases 1–4.

---

## Recommendation for the next development phase (not executed — awaiting approval)

Two independent, non-conflicting work items, either of which can proceed alone:

1. **Fix the checkpoint-selection criterion** (§7) before any future training run —
   replace minimum-per-class-recall with something precision-aware (e.g. minimum
   per-class F1, or recall with a precision floor). This is a code-only change, no
   new data needed, and directly addresses the pothole/white_cane instability
   observed here.
2. **Source new, licensed wheelchair data** targeting the specific measured gaps:
   multi-instance/crowd scenes, small/distant instances, and images where a
   wheelchair co-occurs with other people/clutter. This is the only path that
   addresses §5/§6 (wheelchair recall), and per your standing rule, requires
   presenting specific candidate datasets and their licenses for approval before
   anything is downloaded.

Item 1 alone would not have been sufficient in this run (epoch 12 proves that), but
combining a precision-aware selection criterion with genuinely new wheelchair data
is the most defensible next attempt — doing one without the other is likely to
reproduce a version of the same trade-off seen here.

**No action will be taken on either item without your explicit instruction.**
