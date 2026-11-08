"""GhostEngine: the real particle filter.

Every ghost is one possible version of the missing person, walking Edmonton's real
street and trail network (data/graphs/edmonton_demo.graphml). Evidence re-weights
ghosts; when too few carry the weight, the unlikely ones are replaced by copies of
likely ones (resampling), keeping each ghost's slot where possible so the screen can
animate smoothly (GhostFrame.respawned lists the reused slots).

Behaviour (dementia launch profile, tunable in BEHAVIOUR):
  - walks only on streets/paths, at a pace set by mobility
  - holds an intended direction that drifts slowly; at busy intersections sometimes
    sets off a new way (wrong turns); at dead ends turns back and picks a new way
  - rarely turns back otherwise; takes short rests
  - eventually stops for good (tired, stuck, sat down): heavy-tailed moving time,
    tuned so ghost distances match urban dementia cases (Koester ISRID: 25% within
    0.3 km, 50% within 1.1 km) as far as the demo map's edges allow
  - some ghosts walk toward a favourite place once the family names one, and
    often stay there

Evidence is matched against where each ghost WAS at the evidence time (a position
history is kept), so a tip that arrives late still counts correctly.
"""
from __future__ import annotations

import math
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

from contracts.models import (
    Cluster, Evidence, GeoPoint, GhostFrame, SubjectProfile, TaskingRequest,
)

REPO = Path(__file__).resolve().parents[2]
GRAPH_DIR = REPO / "data" / "graphs"
CACHE_DIR = REPO / "cache" / "graphs"
M_PER_DEG_LAT = 111_320.0

SPEED_MS = {"low": 0.55, "medium": 0.85, "high": 1.15}

BEHAVIOUR = dict(
    k_straight=5.0,        # preference for the ghost's intended direction (softmax score)
    heading_drift=0.08,    # intended direction drifts this much (radians) per intersection
    p_wrong_turn=0.08,     # at a busy intersection: chance of setting off a new way
    busy_degree=4,         # intersections with this many ways are confusing ...
    busy_temp=1.6,         # ... so choices there are this much more random
    p_backtrack=0.04,      # chance of turning back at an intersection
    p_rest=0.03,           # chance of a short rest at a node
    max_rest_s=480.0,      # rests last up to 8 minutes
    move_median_h=3.5,     # moving time before stopping for good (lognormal median)
    move_sigma=2.6,        # ... and spread (heavy tail: many stop early, some walk for hours)
    move_cap_h=24.0,
    f_goal=0.45,           # share of moving ghosts that head for a favourite place
    k_goal=2.5,            # strength of that pull
    p_stay_at_goal=0.7,    # chance a ghost that reaches its favourite place stays
    goal_reach_m=60.0,
)
BACKGROUND_AREA_M2 = 10e6  # where a mistaken report could have put her (~10 km^2)
TIP_WINDOW_S = 600.0       # a tip's time is approximate: +-10 minutes
SURPRISE = 0.01            # if <1% of the ghosts could match a credible sighting, the model
                           # (not the witness) is what's wrong: re-seed ghosts at the sighting
HIST_EVERY_S = 120.0       # keep a position snapshot every 2 sim minutes ...
HIST_MAX = 360             # ... for up to 12 sim hours
DEFAULT_RADIUS = {"sighting": 150.0, "clue": 60.0, "last_seen": 60.0,
                  "searched_area": 300.0, "constraint": 300.0}


# ------------------------------------------------------------------ street graph
@dataclass
class _Graph:
    lonlat: np.ndarray      # (N, 2)
    xy: np.ndarray          # (N, 2) metres from origin
    origin: tuple[float, float]   # (lat, lon)
    eu: np.ndarray          # (E,) directed edges, both directions present
    ev: np.ndarray
    elen: np.ndarray
    eang: np.ndarray        # heading of each directed edge (radians)
    rev: np.ndarray         # index of the reverse edge
    nbr: np.ndarray         # (N, D) outgoing edge ids, -1 padded
    deg: np.ndarray         # (N,)

    def to_xy(self, lon, lat):
        lat0, lon0 = self.origin
        return np.stack([(np.asarray(lon, dtype=float) - lon0) * M_PER_DEG_LAT * math.cos(math.radians(lat0)),
                         (np.asarray(lat, dtype=float) - lat0) * M_PER_DEG_LAT], axis=-1)

    def nearest(self, lon: float, lat: float) -> int:
        p = self.to_xy(lon, lat)
        return int(np.argmin(((self.xy - p) ** 2).sum(1)))


_GRAPHS: dict[str, _Graph] = {}


def _build_graph(name: str) -> _Graph:
    import networkx as nx

    src = GRAPH_DIR / f"{name}.graphml"
    cache = CACHE_DIR / f"{name}.npz"
    if cache.exists() and src.exists() and cache.stat().st_mtime >= src.stat().st_mtime:
        z = np.load(cache)
        lonlat, eu, ev, elen = z["lonlat"], z["eu"], z["ev"], z["elen"]
    else:
        g = nx.Graph(nx.read_graphml(src))                      # undirected, simple
        g = g.subgraph(max(nx.connected_components(g), key=len)).copy()
        ids = list(g.nodes)
        index = {n: i for i, n in enumerate(ids)}
        lonlat = np.array([[float(g.nodes[n]["x"]), float(g.nodes[n]["y"])] for n in ids])
        us, vs, ls = [], [], []
        for u, v, d in g.edges(data=True):
            a, b = index[u], index[v]
            if a == b:
                continue
            length = float(d.get("length") or 0.0)
            us += [a, b]; vs += [b, a]; ls += [length, length]
        eu, ev, elen = np.array(us), np.array(vs), np.array(ls)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        np.savez(cache, lonlat=lonlat, eu=eu, ev=ev, elen=elen)

    origin = (float(lonlat[:, 1].mean()), float(lonlat[:, 0].mean()))
    lat0, lon0 = origin
    xy = np.stack([(lonlat[:, 0] - lon0) * M_PER_DEG_LAT * math.cos(math.radians(lat0)),
                   (lonlat[:, 1] - lat0) * M_PER_DEG_LAT], axis=1)
    straight = np.linalg.norm(xy[ev] - xy[eu], axis=1)
    elen = np.where(elen > 0.5, elen, np.maximum(straight, 1.0))
    eang = np.arctan2(xy[ev, 1] - xy[eu, 1], xy[ev, 0] - xy[eu, 0])
    rev = np.arange(len(eu)) ^ 1                     # edges were added as (u->v, v->u) pairs
    n = len(lonlat)
    deg = np.bincount(eu, minlength=n)
    nbr = np.full((n, int(deg.max())), -1, dtype=np.int64)
    order = np.argsort(eu, kind="stable")
    starts = np.concatenate([[0], np.cumsum(deg)[:-1]])
    slot = np.arange(len(eu)) - starts[eu[order]]
    nbr[eu[order], slot] = order
    return _Graph(lonlat, xy, origin, eu, ev, elen, eang, rev, nbr, deg)


def get_graph(name: str = "edmonton_demo") -> _Graph:
    if name not in _GRAPHS:
        _GRAPHS[name] = _build_graph(name)
    return _GRAPHS[name]


# ------------------------------------------------------------------ engine
class GhostEngine:
    """Particle filter over the street graph. Implements the SearchEngine protocol."""

    def __init__(self, n_ghosts: int = 5000, seed: int = 7, graph: str | None = None,
                 behaviour: dict | None = None) -> None:
        self.g = get_graph(graph or os.getenv("OVERWATCH_GRAPH", "edmonton_demo"))
        self.n = n_ghosts
        self.rng = np.random.default_rng(seed)
        self.b = {**BEHAVIOUR, **(behaviour or {})}
        self.case_id = ""
        self.t = self.t0 = datetime.now()
        self.profile: SubjectProfile | None = None
        self.evidence: list[Evidence] = []
        self.favourites: list[tuple[int, str]] = []          # (node, evidence id)
        self.proposed: list[tuple[np.ndarray, str]] = []     # (xy, asset) already proposed
        self.base_xy = np.zeros(2)
        self._respawned: set[int] = set()
        self.alive_fraction = 1.0

    # ---------------------------------------------------------------- interface
    def reset(self, profile: SubjectProfile, start_time: datetime) -> None:
        g, n, rng, b = self.g, self.n, self.rng, self.b
        self.profile = profile
        self.case_id = profile.case_id
        self.t = self.t0 = start_time
        self.evidence = []
        self.favourites = []
        self.proposed = []
        self._respawned = set()
        self.alive_fraction = 1.0
        ls = profile.last_seen or GeoPoint(lat=53.5422, lon=-113.5337)
        start = g.nearest(ls.lon, ls.lat)
        self.base_xy = g.xy[start].copy()
        # every ghost starts at the last-seen point, facing a random street
        k = rng.integers(0, g.deg[start], n)
        self.e = g.nbr[start][k].copy()
        self.s = np.zeros(n)
        self.heading = g.eang[self.e] + rng.normal(0, 0.3, n)
        base = SPEED_MS.get(profile.mobility, 0.85)
        self.speed = base * rng.lognormal(0.0, 0.2, n)
        self.move_left = 3600 * np.minimum(
            rng.lognormal(math.log(b["move_median_h"]), b["move_sigma"], n), b["move_cap_h"])
        self.rest_left = np.zeros(n)
        self.goal = np.full(n, -1)
        self.w = np.ones(n)
        self.hist_t: list[datetime] = []
        self.hist: list[np.ndarray] = []
        self._snapshot()

    def step(self, minutes: float) -> None:
        if minutes <= 0:
            return
        self._move(np.full(self.n, minutes * 60.0))
        self.t += timedelta(minutes=minutes)
        if not self.hist_t or (self.t - self.hist_t[-1]).total_seconds() >= HIST_EVERY_S:
            self._snapshot()

    def _move(self, left: np.ndarray) -> None:
        """Walk every ghost for left[i] seconds (0 = stay put)."""
        g = self.g
        left = left.astype(float).copy()
        for _ in range(5000):
            act = (left > 1e-9) & (self.move_left > 1e-9)
            if not act.any():
                break
            r = act & (self.rest_left > 0)                   # resting: time passes, no movement
            if r.any():
                use = np.minimum(self.rest_left[r], left[r])
                self.rest_left[r] -= use; left[r] -= use; self.move_left[r] -= use
            m = act & (self.rest_left <= 0) & (left > 1e-9) & (self.move_left > 1e-9)
            if not m.any():
                continue
            idx = np.nonzero(m)[0]
            e = self.e[idx]
            to_node = (g.elen[e] - self.s[idx]) / self.speed[idx]
            use = np.minimum(np.minimum(left[idx], to_node), self.move_left[idx])
            self.s[idx] += use * self.speed[idx]
            left[idx] -= use
            self.move_left[idx] -= use
            arrived = idx[self.s[idx] >= g.elen[self.e[idx]] - 1e-6]
            if len(arrived):
                self._at_node(arrived)

    def apply(self, ev: Evidence) -> None:
        self.evidence.append(ev)
        if ev.kind == "note":
            return
        if ev.kind == "favourite_place":
            if ev.location is not None:
                self.favourites.append((self.g.nearest(ev.location.lon, ev.location.lat), ev.id))
                self._assign_goals()
            return
        if ev.location is None and not ev.area:
            return
        radius = ev.radius_m or DEFAULT_RADIUS.get(ev.kind, 150.0)
        if ev.kind == "last_seen" and self._restates_last_seen(ev):
            return                                           # same as the case file: no new information
        if ev.kind in ("sighting", "clue", "last_seen"):
            if ev.location is None:
                return
            c = self.g.to_xy(ev.location.lon, ev.location.lat)
            sigma = max(radius, 40.0)
            # Was the ghost at that spot at any time around the reported time? ("around 2:35")
            d2 = np.min([((p - c) ** 2).sum(1) for p in self._xy_window(ev.time, TIP_WINDOW_S)], axis=0)
            near = np.exp(-d2 / (2 * sigma ** 2))
            support = float((self.w * near).sum() / self.w.sum())
            if support < SURPRISE and ev.reliability >= 0.6 and ev.kind != "last_seen":
                self._reseed(ev, c, sigma)                    # credible report the model didn't expect
                return
            # Report is right (Gaussian around the reported spot) or wrong (could be
            # anywhere in the search area). Both as densities, scaled so a ghost right
            # on the spot scores r: the "wrong report" floor is tiny, as it should be.
            wrong = (1 - ev.reliability) * (2 * np.pi * sigma ** 2) / BACKGROUND_AREA_M2
            like = wrong + ev.reliability * near
        elif ev.kind in ("searched_area", "constraint"):
            inside = self._inside(self._xy_at(ev.time), ev, radius)
            if ev.kind == "searched_area":
                pod = ev.detection_prob if ev.detection_prob is not None else 0.7
                miss = 1 - pod * ev.reliability
            else:
                miss = 1 - ev.reliability
            like = np.where(inside, miss, 1.0)
        else:
            return
        before = self.w.sum()
        w = self.w * like
        after = w.sum()
        if after <= 0 or not np.isfinite(after):             # contradicts every ghost: ignore
            return
        self.w = w * (self.n / after)
        self.alive_fraction = float(np.clip(self.alive_fraction * after / before, 0.0, 1.0))
        if self._ess() < 0.5 * self.n:
            self._resample()

    def frame(self) -> GhostFrame:
        lonlat = self._lonlat()
        w = self.w / self.w.max() if self.w.max() > 0 else self.w
        pos = np.column_stack([np.round(lonlat, 6), np.round(w, 4)]).tolist()
        respawned = sorted(self._respawned)
        self._respawned = set()
        return GhostFrame(case_id=self.case_id, t=self.t, positions=pos,
                          alive_fraction=round(self.alive_fraction, 4),
                          clusters=self.clusters(), respawned=respawned)

    def propose(self) -> list[TaskingRequest]:
        """One request for the most likely area not yet covered: a drone takes the first
        look; once a drone has looked and the area is very likely, a ground team confirms."""
        clusters = self.clusters()
        for cl in clusters:
            c = self.g.to_xy(cl.center.lon, cl.center.lat)
            before = {a for p, a in self.proposed if np.linalg.norm(c - p) < 300}
            if not before:
                asset = "Drone 2"
            elif "Drone 2" in before and "Ground Team 1" not in before and cl.probability >= 0.5:
                asset = "Ground Team 1"
            else:
                continue
            self.proposed.append((c, asset))
            others = [x for x in clusters if x.id != cl.id]
            return [self._request(cl, c, others, asset)]
        return []

    # ---------------------------------------------------------------- clusters
    def clusters(self, max_n: int = 4, cell: float = 150.0, radius: float = 350.0) -> list[Cluster]:
        xy = self._xy()
        w = self.w / self.w.sum()
        ij = np.floor(xy / cell).astype(int)
        keys, inv = np.unique(ij, axis=0, return_inverse=True)
        mass = np.bincount(inv.ravel(), weights=w)
        out: list[Cluster] = []
        centres: list[np.ndarray] = []
        for k in np.argsort(-mass)[:200]:
            c0 = (keys[k] + 0.5) * cell
            if any(np.linalg.norm(c0 - c) < 2 * radius for c in centres):
                continue
            near = ((xy - c0) ** 2).sum(1) < radius ** 2
            p = float(w[near].sum())
            if p < 0.05:
                break
            c = (xy[near] * w[near, None]).sum(0) / max(w[near].sum(), 1e-12)
            centres.append(c)
            lon, lat = self._xy_to_lonlat(c)
            evid = self._evidence_near(c, 700.0)
            out.append(Cluster(id=f"cl_{int(c[0] // 300)}_{int(c[1] // 300)}",
                               center=GeoPoint(lat=round(lat, 6), lon=round(lon, 6)),
                               probability=round(min(p, 1.0), 4),
                               story=self._story(c, p, evid), evidence_ids=[e.id for e in evid]))
            if len(out) >= max_n:
                break
        return out

    # ---------------------------------------------------------------- internals
    def _at_node(self, idx: np.ndarray) -> None:
        g, b, rng = self.g, self.b, self.rng
        here = g.ev[self.e[idx]]
        # reached the favourite place?
        has_goal = self.goal[idx] >= 0
        if has_goal.any():
            gi = idx[has_goal]
            dist = np.linalg.norm(g.xy[here[has_goal]] - g.xy[self.goal[gi]], axis=1)
            reached = gi[dist < b["goal_reach_m"]]
            if len(reached):
                stay = reached[rng.random(len(reached)) < b["p_stay_at_goal"]]
                self.move_left[stay] = 0.0
                self.goal[reached] = -1
        # intended direction: slow drift, occasional wrong turn, new way at dead ends
        busy = g.deg[here] >= b["busy_degree"]
        wrong = busy & (rng.random(len(idx)) < b["p_wrong_turn"])
        self.heading[idx] += rng.normal(0, b["heading_drift"], len(idx)) + wrong * rng.normal(0, 1.2, len(idx))
        dead_end = idx[g.deg[here] <= 1]
        self.heading[dead_end] = rng.uniform(-np.pi, np.pi, len(dead_end))
        # choose the next street
        cand = g.nbr[here]                                   # (m, D)
        valid = cand >= 0
        cs = np.where(valid, cand, 0)
        came = self.e[idx]
        score = b["k_straight"] * np.cos(g.eang[cs] - self.heading[idx][:, None])
        back = cs == g.rev[came][:, None]
        allow_back = (rng.random(len(idx)) < b["p_backtrack"])[:, None] | (g.deg[here] <= 1)[:, None]
        score = np.where(back & ~allow_back, score - 8.0, score)
        goal = self.goal[idx]
        gmask = goal >= 0
        if gmask.any():
            gxy = g.xy[np.where(gmask, goal, 0)]
            d_here = np.linalg.norm(g.xy[here] - gxy, axis=1)[:, None]
            d_next = np.linalg.norm(g.xy[g.ev[cs]] - gxy[:, None, :], axis=2)
            progress = np.clip((d_here - d_next) / g.elen[cs], -1, 1)
            score = score + np.where(gmask[:, None], b["k_goal"] * progress, 0.0)
        temp = np.where(busy, b["busy_temp"], 1.0)[:, None]
        gumbel = -np.log(-np.log(rng.random(score.shape) + 1e-12) + 1e-12)
        pick = np.argmax(np.where(valid, score / temp + gumbel, -np.inf), axis=1)
        self.e[idx] = cs[np.arange(len(idx)), pick]
        self.s[idx] = 0.0
        rest = idx[rng.random(len(idx)) < b["p_rest"]]
        self.rest_left[rest] = rng.uniform(0, b["max_rest_s"], len(rest))

    def _assign_goals(self) -> None:
        if not self.favourites:
            return
        g, rng = self.g, self.rng
        moving = np.nonzero(self.move_left > 0)[0]
        self.goal[moving] = -1
        pick = moving[rng.random(len(moving)) < self.b["f_goal"]]
        if not len(pick):
            return
        fav_nodes = np.array([f for f, _ in self.favourites])
        d = np.linalg.norm(self._xy()[pick][:, None, :] - g.xy[fav_nodes][None], axis=2)
        p = np.exp(-d / 1500.0)
        p /= p.sum(1, keepdims=True)
        u = rng.random(len(pick))[:, None]
        choice = (np.cumsum(p, axis=1) < u).sum(1)
        self.goal[pick] = fav_nodes[np.minimum(choice, len(fav_nodes) - 1)]

    def _restates_last_seen(self, ev: Evidence) -> bool:
        p = self.profile
        if p is None or p.last_seen is None or ev.location is None:
            return False
        d = np.linalg.norm(self.g.to_xy(ev.location.lon, ev.location.lat)
                           - self.g.to_xy(p.last_seen.lon, p.last_seen.lat))
        dt = abs((ev.time - self.t0).total_seconds())
        return d < 150 and dt < 15 * 60

    def _reseed(self, ev: Evidence, c: np.ndarray, sigma: float) -> None:
        """Replace a share of ghosts (the report's reliability) with ghosts that were at the
        reported spot at the reported time, then walk them forward to now."""
        g, rng, b = self.g, self.rng, self.b
        k = int(round(self.n * ev.reliability))
        slots = rng.choice(self.n, size=k, replace=False)
        d = np.linalg.norm(g.xy - c, axis=1)
        pool = np.nonzero(d < max(2 * sigma, 80))[0]
        if not len(pool):
            pool = np.array([int(np.argmin(d))])
        nodes = pool[rng.integers(0, len(pool), k)]
        nodes = np.where(g.deg[nodes] > 0, nodes, int(np.argmin(d)))
        self.e[slots] = g.nbr[nodes, rng.integers(0, g.deg[nodes])]
        self.s[slots] = 0.0
        self.heading[slots] = rng.uniform(-np.pi, np.pi, k)
        base = SPEED_MS.get(self.profile.mobility if self.profile else "medium", 0.85)
        self.speed[slots] = base * rng.lognormal(0.0, 0.2, k)
        self.move_left[slots] = 3600 * np.minimum(
            rng.lognormal(math.log(b["move_median_h"]), b["move_sigma"], k), b["move_cap_h"])
        self.rest_left[slots] = 0.0
        self.goal[slots] = -1
        if self.favourites:
            heads = slots[rng.random(k) < b["f_goal"]]
            fav = np.array([f for f, _ in self.favourites])
            self.goal[heads] = fav[rng.integers(0, len(fav), len(heads))]
        at_spot = self._xy()[slots].astype(np.float32)
        for t, h in zip(self.hist_t, self.hist):
            if t >= ev.time:
                h[slots] = at_spot
        self.w[slots] = float(np.mean(np.delete(self.w, slots))) if k < self.n else 1.0
        walk_s = max((self.t - ev.time).total_seconds(), 0.0)
        if walk_s > 0:
            left = np.zeros(self.n)
            left[slots] = walk_s
            self._move(left)
        self._respawned.update(slots.tolist())
        self.alive_fraction = float(np.clip(self.alive_fraction * (1 - ev.reliability * 0.5), 0, 1))

    def _xy_window(self, when: datetime, half_s: float) -> list[np.ndarray]:
        out = [self.hist[i].astype(np.float64) for i, t in enumerate(self.hist_t)
               if abs((t - when).total_seconds()) <= half_s]
        if when >= self.t or not out:
            out.append(self._xy_at(when))
        return out

    def _ess(self) -> float:
        w = self.w / self.w.sum()
        return 1.0 / float((w ** 2).sum())

    def _resample(self) -> None:
        """Systematic resampling that keeps survivors in their own slot."""
        n, rng = self.n, self.rng
        w = self.w / self.w.sum()
        cdf = np.cumsum(w)
        cdf[-1] = 1.0
        draws = np.searchsorted(cdf, (rng.random() + np.arange(n)) / n)
        counts = np.bincount(draws, minlength=n)
        dead = np.nonzero(counts == 0)[0]
        extra = np.repeat(np.arange(n), np.maximum(counts - 1, 0))
        rng.shuffle(extra)
        if len(dead):
            for name in ("e", "s", "speed", "move_left", "rest_left", "goal", "heading"):
                a = getattr(self, name)
                a[dead] = a[extra]
            for h in self.hist:
                h[dead] = h[extra]
            # copies that have stopped would sit on the exact same spot: spread them a little
            stopped = dead[self.move_left[dead] <= 0]
            self.s[stopped] = np.clip(self.s[stopped] + rng.normal(0, 15, len(stopped)), 0,
                                      self.g.elen[self.e[stopped]])
            self.speed[dead] *= rng.lognormal(0, 0.05, len(dead))
            self.heading[dead] += rng.normal(0, 0.2, len(dead))
            self._respawned.update(dead.tolist())
        self.w = np.ones(n)

    def _xy(self) -> np.ndarray:
        g = self.g
        f = (self.s / g.elen[self.e])[:, None]
        return g.xy[g.eu[self.e]] * (1 - f) + g.xy[g.ev[self.e]] * f

    def _lonlat(self) -> np.ndarray:
        g = self.g
        f = (self.s / g.elen[self.e])[:, None]
        return g.lonlat[g.eu[self.e]] * (1 - f) + g.lonlat[g.ev[self.e]] * f

    def _xy_to_lonlat(self, xy: np.ndarray) -> tuple[float, float]:
        lat0, lon0 = self.g.origin
        return (float(lon0 + xy[0] / (M_PER_DEG_LAT * math.cos(math.radians(lat0)))),
                float(lat0 + xy[1] / M_PER_DEG_LAT))

    def _snapshot(self) -> None:
        self.hist_t.append(self.t)
        self.hist.append(self._xy().astype(np.float32))
        if len(self.hist) > HIST_MAX:
            self.hist_t.pop(0)
            self.hist.pop(0)

    def _xy_at(self, when: datetime) -> np.ndarray:
        if not self.hist_t or when >= self.t:
            return self._xy()
        best = min(range(len(self.hist_t)), key=lambda i: abs((self.hist_t[i] - when).total_seconds()))
        return self.hist[best].astype(np.float64)

    def _inside(self, pos: np.ndarray, ev: Evidence, radius: float) -> np.ndarray:
        if ev.area and len(ev.area) >= 3:
            poly = self.g.to_xy([p.lon for p in ev.area], [p.lat for p in ev.area])
            x, y = pos[:, 0], pos[:, 1]
            inside = np.zeros(len(pos), dtype=bool)
            j = len(poly) - 1
            for i in range(len(poly)):
                (xi, yi), (xj, yj) = poly[i], poly[j]
                cross = ((yi > y) != (yj > y)) & (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi)
                inside ^= cross
                j = i
            return inside
        c = self.g.to_xy(ev.location.lon, ev.location.lat)
        return ((pos - c) ** 2).sum(1) < radius ** 2

    def _evidence_near(self, c: np.ndarray, within: float) -> list[Evidence]:
        out = []
        for e in self.evidence:
            if e.kind in ("note", "last_seen") or e.location is None:
                continue
            if np.linalg.norm(self.g.to_xy(e.location.lon, e.location.lat) - c) < within:
                out.append(e)
        return out

    def _story(self, c: np.ndarray, p: float, evid: list[Evidence]) -> str:
        """Plain template; backend/agent can replace it with an LLM narration."""
        dist = float(np.linalg.norm(c - self.base_xy))
        bearing = math.degrees(math.atan2(c[0] - self.base_xy[0], c[1] - self.base_xy[1])) % 360
        direction = ["north", "northeast", "east", "southeast", "south", "southwest", "west",
                     "northwest"][int((bearing + 22.5) // 45) % 8]
        where = (f"about {dist / 1000:.1f} km {direction} of where she was last seen" if dist > 150
                 else "close to where she was last seen")
        text = f"{p:.0%} of the remaining possibilities are {where}."
        if evid:
            text += " Supported by: " + "; ".join(e.summary for e in evid[:3]) + "."
        return text

    def _request(self, cl: Cluster, c: np.ndarray, others: list[Cluster], asset: str) -> TaskingRequest:
        dist = float(np.linalg.norm(c - self.base_xy))
        drone = asset.startswith("Drone")
        pod = 0.8 if drone else 0.9
        half = 150.0
        corners = [c + np.array(d) for d in ((-half, -half), (half, -half), (half, half), (-half, half))]

        def to_pt(xy: np.ndarray) -> GeoPoint:
            lon, lat = self._xy_to_lonlat(xy)
            return GeoPoint(lat=round(lat, 6), lon=round(lon, 6))

        evid = [e for e in self.evidence if e.id in cl.evidence_ids]
        reasons = [f"{cl.probability:.0%} of the remaining possibilities are within 350 m of this point."]
        if not drone:
            reasons.append("A drone has already looked here; a ground team can confirm in person.")
        reasons += [e.summary for e in sorted(evid, key=lambda e: e.time, reverse=True)[:3]]
        if others:
            reasons.append(f"Next most likely area holds {others[0].probability:.0%}.")
        speed_m_min = 600.0 if drone else 250.0          # drone flight vs drive-then-walk
        return TaskingRequest(
            case_id=self.case_id, asset=asset,
            target_area=[to_pt(p) for p in corners],
            route=[to_pt(self.base_xy), to_pt(c)],
            expected_gain=round(min(cl.probability * pod, 1.0), 4),
            duration_min=round(dist / speed_m_min + (8 if drone else 15), 1),
            reasons=reasons, evidence_ids=cl.evidence_ids,
            alternatives=[f"Area {i + 2}: {o.probability:.0%} of possibilities"
                          for i, o in enumerate(others[:2])],
            constraints_ok=({"battery": True, "airspace": True, "wind": True, "line_of_sight": dist < 1500}
                            if drone else {"daylight": True}),
        )
