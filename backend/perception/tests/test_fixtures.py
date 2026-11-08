from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def test_the_placeholder_frames_decode():
    cv2 = pytest.importorskip("cv2")
    for name in ("frame_grey_jacket", "frame_blue_jacket", "frame_red_jacket", "frame_empty"):
        img = cv2.imread(str(FIXTURES / f"{name}.jpg"))
        assert img is not None and img.shape == (360, 640, 3), name
