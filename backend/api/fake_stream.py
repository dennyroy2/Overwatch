"""Fake live stream so the frontend and everyone else can build from minute one.

Runs the GhostEngine (particle filter on Edmonton's street graph; OVERWATCH_ENGINE=stub
for the old random walk) and sprinkles
in scripted evidence cards and tasking requests. Swap in the real engine later by
changing `make_engine()` only.
"""
from __future__ import annotations

import asyncio
import math
import os
from datetime import datetime, timedelta, timezone

from contracts.models import (
    Evidence, EvidenceMsg, FoundEvent, FoundMsg, GeoPoint, GhostsMsg, LogMsg, TaskingMsg,
)
from backend.agent.narrator import narrator
from backend.api.alerts import maybe_alert
from backend.api.hub import CaseHub
from backend.engine.interface import GhostEngine, SearchEngine, StubEngine

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
             summary="Family: she often walks to a bakery near Jasper Ave")),
    (14, dict(kind="sighting", source="transit", reliability=0.75,
              location=GeoPoint(lat=53.5330, lon=-113.5250), radius_m=250,
              summary="Bus driver: woman in a grey hooded jacket got off near the river valley stop")),
    (24, dict(kind="searched_area", source="ground_team", reliability=0.9, detection_prob=0.7,
              location=GeoPoint(lat=53.5440, lon=-113.5300), radius_m=400,
              summary="Ground Team 1 searched blocks north of Jasper Ave, nothing found")),
    (34, dict(kind="clue", source="drone_ai", reliability=0.82,
              location=GeoPoint(lat=53.5310, lon=-113.5205), radius_m=120,
              summary="Drone 2: possible grey hooded jacket in ravine (82%)")),
]


ENGINE = os.getenv("OVERWATCH_ENGINE", "ghost")   # "ghost" (real) or "stub" (old random walk)


def make_engine() -> SearchEngine:
    if ENGINE == "stub":
        return StubEngine(n_ghosts=GHOSTS)
    return GhostEngine(n_ghosts=GHOSTS)


async def _propose(hub: CaseHub, engine: SearchEngine) -> None:
    for req in engine.propose():
        hub.requests[req.id] = req
        await hub.broadcast(TaskingMsg(data=req))
        narrator.schedule_reasons(hub, req)          # AI wording follows, same request id


# A detection from a sensor (drone, camera, ground team) that lands where the engine already
# concentrates most of the probability raises the "possible match" alert. Only an officer can
# confirm a find (POST /case/{id}/close with found=true); the system never claims it.
MATCH_SOURCES = ("drone_ai", "camera", "ground_team")
MATCH_MIN_RELIABILITY = 0.75
MATCH_MIN_PROBABILITY = 0.6
MATCH_WITHIN_M = 300.0


def _metres(a: GeoPoint, b: GeoPoint) -> float:
    dx = (a.lon - b.lon) * 111_320 * math.cos(math.radians(a.lat))
    return math.hypot(dx, (a.lat - b.lat) * 111_320)


async def _check_possible_match(hub: CaseHub, engine: SearchEngine, new: list[Evidence]) -> None:
    if hub.possible_match_sent:
        return
    hits = [e for e in new if e.kind in ("clue", "sighting") and e.source in MATCH_SOURCES
            and e.reliability >= MATCH_MIN_RELIABILITY and e.location is not None]
    if not hits:
        return
    clusters = engine.clusters() if hasattr(engine, "clusters") else engine.frame().clusters
    if not clusters:
        return
    top = clusters[0]
    for ev in hits:
        if top.probability >= MATCH_MIN_PROBABILITY and _metres(top.center, ev.location) <= MATCH_WITHIN_M:
            hub.possible_match_sent = True
            await hub.broadcast(FoundMsg(data=FoundEvent(case_id=hub.profile.case_id,
                                                          location=ev.location, evidence_id=ev.id)))
            detail = (f"{ev.summary} | {top.probability:.0%} of the remaining possibilities are here. "
                      "Awaiting officer confirmation.")
            await hub.broadcast(LogMsg(data=hub.add_log("system", "possible_match", detail)))
            return


async def _log_search_result(hub: CaseHub, engine: SearchEngine, ev: Evidence) -> None:
    """After an area is searched with nothing found, record what that search was worth in
    search-planning terms (POA x POD = POS), as an After Action Report would."""
    info = getattr(engine, "last_search", None)
    if ev.kind != "searched_area" or not info or info.get("evidence_id") != ev.id:
        return
    detail = (f"{ev.summary} Area held {info['poa']:.0%} of the probability (POA); "
              f"detection {info['pod']:.0%} (POD); probability of success {info['pos']:.0%} (POS). "
              "Nothing found: that probability moves elsewhere.")
    await hub.broadcast(LogMsg(data=hub.add_log("system", "search_result", detail)))


async def run_fake_case(hub: CaseHub) -> None:
    engine = make_engine()
    start = hub.profile.last_seen_time or datetime.now(timezone.utc)
    engine.reset(hub.profile, start)
    beats = list(FAKE_BEATS)[hub.beats_sent:] if FAKE_BEATS_ON else []
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
                await _log_search_result(hub, engine, ev)
            if any(ev.kind in PROPOSE_ON for ev in pending):
                await _propose(hub, engine)
            await _check_possible_match(hub, engine, pending)

            # Scripted fake beats
            new = list(pending)
            while beats and seconds >= beats[0][0]:
                _, spec = beats.pop(0)
                hub.beats_sent += 1
                now = getattr(engine, "t", None) or engine.frame().t
                ev = Evidence(case_id=hub.profile.case_id, time=now, confirmed=True, **spec)
                hub.evidence.append(ev)
                applied[ev.id] = ev
                engine.apply(ev)
                new.append(ev)
                await _log_search_result(hub, engine, ev)
                await hub.broadcast(EvidenceMsg(data=ev))
                await hub.broadcast(LogMsg(data=hub.add_log("system", "evidence_added", ev.summary)))
                if ev.kind in PROPOSE_ON:
                    await _propose(hub, engine)
                await _check_possible_match(hub, engine, [ev])

            await maybe_alert(hub, engine, seconds, new)  # targeted public alert area (+ second waves)

            frame = engine.frame()
            hub.last_left_area, hub.last_clusters = frame.left_area, frame.clusters
            narrator.decorate(hub, frame)                # AI cluster stories once ready
            await hub.broadcast(GhostsMsg(data=frame))
            tick += 1
            seconds += 1 / FPS
            await asyncio.sleep(1 / FPS)
    except asyncio.CancelledError:
        pass
