import pytest

from backend.perception import detect
from backend.perception.detect import Detection, to_detections


def test_to_detections_keeps_people_only_sorted_by_confidence():
    out = to_detections([(0, 0, 10, 20), (5, 5, 9, 9), (1, 1, 4, 4)], [0.4, 0.9, 0.8], [0, 0, 2], {0: "person", 2: "car"})
    assert [d.confidence for d in out] == [0.9, 0.4]
    assert all(d.label == "person" for d in out)


def test_to_detections_can_keep_every_class():
    out = to_detections([(0, 0, 1, 1)], [0.5], [2], {2: "car"}, keep_class=None)
    assert out[0].label == "car"


def test_detection_geometry():
    d = Detection(10, 20, 30, 60, 0.5)
    assert (d.width, d.height, d.centre) == (20, 40, (20, 40))


def test_detect_people_asks_the_model_for_people_only_and_converts_boxes(monkeypatch):
    class Tensor(list):
        def cpu(self):
            return self

        def tolist(self):
            return list(self)

    class Boxes:
        xyxy, conf, cls = Tensor([[1, 2, 3, 4]]), Tensor([0.7]), Tensor([0])

    class Result:
        boxes, names = Boxes(), {0: "person"}

    seen = {}

    class Model:
        def predict(self, image, **kw):
            seen.update(kw)
            return [Result()]

    monkeypatch.setattr(detect, "load_model", lambda weights: Model())
    out = detect.detect_people("img", conf=0.3, imgsz=800)
    assert seen == {"conf": 0.3, "imgsz": 800, "classes": [0], "verbose": False}
    assert out == [Detection(1.0, 2.0, 3.0, 4.0, 0.7, "person")]


def test_draw_detections_returns_a_copy_with_pixels_changed():
    cv2 = pytest.importorskip("cv2")
    import numpy as np

    img = np.zeros((50, 50, 3), np.uint8)
    out = detect.draw_detections(img, [Detection(5, 5, 40, 40, 0.9)])
    assert img.sum() == 0 and out.sum() > 0
