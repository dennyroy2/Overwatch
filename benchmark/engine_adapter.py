"""
The ONE place the benchmark talks to the ghost engine.

Signature (keep it stable):
    predict_ghosts(graph, profile, evidence, at_s, n_ghosts, seed) -> list[[lon, lat, weight]]

`at_s` is seconds after the last_seen time. The return value has the same
shape as GhostFrame.positions in contracts, so swapping in the real engine is
a one-function change.

Right now this is a STUB engine (simple particle filter using benchmark/walker.py).
When Rishaan's backend/engine is ready, replace the body of `predict_ghosts`
with a call into it and set USING_REAL_ENGINE = True. Don't import his internals
anywhere else in benchmark/.
"""

from __future__ import annotations

import math
import random

from contracts_compat import Evidence, SubjectProfile
from graph import StreetGraph, to_latlon, to_xy
from walker import WalkParams, walk

USING_REAL_ENGINE = False


def _seconds_after(ev: Evidence, last_seen: Evidence) -> float:
    return (ev.time - last_seen.time).total_seconds()


def predict_ghosts(graph: StreetGraph, profile: SubjectProfile, evidence: list[Evidence],
                   at_s: float, n_ghosts: int = 1000, seed: int = 0) -> list[list[float]]:
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
        p = params.perturbed(rnd)          # each ghost is a slightly different version of them
        track = walk(graph, start, at_s, p, favourites or graph.places, rnd)
        w = 1.0
        for s in sightings:                # evidence reweights ghosts that couldn't be there
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
