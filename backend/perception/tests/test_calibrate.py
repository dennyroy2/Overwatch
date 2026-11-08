import pytest

from backend.perception.calibrate import (
    RELIABILITY_CAP, RELIABILITY_FLOOR, SIGHTING_MAX, clue_reliability, reliability, sighting_reliability,
)
from backend.perception.clothing import MATCH_THRESHOLD


def test_a_clue_just_over_the_threshold_gets_the_floor_and_a_perfect_one_the_cap():
    assert clue_reliability(MATCH_THRESHOLD) == RELIABILITY_FLOOR == 0.5
    assert clue_reliability(1.0) == RELIABILITY_CAP == 0.9
    assert clue_reliability(0.725) == pytest.approx(0.70, abs=0.01)         # halfway between the two


def test_clue_reliability_rises_with_the_score_and_never_leaves_its_range():
    scores = [0.0, 0.2, 0.45, 0.6, 0.8, 1.0, 1.5]
    vals = [clue_reliability(s) for s in scores]
    assert vals == sorted(vals)
    assert min(vals) == 0.5 and max(vals) == 0.9


def test_the_possible_match_alert_gate_is_reached_only_by_a_good_match():
    assert clue_reliability(0.5) < 0.75 <= clue_reliability(0.85)           # the alert needs 0.75 or more


def test_a_sighting_is_weak_whatever_the_detector_thinks():
    assert sighting_reliability(1.0) == SIGHTING_MAX == 0.35
    assert sighting_reliability(0.4) == 0.14 and sighting_reliability(0.0) == 0.0
    assert sighting_reliability(7.0) == 0.35


def test_reliability_picks_the_rule_by_kind():
    assert reliability("clue", 1.0, 0.2) == 0.9
    assert reliability("sighting", 1.0, 0.8) == 0.28
