"""Steps 27-29: count how many labelled people a detector finds (recall) and how many of its boxes are real
(precision), on images with YOLO-format label files (`class x_centre y_centre width height`, all 0-1).

    .venv/bin/python -m backend.perception.evaluate --images <dir> --labels <dir> [--imgsz 640]
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

from .detect import Detection

DEFAULT_IOU = 0.3   # tiny boxes make 0.5 harsh: a 2 px shift on a 20 px person already costs a third of the overlap


def read_yolo_labels(path: Path, width: int, height: int) -> list[Detection]:
    """A YOLO label file -> ground-truth boxes in pixels (confidence 1). A missing file means no people."""
    path = Path(path)
    if not path.is_file():
        return []
    out = []
    for line in path.read_text().splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        xc, yc, w, h = (float(v) for v in parts[1:5])
        out.append(Detection((xc - w / 2) * width, (yc - h / 2) * height, (xc + w / 2) * width, (yc + h / 2) * height, 1.0))
    return out


def iou(a: Detection, b: Detection) -> float:
    ix = max(0.0, min(a.x2, b.x2) - max(a.x1, b.x1))
    iy = max(0.0, min(a.y2, b.y2) - max(a.y1, b.y1))
    inter = ix * iy
    union = a.width * a.height + b.width * b.height - inter
    return inter / union if union > 0 else 0.0


@dataclass(frozen=True)
class Counts:
    truth: int        # labelled people
    found: int        # labelled people matched by a box
    boxes: int        # boxes the detector drew
    correct: int      # boxes that matched a labelled person

    @property
    def recall(self) -> float:
        return self.found / self.truth if self.truth else 0.0

    @property
    def precision(self) -> float:
        return self.correct / self.boxes if self.boxes else 0.0

    def __add__(self, o: "Counts") -> "Counts":
        return Counts(self.truth + o.truth, self.found + o.found, self.boxes + o.boxes, self.correct + o.correct)


def match(truth: list[Detection], detections: list[Detection], iou_min: float = DEFAULT_IOU) -> Counts:
    """Greedy one-to-one matching, most confident box first. Each labelled person and each box counts once."""
    taken: set[int] = set()
    correct = 0
    for d in sorted(detections, key=lambda d: -d.confidence):
        best, best_iou = None, iou_min
        for i, t in enumerate(truth):
            if i in taken:
                continue
            v = iou(t, d)
            if v >= best_iou:
                best, best_iou = i, v
        if best is not None:
            taken.add(best)
            correct += 1
    return Counts(len(truth), len(taken), len(detections), correct)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="backend.perception.evaluate", description=__doc__)
    p.add_argument("--images", type=Path, required=True)
    p.add_argument("--labels", type=Path, required=True)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--iou", type=float, default=DEFAULT_IOU)
    p.add_argument("--weights", default=None)
    p.add_argument("--width", type=int, default=None, help="shrink every image to this width first (the demo clip is 1280 wide)")
    p.add_argument("--sliced", action="store_true", help="use sliced inference (SAHI) with the tile settings below")
    p.add_argument("--tile", type=int, default=480)
    p.add_argument("--overlap", type=float, default=0.2)
    p.add_argument("--standard-pass", type=int, default=1, help="1 = also run a whole-frame pass")
    args = p.parse_args(argv)

    import cv2

    from . import detect

    weights = args.weights or detect.DEFAULT_WEIGHTS
    total = Counts(0, 0, 0, 0)
    for img_path in sorted(args.images.glob("*.jpg")):
        image = cv2.imread(str(img_path))
        if args.width:
            image = cv2.resize(image, (args.width, round(image.shape[0] * args.width / image.shape[1])), interpolation=cv2.INTER_AREA)
        h, w = image.shape[:2]
        truth = read_yolo_labels(args.labels / f"{img_path.stem}.txt", w, h)
        if args.sliced:
            dets = detect.detect_people_sliced(image, weights, args.conf, args.tile, args.overlap, args.imgsz, bool(args.standard_pass))
        else:
            dets = detect.detect_people(image, weights, args.conf, args.imgsz)
        c = match(truth, dets, args.iou)
        total += c
        print(f"{img_path.name:24s} people {c.truth:2d}  found {c.found:2d}  boxes {c.boxes:2d}  correct {c.correct:2d}")
    mode = f"sliced tile={args.tile} overlap={args.overlap} std={args.standard_pass} " if args.sliced else "whole-frame "
    print(f"TOTAL  {mode}imgsz={args.imgsz} conf={args.conf} iou>={args.iou}: found {total.found} of {total.truth} people "
          f"(recall {total.recall:.0%}), {total.correct} of {total.boxes} boxes real (precision {total.precision:.0%})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
