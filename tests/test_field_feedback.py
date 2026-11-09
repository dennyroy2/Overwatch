"""Search and rescue feedback (Nov 8): UTM, BOLO, first hour, CCTV, buildings, task force, police-only, exports."""
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree

from fastapi.testclient import TestClient

from backend.api import export, field
from backend.api.hub import CaseHub
from backend.api.main import app
from backend.engine import buildings
from backend.engine.utm import to_utm, utm_str
from contracts.models import Evidence, GeoPoint, SubjectProfile

T0 = datetime(2026, 11, 8, 14, 0, tzinfo=timezone(timedelta(hours=-7)))


def _profile(**kw) -> SubjectProfile:
    return SubjectProfile(name="Margaret", age=79, mobility="low", clothing=["grey hooded jacket"],
                          last_seen=GeoPoint(lat=53.5422, lon=-113.5337), last_seen_time=T0, **kw)


def test_utm_matches_caltopo_readout():
    zone, band, e, n = to_utm(-113.99198, 51.40800)       # the CalTopo screenshot: 12U 0291922E 5699445N
    assert (zone, band) == (12, "U")
    assert abs(e - 291922) < 2 and abs(n - 5699445) < 2
    assert utm_str(-113.5337, 53.5422).startswith("12U 0332")


def test_bolo_and_police_only():
    plain = field.bolo(_profile())
    assert "BOLO" in plain.text and "grey hooded jacket" in plain.text and "12U" in plain.text
    assert "2:00 PM" in plain.text and not plain.police_only
    danger = field.bolo(_profile(weapon_access=True))
    assert danger.police_only and "DO NOT APPROACH" in danger.text


def test_first_hour_only_early():
    p = _profile()
    req = field.first_hour_request(p, T0 + timedelta(minutes=40))
    assert req and req.kind == "first_hour" and any("BOLO" in t for t in req.tasks)
    assert any("camera footage" in t for t in req.tasks)
    assert field.first_hour_request(p, T0 + timedelta(hours=5)) is None


def test_cctv_for_transit_sighting_only():
    p = _profile()
    ev = Evidence(case_id=p.case_id, kind="sighting", source="transit", time=T0 + timedelta(minutes=95),
                  location=GeoPoint(lat=53.5330, lon=-113.5390), summary="Bus driver saw her")
    req = field.cctv_request(p, ev)
    assert req and req.kind == "cctv" and "ETS" in req.tasks[0] and "3:20 pm" in req.tasks[0]
    ev2 = ev.model_copy(update={"source": "drone_ai", "kind": "clue"})
    assert field.cctv_request(p, ev2) is None


def test_building_kinds_and_access():
    assert buildings.kind_of({"building": "house"}) == "residential"
    assert buildings.kind_of({"building": "yes", "amenity": "cafe"}) == "business"
    assert buildings.kind_of({"building": "yes", "amenity": "nursing_home"}) == "care"
    assert buildings.kind_of({"building": "yes", "area_m2": 20}) == "outbuilding"
    assert "warrant" in buildings.ACCESS["residential"]


def test_exports_are_valid():
    p = _profile()
    hub = CaseHub(profile=p)
    hub.evidence.append(Evidence(case_id=p.case_id, kind="searched_area", source="ground_team", time=T0,
                                 location=GeoPoint(lat=53.54, lon=-113.52), radius_m=300, summary="Searched"))
    g = export.geojson(hub)
    assert g["type"] == "FeatureCollection" and {f["properties"]["layer"] for f in g["features"]} >= {
        "last_seen", "searched_area"}
    assert all("UTM 12U" in f["properties"]["description"] for f in g["features"])
    ElementTree.fromstring(export.kml(hub).encode())     # well-formed KML


def test_safety_endpoint_and_bolo_endpoint():
    c = TestClient(app)
    case = c.post("/case", json=_profile().model_dump(mode="json")).json()
    r = c.post(f"/case/{case['case_id']}/safety", json={"violence_history": True})
    assert r.status_code == 200 and r.json()["violence_history"] is True
    assert c.get(f"/case/{case['case_id']}/bolo").json()["police_only"] is True
    assert c.get(f"/case/{case['case_id']}/export.kml").status_code == 200
    log = c.get(f"/report/{case['case_id']}").json()["log"]
    assert any(e["action"] == "safety_flag" for e in log)
