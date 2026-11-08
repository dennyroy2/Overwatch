"""Step 33: from a detection's scores to the `reliability` the engine uses (agreed with Denny: measured precision,
capped at 0.90).

The engine uses reliability directly: it is the probability that the report is right in its likelihood update, a clue
at 0.6 or more in an unexpected spot reseeds the ghosts there, and the possible-match alert needs 0.75.

Basis (step 30): among the labelled people, every box that scored at or above the match threshold was the subject and
none of the 95 bystander boxes did (39 subject boxes: 21 labelled frames, 18 clip detections), so the measured
precision is 100% (about 98% once smoothed, (39 + 1) / (39 + 2)). That is one scene and effectively one subject, so the
top of the range is capped at 0.90, and a match that only just clears the threshold gets 0.50.

  clue:     threshold -> 0.50, rising in a straight line to 1.0 -> 0.90
  sighting: a person with no clothing match says little about THIS subject: at most 0.35, scaled by the detector's
            own confidence
"""
from __future__ import annotations

from .clothing import MATCH_THRESHOLD

RELIABILITY_CAP = 0.90
RELIABILITY_FLOOR = 0.50
SIGHTING_MAX = 0.35


def _clamp01(x: float) -> float:
    return min(1.0, max(0.0, x))


def clue_reliability(clue_score: float) -> float:
    s = _clamp01((clue_score - MATCH_THRESHOLD) / (1.0 - MATCH_THRESHOLD))
    return round(RELIABILITY_FLOOR + (RELIABILITY_CAP - RELIABILITY_FLOOR) * s, 2)


def sighting_reliability(detector_confidence: float) -> float:
    return round(SIGHTING_MAX * _clamp01(detector_confidence), 2)


def reliability(kind: str, clue_score: float, detector_confidence: float) -> float:
    """`kind` is "clue" or "sighting"."""
    return clue_reliability(clue_score) if kind == "clue" else sighting_reliability(detector_confidence)
