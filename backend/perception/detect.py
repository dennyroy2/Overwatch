"""Steps 26 and 28: person detection on whole frames, then sliced (SAHI) inference."""
from __future__ import annotations

from dataclasses import dataclass

PERSON_CLASS = 0            # COCO class id for "person"
DEFAULT_WEIGHTS = "yolo11m.pt"   # a mid-size model, so the miss in step 27 is not blamed on a weak one. *.pt is gitignored; downloaded on first use


@dataclass(frozen=True)
class Detection:
    """A box in full-frame pixels, (x1, y1) top-left to (x2, y2) bottom-right."""
    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float
    label: str = "person"

    @property
    def width(self) -> float:
        return self.x2 - self.x1

    @property
    def height(self) -> float:
        return self.y2 - self.y1

    @property
    def centre(self) -> tuple[float, float]:
        return ((self.x1 + self.x2) / 2, (self.y1 + self.y2) / 2)


_MODELS: dict[str, object] = {}


def _weights_path(weights: str) -> str:
    """A bare name like "yolo11m.pt" is looked up in `weights/` first, so nothing lands in the repo root."""
    from .paths import WEIGHTS_DIR

    local = WEIGHTS_DIR / weights
    WEIGHTS_DIR.mkdir(exist_ok=True)
    return str(local)


def load_model(weights: str = DEFAULT_WEIGHTS):
    """Load (once) and cache an Ultralytics YOLO model. Downloads the weights on first use."""
    if weights not in _MODELS:
        from ultralytics import YOLO  # heavy import stays inside the function

        _MODELS[weights] = YOLO(_weights_path(weights))
    return _MODELS[weights]


def to_detections(boxes_xyxy, confidences, classes, names: dict[int, str] | None = None,
                  keep_class: int | None = PERSON_CLASS) -> list[Detection]:
    """Plain lists/arrays of boxes, scores and class ids -> `Detection`s, highest confidence first.
    `keep_class=None` keeps every class."""
    out = []
    for (x1, y1, x2, y2), c, k in zip(boxes_xyxy, confidences, classes):
        if keep_class is not None and int(k) != keep_class:
            continue
        label = (names or {}).get(int(k), "person" if int(k) == PERSON_CLASS else str(int(k)))
        out.append(Detection(float(x1), float(y1), float(x2), float(y2), float(c), label))
    return sorted(out, key=lambda d: -d.confidence)


def detect_people(image, weights: str = DEFAULT_WEIGHTS, conf: float = 0.25, imgsz: int = 640) -> list[Detection]:
    """Whole-frame person detection. `image` is a BGR array (what OpenCV gives). The frame is shrunk to
    `imgsz` on its longer side first, which is exactly why small people vanish (step 27)."""
    model = load_model(weights)
    result = model.predict(image, conf=conf, imgsz=imgsz, classes=[PERSON_CLASS], verbose=False)[0]
    b = result.boxes
    return to_detections(b.xyxy.cpu().tolist(), b.conf.cpu().tolist(), b.cls.cpu().tolist(), result.names)


def draw_detections(image, detections: list[Detection], colour=(36, 178, 255)):
    """A copy of `image` with each box and its confidence drawn on it (for eyeballing, never committed)."""
    import cv2

    out = image.copy()
    for d in detections:
        p1, p2 = (round(d.x1), round(d.y1)), (round(d.x2), round(d.y2))
        cv2.rectangle(out, p1, p2, colour, 2)
        cv2.putText(out, f"{d.label} {d.confidence:.2f}", (p1[0], max(12, p1[1] - 4)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, colour, 1, cv2.LINE_AA)
    return out


def detect_people_sliced(image, weights: str = DEFAULT_WEIGHTS, conf: float = 0.25,
                         tile: int = 640, overlap: float = 0.2) -> list[Detection]:
    """Sliced inference with SAHI, merged back to full-frame coordinates. Step 28."""
    raise NotImplementedError("step 28")
