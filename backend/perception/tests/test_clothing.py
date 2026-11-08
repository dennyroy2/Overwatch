from pathlib import Path

import pytest

from backend.perception.clothing import (
    GENERIC_CLUES, MATCH_THRESHOLD, ClueScore, ClueScorer, ItemScore, clue_prompts, colour_of, combine,
)
from backend.perception.detect import Detection

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
TORSO = Detection(300, 190, 350, 212, 1.0)      # around the person drawn at (320, 200) in the fixture frames


def test_profile_clothing_comes_first_then_generic_clues():
    out = clue_prompts(["grey hooded jacket", "dark sneakers"])
    assert out[:2] == ["grey hooded jacket", "dark sneakers"]
    assert out[2:] == list(GENERIC_CLUES)


def test_duplicates_and_blanks_are_dropped_case_insensitively():
    assert clue_prompts(["Hat", "  ", "red scarf", "hat"]) == ["Hat", "red scarf", "backpack", "cane"]


@pytest.mark.parametrize("phrase,colour", [
    ("grey hooded jacket", "grey"), ("gray hoodie", "grey"), ("dark track pants with white side stripes", "dark"),
    ("dark sneakers", "dark"), ("blue puffer jacket", "blue"), ("dark blue jacket", "blue"), ("black coat", "dark"),
    ("backpack", None), ("cane", None), ("Red Scarf", "red"),
])
def test_colour_of_reads_the_first_colour_word(phrase, colour):
    assert colour_of(phrase) == colour


def test_combine_needs_both_checks_to_score_high():
    assert combine(0.25, 0.12) == pytest.approx(1.0)
    assert combine(0.0, 0.5) == 0.0                       # wrong object: the right colour cannot rescue it
    assert combine(0.25, 0.0) == 0.0                      # right object, wrong colour
    assert combine(0.25, None) == 1.0                     # no colour word: the model alone decides
    assert combine(5.0, 5.0) == 1.0 and combine(-1, -1) == 0.0   # always inside 0..1


def test_colour_mask_classifies_neutral_and_saturated_pixels():
    np = pytest.importorskip("numpy")
    from backend.perception.clothing import colour_mask

    hsv = np.array([[[0, 0, 130], [0, 0, 230], [10, 200, 30], [110, 200, 160], [2, 220, 200], [60, 200, 150]]], np.uint8)
    got = {c: colour_mask(hsv, c)[0].tolist() for c in ("grey", "white", "dark", "blue", "red", "green")}
    assert got["grey"] == [True, False, False, False, False, False]
    assert got["white"] == [False, True, False, False, False, False]
    assert got["dark"] == [False, False, True, False, False, False]
    assert got["blue"] == [False, False, False, True, False, False]
    assert got["red"] == [False, False, False, False, True, False]
    assert got["green"] == [False, False, False, False, False, True]


@pytest.mark.parametrize("fixture,colour,expect_high", [
    ("frame_blue_jacket.jpg", "blue", True), ("frame_blue_jacket.jpg", "red", False),
    ("frame_red_jacket.jpg", "red", True), ("frame_red_jacket.jpg", "blue", False),
    ("frame_grey_jacket.jpg", "grey", True), ("frame_grey_jacket.jpg", "red", False),
    ("frame_empty.jpg", "grey", False), ("frame_empty.jpg", "blue", False),
])
def test_colour_fraction_on_the_fixture_frames(fixture, colour, expect_high):
    cv2 = pytest.importorskip("cv2")
    from backend.perception.clothing import COLOUR_FULL, colour_fraction

    frac = colour_fraction(cv2.imread(str(FIXTURES / fixture)), TORSO, colour)
    assert (frac >= COLOUR_FULL) == expect_high, f"{fixture} {colour}: {frac:.2f}"


def test_scorer_uses_only_the_subjects_clothing_for_the_match(monkeypatch):
    np = pytest.importorskip("numpy")
    pytest.importorskip("cv2")
    scorer = ClueScorer(["blue puffer jacket"])
    # the model sees a backpack strongly and the jacket not at all
    monkeypatch.setattr(scorer, "world_scores", lambda image, box: {"blue puffer jacket": 0.0, "backpack": 0.9, "cane": 0.0, "hat": 0.0})
    cs = scorer.score(np.zeros((100, 100, 3), np.uint8), Detection(10, 10, 40, 40, 1.0))
    assert [i.phrase for i in cs.items] == ["blue puffer jacket"]
    assert {i.phrase for i in cs.generic} == {"backpack", "cane", "hat"}
    assert cs.generic[0].score == 1.0 or max(i.score for i in cs.generic) == 1.0   # recorded
    assert cs.person == 0.0 and not cs.is_match                                      # but never a match


def test_is_match_uses_the_chosen_threshold_and_the_best_garment():
    item = lambda s: ItemScore("x", 0.0, None, s)
    assert ClueScore((item(0.2), item(MATCH_THRESHOLD)), (), MATCH_THRESHOLD).is_match
    assert not ClueScore((item(0.2),), (), 0.2).is_match
    assert 0.41 < MATCH_THRESHOLD < 0.68                  # above every wrong-colour score (0.41), below the weakest clean subject (0.68)
