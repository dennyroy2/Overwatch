import json
from types import SimpleNamespace as NS

import pytest

from backend.perception.detect import Detection
from backend.perception.frames import ClipInfo, Frame
from backend.perception.geolocate import load_flight_path
from backend.perception.sidecar import (
    crop_path, dumps, evidence_id, read_sidecar, sidecar_path, update_manifest, write_crops,
)

FIXTURE = __import__("pathlib").Path(__file__).resolve().parents[1] / "fixtures" / "flight_margaret_drone2.json"


def test_evidence_ids_are_deterministic():
    assert evidence_id("margaret_drone2", 7, 0) == "ev_margaret_drone2_7_0"
    assert evidence_id("margaret_drone2", 7, 0) == evidence_id("margaret_drone2", 7, 0)


def test_paths_land_where_the_frontend_serves_them():
    assert sidecar_path("c").as_posix().endswith("frontend/public/footage/c.detections.json")
    assert crop_path("ev_c_1_0").as_posix().endswith("frontend/public/crops/ev_c_1_0.jpg")


def test_dumps_is_stable_and_ends_with_a_newline():
    assert dumps({"b": 1, "a": [1, 2]}) == dumps({"b": 1, "a": [1, 2]})
    assert dumps({"a": 1}).endswith("}\n")


def test_manifest_adds_replaces_and_sorts_by_id(tmp_path):
    path = tmp_path / "manifest.json"
    update_manifest({"id": "b", "v": 1}, path)
    update_manifest({"id": "a", "v": 1}, path)
    m = update_manifest({"id": "b", "v": 2}, path)
    assert [(c["id"], c["v"]) for c in m["clips"]] == [("a", 1), ("b", 2)]
    assert json.loads(path.read_text()) == m


# ---------------------------------------------------------------- the whole assembly, with stand-in models
np = pytest.importorskip("numpy")
pytest.importorskip("cv2")
from backend.perception.precompute import build_clip  # noqa: E402


def frame(i, t):
    img = np.full((720, 1280, 3), 90, np.uint8)
    img[300:340, 600:700] = (40 + i, 120, 200)           # a distinct patch so crops differ per frame
    return Frame(i, t, img)


def run(sightings=True, n=8, big_from=0, small_conf=lambda i: 0.2 if i < 2 else 0.6):
    flight = load_flight_path(FIXTURE)
    info = ClipInfo(1280, 720, 30.0, 435, 14.5)
    big = Detection(600, 300, 700, 340, 0.8)                       # always matches the clothing
    small = lambda i: Detection(300, 500, 310, 520, small_conf(i))  # about 26 m from it on the ground
    frames = [frame(i, i * 0.5 + 3.0) for i in range(n)]
    by_image = {id(f.image): f.index for f in frames}
    detector = lambda image: ([big] if by_image[id(image)] >= big_from else []) + [small(by_image[id(image)])]
    scorer = NS(clothing=["grey hooded jacket"],
                score=lambda image, box: NS(person=0.9 if box.width > 50 else 0.0, is_match=box.width > 50,
                                            best=NS(phrase="grey hooded jacket"), generic=[]))
    return build_clip("clipx", frames, detector, scorer, flight, info, 2.0, sightings=sightings, params={"detector": "fake"})


def kinds_of(r):
    return [(d["frame"], d["kind"]) for d in r.sidecar["detections"] if d["kind"]]


def test_repeated_detections_become_one_clue_and_every_box_is_kept():
    r = run(small_conf=lambda i: 0.1)                  # the small person is never sure enough to count
    assert kinds_of(r) == [(0, "clue")]
    assert [d["evidence_id"] for d in r.sidecar["detections"] if d["kind"]] == ["ev_clipx_0_0"]   # frame 0, most confident box
    assert len(r.sidecar["detections"]) == 16          # 8 frames x 2 boxes, all kept for the panel


def test_a_sighting_is_sent_once_it_is_sure_and_a_later_clue_is_a_different_kind():
    r = run(big_from=3, small_conf=lambda i: 0.6)      # the small person alone, then the matching one appears
    assert kinds_of(r) == [(0, "sighting"), (3, "clue")]


def test_a_sighting_beside_a_clue_in_the_same_frame_is_dropped_whichever_box_is_listed_first():
    r = run(small_conf=lambda i: 0.95)                 # the small person is even surer than the clue's box (0.8)
    assert kinds_of(r) == [(0, "clue")]


def test_crops_exist_only_for_evidence_and_match_the_ids():
    r = run(big_from=3, small_conf=lambda i: 0.6)
    assert set(r.crops) == {d["evidence_id"] for d in r.sidecar["detections"] if d["evidence_id"]}
    assert r.manifest_entry["evidence"] == len(r.crops) == 2
    assert all(c.shape[0] >= 96 and c.shape[1] >= 96 for c in r.crops.values())    # tiny boxes are enlarged


def test_sightings_can_be_switched_off():
    r = run(big_from=3, sightings=False, small_conf=lambda i: 0.6)
    assert kinds_of(r) == [(3, "clue")]


def test_the_sidecar_has_what_the_panel_reads():
    r = run()
    doc = r.sidecar
    assert doc["schema"] == 1 and doc["clip"] == "clipx" and doc["asset"] == "Drone 2"
    assert (doc["width"], doc["height"], doc["fps_sampled"]) == (1280, 720, 2.0)
    assert doc["frames"][0] == {"index": 0, "time_s": 3.0, "drone": {"lat": pytest.approx(53.53348, abs=1e-4), "lon": pytest.approx(-113.538099, abs=1e-4), "alt_m": 40.0, "heading_deg": 51.0}}
    d = doc["detections"][0]
    assert d["box"] == [0.4688, 0.4167, 0.5469, 0.4722] and d["label"] == "grey hooded jacket" and d["matched"] is True
    assert set(d["location"]) == {"lat", "lon"} and d["radius_m"] > 75
    assert all("n" not in x for x in doc["detections"])
    e = r.manifest_entry
    assert (e["id"], e["video"], e["sidecar"], e["asset"]) == ("clipx", "/footage/clipx.mp4", "/footage/clipx.detections.json", "Drone 2")
    assert e["time_range_s"] == [0.0, 14.5] and 53.5 < e["placement"]["lat"] < 53.6


def test_running_it_twice_gives_identical_bytes():
    a, b = run(), run()
    assert dumps(a.sidecar) == dumps(b.sidecar)
    assert dumps(a.manifest_entry) == dumps(b.manifest_entry)
    assert all((a.crops[k] == b.crops[k]).all() for k in a.crops)


def test_write_crops_removes_this_clips_stale_crops_only(tmp_path):
    img = np.zeros((120, 120, 3), np.uint8)
    for name in ("ev_clipx_1_0", "ev_clipx_9_9", "ev_other_1_0"):
        (tmp_path / f"{name}.jpg").write_bytes(b"x")
    write_crops("clipx", {"ev_clipx_1_0": img}, tmp_path)
    assert sorted(p.name for p in tmp_path.iterdir()) == ["ev_clipx_1_0.jpg", "ev_other_1_0.jpg"]
    assert (tmp_path / "ev_clipx_1_0.jpg").stat().st_size > 10      # rewritten as a real JPEG


def test_every_clothing_match_carries_a_reliability_but_plain_boxes_do_not():
    r = run(small_conf=lambda i: 0.1)
    for d in r.sidecar["detections"]:
        assert (d["reliability"] is not None) == d["matched"]
    sent = [d for d in r.sidecar["detections"] if d["kind"]]
    assert sent[0]["reliability"] == 0.83                      # clothing score 0.9 -> calibrated (only a perfect 1.0 reaches 0.90)
