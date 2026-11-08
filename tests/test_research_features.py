"""Features from the end-user research: left-area chance, search-planning numbers, Air 1,
targeted alert areas (with second waves, no alert fatigue), and family questions."""
import asyncio
from datetime import datetime, timedelta, timezone

import numpy as np
from fastapi.testclient import TestClient

from backend.api import alerts
from backend.api.hub import CaseHub
from backend.api.main import app
from backend.engine.interface import GhostEngine
from contracts.models import Evidence, GeoPoint, SubjectProfile

T0 = datetime(2026, 11, 8, 14, 0, tzinfo=timezone(timedelta(hours=-7)))
LS = GeoPoint(lat=53.5422, lon=-113.5337)
client = TestClient(app)


def _engine(seed=1):
    e = GhostEngine(n_ghosts=2000, seed=seed)
    e.reset(SubjectProfile(case_id="c", name="Margaret", age=79, mobility="low", last_seen=LS, last_seen_time=T0), T0)
    for _ in range(15):
        e.step(2)
    return e


def _ev(kind, loc, minutes, **kw):
    kw.setdefault("source", "witness")
    return Evidence(case_id="c", kind=kind, location=loc, time=T0 + timedelta(minutes=minutes), summary=kind, **kw)


def test_left_area_starts_at_prior_falls_with_sighting_rises_with_empty_search():
    e = _engine()
    start = e.left_area()
    assert 0.05 <= start <= 0.2
    e.apply(_ev("searched_area", LS, 30, source="ground_team", reliability=0.95, radius_m=600, detection_prob=0.9))
    assert e.left_area() > start                       # nothing found where most ghosts were
    assert e.last_search["poa"] > 0.3 and abs(e.last_search["pos"] - e.last_search["poa"] * e.last_search["pod"]) < 1e-9
    e2 = _engine()
    e2.apply(_ev("sighting", LS, 30, reliability=0.9, radius_m=150))
    assert e2.left_area() < start                      # a credible sighting here says she's here


def test_alert_area_is_a_polygon_holding_most_probability():
    a = _engine().alert_area()
    assert len(a["polygon"]) >= 3 and 0.6 <= a["covers"] <= 1.0 and a["area_km2"] > 0


def test_requests_show_poa_pod_pos_and_far_areas_go_to_air1():
    e = _engine()
    far = GeoPoint(lat=53.5276, lon=-113.5524)        # ~2 km away, beyond drone range
    e.apply(_ev("sighting", far, 28, source="transit", reliability=0.8, radius_m=100))
    req = e.propose()[0]
    assert "POA" in req.reasons[0] and "POS" in req.reasons[0]
    assert req.asset == "Air 1"


class FakeEngine:
    def __init__(self):
        self.next = None

    def alert_area(self):
        return self.next


def _area(x, y, km2):
    return {"polygon": [(-113.53, 53.54), (-113.52, 53.54), (-113.52, 53.53)], "area_km2": km2,
            "covers": 0.8, "centre_xy": np.array([x, y], dtype=float)}


def test_alert_waves_only_when_area_moves_or_grows():
    hub = CaseHub(profile=SubjectProfile(case_id="c", name="Margaret", age=79, last_seen_time=T0))
    sent = []

    async def capture(m):
        sent.append(m)
    hub.broadcast = capture
    eng = FakeEngine()
    sight = _ev("sighting", LS, 30)

    async def run():
        eng.next = _area(0, 0, 1.0)
        await alerts.maybe_alert(hub, eng, 3.0, [])          # too early, no trigger: nothing
        assert hub.alerts == []
        await alerts.maybe_alert(hub, eng, 11.0, [])         # first alert
        eng.next = _area(100, 0, 0.5)                        # small move + shrink: no new wave
        await alerts.maybe_alert(hub, eng, 20.0, [sight])
        eng.next = _area(1300, 0, 1.0)                       # moved 1.3 km: second wave
        await alerts.maybe_alert(hub, eng, 30.0, [sight])
        eng.next = _area(2000, 0, 1.0)                       # moved, but no new evidence: nothing
        await alerts.maybe_alert(hub, eng, 40.0, [])
    asyncio.run(run())
    assert [a.version for a in hub.alerts] == [1, 2]
    assert "Second wave" in hub.alerts[1].reason and "east" in hub.alerts[1].reason
    assert "911" in hub.alerts[0].message and "Margaret" in hub.alerts[0].message


def test_family_questions_and_answers_flow_into_evidence_and_report(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    cid = client.post("/case", json={"name": "Margaret", "age": 79, "last_seen": {"lat": 53.5422, "lon": -113.5337}}).json()["case_id"]
    qs = client.get(f"/case/{cid}/questions").json()
    assert any(q["kind"] == "place" for q in qs) and any("drive" in q["text"] for q in qs)
    place = client.post(f"/case/{cid}/answers", json={"question_id": "former_homes",
                                                      "answer": "She grew up near Hawrelak Park"}).json()
    assert place["on_map"] and place["evidence"]["kind"] == "favourite_place" and place["evidence"]["location"]
    info = client.post(f"/case/{cid}/answers", json={"question_id": "transport", "answer": "No, she gave up driving"}).json()
    assert not info["on_map"] and info["evidence"]["kind"] == "note"
    rep = client.get(f"/report/{cid}").json()
    assert len(rep["family_answers"]) == 2 and rep["family_answers"][0]["evidence_id"]
