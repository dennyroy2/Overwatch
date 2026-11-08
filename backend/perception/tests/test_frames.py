from backend.perception.frames import sample_times


def test_sample_times_at_two_fps():
    assert sample_times(2.0, 2.0) == [0.0, 0.5, 1.0, 1.5, 2.0]


def test_sample_times_never_passes_the_duration():
    assert sample_times(14.5, 2.0)[-1] == 14.5
    assert sample_times(1.2, 2.0)[-1] == 1.0


def test_sample_times_empty_for_bad_input():
    assert sample_times(0, 2.0) == []
    assert sample_times(5, 0) == []
