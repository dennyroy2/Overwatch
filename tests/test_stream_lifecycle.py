"""A dropped connection must not restart a case's run (Denny's #23)."""
import asyncio

from backend.api import main
from backend.api.hub import CaseHub
from contracts.models import SubjectProfile


def test_run_stops_only_after_idle_grace_and_reconnect_cancels_stop(monkeypatch):
    monkeypatch.setattr(main, "IDLE_STOP_S", 0.05)

    async def scenario():
        hub = CaseHub(profile=SubjectProfile(case_id="c", name="M", age=79))
        hub.task = asyncio.create_task(asyncio.sleep(60))
        # last socket left: a stop is scheduled, but the run is still going
        hub.stop_task = asyncio.create_task(main._stop_when_idle(hub))
        await asyncio.sleep(0)
        assert not hub.task.done()
        # someone reconnects in time: the stop is cancelled, the run survives
        hub.stop_task.cancel()
        hub.stop_task = None
        await asyncio.sleep(0.1)
        assert hub.task is not None and not hub.task.done()
        # nobody comes back: after the grace period the run stops
        run = hub.task
        hub.stop_task = asyncio.create_task(main._stop_when_idle(hub))
        await asyncio.sleep(0.1)
        assert hub.task is None and hub.stop_task is None
        await asyncio.sleep(0)                      # let the cancellation finish
        assert run.cancelled()

    asyncio.run(scenario())


def test_beats_already_played_are_never_replayed():
    from backend.api import fake_stream
    hub = CaseHub(profile=SubjectProfile(case_id="c", name="M", age=79))
    hub.beats_sent = len(fake_stream.FAKE_BEATS)
    assert list(fake_stream.FAKE_BEATS)[hub.beats_sent:] == []
