"""Step 26: pull frames out of a clip at a fixed rate, keeping each frame's time."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

DEFAULT_FPS = 2.0


@dataclass(frozen=True)
class Frame:
    index: int          # 0, 1, 2... in extraction order
    time_s: float       # seconds from the start of the clip
    image: "object"     # BGR numpy array (H, W, 3); typed loosely so numpy is not needed at import


def sample_times(duration_s: float, fps: float = DEFAULT_FPS) -> list[float]:
    """The clip times (seconds) frames are taken at: 0, 1/fps, 2/fps, ... up to the duration."""
    if duration_s <= 0 or fps <= 0:
        return []
    n = int(duration_s * fps + 1e-9) + 1
    return [round(i / fps, 6) for i in range(n) if i / fps <= duration_s + 1e-9]


def extract_frames(video: Path, fps: float = DEFAULT_FPS) -> Iterator[Frame]:
    """Yield frames from `video` at `fps`. Implemented in step 26 (needs OpenCV)."""
    raise NotImplementedError("step 26")
