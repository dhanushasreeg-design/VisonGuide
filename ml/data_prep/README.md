# Accessibility dataset prep (wheelchair / white_cane / pothole)

Status: **prep-only, blocked on raw data**. No training, no ONNX export, no
app changes have been made. See `ml/data/prepared/report.json` after running
the script for exact, non-invented image counts.

## Why this can't run yet

All three source datasets live on Roboflow Universe. Even the permissively
licensed ones (CC BY 4.0, MIT) are gated behind a Roboflow login for the
actual file download — there's no anonymous/curl-able export URL. So the
real image counts and the "images needing manual review" list can only be
produced by actually running `prepare_accessibility_dataset.py` against the
downloaded exports, not estimated in advance.

## What's needed to unblock

Download the three exports (free Roboflow account, no purchase needed) in
**YOLOv8** format and place them here:

```
ml/data/raw/wheelchair/    <- hijsmom/wheelchair-stroller-6hfsm, version 1   [DONE]
ml/data/raw/white_cane/    <- tra-nguyen1/white-cane-3, version 7            [PENDING]
ml/data/raw/pothole/       <- brad-dwyer/pothole-voxrl (Chitholian), version 1 [PENDING]
```

Each folder should look like a standard Roboflow YOLOv8 export:
`data.yaml`, `train/images`, `train/labels`, `valid/images`,
`valid/labels`, (`test/images`, `test/labels` if present).

Download links:
- https://universe.roboflow.com/hijsmom/wheelchair-stroller-6hfsm
- https://universe.roboflow.com/tra-nguyen1/white-cane-3/dataset/7
- https://universe.roboflow.com/brad-dwyer/pothole-voxrl

## Running the prep step

```
pip install pyyaml
python ml/data_prep/prepare_accessibility_dataset.py
```

This reads the raw exports, applies the approved class mapping (documented
at the top of the script), writes the filtered/remapped dataset to
`ml/data/prepared/`, and writes `ml/data/prepared/report.json` with the
exact counts required for the data preparation report:

- original images per source dataset
- images dropped because every box in them was a dropped class
  (e.g. an image that only contains a `stroller`, or only an `umbrella`)
- images with no label file at all (flagged for manual review, not silently
  skipped)
- final usable image count per dataset and combined
- final train/valid/test split counts

If the raw export for a dataset contains any class not in the approved
mapping, the script stops and reports it instead of guessing.

`ml/data/` (raw and prepared) is gitignored — it's local working data, not
committed to the repo.
