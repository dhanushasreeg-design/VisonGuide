"""
Phase 4 training augmentations for the accessibility DETR (wheelchair /
white_cane / pothole). Uses only torchvision.transforms.v2 (already an
installed dependency of this project's torch/torchvision stack -- nothing
new is added to requirements).

Applied to the TRAIN split only. Never applied to valid/test -- evaluation
must see unmodified images.

Conservative by design (see ml/data/prepared_v2/README.md and the Phase 3
proposal for the audit findings that justify each choice):
  - horizontal flip (p=0.5): geometrically safe for all 3 classes.
  - scale jitter: resize shortest edge to a random value in [380, 480]
    before the existing DETR image processor's own 480/800 resize. This is
    the direct lever for the wheelchair small/distant-object gap -- it
    forces the same 220 wheelchairs to be seen at smaller effective scale.
  - moderate crop: crop retains >=70% of the area of every box that
    survives; boxes that would fall below that are dropped from that
    sample rather than kept as a mangled sliced box.
  - color jitter: brightness/contrast/saturation +/-15-20%.

Boxes are carried in YOLO-normalized (cx, cy, w, h) form throughout, same
convention as ml/data/prepared_v2 label files, so this module has no
dependency on any particular downstream annotation format.
"""

import random

from PIL import Image
from torchvision.transforms import v2 as T


def _yolo_to_xyxy(box, img_w, img_h):
    cx, cy, w, h = box
    return (
        (cx - w / 2) * img_w,
        (cy - h / 2) * img_h,
        (cx + w / 2) * img_w,
        (cy + h / 2) * img_h,
    )


def _xyxy_to_yolo(box, img_w, img_h):
    x1, y1, x2, y2 = box
    w = (x2 - x1) / img_w
    h = (y2 - y1) / img_h
    cx = (x1 + x2) / 2 / img_w
    cy = (y1 + y2) / 2 / img_h
    return (cx, cy, w, h)


def augment_train_sample(image: Image.Image, boxes_yolo, class_ids, seed=None):
    """
    image: PIL RGB image
    boxes_yolo: list of (cx, cy, w, h) normalized [0,1]
    class_ids: list of int, same length as boxes_yolo

    Returns (new_image, new_boxes_yolo, new_class_ids). Boxes/classes that
    get dropped by cropping are simply absent from the returned lists --
    never distorted into an invalid box.
    """
    rng = random.Random(seed)
    img_w, img_h = image.size
    boxes_px = [_yolo_to_xyxy(b, img_w, img_h) for b in boxes_yolo]

    # 1. horizontal flip
    if rng.random() < 0.5:
        image = T.functional.horizontal_flip(image)
        boxes_px = [(img_w - x2, y1, img_w - x1, y2) for (x1, y1, x2, y2) in boxes_px]

    # 2. moderate crop -- retain boxes with >=70% of original area inside the crop
    crop_frac = rng.uniform(0.8, 1.0)  # crop covers 80-100% of each dimension
    crop_w, crop_h = int(img_w * crop_frac), int(img_h * crop_frac)
    max_x0, max_y0 = img_w - crop_w, img_h - crop_h
    x0 = rng.randint(0, max(max_x0, 0))
    y0 = rng.randint(0, max(max_y0, 0))
    crop_box = (x0, y0, x0 + crop_w, y0 + crop_h)

    def _clip_and_area_ratio(b):
        x1, y1, x2, y2 = b
        cx1, cy1 = max(x1, crop_box[0]), max(y1, crop_box[1])
        cx2, cy2 = min(x2, crop_box[2]), min(y2, crop_box[3])
        inter_w, inter_h = max(0, cx2 - cx1), max(0, cy2 - cy1)
        inter_area = inter_w * inter_h
        orig_area = max(1e-6, (x2 - x1) * (y2 - y1))
        return (cx1, cy1, cx2, cy2), inter_area / orig_area

    image = image.crop(crop_box)
    new_boxes_px, new_class_ids = [], []
    for b, cid in zip(boxes_px, class_ids):
        clipped, ratio = _clip_and_area_ratio(b)
        if ratio >= 0.70:
            # shift into crop-local coordinates
            x1, y1, x2, y2 = clipped
            new_boxes_px.append((x1 - x0, y1 - y0, x2 - x0, y2 - y0))
            new_class_ids.append(cid)
    boxes_px = new_boxes_px
    class_ids = new_class_ids
    img_w, img_h = image.size

    # 3. scale jitter -- resize shortest edge into [380, 480], keep aspect ratio
    target_short = rng.randint(380, 480)
    short_side = min(img_w, img_h)
    scale = target_short / short_side
    new_w, new_h = max(1, round(img_w * scale)), max(1, round(img_h * scale))
    image = image.resize((new_w, new_h), Image.BILINEAR)
    boxes_px = [(x1 * scale, y1 * scale, x2 * scale, y2 * scale) for (x1, y1, x2, y2) in boxes_px]
    img_w, img_h = new_w, new_h

    # 4. color jitter (brightness/contrast/saturation +/-15-20%), no geometry change
    jitter = T.ColorJitter(brightness=0.20, contrast=0.20, saturation=0.15)
    image = jitter(image)

    boxes_yolo_out = [_xyxy_to_yolo(b, img_w, img_h) for b in boxes_px]
    # final safety filter: reject anything that rounds to zero/negative or out of range
    safe_boxes, safe_classes = [], []
    for (cx, cy, w, h), cid in zip(boxes_yolo_out, class_ids):
        if 0 <= cx <= 1 and 0 <= cy <= 1 and 0 < w <= 1 and 0 < h <= 1:
            safe_boxes.append((cx, cy, w, h))
            safe_classes.append(cid)

    return image, safe_boxes, safe_classes
