"""The engine interface every part of the system codes against.

- The API server calls these methods.
- Varad's benchmark calls these methods.
- StubEngine (below) satisfies the interface today; the real particle-filter
  engine replaces it later without anyone else changing their code.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Protocol

import numpy as np

from contracts.models import (
    Cluster, Evidence, GeoPoint, GhostFrame, SubjectProfile, TaskingRequest, new_id,
)

# Fictional demo case location: 124 St & Jasper Ave, Edmonton (approximate)
EDMONTON_DEFAULT = GeoPoint(lat=53.5422, lon=-113.5337)
M_PER_DEG_LAT = 111_320.0


class SearchEngine(Protocol):
    def reset(self, profile: SubjectProfile, start_time: datetime) -> None: ...
    def step(self, minutes: float) -> None: ...
    def apply(self, evidence: Evidence) -> None: ...
    def frame(self) -> GhostFrame: ...
    def propose(self) -> list[TaskingRequest]: ...


class StubEngine:
    """Random-walk stand-in. Looks plausible on the map; no real reasoning."""

    def __init__(self, n_ghosts: int = 5000, seed: int = 7) -> None:
        self.n = n_ghosts
        self.rng = np.random.default_rng(seed)
        self.case_id = ""
        self.t = datetime.now()
        self.origin = EDMONTON_DEFAULT
        self.pos = np.zeros((n_ghosts, 2))       # metres east, north from origin
        self.heading = np.zeros(n_ghosts)
        self.weight = np.ones(n_ghosts)
        self.alive = np.ones(n_ghosts, dtype=bool)
        self.evidence: list[Evidence] = []

    # ---- interface
    def reset(self, profile: SubjectProfile, start_time: datetime) -> None:
        self.case_id = profile.case_id
        self.origin = profile.last_seen or EDMONTON_DEFAULT
        self.t = start_time
        self.pos[:] = self.rng.normal(0, 15, size=(self.n, 2))
        self.heading = self.rng.uniform(0, 2 * np.pi, self.n)
        self.weight[:] = 1.0
        self.alive[:] = True
        self.evidence.clear()

    def step(self, minutes: float) -> None:
        speed_m_per_min = 50.0  # slow walking pace
        self.heading += self.rng.normal(0, 0.35, self.n)
        d = speed_m_per_min * minutes * self.rng.uniform(0.3, 1.0, self.n)
        self.pos[:, 0] += np.cos(self.heading) * d
        self.pos[:, 1] += np.sin(self.heading) * d
        self.t += timedelta(minutes=minutes)

    def apply(self, evidence: Evidence) -> None:
        self.evidence.append(evidence)
        if evidence.location is None:
            return
        target = self._to_xy(evidence.location)
        dist = np.linalg.norm(self.pos - target, axis=1)
        radius = evidence.radius_m or 300.0
        if evidence.kind in ("sighting", "clue"):
            # Ghosts far from the sighting become unlikely
            keep = np.exp(-(dist / (radius * 3)) ** 2) * evidence.reliability + (1 - evidence.reliability)
            self.weight *= keep
        elif evidence.kind == "searched_area":
            p = evidence.detection_prob or 0.7
            self.weight[dist < radius] *= (1 - p)
        self._resample()

    def frame(self) -> GhostFrame:
        lonlat = self._to_lonlat(self.pos)
        w = self.weight / self.weight.max() if self.weight.max() > 0 else self.weight
        positions = np.column_stack([lonlat, w]).round(6).tolist()
        return GhostFrame(
            case_id=self.case_id, t=self.t, positions=positions,
            alive_fraction=float(self.alive.mean()), clusters=self._clusters(),
        )

    def propose(self) -> list[TaskingRequest]:
        clusters = self._clusters()
        if not clusters:
            return []
        c = clusters[0]
        box = self._box(c.center, 250)
        return [TaskingRequest(
            case_id=self.case_id, asset="Drone 2", target_area=box,
            route=[self.origin, c.center], expected_gain=round(c.probability, 2),
            duration_min=12, reasons=[
                f"Highest-probability area holds {c.probability:.0%} of remaining ghosts",
                "Area not yet covered by any search",
            ],
            evidence_ids=[e.id for e in self.evidence[-2:]],
            alternatives=["Ground Team 1 to the same area (35 min)"],
            constraints_ok={"battery": True, "line_of_sight": True, "airspace": True, "wind": True},
        )]

    # ---- helpers
    def _resample(self) -> None:
        w = self.weight / self.weight.sum()
        idx = self.rng.choice(self.n, size=self.n, p=w)
        self.pos = self.pos[idx] + self.rng.normal(0, 5, size=(self.n, 2))
        self.heading = self.heading[idx]
        self.weight[:] = 1.0

    def _clusters(self, k: int = 3) -> list[Cluster]:
        cell = 200.0
        keys = np.floor(self.pos / cell).astype(int)
        uniq, inv, counts = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
        order = np.argsort(-counts)[:k]
        out = []
        for rank, i in enumerate(order):
            members = self.pos[inv.ravel() == i]
            center = self._to_lonlat(members.mean(axis=0, keepdims=True))[0]
            out.append(Cluster(
                id=f"cl_{rank}", center=GeoPoint(lon=float(center[0]), lat=float(center[1])),
                probability=float(counts[i] / self.n), evidence_ids=[e.id for e in self.evidence],
            ))
        return out

    def _to_xy(self, p: GeoPoint) -> np.ndarray:
        m_per_deg_lon = M_PER_DEG_LAT * np.cos(np.radians(self.origin.lat))
        return np.array([(p.lon - self.origin.lon) * m_per_deg_lon, (p.lat - self.origin.lat) * M_PER_DEG_LAT])

    def _to_lonlat(self, xy: np.ndarray) -> np.ndarray:
        m_per_deg_lon = M_PER_DEG_LAT * np.cos(np.radians(self.origin.lat))
        lon = self.origin.lon + xy[:, 0] / m_per_deg_lon
        lat = self.origin.lat + xy[:, 1] / M_PER_DEG_LAT
        return np.column_stack([lon, lat])

    def _box(self, c: GeoPoint, half_m: float) -> list[GeoPoint]:
        dlat = half_m / M_PER_DEG_LAT
        dlon = half_m / (M_PER_DEG_LAT * np.cos(np.radians(c.lat)))
        return [GeoPoint(lat=c.lat + a * dlat, lon=c.lon + b * dlon)
                for a, b in ((1, -1), (1, 1), (-1, 1), (-1, -1))]


def new_cluster_id() -> str:
    return new_id("cl")
