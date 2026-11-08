"""Steps 32-33: which detections become evidence. A detector can fire on the same jacket in 30 frames in a row; sending
all of them would make the engine count one sighting thirty times and collapse the ghosts far too confidently. So:

  * a person whose clothing matches is a `clue`; a located person with no match, above `MIN_SIGHTING_CONF`, is a
    `sighting`;
  * one item per place. The first look at a new place is not sent at once: the place SETTLES for `SETTLE_S` seconds and
    the best look in that window is sent (best clothing score, then detection confidence), so the card and its crop
    show the clearest view, not the first blurry one;
  * afterwards the place is quiet: a new look there is sent only if its confidence has RISEN by `CONF_RISE` or more
    over the best one sent (a falling confidence is not new news), or if the person is now outside the place's radius,
    which is a new place;
  * a `sighting` inside the radius of a clue (sent or still settling) is dropped: the clue already says more.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

MIN_SIGHTING_CONF = 0.40    # a person with no clothing match must be at least this sure to count at all
CONF_RISE = 0.25            # a look this much clearer than the best one sent counts as new evidence
SETTLE_S = 2.0              # seconds a new place waits for a better look before its best look is sent


@dataclass(frozen=True)
class Candidate:
    kind: str               # "clue" or "sighting"
    lat: float
    lon: float
    radius_m: float
    confidence: float       # a clue's clothing score, or a sighting's detection confidence
    time_s: float = 0.0     # when it was seen (clip seconds)
    tiebreak: float = 0.0   # breaks ties between equal confidences (the detector's own confidence)


def _metres(a: Candidate, b: Candidate) -> float:
    dy = (a.lat - b.lat) * 111_320.0
    dx = (a.lon - b.lon) * 111_320.0 * math.cos(math.radians((a.lat + b.lat) / 2))
    return math.hypot(dx, dy)


class _Place:
    def __init__(self, first: Candidate, index: int) -> None:
        self.anchor = first                      # the first look fixes the place and its radius
        self.opened = first.time_s
        self.best, self.best_index = first, index
        self.settled = False

    def rank(self, c: Candidate) -> tuple[float, float]:
        return (c.confidence, c.tiebreak)


def select(candidates: Sequence[Candidate], sightings: bool = True) -> list[bool]:
    """For candidates in time order, whether each becomes evidence. `sightings=False` keeps clues only."""
    places: list[_Place] = []
    flags = [False] * len(candidates)

    def settle(place: _Place) -> None:
        place.settled = True
        flags[place.best_index] = True

    for i, c in enumerate(candidates):
        for p in places:
            if not p.settled and c.time_s - p.opened >= SETTLE_S:
                settle(p)
        if c.kind == "sighting" and not sightings:
            continue
        if c.kind == "sighting" and any(p.anchor.kind == "clue" and _metres(c, p.anchor) <= p.anchor.radius_m for p in places):
            continue
        near = [p for p in places if p.anchor.kind == c.kind and _metres(c, p.anchor) <= p.anchor.radius_m]
        if not near:
            places.append(_Place(c, i))
            continue
        here = min(near, key=lambda p: _metres(c, p.anchor))
        if not here.settled:
            if here.rank(c) > here.rank(here.best):          # a clearer look while the place is still settling
                here.best, here.best_index = c, i
        elif c.confidence >= here.best.confidence + CONF_RISE:
            flags[i] = True
            here.best = c
    for p in places:
        if not p.settled:
            settle(p)
    return flags
