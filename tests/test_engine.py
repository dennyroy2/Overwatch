"""GhostEngine: the real particle filter on the Edmonton street graph."""
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from backend.engine.interface import GhostEngine
from contracts.models import Evidence, GeoPoint, SubjectProfile

T0 = datetime(2026, 11, 8, 14, 0, tzinfo=timezone(timedelta(hours=-7)))
LAST_SEEN = GeoPoint(lat=53.5422, lon=-113.5337)          # 124 St & Jasper Ave
BUS_STOP = GeoPoint(lat=53.5328, lon=-113.5395)           # Groat Rd & Emily Murphy Park Rd
SLOPE = GeoPoint(lat=53.5340, lon=-113.5370)


def _engine(n=2000, seed=1, mobility="low"):
    eng = GhostEngine(n_ghosts=n, seed=seed)
    eng.reset(SubjectProfile(case_id="c", name="Margaret", age=79, mobility=mobility,
                             last_seen=LAST_SEEN, last_seen_time=T0), T0)
    return eng


def _ev(kind, loc, minutes, **kw):
    kw.setdefault("source", "witness")
    kw.setdefault("summary", kind)
    return Evidence(case_id="c", kind=kind, location=loc, time=T0 + timedelta(minutes=minutes), **kw)


def _dist_m(a: GeoPoint, b: GeoPoint) -> float:
    dx = (a.lon - b.lon) * 111_320 * np.cos(np.radians(a.lat))
    return float(np.hypot(dx, (a.lat - b.lat) * 111_320))


def test_frame_shape_and_ghosts_stay_on_the_map():
    eng = _engine()
    for _ in range(30):
        eng.step(2)
    f = eng.frame()
    assert len(f.positions) == 2000 and len(f.positions[0]) == 3
    lon, lat = np.array(f.positions)[:, 0], np.array(f.positions)[:, 1]
    assert (lat > 53.50).all() and (lat < 53.57).all() and (lon > -113.57).all() and (lon < -113.46).all()
    assert f.clusters and f.clusters[0].probability > 0


def test_ghost_index_is_stable_between_frames():
    eng = _engine()
    for _ in range(10):
        eng.step(2)
    a = np.array(eng.frame().positions)
    eng.step(0.5)                                         # 30 s: nobody can move more than ~60 m
    f = eng.frame()
    b = np.array(f.positions)
    moved = np.hypot((a[:, 0] - b[:, 0]) * 111_320 * np.cos(np.radians(53.54)), (a[:, 1] - b[:, 1]) * 111_320)
    assert f.respawned == []
    assert moved.max() < 80


def test_restated_last_seen_changes_nothing():
    eng = _engine()
    eng.step(5)
    eng.apply(_ev("last_seen", LAST_SEEN, 0, source="family", reliability=0.95))
    assert eng.alive_fraction == 1.0


def test_credible_surprising_sighting_moves_the_hot_spot_there():
    eng = _engine()
    for _ in range(35):
        eng.step(2)                                       # 70 minutes in
    eng.apply(_ev("sighting", BUS_STOP, 35, source="transit", reliability=0.75, radius_m=100))
    f = eng.frame()
    assert len(f.respawned) > 0                           # slots were re-seeded from the sighting
    assert _dist_m(f.clusters[0].center, BUS_STOP) < 600


def test_clue_concentrates_and_resamples_with_respawned_slots():
    eng = _engine()
    for _ in range(35):
        eng.step(2)
    eng.apply(_ev("sighting", BUS_STOP, 35, source="transit", reliability=0.75, radius_m=100))
    eng.frame()
    for _ in range(12):
        eng.step(2)
    eng.apply(_ev("clue", SLOPE, 94, source="drone_ai", reliability=0.82, radius_m=50))
    f = eng.frame()
    top = f.clusters[0]
    assert _dist_m(top.center, SLOPE) < 250 and top.probability > 0.4
    assert all(0 <= i < 2000 for i in f.respawned)


def test_searched_area_removes_probability_there():
    eng = _engine(mobility="medium")
    for _ in range(15):
        eng.step(2)
    xy = eng._xy()
    before = float((np.linalg.norm(xy - eng.base_xy, axis=1) < 300).mean())
    eng.apply(_ev("searched_area", LAST_SEEN, 30, source="ground_team", reliability=0.9,
                  radius_m=300, detection_prob=0.8))
    w = eng.w / eng.w.sum()
    after = float(w[np.linalg.norm(eng._xy() - eng.base_xy, axis=1) < 300].sum())
    assert after < 0.6 * before
    assert eng.alive_fraction < 1.0


def test_drone_first_then_ground_team_to_confirm():
    eng = _engine()
    for _ in range(35):
        eng.step(2)
    eng.apply(_ev("sighting", BUS_STOP, 35, source="transit", reliability=0.75, radius_m=100))
    first = eng.propose()
    assert first and first[0].asset == "Drone 2" and first[0].expected_gain > 0
    assert first[0].evidence_ids                          # reasons point at evidence
    for _ in range(12):
        eng.step(2)
    eng.apply(_ev("clue", SLOPE, 94, source="drone_ai", reliability=0.82, radius_m=50))
    second = eng.propose()
    # confident after the air search: an interdisciplinary task force goes in (field feedback)
    assert second and second[0].asset == "Task Force 1" and second[0].kind == "task_force"
    assert first[0].utm and first[0].utm.startswith("12U ")


def test_police_only_mode_never_sends_volunteers():
    eng = _engine()
    eng.profile.weapon_access = True
    for _ in range(35):
        eng.step(2)
    eng.apply(_ev("sighting", BUS_STOP, 35, source="transit", reliability=0.75, radius_m=100))
    eng.propose()
    for _ in range(12):
        eng.step(2)
    eng.apply(_ev("clue", SLOPE, 94, source="drone_ai", reliability=0.82, radius_m=50))
    second = eng.propose()[0]
    assert "volunteers" in " ".join(second.reasons) and "weapon" in " ".join(second.reasons)


@pytest.mark.parametrize("mobility", ["medium"])
def test_distances_stay_calibrated(mobility):
    """Guard rail: with no evidence, ghosts spread like urban dementia cases (ISRID: 25% within
    0.3 km, 50% within 1.1 km), allowing for the demo map's edges."""
    eng = _engine(n=1500, seed=3, mobility=mobility)
    while (eng.t - T0).total_seconds() < 8 * 3600 and (eng.move_left > 0).any():
        eng.step(10)
    d = np.linalg.norm(eng._xy() - eng.base_xy, axis=1) / 1000
    q25, q50 = np.quantile(d, [0.25, 0.5])
    assert 0.15 < q25 < 0.6
    assert 0.5 < q50 < 1.5
