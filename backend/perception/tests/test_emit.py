import io
import json
from datetime import datetime, timezone

import httpx
import pytest

from backend.perception import emit, sidecar

CASE = {"case": {"case_id": "case_1", "last_seen_time": "2026-11-08T14:00:00-07:00"}}


def make_client(posted, report=CASE, post_status=200):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json=report) if report else httpx.Response(404, json={"detail": "x"})
        posted.append(json.loads(request.content))
        return httpx.Response(post_status, json=posted[-1])
    return httpx.Client(transport=httpx.MockTransport(handler), base_url="http://test")


def run(argv, posted, **kw):
    sleeps, out = [], io.StringIO()
    code = emit.main(argv, client=make_client(posted, **kw), sleep=sleeps.append, out=out)
    return code, sleeps, out.getvalue()


def test_posts_the_clips_evidence_at_its_offset_with_structured_fields():
    posted = []
    code, sleeps, out = run(["--case", "case_1", "--clip", "margaret_drone2"], posted)
    assert code == 0 and len(posted) == 1
    ev = posted[0]
    assert ev["id"] == "ev_margaret_drone2_8_0" and ev["case_id"] == "case_1"
    assert ev["kind"] == "clue" and ev["source"] == "drone_ai" and ev["confirmed"] is False
    assert ev["media_url"] == "/crops/ev_margaret_drone2_8_0.jpg" and ev["radius_m"] > 75
    assert sleeps and sleeps[0] == pytest.approx(4.0, abs=0.2)             # waits for the 4.0 s mark
    assert "posted clue ev_margaret_drone2_8_0" in out


def test_the_evidence_time_defaults_to_last_seen_plus_95_minutes_and_can_be_set():
    posted = []
    run(["--case", "case_1", "--clip", "margaret_drone2"], posted)
    # 14:00 at UTC-7 is 21:00 UTC; + 95 min + 4 s
    assert datetime.fromisoformat(posted[0]["time"].replace("Z", "+00:00")) == datetime(2026, 11, 8, 22, 35, 4, tzinfo=timezone.utc)
    posted2 = []
    run(["--case", "case_1", "--clip", "margaret_drone2", "--sim-start", "2026-11-08T22:00:00Z"], posted2)
    assert datetime.fromisoformat(posted2[0]["time"].replace("Z", "+00:00")) == datetime(2026, 11, 8, 22, 0, 4, tzinfo=timezone.utc)


def test_speed_shortens_the_wait_and_dry_run_posts_nothing():
    posted = []
    _, sleeps, _ = run(["--case", "case_1", "--clip", "margaret_drone2", "--speed", "4"], posted)
    assert sleeps[0] == pytest.approx(1.0, abs=0.1)
    posted = []
    code, _, out = run(["--case", "case_1", "--clip", "margaret_drone2", "--dry-run"], posted)
    assert code == 0 and posted == [] and "would post clue" in out


def test_an_unknown_case_is_a_clear_error_not_a_crash(capsys):
    code, _, _ = run(["--case", "case_x", "--clip", "margaret_drone2"], [], report=None)
    assert code == 2 and "does not know case" in capsys.readouterr().err
    code, _, _ = run(["--case", "case_x", "--clip", "margaret_drone2", "--sim-start", "2026-11-08T22:00:00Z"], [], post_status=404)
    assert code == 2


def test_an_unreachable_server_says_so(capsys):
    def boom(request):
        raise httpx.ConnectError("refused")
    client = httpx.Client(transport=httpx.MockTransport(boom), base_url="http://test")
    code = emit.main(["--case", "c", "--clip", "margaret_drone2"], client=client, sleep=lambda s: None, out=io.StringIO())
    assert code == 3 and "make api" in capsys.readouterr().err
