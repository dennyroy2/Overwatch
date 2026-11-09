"""Narrator: AI stories and tasking reasons, with Claude replaced by a stand-in."""
import asyncio
import time
from datetime import datetime, timedelta, timezone

import pytest

from backend.agent import narrator as nar
from contracts.models import (
    Cluster, Evidence, GeoPoint, GhostFrame, SubjectProfile, TaskingRequest,
)

T0 = datetime(2026, 11, 8, 14, 0, tzinfo=timezone(timedelta(hours=-7)))


class FakeHub:
    def __init__(self):
        self.profile = SubjectProfile(case_id="c", name="Margaret", age=79, mobility="low",
                                      clothing=["grey hooded jacket"],
                                      last_seen=GeoPoint(lat=53.5422, lon=-113.5337), last_seen_time=T0)
        self.evidence = [Evidence(id="ev1", case_id="c", kind="sighting", source="transit",
                                  time=T0 + timedelta(minutes=35), reliability=0.75,
                                  location=GeoPoint(lat=53.5328, lon=-113.5395),
                                  summary="Bus driver: woman got off at Emily Murphy Park stop")]
        self.requests = {}
        self.sent = []

    async def broadcast(self, msg):
        self.sent.append(msg)


def _frame():
    cl = Cluster(id="cl_1", center=GeoPoint(lat=53.5333, lon=-113.5391), probability=0.35,
                 story="TEMPLATE", evidence_ids=["ev1"])
    return GhostFrame(case_id="c", t=T0, positions=[], alive_fraction=1.0, clusters=[cl])


@pytest.fixture
def fresh(monkeypatch):
    monkeypatch.setattr(nar, "narrator", nar.Narrator())
    return nar.narrator


def _wait_story(n, hub, frame, timeout=3.0):
    end = time.time() + timeout
    while time.time() < end:
        f = frame.model_copy(deep=True)
        n.decorate(hub, f)
        if f.clusters[0].story != "TEMPLATE":
            return f.clusters[0].story
        time.sleep(0.02)
    return "TEMPLATE"


def test_no_key_keeps_template_and_makes_no_calls(fresh, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    calls = []
    monkeypatch.setattr(nar, "_call", lambda *a, **k: calls.append(a) or "x")
    f = _frame()
    fresh.decorate(FakeHub(), f)
    assert f.clusters[0].story == "TEMPLATE" and calls == []


def test_story_is_swapped_in_once_written_and_cached(fresh, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    calls = []

    def fake(system, user, max_tokens=200):
        calls.append(user)
        return "Margaret likely rode the bus south and got off near Emily Murphy Park."
    monkeypatch.setattr(nar, "_call", fake)
    hub = FakeHub()
    story = _wait_story(fresh, hub, _frame())
    assert story.startswith("Margaret likely")
    assert "Bus driver" in calls[0] and "km" in calls[0]          # evidence + where, in the prompt
    _wait_story(fresh, hub, _frame())
    assert len(calls) == 1                                          # cached: same evidence, same area


def test_story_claiming_found_is_rejected(fresh, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(nar, "_call", lambda *a, **k: "Margaret has been found near the park.")
    assert _wait_story(fresh, FakeHub(), _frame(), timeout=0.5) == "TEMPLATE"


def _req(status="pending"):
    return TaskingRequest(id="req1", case_id="c", asset="Drone 2", target_area=[], route=[],
                          expected_gain=0.29, duration_min=9.7,
                          reasons=["37% of the remaining possibilities are within 350 m of this point."],
                          evidence_ids=["ev1"], status=status)


def test_reasons_upgrade_keeps_engine_numbers_first(fresh, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(nar, "_call", lambda *a, **k:
                        '["The bus driver saw her get off right beside this area.", '
                        '"No other area comes close: the next holds far less."]')
    hub = FakeHub()
    req = _req()
    hub.requests[req.id] = req
    asyncio.run(fresh._upgrade_request(hub, req))
    new = hub.requests["req1"]
    assert new.reasons[0].startswith("37%") and len(new.reasons) == 3
    assert hub.sent and hub.sent[0].data.id == "req1"


def test_reasons_left_alone_after_officer_decides_or_on_junk(fresh, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(nar, "_call", lambda *a, **k: '["fine reason"]')
    hub = FakeHub()
    hub.requests["req1"] = _req(status="approved")
    asyncio.run(fresh._upgrade_request(hub, _req()))
    assert hub.sent == []
    monkeypatch.setattr(nar, "_call", lambda *a, **k: "not json at all")
    hub.requests["req1"] = _req()
    asyncio.run(fresh._upgrade_request(hub, _req()))
    assert hub.sent == [] and len(hub.requests["req1"].reasons) == 1
