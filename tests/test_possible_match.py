"""The 'possible match' alert: raised once, only for sensor detections where the engine agrees."""
import asyncio
from datetime import datetime, timezone

from backend.api.fake_stream import _check_possible_match
from backend.api.hub import CaseHub
from contracts.models import Cluster, Evidence, GeoPoint, SubjectProfile

SLOPE = GeoPoint(lat=53.5340, lon=-113.5370)
FAR = GeoPoint(lat=53.5422, lon=-113.5337)


class FakeEngine:
    def __init__(self, center: GeoPoint, p: float):
        self.cl = [Cluster(id="cl", center=center, probability=p)]

    def clusters(self):
        return self.cl


def _hub():
    return CaseHub(profile=SubjectProfile(case_id="c", name="Margaret", age=79))


def _clue(source="drone_ai", reliability=0.82, loc=SLOPE, kind="clue"):
    return Evidence(case_id="c", kind=kind, source=source, reliability=reliability, location=loc,
                    time=datetime(2026, 11, 8, 15, 35, tzinfo=timezone.utc),
                    summary="Drone 2: possible person in grey hooded jacket (82%)")


def _run(hub, engine, evs):
    sent = []

    async def capture(msg):
        sent.append(msg)
    hub.broadcast = capture
    asyncio.run(_check_possible_match(hub, engine, evs))
    return sent


def test_drone_clue_where_engine_agrees_raises_alert_once():
    hub, eng = _hub(), FakeEngine(SLOPE, 0.8)
    sent = _run(hub, eng, [_clue()])
    kinds = [m.type for m in sent]
    assert kinds == ["found", "log"]
    assert sent[0].data.note.startswith("Possible match") and sent[0].data.evidence_id
    assert hub.log[-1].action == "possible_match"
    assert _run(hub, eng, [_clue()]) == []                     # only once per case


def test_no_alert_for_witness_low_confidence_far_away_or_spread_out():
    assert _run(_hub(), FakeEngine(SLOPE, 0.8), [_clue(source="witness", kind="sighting")]) == []
    assert _run(_hub(), FakeEngine(SLOPE, 0.8), [_clue(reliability=0.5)]) == []
    assert _run(_hub(), FakeEngine(FAR, 0.8), [_clue()]) == []
    assert _run(_hub(), FakeEngine(SLOPE, 0.4), [_clue()]) == []


def test_never_logs_found_confirmed():
    hub = _hub()
    _run(hub, FakeEngine(SLOPE, 0.9), [_clue()])
    assert all(e.action != "found_confirmed" for e in hub.log)  # only an officer confirms
