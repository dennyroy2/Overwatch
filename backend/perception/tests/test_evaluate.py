import pytest

from backend.perception.detect import Detection
from backend.perception.evaluate import Counts, iou, match, read_yolo_labels


def box(x1, y1, x2, y2, c=0.9):
    return Detection(x1, y1, x2, y2, c)


def test_iou_of_identical_disjoint_and_half_overlapping_boxes():
    assert iou(box(0, 0, 10, 10), box(0, 0, 10, 10)) == 1.0
    assert iou(box(0, 0, 10, 10), box(20, 20, 30, 30)) == 0.0
    assert iou(box(0, 0, 10, 10), box(5, 0, 15, 10)) == pytest.approx(50 / 150)


def test_read_yolo_labels_converts_normalised_centre_boxes_to_pixels(tmp_path):
    f = tmp_path / "a.txt"
    f.write_text("0 0.5 0.5 0.1 0.2\n\nbad line\n")
    (b,) = read_yolo_labels(f, 1000, 500)
    assert (b.x1, b.y1, b.x2, b.y2) == pytest.approx((450, 200, 550, 300))
    assert read_yolo_labels(tmp_path / "missing.txt", 10, 10) == []


def test_match_counts_each_person_and_each_box_once():
    truth = [box(0, 0, 10, 10), box(100, 100, 110, 110)]
    dets = [box(0, 0, 10, 10, 0.9), box(1, 1, 10, 10, 0.8), box(300, 300, 310, 310, 0.7)]
    c = match(truth, dets)
    assert c == Counts(truth=2, found=1, boxes=3, correct=1)    # the second box on the same person and the stray are not correct
    assert (c.recall, c.precision) == (0.5, pytest.approx(1 / 3))


def test_empty_cases_do_not_divide_by_zero():
    assert match([], []).recall == 0.0 and match([], []).precision == 0.0


def test_counts_add_up():
    assert Counts(2, 1, 3, 1) + Counts(1, 1, 1, 1) == Counts(3, 2, 4, 2)
