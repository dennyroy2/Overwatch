"""Step 30: clothing and gear clues (YOLO-World + an HSV colour check). Clothing and gear only, never faces."""
from __future__ import annotations

# Generic clues searched for on every case, besides the subject's own clothing.
GENERIC_CLUES = ("backpack", "cane", "hat")


def clue_prompts(clothing: list[str]) -> list[str]:
    """The open-vocabulary class list: the profile's clothing first, then generic clues, no duplicates."""
    seen: set[str] = set()
    out: list[str] = []
    for item in [*clothing, *GENERIC_CLUES]:
        key = item.strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(item.strip())
    return out


def score_clue(image, box, prompt: str) -> float:
    """0-1 score that `prompt` is visible inside `box`. Implemented in step 30."""
    raise NotImplementedError("step 30")
