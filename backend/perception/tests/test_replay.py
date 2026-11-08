import json
from datetime import datetime, timedelta, timezone

import pytest

from backend.perception import sidecar
from backend.perception.geolocate import latlon_distance_m
from backend.perception.replay import evidence_for_clip, schedule_for_clip

START = datetime(2026, 11, 8, 21, 35, tzinfo=timezone.utc)


def test_the_committed_demo_clip_gives_one_fully_structured_drone_clue():
    (ev,) = evidence_for_clip("case_demo", "margaret_drone2", START)
    assert ev.id == "ev_margaret_drone2_8_0"
    assert (ev.case_id, ev.kind, ev.source, ev.confirmed) == ("case_demo", "clue", "drone_ai", False)
    assert ev.reliability == 0.9 and ev.radius_m and ev.radius_m > 75
    assert ev.media_url == "/crops/ev_margaret_drone2_8_0.jpg"
    assert ev.summary == "Drone 2: possible grey hooded jacket (90%)"
    assert ev.time == START + timedelta(seconds=4.0)                       # the frame at 4.0 s of the clip
    assert latlon_distance_m((ev.location.lat, ev.location.lon), (53.534, -113.537)) < 100   # the scenario's park
    assert ev.area is None and ev.raw_text is None


def test_the_crop_the_evidence_points_to_is_committed():
    (ev,) = evidence_for_clip("c", "margaret_drone2", START)
    assert sidecar.crop_path(ev.id).is_file()


def test_schedule_gives_the_offsets_in_time_order():
    sched = schedule_for_clip("c", "margaret_drone2", START)
    assert [round(o, 1) for o, _ in sched] == [4.0]


def _write_sidecar(tmp_path, monkeypatch, detections, asset="Drone 2"):
    monkeypatch.setattr(sidecar, "FOOTAGE_DIR", tmp_path)
    (tmp_path / "x.detections.json").write_text(json.dumps({"clip": "x", "asset": asset, "detections": detections}))


def det(t, eid, kind="clue", label="red jacket", rel=0.7, loc=True):
    return {"time_s": t, "evidence_id": eid, "kind": kind, "label": label, "reliability": rel, "radius_m": 60.0,
            "location": {"lat": 53.5, "lon": -113.5} if loc else None}


def test_only_detections_that_became_evidence_are_returned_sorted_by_time(tmp_path, monkeypatch):
    _write_sidecar(tmp_path, monkeypatch, [det(9.0, "ev_x_18_0"), {"time_s": 2.0, "evidence_id": None, "kind": None},
                                           det(3.0, "ev_x_6_0", kind="sighting", label="person", rel=0.14), det(5.0, "ev_x_10_0", loc=False)])
    got = evidence_for_clip("c1", "x", START)
    assert [e.id for e in got] == ["ev_x_6_0", "ev_x_18_0"]                 # no id, or no location, is skipped
    assert got[0].summary == "Drone 2: possible person (14%)" and got[1].summary == "Drone 2: possible red jacket (70%)"


def test_a_clip_without_a_named_asset_says_drone(tmp_path, monkeypatch):
    _write_sidecar(tmp_path, monkeypatch, [det(1.0, "ev_x_2_0")], asset=None)
    assert evidence_for_clip("c", "x", START)[0].summary.startswith("Drone: possible")


def test_a_missing_sidecar_is_a_clear_error(tmp_path, monkeypatch):
    monkeypatch.setattr(sidecar, "FOOTAGE_DIR", tmp_path)
    with pytest.raises(FileNotFoundError):
        evidence_for_clip("c", "nope", START)
