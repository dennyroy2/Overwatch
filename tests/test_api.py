from fastapi.testclient import TestClient

from backend.api.main import app

client = TestClient(app)


def _case() -> str:
    r = client.post("/case", json={"name": "Test", "age": 79, "clothing": ["blue jacket"]})
    assert r.status_code == 200
    return r.json()["case_id"]


def test_health():
    assert client.get("/health").json()["ok"] is True


def test_evidence_roundtrip_and_report():
    cid = _case()
    r = client.post("/evidence", json={
        "case_id": cid, "kind": "sighting", "time": "2026-11-07T15:10:00Z",
        "location": {"lat": 53.533, "lon": -113.525}, "source": "witness",
        "summary": "Seen near the river valley stop",
    })
    assert r.status_code == 200
    rep = client.get(f"/report/{cid}").json()
    assert rep["evidence"][0]["summary"].startswith("Seen")
    assert any(e["action"] == "case_opened" for e in rep["log"])


def test_unknown_case_404():
    r = client.post("/evidence", json={
        "case_id": "nope", "kind": "note", "time": "2026-11-07T15:10:00Z",
        "source": "officer", "summary": "x",
    })
    assert r.status_code == 404


def test_stream_sends_ghosts_and_evidence():
    cid = _case()
    seen = set()
    with client.websocket_connect(f"/stream/{cid}") as ws:
        for _ in range(60):
            msg = ws.receive_json()
            seen.add(msg["type"])
            if msg["type"] == "ghosts":
                assert len(msg["data"]["positions"]) > 0
                lon, lat, w = msg["data"]["positions"][0]
                assert 53.4 < lat < 53.7 and -113.7 < lon < -113.3
            if {"ghosts"} <= seen and len(seen) >= 1:
                break
    assert "ghosts" in seen


def test_engine_stub_evidence_shrinks_spread():
    import numpy as np
    from datetime import datetime, timezone
    from backend.engine.interface import StubEngine
    from contracts.models import Evidence, GeoPoint, SubjectProfile

    eng = StubEngine(n_ghosts=2000)
    eng.reset(SubjectProfile(name="t", age=80), datetime.now(timezone.utc))
    for _ in range(40):
        eng.step(1.0)
    before = eng.pos.std(axis=0).mean()
    target = eng._to_lonlat(eng.pos[:1])[0]
    eng.apply(Evidence(case_id="c", kind="sighting", time=datetime.now(timezone.utc),
                       location=GeoPoint(lon=float(target[0]), lat=float(target[1])),
                       radius_m=100, source="witness", reliability=0.95, summary="s"))
    after = eng.pos.std(axis=0).mean()
    assert after < before
    assert eng.propose()[0].expected_gain > 0


def test_posted_sighting_proposes_tasking_without_fake_beats(monkeypatch):
    from backend.api import fake_stream
    monkeypatch.setattr(fake_stream, "FAKE_BEATS_ON", False)
    cid = _case()
    with client.websocket_connect(f"/stream/{cid}") as ws:
        ws.receive_json()  # stream is running
        client.post("/evidence", json={
            "case_id": cid, "kind": "sighting", "time": "2026-11-07T15:10:00Z",
            "location": {"lat": 53.533, "lon": -113.525}, "radius_m": 150,
            "source": "transit", "summary": "Bus driver sighting",
        })
        kinds = []
        for _ in range(40):
            msg = ws.receive_json()
            kinds.append(msg["type"])
            if msg["type"] == "evidence":
                assert msg["data"]["source"] == "transit"  # no fake beats
            if msg["type"] == "tasking":
                break
    assert "tasking" in kinds


def test_close_search_and_pdf():
    cid = _case()
    r = client.post(f"/case/{cid}/close", json={"found": True, "officer": "Sgt. Lee"})
    assert r.status_code == 200
    actions = [e["action"] for e in client.get(f"/report/{cid}").json()["log"]]
    assert actions[-2:] == ["found_confirmed", "search_closed"]
    pdf = client.get(f"/report/{cid}/pdf")
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content[:4] == b"%PDF"


def test_close_unknown_case_404():
    assert client.post("/case/nope/close", json={}).status_code == 404
