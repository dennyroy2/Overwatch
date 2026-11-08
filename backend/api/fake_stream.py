"""Fake live stream so the frontend and everyone else can build from minute one.

Runs the StubEngine (random-walk ghosts on real Edmonton coordinates) and sprinkles
in scripted evidence cards and tasking requests. Swap in the real engine later by
changing `make_engine()` only.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone

from contracts.models import (
    Evidence, EvidenceMsg, GeoPoint, GhostsMsg, LogMsg, TaskingMsg,
)
from backend.api.hub import CaseHub
from backend.engine.interface import SearchEngine, StubEngine

FPS = float(os.getenv("OVERWATCH_FPS", "5"))
GHOSTS = int(os.getenv("OVERWATCH_GHOSTS", "5000"))
SIM_MINUTES_PER_TICK = float(os.getenv("OVERWATCH_SIM_SPEED", "0.5"))
# Set OVERWATCH_FAKE_BEATS=0 when a real scenario (or real officers) post the evidence.
FAKE_BEATS_ON = os.getenv("OVERWATCH_FAKE_BEATS", "1").lower() not in ("0", "false", "off", "no")

# Evidence that should make the engine propose new tasking requests
PROPOSE_ON = ("sighting", "clue")

# Fictional demo beats (location approximate; Edmonton river valley area)
FAKE_BEATS = [
    (6, dict(kind="favourite_place", source="family", reliability=0.8,
             location=GeoPoint(lat=53.5405, lon=-113.5097), radius_m=150,
             summary="Family: she loves the coffee shop on 109 St")),
    (14, dict(kind="sighting", source="transit", reliability=0.75,
              location=GeoPoint(lat=53.5330, lon=-113.5250), radius_m=250,
              summary="Bus driver: woman in a blue jacket got off near the river valley stop")),
    (24, dict(kind="searched_area", source="ground_team", reliability=0.9, detection_prob=0.7,
              location=GeoPoint(lat=53.5440, lon=-113.5300), radius_m=400,
              summary="Ground Team 1 searched blocks north of Jasper Ave, nothing found")),
    (34, dict(kind="clue", source="drone_ai", reliability=0.82,
              location=GeoPoint(lat=53.5310, lon=-113.5205), radius_m=120,
              summary="Drone 2: possible blue puffer jacket in ravine (82%)")),
]


def make_engine() -> SearchEngine:
    return StubEngine(n_ghosts=GHOSTS)


async def _propose(hub: CaseHub, engine: SearchEngine) -> None:
    for req in engine.propose():
        hub.requests[req.id] = req
        await hub.broadcast(TaskingMsg(data=req))


async def run_fake_case(hub: CaseHub) -> None:
    engine = make_engine()
    start = hub.profile.last_seen_time or datetime.now(timezone.utc)
    engine.reset(hub.profile, start)
    beats = list(FAKE_BEATS) if FAKE_BEATS_ON else []
    applied: dict[str, Evidence] = {}   # id -> version applied (a card can be replaced by id)
    tick = 0
    seconds = 0.0
    try:
        while True:
            engine.step(SIM_MINUTES_PER_TICK)
            # Apply evidence posted by real teammates (perception, agent, scenario)
            async with hub.lock:
                pending = [e for e in hub.evidence if applied.get(e.id) is not e]
            for ev in pending:
                engine.apply(ev)
                applied[ev.id] = ev
            if any(ev.kind in PROPOSE_ON for ev in pending):
                await _propose(hub, engine)

            # Scripted fake beats
            while beats and seconds >= beats[0][0]:
                _, spec = beats.pop(0)
                ev = Evidence(case_id=hub.profile.case_id, time=engine.frame().t, confirmed=True, **spec)
                hub.evidence.append(ev)
                applied[ev.id] = ev
                engine.apply(ev)
                await hub.broadcast(EvidenceMsg(data=ev))
                await hub.broadcast(LogMsg(data=hub.add_log("system", "evidence_added", ev.summary)))
                if ev.kind in PROPOSE_ON:
                    await _propose(hub, engine)

            await hub.broadcast(GhostsMsg(data=engine.frame()))
            tick += 1
            seconds += 1 / FPS
            await asyncio.sleep(1 / FPS)
    except asyncio.CancelledError:
        pass
