from pathlib import Path

import pytest

from backend.perception.cluecheck import best_f1, f1_sweep

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def test_f1_sweep_counts_precision_and_recall_at_each_threshold():
    rows = {r["t"]: r for r in f1_sweep([0.9, 0.8, 0.4], [0.5, 0.1])}
    assert rows[0.0]["recall"] == 1.0 and rows[0.0]["precision"] == pytest.approx(0.6)
    assert rows[0.45] == {"t": 0.45, "precision": 0.667, "recall": 0.667, "f1": 0.667}
    assert rows[0.95]["recall"] == 0.0


def test_best_f1_sits_in_the_middle_of_a_clean_gap_not_on_its_edge():
    b = best_f1([0.7, 0.8, 0.9], [0.1, 0.2, 0.3])       # anything from 0.31 to 0.70 separates them
    assert b["f1"] == 1.0
    assert 0.4 < b["t"] < 0.6


def test_recolour_repaints_the_persons_grey_pixels_and_leaves_the_background():
    cv2 = pytest.importorskip("cv2")
    from backend.perception.clothing import colour_fraction
    from backend.perception.cluecheck import recolour
    from backend.perception.detect import Detection

    img = cv2.imread(str(FIXTURES / "frame_grey_jacket.jpg"))
    box = Detection(300, 190, 350, 212, 1.0)
    blue = recolour(img, box, (110, 170))
    assert colour_fraction(img, box, "blue") < 0.05 < colour_fraction(blue, box, "blue")
    assert (img[:100] == blue[:100]).all()                 # far from the person: untouched
