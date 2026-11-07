"""
The ONE place the benchmark talks to the ghost engine.

Signature (keep it stable):
    predict_ghosts(graph, profile, evidence, at_s, n_ghosts, seed) -> list[[lon, lat, weight]]

`at_s` is seconds after the last_seen time (when the search starts). The return
value has the same shape as GhostFrame.positions in contracts.

Two engines:
  "backend" : Rishaan's engine through backend/engine/interface.py
              (reset -> step -> apply evidence in time order -> frame).
              Whatever engine class he exposes there is what gets benchmarked, so
              when the real particle filter replaces StubEngine, nothing here changes.
  "local"   : my own simple walker-based stand-in (benchmark/walker.py).
              Only for testing the harness. Its numbers are NOT for the pitch,
              because it moves ghosts the same way the fake people move.

Pick with set_engine("backend" | "local"). Default: backend if importable.
"""

from __future__ import annotations

import math
import random
from datetime import timedelta

from contracts_compat import Evidence, SubjectProfile
from graph import StreetGraph, to_latlon, to_xy
from walker import WalkParams, walk

try:
    from backend.engine import interface as _engine_iface
    BACKEND_AVAILABLE = True
except ImportError:
    _engine_iface = None
    BACKEND_AVAILABLE = False

ENGINE = "backend" if BACKEND_AVAILABLE else "local"
STEP_MIN = 2.0  # advance the backend engine in 2-minute steps


def set_engine(name: str) -> None:
    global ENGINE
    if name == "backend" and not BACKEND_AVAILABLE:
        raise RuntimeError("backend/engine not importable. Run from the repo root.")
    ENGINE = name


def engine_name() -> str:
    if ENGINE == "backend":
        cls = _backend_engine_class()
        return f"backend ({cls.__name__})"
    return "local stand-in (not for the pitch)"


def predict_ghosts(graph: StreetGraph, profile: SubjectProfile, evidence: list[Evidence],
                   at_s: float, n_ghosts: int = 1000, seed: int = 0) -> list[list[float]]:
    if ENGINE == "backend":
        return _predict_backend(profile, evidence, at_s, n_ghosts, seed)
    return _predict_local(graph, profile, evidence, at_s, n_ghosts, seed)


# ------------------------------------------------------------------ backend engine
def _backend_engine_class():
    """Prefer a real engine if Rishaan exposes one in interface.py, else StubEngine."""
    for name in ("Engine", "ParticleEngine", "GhostEngine", "StubEngine"):
        cls = getattr(_engine_iface, name, None)
        if cls is not None:
            return cls
    raise RuntimeError("No engine class found in backend/engine/interface.py")


def _make_backend_engine(n_ghosts: int, seed: int):
    cls = _backend_engine_class()
    try:
        return cls(n_ghosts=n_ghosts, seed=seed)
    except TypeError:
        return cls()


def _predict_backend(profile, evidence, at_s, n_ghosts, seed):
    start = profile.last_seen_time or min(e.time for e in evidence)
    end = start + timedelta(seconds=at_s)
    eng = _make_backend_engine(n_ghosts, seed)
    eng.reset(profile, start)

    now = start
    def advance_to(t):
        nonlocal now
        while now < t:
            mins = min(STEP_MIN, (t - now).total_seconds() / 60)
            if mins <= 1e-6:
                break
            eng.step(mins)
            now += timedelta(minutes=mins)

    # feed evidence in time order, exactly like a live search would
    for ev in sorted((e for e in evidence if e.kind != "last_seen"), key=lambda e: e.time):
        if ev.time > end:
            continue
        advance_to(ev.time)
        eng.apply(ev)
    advance_to(end)

    positions = [list(p) for p in eng.frame().positions]
    total = sum(p[2] for p in positions) or 1.0
    for p in positions:
        p[2] /= total
    return positions


# ------------------------------------------------------------------ local stand-in
def _seconds_after(ev: Evidence, last_seen: Evidence) -> float:
    return (ev.time - last_seen.time).total_seconds()


def _predict_local(graph, profile, evidence, at_s, n_ghosts, seed):
    rnd = random.Random(seed)
    last_seen = next(e for e in evidence if e.kind == "last_seen")
    sx, sy = to_xy(last_seen.location.lat, last_seen.location.lon)
    start = graph.nearest_node(sx, sy)
    favourites = [graph.nearest_node(*to_xy(e.location.lat, e.location.lon))
                  for e in evidence if e.kind == "favourite_place" and e.location]
    params = WalkParams.for_profile(profile.condition, profile.mobility)

    sightings = [e for e in evidence if e.kind == "sighting" and e.location and e.confirmed]
    positions = []
    for _ in range(n_ghosts):
        p = params.perturbed(rnd)
        track = walk(graph, start, at_s, p, favourites or graph.places, rnd)
        w = 1.0
        for s in sightings:
            gx, gy = track.position(graph, _seconds_after(s, last_seen))
            ex, ey = to_xy(s.location.lat, s.location.lon)
            r = s.radius_m or 150.0
            d2 = (gx - ex) ** 2 + (gy - ey) ** 2
            w *= (1 - s.reliability) + s.reliability * math.exp(-d2 / (2 * r * r))
        x, y = track.position(graph, at_s)
        lat, lon = to_latlon(x, y)
        positions.append([lon, lat, w])
    total = sum(p[2] for p in positions) or 1.0
    for p in positions:
        p[2] /= total
    return positions
