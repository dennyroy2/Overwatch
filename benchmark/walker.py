"""
How a missing person moves through the street graph, by profile.

Used twice in the benchmark:
  1. to generate each case's hidden TRUE path (with randomly perturbed parameters,
     so the engine never gets the exact behaviour for free), and
  2. by the stub engine to move ghosts (with the default parameters).

Dementia defaults follow the plan: slow walking pace, tends to keep going
straight, drawn to familiar places, rarely backtracks, occasional pauses.
"""

from __future__ import annotations

import bisect
import math
import random
from dataclasses import dataclass, replace

from graph import StreetGraph

SPEED_MS = {"low": 0.55, "medium": 0.85, "high": 1.15}


@dataclass(frozen=True)
class WalkParams:
    speed_ms: float = 0.85
    k_straight: float = 1.6     # preference for continuing straight
    k_place: float = 1.2        # pull toward the nearest familiar place
    p_backtrack: float = 0.03   # chance of turning back at an intersection
    p_pause: float = 0.12       # chance of stopping at a node
    max_pause_s: float = 600.0  # up to 10 minutes

    @staticmethod
    def for_profile(condition: str, mobility: str) -> "WalkParams":
        p = WalkParams(speed_ms=SPEED_MS.get(mobility, 0.85))
        if condition != "dementia":   # other profiles: less straight, less place pull
            p = replace(p, k_straight=1.0, k_place=0.6, p_backtrack=0.12)
        return p

    def perturbed(self, rnd: random.Random) -> "WalkParams":
        j = lambda v, s: max(0.0, v * rnd.uniform(1 - s, 1 + s))
        return replace(self, speed_ms=j(self.speed_ms, 0.25), k_straight=j(self.k_straight, 0.35),
                       k_place=j(self.k_place, 0.5), p_backtrack=min(0.3, j(self.p_backtrack, 0.5)),
                       p_pause=min(0.2, j(self.p_pause, 0.5)))


@dataclass
class Track:
    """Times (s since last seen) at which the walker reached each node."""
    times: list[float]
    nodes: list[int]

    def position(self, g: StreetGraph, t: float) -> tuple[float, float]:
        """Interpolated (x, y) in metres at time t."""
        if t <= self.times[0]:
            return g.xy[self.nodes[0]]
        i = bisect.bisect_right(self.times, t) - 1
        if i >= len(self.times) - 1:
            return g.xy[self.nodes[-1]]
        t0, t1 = self.times[i], self.times[i + 1]
        (x0, y0), (x1, y1) = g.xy[self.nodes[i]], g.xy[self.nodes[i + 1]]
        f = 0.0 if t1 <= t0 else (t - t0) / (t1 - t0)
        return x0 + f * (x1 - x0), y0 + f * (y1 - y0)


def walk(g: StreetGraph, start: int, duration_s: float, params: WalkParams,
         places: list[int], rnd: random.Random) -> Track:
    times, nodes = [0.0], [start]
    t, cur, prev = 0.0, start, None
    place_xy = [g.xy[p] for p in places]
    while t < duration_s:
        if rnd.random() < params.p_pause:                 # stop and stand for a while
            t += rnd.uniform(0, params.max_pause_s)
            times.append(t)
            nodes.append(cur)
            continue
        options = g.nbrs[cur]
        if prev is not None and len(options) > 1 and rnd.random() >= params.p_backtrack:
            options = [o for o in options if o[0] != prev] or options
        cx, cy = g.xy[cur]
        if prev is not None:
            px, py = g.xy[prev]
            heading = math.atan2(cy - py, cx - px)
        else:
            heading = None
        # nearest familiar place from here
        if place_xy:
            tx, ty = min(place_xy, key=lambda p: (p[0] - cx) ** 2 + (p[1] - cy) ** 2)
            d_here = math.hypot(tx - cx, ty - cy)
        scores = []
        for nxt, length in options:
            nx_, ny_ = g.xy[nxt]
            s = 0.0
            if heading is not None:
                s += params.k_straight * math.cos(math.atan2(ny_ - cy, nx_ - cx) - heading)
            if place_xy and d_here > 1:
                s += params.k_place * (d_here - math.hypot(tx - nx_, ty - ny_)) / length
            scores.append(s)
        m = max(scores)
        weights = [math.exp(s - m) for s in scores]
        nxt, length = rnd.choices(options, weights=weights)[0]
        t += length / params.speed_ms
        prev, cur = cur, nxt
        times.append(t)
        nodes.append(cur)
    return Track(times=times, nodes=nodes)
