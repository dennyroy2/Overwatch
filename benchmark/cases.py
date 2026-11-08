"""
Benchmark case generator.

Each case is a fictional missing-person incident on the street graph:
  - a random profile (mostly dementia, the launch market)
  - a last-seen point and 1-3 familiar places
  - a hidden TRUE path, walked with perturbed parameters (model mismatch on purpose)
  - optionally a witness sighting partway through, with location noise
  - a report delay: police start searching some time after the person was last seen

Evidence is built with the real contract models, so the same cases can be fed
to the real engine later.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from contracts_compat import Evidence, GeoPoint, SubjectProfile
from graph import StreetGraph, to_latlon
from walker import Track, WalkParams, walk

T0 = datetime(2026, 11, 7, 15, 0, tzinfo=timezone(timedelta(hours=-7)))  # fictional


@dataclass
class BenchCase:
    case_id: str
    profile: SubjectProfile
    evidence: list[Evidence]            # what police know when the search starts
    report_delay_s: float               # search starts this long after last seen
    true_track: Track                   # hidden from the strategies
    true_xy: tuple[float, float]        # where the person is when the search starts


def _pt(graph: StreetGraph, node: int) -> GeoPoint:
    lat, lon = to_latlon(*graph.xy[node])
    return GeoPoint(lat=lat, lon=lon)


def make_case(graph: StreetGraph, seed: int) -> BenchCase:
    rnd = random.Random(seed)
    cid = f"BENCH-{seed:05d}"
    condition = rnd.choices(["dementia", "other"], weights=[0.8, 0.2])[0]
    mobility = rnd.choices(["low", "medium", "high"], weights=[0.35, 0.5, 0.15])[0]
    # start somewhere central-ish so paths stay on the map
    central = [i for i, (x, y) in enumerate(graph.xy) if math.hypot(x, y) < 1200]
    start = rnd.choice(central)
    profile = SubjectProfile(case_id=cid, name="Simulated subject", age=rnd.randint(68, 90),
                             condition=condition, mobility=mobility,
                             clothing=["grey hooded jacket"], notes="benchmark case",
                             last_seen=_pt(graph, start), last_seen_time=T0)
    # familiar places near home are the likely ones (within ~2.5 km of last seen)
    sx0, sy0 = graph.xy[start]
    nearby = [p for p in graph.places if math.dist(graph.xy[p], (sx0, sy0)) < 2500] or graph.places
    favourites = rnd.sample(nearby, k=min(len(nearby), rnd.randint(1, 3)))
    report_delay_s = rnd.uniform(60, 180) * 60          # reported 1-3 h after last seen

    true_params = WalkParams.for_profile(condition, mobility).perturbed(rnd)
    track = walk(graph, start, report_delay_s, true_params, favourites, rnd)
    true_xy = track.position(graph, report_delay_s)

    evidence = [Evidence(id=f"{cid}-ls", case_id=cid, kind="last_seen", time=T0,
                         location=_pt(graph, start), source="family", reliability=0.95,
                         confirmed=True, summary="Last seen leaving home")]
    for k, fav in enumerate(favourites):
        name, kind = graph.place_info.get(fav, ("familiar place", "place"))
        evidence.append(Evidence(id=f"{cid}-fav{k}", case_id=cid, kind="favourite_place",
                                 time=T0, location=_pt(graph, fav), source="family",
                                 reliability=0.7, confirmed=True,
                                 summary=f"Familiar {kind.replace('_', ' ')}: {name}"))
    if rnd.random() < 0.6:                              # a witness tip partway through
        ts = rnd.uniform(0.3, 0.8) * report_delay_s
        sx, sy = track.position(graph, ts)
        sx, sy = sx + rnd.gauss(0, 80), sy + rnd.gauss(0, 80)
        lat, lon = to_latlon(sx, sy)
        evidence.append(Evidence(id=f"{cid}-sight", case_id=cid, kind="sighting",
                                 time=T0 + timedelta(seconds=ts), location=GeoPoint(lat=lat, lon=lon),
                                 radius_m=150, source="witness", reliability=0.8, confirmed=True,
                                 summary="Witness saw a woman in a blue jacket"))
    return BenchCase(case_id=cid, profile=profile, evidence=evidence,
                     report_delay_s=report_delay_s, true_track=track, true_xy=true_xy)
