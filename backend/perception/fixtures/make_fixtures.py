"""Makes the synthetic placeholder frames in this folder: `.venv/bin/python backend/perception/fixtures/make_fixtures.py`.

They are NOT real SAR footage. Each is a 640x360 grass-like field seen from above with one small
"person" (a torso ellipse and a head), so the plumbing and the clothing colour check have something
to run on. Real frames from the demo clip replace them once the clip is available. Deterministic."""
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
W, H = 640, 360
# name -> torso colour (B, G, R) or None for an empty field
FRAMES = {
    "frame_grey_jacket.jpg": (128, 128, 128),
    "frame_blue_jacket.jpg": (200, 90, 30),
    "frame_red_jacket.jpg": (40, 40, 200),
    "frame_empty.jpg": None,
}


def field() -> np.ndarray:
    rng = np.random.default_rng(7)
    img = np.empty((H, W, 3), np.uint8)
    img[:] = (60, 110, 70)
    noise = rng.integers(-18, 18, (H, W, 1))
    return np.clip(img.astype(int) + noise, 0, 255).astype(np.uint8)


for name, colour in FRAMES.items():
    img = field()
    if colour is not None:
        cv2.ellipse(img, (320, 200), (14, 8), 0, 0, 360, colour, -1)      # torso, about 28x16 px
        cv2.circle(img, (338, 200), 5, (120, 150, 190), -1)                # head
    cv2.imwrite(str(HERE / name), img, [cv2.IMWRITE_JPEG_QUALITY, 90])
print("wrote", len(FRAMES), "frames")
