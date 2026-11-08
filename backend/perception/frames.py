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
    """Yield frames from `video` at `fps`, oldest first. `time_s` is the real time of the frame that
    was picked (its index divided by the video's own frame rate), so it is exact and repeatable.
    Raises FileNotFoundError if the clip is missing and ValueError if it cannot be decoded."""
    import cv2  # heavy import stays inside the function

    video = Path(video)
    if not video.is_file():
        raise FileNotFoundError(f"clip not found: {video}")
    cap = cv2.VideoCapture(str(video))
    try:
        vfps = cap.get(cv2.CAP_PROP_FPS)
        count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if not cap.isOpened() or vfps <= 0 or count <= 0:
            raise ValueError(f"cannot decode {video}")
        wanted = frame_indices(count, vfps, fps)
        next_wanted = 0
        for idx in range(count):
            if next_wanted >= len(wanted) or not cap.grab():
                break
            if idx == wanted[next_wanted]:
                ok, image = cap.retrieve()
                if not ok:
                    break
                yield Frame(next_wanted, round(idx / vfps, 6), image)
                next_wanted += 1
    finally:
        cap.release()


def frame_indices(count: int, video_fps: float, fps: float = DEFAULT_FPS) -> list[int]:
    """Which frame numbers of a `count`-frame clip are picked when sampling at `fps`."""
    if count <= 0 or video_fps <= 0:
        return []
    last = (count - 1) / video_fps
    return sorted({min(count - 1, round(t * video_fps)) for t in sample_times(last, fps)})
