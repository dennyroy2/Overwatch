from types import SimpleNamespace as NS

import pytest

from backend.perception import detect
from backend.perception.evaluate import Counts
from backend.perception.tune import pick_best, split_halves, total


def row(tile, tune_recall, tune_precision, boxes=10):
    return {"tile": tile, "tune": {"recall": tune_recall, "precision": tune_precision, "boxes": boxes}}


def test_split_halves_alternates_and_never_overlaps():
    tune, check = split_halves(list(range(7)))
    assert tune == [0, 2, 4, 6] and check == [1, 3, 5]
    assert not set(tune) & set(check)


def test_pick_best_takes_top_recall_among_rows_that_are_precise_enough():
    rows = [row(1, 0.9, 0.5), row(2, 0.7, 0.85), row(3, 0.6, 0.95)]
    assert pick_best(rows)["tile"] == 2


def test_pick_best_breaks_ties_with_fewer_boxes_and_can_find_nothing():
    assert pick_best([row(1, 0.7, 0.9, boxes=20), row(2, 0.7, 0.9, boxes=12)])["tile"] == 2
    assert pick_best([row(1, 0.9, 0.5)]) is None


def test_detect_people_sliced_passes_settings_to_sahi_and_converts_the_result(monkeypatch):
    np = pytest.importorskip("numpy")
    pytest.importorskip("sahi")
    pytest.importorskip("PIL")
    seen = {}

    def fake_slice(image, model, **kw):
        seen["pixel"] = image.getpixel((0, 0))          # PIL image, so the colour order is checkable
        seen.update(kw)
        p = lambda x1, y1, x2, y2, s, k: NS(bbox=NS(minx=x1, miny=y1, maxx=x2, maxy=y2), score=NS(value=s), category=NS(id=k))
        return NS(object_prediction_list=[p(1, 2, 3, 4, 0.6, 0), p(0, 0, 9, 9, 0.9, 2), p(5, 5, 8, 9, 0.8, 0)])

    monkeypatch.setattr("sahi.predict.get_sliced_prediction", fake_slice)
    monkeypatch.setattr(detect, "_sahi_model", lambda *a: "model")
    bgr = np.zeros((20, 20, 3), np.uint8)
    bgr[:, :] = (255, 0, 0)                              # blue in BGR
    out = detect.detect_people_sliced(bgr, tile=320, overlap=0.3, imgsz=1024, standard_pass=False)
    assert seen["pixel"] == (0, 0, 255)                  # arrives as blue in RGB
    assert (seen["slice_height"], seen["slice_width"]) == (320, 320)
    assert (seen["overlap_height_ratio"], seen["overlap_width_ratio"]) == (0.3, 0.3)
    assert seen["perform_standard_pred"] is False
    assert [d.confidence for d in out] == [0.8, 0.6]     # the class-2 box is dropped, the rest sorted


def test_total_adds_counts_and_handles_an_empty_half():
    assert total([Counts(2, 1, 3, 1), Counts(1, 1, 1, 1)]) == Counts(3, 2, 4, 2)
    assert total([]) == Counts(0, 0, 0, 0)


def test_sliced_defaults_are_the_settings_chosen_in_step_28():
    import inspect

    d = inspect.signature(detect.detect_people_sliced).parameters
    assert (d["conf"].default, d["tile"].default, d["overlap"].default, d["imgsz"].default, d["standard_pass"].default) == (
        0.10, 320, 0.2, 1024, True)
