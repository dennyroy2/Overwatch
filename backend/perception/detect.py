"""Steps 26 and 28: person detection on whole frames, then sliced (SAHI) inference."""
from __future__ import annotations

from dataclasses import dataclass

PERSON_CLASS = 0            # COCO class id for "person"
DEFAULT_WEIGHTS = "yolo11n.pt"   # *.pt is gitignored; Ultralytics downloads it on first use


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


def detect_people(image, weights: str = DEFAULT_WEIGHTS, conf: float = 0.25) -> list[Detection]:
    """Whole-frame detection. Implemented in step 26 (imports ultralytics inside)."""
    raise NotImplementedError("step 26")


def detect_people_sliced(image, weights: str = DEFAULT_WEIGHTS, conf: float = 0.25,
                         tile: int = 640, overlap: float = 0.2) -> list[Detection]:
    """Sliced inference with SAHI, merged back to full-frame coordinates. Step 28."""
    raise NotImplementedError("step 28")
