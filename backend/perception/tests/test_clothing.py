from backend.perception.clothing import GENERIC_CLUES, clue_prompts


def test_profile_clothing_comes_first_then_generic_clues():
    out = clue_prompts(["grey hooded jacket", "dark sneakers"])
    assert out[:2] == ["grey hooded jacket", "dark sneakers"]
    assert out[2:] == list(GENERIC_CLUES)


def test_duplicates_and_blanks_are_dropped_case_insensitively():
    out = clue_prompts(["Hat", "  ", "red scarf", "hat"])
    assert out == ["Hat", "red scarf", "backpack", "cane"]
