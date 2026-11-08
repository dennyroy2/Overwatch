from backend.perception.frames import sample_times


def test_sample_times_at_two_fps():
    assert sample_times(2.0, 2.0) == [0.0, 0.5, 1.0, 1.5, 2.0]


def test_sample_times_never_passes_the_duration():
    assert sample_times(14.5, 2.0)[-1] == 14.5
    assert sample_times(1.2, 2.0)[-1] == 1.0


def test_sample_times_empty_for_bad_input():
    assert sample_times(0, 2.0) == []
    assert sample_times(5, 0) == []


def test_frame_indices_at_two_fps_of_a_30_fps_clip():
    from backend.perception.frames import frame_indices

    assert frame_indices(435, 30, 2.0)[:4] == [0, 15, 30, 45]
    assert frame_indices(435, 30, 2.0)[-1] == 420          # 14.0 s; 14.5 s is past the last frame
    assert frame_indices(0, 30) == []


def _write_clip(path, frames=60, fps=30):
    import cv2
    import numpy as np

    w = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (64, 48))
    for i in range(frames):
        w.write(np.full((48, 64, 3), i * 4 % 256, np.uint8))
    w.release()


def test_extract_frames_keeps_each_frames_time(tmp_path):
    import pytest

    pytest.importorskip("cv2")
    from backend.perception.frames import extract_frames

    clip = tmp_path / "c.mp4"
    _write_clip(clip, frames=60, fps=30)
    got = list(extract_frames(clip, fps=2.0))
    assert [f.index for f in got] == [0, 1, 2, 3]
    assert [f.time_s for f in got] == [0.0, 0.5, 1.0, 1.5]
    assert got[0].image.shape == (48, 64, 3)
    assert list(extract_frames(clip, fps=2.0))[2].time_s == got[2].time_s   # repeatable


def test_extract_frames_reports_a_missing_or_broken_clip(tmp_path):
    import pytest

    pytest.importorskip("cv2")
    from backend.perception.frames import extract_frames

    with pytest.raises(FileNotFoundError):
        list(extract_frames(tmp_path / "nope.mp4"))
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"not a video")
    with pytest.raises(ValueError):
        list(extract_frames(bad))
