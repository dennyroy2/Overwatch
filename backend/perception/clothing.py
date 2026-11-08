"""Step 30: clothing and gear clues. Clothing and gear only, never faces.

Two checks are combined into one 0-1 score per person box:
  1. YOLO-World (open vocabulary) looks inside the person box for each phrase in the subject's `clothing`.
  2. A cheap colour check: does the person's own colour (the pixels that are not background) match the colour
     word in the phrase? It handles greys and darks, not only hues.
A phrase with no colour word ("backpack") is scored by YOLO-World alone. Generic clues (backpack, cane, hat) are
recorded but are never a match by themselves (decision with Denny, 2026-11-08).
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

from .detect import Detection

# Generic clues searched for on every case, besides the subject's own clothing.
GENERIC_CLUES = ("backpack", "cane", "hat")
WORLD_WEIGHTS = "yolov8s-worldv2.pt"


def clue_prompts(clothing: list[str]) -> list[str]:
    """The open-vocabulary class list: the profile's clothing first, then generic clues, no duplicates."""
    seen: set[str] = set()
    out: list[str] = []
    for item in [*clothing, *GENERIC_CLUES]:
        key = item.strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(item.strip())
    return out


# ---------------------------------------------------------------- colour words and HSV bands
# OpenCV HSV: H 0-179, S 0-255, V 0-255. Each band is (h_lo, h_hi, s_lo, s_hi, v_lo, v_hi); hue is ignored for the
# neutrals (grey, white, dark). Red wraps round, so it has two hue ranges.
_SYNONYMS = {"gray": "grey", "black": "dark", "navy": "blue", "beige": "white", "cream": "white", "tan": "brown",
             "violet": "purple", "magenta": "pink", "cyan": "teal", "turquoise": "teal", "khaki": "brown"}
COLOURS = ("grey", "white", "dark", "blue", "red", "orange", "yellow", "green", "teal", "purple", "pink", "brown")


def colour_of(phrase: str) -> str | None:
    """The first colour word in a clothing phrase: 'grey hooded jacket' -> 'grey', 'dark track pants with white
    side stripes' -> 'dark', 'dark blue jacket' -> 'blue' (dark is a shade there), 'backpack' -> None."""
    words = [_SYNONYMS.get(w, w) for w in re.findall(r"[a-z]+", phrase.lower())]
    found = [w for w in words if w in COLOURS]
    if not found:
        return None
    if found[0] == "dark" and len(found) > 1 and words.index("dark") + 1 < len(words) and words[words.index("dark") + 1] in COLOURS:
        return found[1]
    return found[0]


def colour_mask(hsv, colour: str):
    """Boolean mask of the pixels of an HSV image that look `colour`."""
    import numpy as np

    h, s, v = hsv[..., 0].astype(int), hsv[..., 1].astype(int), hsv[..., 2].astype(int)
    if colour == "dark":
        return v < 75
    if colour == "grey":
        return (s < 55) & (v >= 75) & (v <= 195)
    if colour == "white":
        return (s < 45) & (v > 195)
    chroma = (s >= 70) & (v >= 55)
    bands = {"red": ((h <= 8) | (h >= 172)), "orange": (h > 8) & (h <= 22), "yellow": (h > 22) & (h <= 35),
             "green": (h > 35) & (h <= 85), "teal": (h > 85) & (h <= 98), "blue": (h > 98) & (h <= 130),
             "purple": (h > 130) & (h <= 150), "pink": (h > 150) & (h < 172)}
    if colour == "brown":
        return (h > 5) & (h <= 25) & (s >= 70) & (v >= 40) & (v < 150)
    return chroma & bands[colour] if colour in bands else np.zeros(h.shape, bool)


def foreground_mask(image, box: Detection, ring: float = 0.5, tolerance: float = 38.0):
    """Mask of the pixels inside `box` that are the person, not the ground around them. The ground's colour is the
    median of a ring of pixels just outside the box; inside pixels far from it (Lab distance) are the person.
    Returns (mask, pixels_bgr_of_the_box)."""
    import cv2
    import numpy as np

    h, w = image.shape[:2]
    pad = max(4, int(ring * max(box.width, box.height)))
    x1, y1, x2, y2 = (max(0, int(box.x1) - pad), max(0, int(box.y1) - pad), min(w, int(box.x2) + pad), min(h, int(box.y2) + pad))
    ix1, iy1, ix2, iy2 = max(0, int(box.x1)), max(0, int(box.y1)), min(w, int(box.x2) + 1), min(h, int(box.y2) + 1)
    if ix2 <= ix1 or iy2 <= iy1:
        return np.zeros((1, 1), bool), image[:1, :1]
    lab = cv2.cvtColor(image[y1:y2, x1:x2], cv2.COLOR_BGR2LAB).astype(np.float32)
    outer = np.ones(lab.shape[:2], bool)
    outer[iy1 - y1:iy2 - y1, ix1 - x1:ix2 - x1] = False
    ground = np.median(lab[outer], axis=0) if outer.any() else lab.reshape(-1, 3).mean(0)
    inside = lab[iy1 - y1:iy2 - y1, ix1 - x1:ix2 - x1]
    mask = np.linalg.norm(inside - ground, axis=2) > tolerance
    return mask, image[iy1:iy2, ix1:ix2]


def colour_fraction(image, box: Detection, colour: str) -> float:
    """Share of the person's own pixels (background removed) that look `colour`; 0 if there are none."""
    import cv2

    mask, pixels = foreground_mask(image, box)
    if not mask.any():
        return 0.0
    hsv = cv2.cvtColor(pixels, cv2.COLOR_BGR2HSV)
    return float((colour_mask(hsv, colour) & mask).sum() / mask.sum())


# ---------------------------------------------------------------- the combined score
WORLD_FULL = 0.25        # a YOLO-World confidence this high counts as a full 1.0 (its scores are low by nature)
COLOUR_FULL = 0.12       # this share of the person's pixels in the phrase's colour counts as a full 1.0
COLOUR_WEIGHT = 0.3      # how much the colour check counts against the model's score (geometric weighting)
# A person is a clothing match at or above this ("balanced": best F1, agreed with Denny). Chosen from the numbers in
# step 30 (see frontend/DECISIONS.md): bystanders and wrong-colour versions of the subject scored at most 0.41, the
# subject's real detections in the demo clip 0.48 to 1.00 (one at 0.10), so 0.45 keeps 18 of 19 with no false match.
MATCH_THRESHOLD = 0.45


def combine(world: float, colour_fraction_: float | None) -> float:
    """One 0-1 score for one phrase. `world` is YOLO-World's confidence; `colour_fraction_` is the share of the
    person's pixels in the phrase's colour, or None when the phrase has no colour word (model score only).
    Weighted geometric mean, so a phrase needs BOTH checks to score high: right object, right colour."""
    w = min(1.0, max(0.0, world / WORLD_FULL))
    if colour_fraction_ is None:
        return w
    c = min(1.0, max(0.0, colour_fraction_ / COLOUR_FULL))
    return (w ** (1 - COLOUR_WEIGHT)) * (c ** COLOUR_WEIGHT)


@dataclass(frozen=True)
class ItemScore:
    phrase: str
    world: float                 # YOLO-World confidence for the phrase inside the person box
    colour: float | None         # colour share, None if the phrase has no colour word
    score: float                 # `combine` of the two


@dataclass(frozen=True)
class ClueScore:
    items: tuple[ItemScore, ...]          # the subject's own clothing phrases
    generic: tuple[ItemScore, ...] = field(default_factory=tuple)   # backpack, cane, hat: recorded, never a match
    person: float = 0.0                   # the best of `items`: one strong garment is enough to be a clue

    @property
    def best(self) -> ItemScore | None:
        return max(self.items, key=lambda i: i.score, default=None)

    @property
    def is_match(self) -> bool:
        """True when the person's clothing matches the subject's: only the subject's own clothing counts, never a
        generic clue such as a backpack."""
        return self.person >= MATCH_THRESHOLD


def ensure_certificates() -> None:
    """YOLO-World fetches its text encoder with Python's own HTTPS, which on a python.org install does not trust
    the Mac's certificates. Point it at certifi's bundle (once) so the first run can download it."""
    if "SSL_CERT_FILE" not in os.environ:
        import certifi

        os.environ["SSL_CERT_FILE"] = certifi.where()


class ClueScorer:
    """Scores person boxes against one subject's clothing. Loads the open-vocabulary model once, on first use."""

    def __init__(self, clothing: list[str], weights: str = WORLD_WEIGHTS, pad: float = 0.35, size: int = 640):
        self.clothing = [c.strip() for c in clothing if c.strip()]
        self.prompts = clue_prompts(clothing)
        self.weights, self.pad, self.size = weights, pad, size
        self._model = None

    def _load(self):
        if self._model is None:
            ensure_certificates()
            from ultralytics import YOLOWorld  # heavy import stays inside the function

            from .detect import _weights_path

            model = YOLOWorld(_weights_path(self.weights))
            model.set_classes(self.prompts)
            self._model = model
        return self._model

    def world_scores(self, image, box: Detection) -> dict[str, float]:
        """Best YOLO-World confidence per phrase inside the (padded, enlarged) person box."""
        import cv2

        h, w = image.shape[:2]
        pad = max(8, self.pad * max(box.width, box.height))
        x1, y1, x2, y2 = (int(max(0, box.x1 - pad)), int(max(0, box.y1 - pad)), int(min(w, box.x2 + pad)), int(min(h, box.y2 + pad)))
        crop = image[y1:y2, x1:x2]
        if crop.size == 0:
            return {p: 0.0 for p in self.prompts}
        scale = self.size / max(crop.shape[:2])
        crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        result = self._load().predict(crop, conf=0.005, imgsz=self.size, verbose=False)[0]
        best = {p: 0.0 for p in self.prompts}
        for b in result.boxes:
            name = self.prompts[int(b.cls)]
            best[name] = max(best[name], float(b.conf))
        return best

    def score(self, image, box: Detection) -> ClueScore:
        world = self.world_scores(image, box)
        items = []
        for phrase in self.prompts:
            col = colour_of(phrase)
            frac = colour_fraction(image, box, col) if col else None
            items.append(ItemScore(phrase, world[phrase], frac, combine(world[phrase], frac)))
        own = tuple(i for i in items if i.phrase in self.clothing)
        generic = tuple(i for i in items if i.phrase not in self.clothing)
        return ClueScore(own, generic, max((i.score for i in own), default=0.0))
