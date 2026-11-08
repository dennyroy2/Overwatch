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


# Sliced-inference settings chosen in step 28 (see frontend/DECISIONS.md for the table they came from).
SLICED_CONF = 0.10      # lower than whole-frame's 0.25: tiles are small, and precision stayed at 97-100% on both halves
SLICE_TILE = 320        # px per tile of the frame as given: tuned for the demo clip, which is 1280 wide
SLICE_OVERLAP = 0.2     # fraction shared by neighbouring tiles
SLICE_IMGSZ = 1024      # each tile is enlarged to this before the detector sees it

_SAHI_MODELS: dict[tuple, object] = {}


def _sahi_model(weights: str, conf: float, imgsz: int):
    key = (weights, conf, imgsz)
    if key not in _SAHI_MODELS:
        from sahi import AutoDetectionModel  # heavy import stays inside the function

        _SAHI_MODELS[key] = AutoDetectionModel.from_pretrained(
            model_type="ultralytics", model_path=_weights_path(weights), confidence_threshold=conf, image_size=imgsz,
        )
    return _SAHI_MODELS[key]


def detect_people_sliced(image, weights: str = DEFAULT_WEIGHTS, conf: float = SLICED_CONF, tile: int = SLICE_TILE,
                         overlap: float = SLICE_OVERLAP, imgsz: int = SLICE_IMGSZ, standard_pass: bool = True) -> list[Detection]:
    """Sliced inference (SAHI): cut the frame into overlapping `tile`-pixel squares, detect in each (the tile is
    run at `imgsz`, so a small tile is enlarged), and merge the boxes back to full-frame pixels. Boxes cut by a
    tile edge are merged with their other half; duplicates from the overlap are removed. `standard_pass` also
    runs one ordinary whole-frame pass, which keeps large people that no single tile contains whole."""
    from PIL import Image
    from sahi.predict import get_sliced_prediction

    rgb = Image.fromarray(image[:, :, ::-1])      # OpenCV arrays are BGR; SAHI and PIL want RGB
    result = get_sliced_prediction(
        rgb, _sahi_model(weights, conf, imgsz), slice_height=tile, slice_width=tile,
        overlap_height_ratio=overlap, overlap_width_ratio=overlap, perform_standard_pred=standard_pass,
        postprocess_type="GREEDYNMM", postprocess_match_metric="IOS", postprocess_match_threshold=0.5, verbose=0,
    )
    boxes, scores, classes = [], [], []
    for p in result.object_prediction_list:
        b = p.bbox
        boxes.append((b.minx, b.miny, b.maxx, b.maxy))
        scores.append(p.score.value)
        classes.append(p.category.id)
    return to_detections(boxes, scores, classes, {PERSON_CLASS: "person"})
