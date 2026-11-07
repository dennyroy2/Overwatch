"""Tests for the tip parser (rules path, no network). Run: py -m pytest backend/agent -q"""
from datetime import datetime

from backend.agent import gazetteer as gz
from backend.agent.tip_parser import extraction_from_llm_json, parse_tip_verbose
from contracts.models import GeoPoint, SubjectProfile

NOW = datetime.fromisoformat("2026-11-08T16:10:00-07:00")
CASE = SubjectProfile(
    case_id="case_test", name="Margaret", age=79, condition="dementia", mobility="low",
    clothing=["grey hooded jacket", "dark track pants with white side stripes"],
    last_seen=GeoPoint(lat=53.5422, lon=-113.5337),
    last_seen_time=datetime.fromisoformat("2026-11-08T14:00:00-07:00"),
)


def parse(text):
    return parse_tip_verbose(text, CASE, now=NOW, use_llm=False)


def near(e, lat, lon, m):
    return e.location is not None and gz.dist_m(e.location.lat, e.location.lon, lat, lon) < m


def test_bus_driver_sighting():
    r = parse("I'm a bus driver. An older lady in a grey hoodie got off at the Emily Murphy Park "
              "stop on Groat Road, maybe 2:35.")
    e = r.evidence
    assert (e.kind, e.source) == ("sighting", "transit")
    assert e.time.strftime("%H:%M") == "14:35"
    assert near(e, 53.5328, -113.5395, 250)          # the Groat Rd & Emily Murphy Park Rd stop
    assert e.confirmed is False and e.raw_text


def test_clothing_match_raises_reliability():
    plain = parse("Witness saw a woman at the Emily Murphy Park stop").evidence.reliability
    match = parse("Witness saw a woman in a grey hoodie at the Emily Murphy Park stop").evidence.reliability
    assert match > plain


def test_searched_area_intersection_and_cafe():
    e = parse("Team 1 cleared the blocks around the coffee shop on 109 and Jasper, no sign of her.").evidence
    assert (e.kind, e.source) == ("searched_area", "ground_team")
    assert e.detection_prob == 0.7
    assert near(e, 53.5424, -113.5091, 200)


def test_blocks_set_radius():
    e = parse("Team 2 searched 3 blocks around 116 Street and 102 Avenue, no sign of her").evidence
    assert e.radius_m == 300 and near(e, 53.543, -113.5213, 150)


def test_favourite_place_from_family():
    e = parse("She loves the coffee shop on 109 Street, she goes there almost every day.").evidence
    assert (e.kind, e.source) == ("favourite_place", "family")


def test_named_place_short_form_and_relative_time():
    r = parse("Saw an old lady sitting on a bench near Hawrelak Park, maybe 20 minutes ago")
    assert "Hawrelak" in (r.place_label or "")
    assert r.evidence.time.strftime("%H:%M") == "15:50"
    assert r.evidence.reliability < 0.6             # "maybe" lowers it


def test_grid_intersection():
    e = parse("Saw her near 124 St and 107 Ave about 10 minutes ago").evidence
    assert near(e, 53.5514, -113.5359, 150)


def test_no_place_gives_no_location_and_a_warning():
    r = parse("She has a pacemaker and walks slowly")
    assert r.evidence.location is None and r.warnings


def test_llm_json_is_resolved_by_gazetteer():
    ex = extraction_from_llm_json('{"kind":"sighting","source":"witness","place_text":"Victoria Park",'
                                  '"time_24h":"15:20","reliability":0.6,"summary":"Witness: woman near Victoria Park"}')
    assert ex.kind == "sighting" and ex.clock == (15, 20) and ex.place_text == "Victoria Park"


class _FakeResp:
    def __init__(self, status, payload):
        self.status_code, self._p = status, payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)

    def json(self):
        return self._p


def test_llm_path_with_fake_api(monkeypatch):
    """Haiku is called with the key, its JSON is used, and places still come from our map."""
    import httpx
    calls = []
    reply = {"content": [{"type": "text", "text": '{"kind":"sighting","source":"transit",'
             '"place_text":"Emily Murphy Park stop","kind_hint":"bus_stop","time_24h":"14:35",'
             '"reliability":0.75,"summary":"Bus driver: woman in grey hoodie at Emily Murphy Park stop"}'}]}

    def fake_post(url, **kw):
        calls.append(kw["json"])
        return _FakeResp(400, {}) if len(calls) == 1 else _FakeResp(200, reply)   # first: reject fast settings

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(httpx, "post", fake_post)
    r = parse_tip_verbose("bus driver saw her at the emily murphy park stop 2:35", CASE, now=NOW)
    assert r.method == "llm" and calls[0]["model"] == "claude-haiku-5-5"
    assert "thinking" in calls[0] and "thinking" not in calls[1]          # retried in plain mode
    assert r.evidence.time.strftime("%H:%M") == "14:35"
    assert near(r.evidence, 53.5328, -113.5395, 250)


def test_llm_failure_falls_back_to_rules(monkeypatch):
    import httpx

    def boom(url, **kw):
        raise httpx.ConnectError("wifi down")

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(httpx, "post", boom)
    r = parse_tip_verbose("Team 2 searched 3 blocks around 116 Street and 102 Avenue, no sign of her", CASE, now=NOW)
    assert r.method == "rules" and r.evidence.kind == "searched_area"
