"""
Phase 4 experiment: fine-tune facebook/detr-resnet-50 into the 3-class
accessibility detector (wheelchair, white_cane, pothole) using the
leakage-safe ml/data/prepared_v2/ split, with conservative train-time
augmentation and recall-aware checkpoint selection.

This is a SEPARATE experiment from the v1 training run. It does NOT
overwrite ml/checkpoints/accessibility_detr_best/ (the current production
baseline) or ml/train/training_log.json (the v1 log). Output goes to
ml/checkpoints/accessibility_detr_v2_exp1/ and
ml/train/training_log_v2_exp1.json.

Approved Phase 4 configuration (see conversation record / Phase 3 proposal):
  - data: ml/data/prepared_v2 (leakage-safe re-split)
  - augmentation: train split only, via ml/train/augmentations.py
  - image size: shortest_edge=480, longest_edge=800 (unchanged from v1 --
    proven safe; a GPU smoke test at this exact config measured 1912.8 MiB
    peak / 4095.5 MiB total = 46.7% VRAM before this run was approved)
  - batch size: 4, gradient accumulation: 2 (effective batch 8, zero extra
    peak VRAM cost -- sequential smaller forward/backward passes)
  - learning rates: UNCHANGED from v1 (lr_backbone=1e-5, lr_other=1e-4) --
    deliberately not touched so this experiment isolates the effect of
    data+augmentation+checkpoint-selection, not LR tuning
  - epochs: up to 15, with patience=4 early stopping (no hard wall-clock cap
    this time -- v1's cap was a same-day-deadline artifact, not a measured
    requirement)
  - checkpoint selection: best MINIMUM per-class recall (wheelchair/
    white_cane/pothole) on the leakage-safe validation split, at the
    production confidence threshold (0.40) and the production
    accessibility NMS logic (mirrored in ml/train/evaluate.py), NOT total
    validation loss. Total loss is still logged for reference. Recall is
    computed via evaluate.evaluate_loaded_model -- the same matching/AP
    code that was hand-verified in evaluate.py's _selftest() before being
    trusted here.

No ONNX export, no application code changes, no production model swap.
"""

import argparse
import json
import random
import sys
import time
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader
from transformers import AutoImageProcessor, DetrForObjectDetection

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dataset import AccessibilityYoloDataset, CLASSES, collate_fn  # noqa: E402
import evaluate as eval_module  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent  # ml/
DATA_ROOT = ROOT / "data" / "prepared_v2"
CKPT_ROOT = ROOT / "checkpoints"
DEFAULT_RUN_NAME = "accessibility_detr_v2_exp1"  # the approved full-experiment name

BASE_MODEL = "facebook/detr-resnet-50"
IMAGE_SIZE = {"shortest_edge": 480, "longest_edge": 800}  # unchanged from v1 -- smoke-tested safe

BATCH_SIZE = 4
ACCUM_STEPS = 2
NUM_EPOCHS = 15
PATIENCE = 4
LR_BACKBONE = 1e-5
LR_OTHER = 1e-4


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--max-epochs", type=int, default=NUM_EPOCHS,
                    help="Override NUM_EPOCHS (used for short persistence/resume tests; "
                         "the approved full experiment uses the default 15).")
    p.add_argument("--resume-from", type=str, default=None,
                    help="Run-name to resume model/optimizer/history state FROM (its "
                         "<name>_last/ checkpoint dir + <name>_resume_state.pt). Skips the "
                         "sanity check. Does NOT imply writing back to that same run-name -- "
                         "use --run-name to control where THIS run's outputs are saved, so a "
                         "resumed test run can never overwrite the state it resumed from. "
                         "Omit to start fresh.")
    p.add_argument("--run-name", type=str, default=DEFAULT_RUN_NAME,
                    help="Names this run's OWN output paths (checkpoint dirs + log file) so "
                         "isolated test runs can never collide with each other or with the "
                         "approved full experiment's files. Default is the approved "
                         "full-experiment name.")
    return p.parse_args()


def run_paths(run_name):
    log_name = "training_log_v2_exp1.json" if run_name == DEFAULT_RUN_NAME else f"training_log_{run_name}.json"
    return {
        "best_ckpt_dir": CKPT_ROOT / run_name,
        "last_ckpt_dir": CKPT_ROOT / f"{run_name}_last",
        "resume_state_path": CKPT_ROOT / f"{run_name}_resume_state.pt",
        "log_path": ROOT / "train" / log_name,
    }


def build_model_and_processor():
    processor = AutoImageProcessor.from_pretrained(BASE_MODEL, size=IMAGE_SIZE)
    model = DetrForObjectDetection.from_pretrained(
        BASE_MODEL,
        num_labels=len(CLASSES),
        ignore_mismatched_sizes=True,
    )
    return model, processor


def sanity_check(model, processor, device):
    print("=" * 70)
    print("SANITY CHECK")
    print("=" * 70)

    ds = AccessibilityYoloDataset(DATA_ROOT, "train", processor, augment=True)
    print(f"[1] Loaded prepared_v2 'train' (augmented): {len(ds)} images")

    n_probe = min(4, len(ds))
    samples = [ds[i] for i in range(n_probe)]
    print(f"[2] Loaded {n_probe} training samples")

    seen_labels = set()
    for s in samples:
        seen_labels.update(int(c) for c in s["labels"]["class_labels"].tolist())
    bad_labels = seen_labels - {0, 1, 2}
    print(f"[3] Class IDs present in probed samples: {sorted(seen_labels)} "
          f"(expected subset of {{0:wheelchair, 1:white_cane, 2:pothole}})")
    if bad_labels:
        print(f"    FAIL: unexpected class ids found: {bad_labels}")
        return False

    batch = collate_fn(samples[: min(2, n_probe)], processor)
    batch = {k: (v.to(device) if torch.is_tensor(v) else [{kk: vv.to(device) for kk, vv in d.items()} for d in v])
             for k, v in batch.items()}

    model.to(device)
    model.train()
    outputs = model(pixel_values=batch["pixel_values"], pixel_mask=batch["pixel_mask"], labels=batch["labels"])
    loss = outputs.loss
    print(f"[4] Forward pass OK. Output loss tensor shape: {loss.shape}, dtype: {loss.dtype}")

    if not torch.isfinite(loss):
        print(f"    FAIL: loss is not finite: {loss.item()}")
        return False
    print(f"[5] Loss calculation OK. Initial loss = {loss.item():.4f}")

    optimizer = torch.optim.AdamW(model.parameters(), lr=LR_OTHER)
    optimizer.zero_grad()
    loss.backward()
    optimizer.step()

    with torch.no_grad():
        outputs2 = model(pixel_values=batch["pixel_values"], pixel_mask=batch["pixel_mask"], labels=batch["labels"])
    print(f"[6] One optimizer step completed. Loss before step: {loss.item():.4f}, "
          f"loss after step (same batch): {outputs2.loss.item():.4f}")

    print("SANITY CHECK: PASSED")
    print("=" * 70)
    return True


def run_epoch_train(model, loader, device, optimizer, accum_steps):
    model.train()
    total_loss, total_ce, total_bbox, total_giou, n_batches = 0.0, 0.0, 0.0, 0.0, 0
    optimizer.zero_grad()
    for step, batch in enumerate(loader):
        pixel_values = batch["pixel_values"].to(device)
        pixel_mask = batch["pixel_mask"].to(device)
        labels = [{k: v.to(device) for k, v in t.items()} for t in batch["labels"]]

        outputs = model(pixel_values=pixel_values, pixel_mask=pixel_mask, labels=labels)
        loss = outputs.loss / accum_steps
        loss.backward()

        if (step + 1) % accum_steps == 0:
            optimizer.step()
            optimizer.zero_grad()

        total_loss += outputs.loss.item()
        total_ce += outputs.loss_dict.get("loss_ce", torch.tensor(0.0)).item()
        total_bbox += outputs.loss_dict.get("loss_bbox", torch.tensor(0.0)).item()
        total_giou += outputs.loss_dict.get("loss_giou", torch.tensor(0.0)).item()
        n_batches += 1

    # flush any partial accumulation window at end of epoch
    if n_batches % accum_steps != 0:
        optimizer.step()
        optimizer.zero_grad()

    return {
        "loss": total_loss / n_batches, "loss_ce": total_ce / n_batches,
        "loss_bbox": total_bbox / n_batches, "loss_giou": total_giou / n_batches,
        "n_batches": n_batches,
    }


@torch.no_grad()
def run_epoch_eval_loss(model, loader, device):
    model.eval()
    total_loss, total_ce, total_bbox, total_giou, n_batches = 0.0, 0.0, 0.0, 0.0, 0
    for batch in loader:
        pixel_values = batch["pixel_values"].to(device)
        pixel_mask = batch["pixel_mask"].to(device)
        labels = [{k: v.to(device) for k, v in t.items()} for t in batch["labels"]]
        outputs = model(pixel_values=pixel_values, pixel_mask=pixel_mask, labels=labels)
        total_loss += outputs.loss.item()
        total_ce += outputs.loss_dict.get("loss_ce", torch.tensor(0.0)).item()
        total_bbox += outputs.loss_dict.get("loss_bbox", torch.tensor(0.0)).item()
        total_giou += outputs.loss_dict.get("loss_giou", torch.tensor(0.0)).item()
        n_batches += 1
    return {
        "loss": total_loss / n_batches, "loss_ce": total_ce / n_batches,
        "loss_bbox": total_bbox / n_batches, "loss_giou": total_giou / n_batches,
        "n_batches": n_batches,
    }


def main():
    args = parse_args()
    max_epochs = args.max_epochs
    paths = run_paths(args.run_name)
    BEST_CKPT_DIR = paths["best_ckpt_dir"]
    LAST_CKPT_DIR = paths["last_ckpt_dir"]
    RESUME_STATE_PATH = paths["resume_state_path"]
    LOG_PATH = paths["log_path"]

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device} ({torch.cuda.get_device_name(0) if device.type == 'cuda' else 'CPU'})", flush=True)
    print(f"Run name: {args.run_name}", flush=True)
    print(f"Output paths: best={BEST_CKPT_DIR} last={LAST_CKPT_DIR} resume_state={RESUME_STATE_PATH} log={LOG_PATH}",
          flush=True)

    CKPT_ROOT.mkdir(parents=True, exist_ok=True)

    resume_source = None
    if args.resume_from:
        source_paths = run_paths(args.resume_from)
        if source_paths["resume_state_path"].exists() and source_paths["last_ckpt_dir"].exists():
            resume_source = source_paths
        else:
            print(f"--resume-from {args.resume_from!r} passed but no resumable state found at "
                  f"{source_paths['resume_state_path']} / {source_paths['last_ckpt_dir']} "
                  f"-- starting fresh instead.", flush=True)
    resuming = resume_source is not None

    if resuming:
        print(f"Resuming FROM run '{args.resume_from}' ({resume_source['last_ckpt_dir']} / "
              f"{resume_source['resume_state_path']}), SAVING TO run '{args.run_name}' "
              f"({BEST_CKPT_DIR} / {LAST_CKPT_DIR}) -- source run's own files will not be touched.",
              flush=True)
        processor = AutoImageProcessor.from_pretrained(resume_source["last_ckpt_dir"])
        model = DetrForObjectDetection.from_pretrained(resume_source["last_ckpt_dir"])
        model.to(device)
        state = torch.load(resume_source["resume_state_path"], map_location=device, weights_only=False)
        history = state["history"]
        best_min_class_recall = state["best_min_class_recall"]
        best_val_loss_at_best_recall = state["best_val_loss_at_best_recall"]
        best_epoch = state["best_epoch"]
        epochs_since_improvement = state["epochs_since_improvement"]
        start_epoch = state["last_completed_epoch"] + 1
        random.setstate(state["py_random_state"])
        np.random.set_state(state["np_random_state"])
        # torch.load(..., map_location=device) remaps every tensor in the
        # saved state onto the GPU -- but torch.set_rng_state/
        # torch.cuda.set_rng_state both require a CPU ByteTensor regardless
        # of which device's RNG is being restored, so force it back here.
        torch.set_rng_state(state["torch_random_state"].cpu())
        if device.type == "cuda" and state.get("torch_cuda_random_state") is not None:
            torch.cuda.set_rng_state(state["torch_cuda_random_state"].cpu())
        print(f"Resumed at epoch {start_epoch}, prior history has {len(history)} entries, "
              f"best_epoch={best_epoch}, best_min_class_recall={best_min_class_recall}", flush=True)
    else:
        model, processor = build_model_and_processor()
        if not sanity_check(model, processor, device):
            print("Sanity check FAILED. Aborting before real training.", flush=True)
            sys.exit(1)
        model, processor = build_model_and_processor()
        model.to(device)
        history = []
        best_min_class_recall = -1.0
        best_val_loss_at_best_recall = float("inf")
        best_epoch = None
        epochs_since_improvement = 0
        start_epoch = 1

    train_ds = AccessibilityYoloDataset(DATA_ROOT, "train", processor, augment=True)
    valid_ds = AccessibilityYoloDataset(DATA_ROOT, "valid", processor, augment=False)
    test_ds = AccessibilityYoloDataset(DATA_ROOT, "test", processor, augment=False)

    def cf(batch):
        return collate_fn(batch, processor)

    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True, collate_fn=cf)
    valid_loader = DataLoader(valid_ds, batch_size=BATCH_SIZE, shuffle=False, collate_fn=cf)
    test_loader = DataLoader(test_ds, batch_size=BATCH_SIZE, shuffle=False, collate_fn=cf)

    backbone_params = [p for n, p in model.named_parameters() if "backbone" in n and p.requires_grad]
    other_params = [p for n, p in model.named_parameters() if "backbone" not in n and p.requires_grad]
    optimizer = torch.optim.AdamW([
        {"params": backbone_params, "lr": LR_BACKBONE},
        {"params": other_params, "lr": LR_OTHER},
    ])
    if resuming and state.get("optimizer_state_dict") is not None:
        optimizer.load_state_dict(state["optimizer_state_dict"])

    print("=" * 70, flush=True)
    print("TRAINING (Phase 4 experiment: prepared_v2 + augmentation + recall-based checkpoint selection)", flush=True)
    print(f"config: epochs<= {max_epochs} patience={PATIENCE} batch_size={BATCH_SIZE} accum_steps={ACCUM_STEPS} "
          f"(effective batch {BATCH_SIZE*ACCUM_STEPS}) image_size={IMAGE_SIZE} "
          f"lr_backbone={LR_BACKBONE} lr_other={LR_OTHER} start_epoch={start_epoch}", flush=True)
    print(f"train={len(train_ds)} valid={len(valid_ds)} test={len(test_ds)} images", flush=True)
    print("=" * 70, flush=True)

    start_time = time.time()

    for epoch in range(start_epoch, max_epochs + 1):
        epoch_start = time.time()

        t0 = time.time()
        train_metrics = run_epoch_train(model, train_loader, device, optimizer, ACCUM_STEPS)
        train_time = time.time() - t0

        t0 = time.time()
        val_loss_metrics = run_epoch_eval_loss(model, valid_loader, device)
        val_loss_time = time.time() - t0

        t0 = time.time()
        val_recall_metrics = eval_module.evaluate_loaded_model(
            model, processor, DATA_ROOT, "valid", device,
            threshold=eval_module.PRODUCTION_THRESHOLD, checkpoint_label=f"epoch_{epoch}_inmem",
        )
        val_recall_time = time.time() - t0

        per_class_full_metrics = {
            c: {
                "precision": val_recall_metrics["per_class"][c]["precision"],
                "recall": val_recall_metrics["per_class"][c]["recall"],
                "f1": val_recall_metrics["per_class"][c]["f1"],
                "ap_at_0.5": val_recall_metrics["per_class"][c]["ap_at_0.5"],
                "tp": val_recall_metrics["per_class"][c]["tp"],
                "fp_duplicate": val_recall_metrics["per_class"][c]["fp_duplicate"],
                "fp_other": val_recall_metrics["per_class"][c]["fp_other"],
                "fn": val_recall_metrics["per_class"][c]["fn"],
                "num_gt": val_recall_metrics["per_class"][c]["num_gt"],
            }
            for c in CLASSES
        }
        per_class_recall = {c: per_class_full_metrics[c]["recall"] for c in CLASSES}
        recalls_present = [r for r in per_class_recall.values() if r is not None]
        min_class_recall = min(recalls_present) if recalls_present else 0.0
        epoch_time = time.time() - epoch_start

        print(f"[epoch {epoch}/{max_epochs}] train_loss={train_metrics['loss']:.4f} "
              f"val_loss={val_loss_metrics['loss']:.4f} "
              f"val_recall(wheelchair/white_cane/pothole)="
              f"{per_class_recall['wheelchair']}/{per_class_recall['white_cane']}/{per_class_recall['pothole']} "
              f"min_class_recall={min_class_recall:.4f} "
              f"TIMING: train={train_time:.1f}s val_loss={val_loss_time:.1f}s val_recall_eval={val_recall_time:.1f}s "
              f"total_epoch={epoch_time:.1f}s", flush=True)
        for c in CLASSES:
            m = per_class_full_metrics[c]
            prec = f"{m['precision']:.4f}" if m['precision'] is not None else "n/a"
            f1 = f"{m['f1']:.4f}" if m['f1'] is not None else "n/a"
            ap = f"{m['ap_at_0.5']:.4f}" if m['ap_at_0.5'] is not None else "n/a"
            rec = f"{m['recall']:.4f}" if m['recall'] is not None else "n/a"
            print(f"    {c:12s} precision={prec} recall={rec} f1={f1} ap@0.5={ap} "
                  f"tp={m['tp']} fp_dup={m['fp_duplicate']} fp_other={m['fp_other']} fn={m['fn']} num_gt={m['num_gt']}",
                  flush=True)

        history.append({
            "epoch": epoch,
            "train": train_metrics,
            "valid_loss": val_loss_metrics,
            "valid_per_class_recall": per_class_recall,
            "valid_per_class_metrics": per_class_full_metrics,
            "valid_min_class_recall": min_class_recall,
            "checkpoint_selection_metric": min_class_recall,
            "epoch_time_seconds": epoch_time,
            "timing_breakdown_seconds": {
                "train": train_time, "val_loss_eval": val_loss_time, "val_recall_eval": val_recall_time,
            },
        })

        improved = (min_class_recall > best_min_class_recall) or (
            min_class_recall == best_min_class_recall and val_loss_metrics["loss"] < best_val_loss_at_best_recall
        )
        if improved:
            best_min_class_recall = min_class_recall
            best_val_loss_at_best_recall = val_loss_metrics["loss"]
            best_epoch = epoch
            epochs_since_improvement = 0
            model.save_pretrained(BEST_CKPT_DIR)
            processor.save_pretrained(BEST_CKPT_DIR)
            print(f"    -> new best (min_class_recall={min_class_recall:.4f}, val_loss={val_loss_metrics['loss']:.4f}), "
                  f"checkpoint saved to {BEST_CKPT_DIR}", flush=True)
        else:
            epochs_since_improvement += 1
            print(f"    no improvement ({epochs_since_improvement}/{PATIENCE})", flush=True)

        # Save resumable state after EVERY completed epoch (independent of
        # whether it was a "best" epoch) so an interruption never loses more
        # than the current epoch's work.
        model.save_pretrained(LAST_CKPT_DIR)
        processor.save_pretrained(LAST_CKPT_DIR)
        torch.save({
            "last_completed_epoch": epoch,
            "history": history,
            "best_min_class_recall": best_min_class_recall,
            "best_val_loss_at_best_recall": best_val_loss_at_best_recall,
            "best_epoch": best_epoch,
            "epochs_since_improvement": epochs_since_improvement,
            "optimizer_state_dict": optimizer.state_dict(),
            "py_random_state": random.getstate(),
            "np_random_state": np.random.get_state(),
            "torch_random_state": torch.get_rng_state(),
            "torch_cuda_random_state": torch.cuda.get_rng_state() if device.type == "cuda" else None,
        }, RESUME_STATE_PATH)
        print(f"    resumable state saved (epoch {epoch} complete) -> {LAST_CKPT_DIR} / {RESUME_STATE_PATH}", flush=True)

        # write the training log incrementally too, so even a mid-run kill
        # leaves a partial-but-honest log rather than none at all
        _write_log(history, best_epoch, best_min_class_recall, best_val_loss_at_best_recall,
                   device, start_time, final_test_metrics=None, complete=False, max_epochs_used=max_epochs,
                   best_ckpt_dir=BEST_CKPT_DIR, log_path=LOG_PATH, run_name=args.run_name)

        if epochs_since_improvement >= PATIENCE:
            print(f"    patience exhausted -- stopping after epoch {epoch}", flush=True)
            break

    total_time = time.time() - start_time
    print("Running final loss-only check on held-out test split (informational; real comparison is via evaluate.py)...", flush=True)
    test_metrics = run_epoch_eval_loss(model, test_loader, device)

    _write_log(history, best_epoch, best_min_class_recall, best_val_loss_at_best_recall,
               device, start_time, final_test_metrics=test_metrics, complete=True, max_epochs_used=max_epochs,
               best_ckpt_dir=BEST_CKPT_DIR, log_path=LOG_PATH, run_name=args.run_name)
    print(f"Training log written to {LOG_PATH}", flush=True)
    print(f"Best checkpoint: {BEST_CKPT_DIR} (epoch {best_epoch}, min_class_recall={best_min_class_recall:.4f})", flush=True)
    print("No ONNX export performed. No application files touched. accessibility_detr_best/ (v1) untouched.", flush=True)


def _write_log(history, best_epoch, best_min_class_recall, best_val_loss_at_best_recall,
                device, start_time, final_test_metrics, complete, best_ckpt_dir, log_path,
                run_name, max_epochs_used=NUM_EPOCHS):
    log = {
        "run_name": run_name,
        "base_model": BASE_MODEL,
        "classes": CLASSES,
        "data_root": str(DATA_ROOT),
        "config": {
            "batch_size": BATCH_SIZE, "accum_steps": ACCUM_STEPS, "effective_batch_size": BATCH_SIZE * ACCUM_STEPS,
            "num_epochs_max": max_epochs_used, "patience": PATIENCE,
            "image_size": IMAGE_SIZE, "lr_backbone": LR_BACKBONE, "lr_other": LR_OTHER,
            "augmentation": "flip+scale_jitter(380-480)+crop(>=70% box retention)+color_jitter, train split only",
            "checkpoint_selection": "best minimum per-class recall on valid split @ threshold=0.40 + production NMS; "
                                     "val_loss is tie-breaker only",
        },
        "device": str(device),
        "run_complete": complete,
        "epochs_completed": len(history),
        "total_training_time_seconds": time.time() - start_time,
        "history": history,
        "best_epoch": best_epoch,
        "best_min_class_recall": best_min_class_recall,
        "best_val_loss_at_best_recall": best_val_loss_at_best_recall,
        "best_checkpoint": str(best_ckpt_dir),
        "final_test_loss_only_metrics": final_test_metrics,
    }
    log_path.write_text(json.dumps(log, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
