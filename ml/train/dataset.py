"""
YOLO-format -> HF DETR annotation adapter for the prepared accessibility dataset.

Reads ml/data/prepared/<split>/{images,labels}/ (written by
ml/data_prep/prepare_accessibility_dataset.py) and exposes a torch Dataset
that yields the {"pixel_values", "pixel_mask", "labels"} format expected by
transformers.DetrForObjectDetection.

Does not touch the deployed Xenova/detr-resnet-50 ONNX model or any
application code.
"""

from pathlib import Path
from PIL import Image
import torch
from torch.utils.data import Dataset

CLASSES = ["wheelchair", "white_cane", "pothole"]


class AccessibilityYoloDataset(Dataset):
    def __init__(self, root: Path, split: str, image_processor, augment: bool = False):
        """
        augment: if True, apply the Phase 4 training-time augmentation
        pipeline (ml/train/augmentations.py) before handing the image to
        the DETR image processor. Must only be set True for the train
        split -- default is False so existing (valid/test, and any other
        caller) behavior is completely unchanged.
        """
        self.img_dir = Path(root) / split / "images"
        self.lbl_dir = Path(root) / split / "labels"
        self.image_processor = image_processor
        self.augment = augment
        self.samples = sorted(p for p in self.img_dir.glob("*") if p.is_file())
        if not self.samples:
            raise RuntimeError(f"No images found in {self.img_dir}")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        img_path = self.samples[idx]
        image = Image.open(img_path).convert("RGB")

        lbl_path = self.lbl_dir / (img_path.stem + ".txt")
        boxes_yolo = []
        class_ids = []
        if lbl_path.exists():
            for line in lbl_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                cls_id, cx, cy, bw, bh = line.split()
                boxes_yolo.append((float(cx), float(cy), float(bw), float(bh)))
                class_ids.append(int(cls_id))

        if self.augment:
            from augmentations import augment_train_sample
            image, boxes_yolo, class_ids = augment_train_sample(image, boxes_yolo, class_ids, seed=idx)

        w, h = image.size
        annotations = []
        for ann_id, (cls_id, (cx, cy, bw, bh)) in enumerate(zip(class_ids, boxes_yolo)):
            cx_px, cy_px, bw_px, bh_px = cx * w, cy * h, bw * w, bh * h
            x_min = cx_px - bw_px / 2
            y_min = cy_px - bh_px / 2
            annotations.append({
                "id": ann_id,
                "image_id": idx,
                "category_id": cls_id,
                "bbox": [x_min, y_min, bw_px, bh_px],
                "area": bw_px * bh_px,
                "iscrowd": 0,
            })

        target = {"image_id": idx, "annotations": annotations}
        encoding = self.image_processor(images=image, annotations=target, return_tensors="pt")
        return {
            "pixel_values": encoding["pixel_values"][0],
            "labels": encoding["labels"][0],
        }


def collate_fn(batch, image_processor):
    pixel_values = [item["pixel_values"] for item in batch]
    encoding = image_processor.pad(pixel_values, return_tensors="pt")
    labels = [item["labels"] for item in batch]
    return {
        "pixel_values": encoding["pixel_values"],
        "pixel_mask": encoding["pixel_mask"],
        "labels": labels,
    }
