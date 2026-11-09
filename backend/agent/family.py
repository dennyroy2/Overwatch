"""Ask the family: the intake questions that most often crack dementia cases.

Search manuals put investigation first, and the questions that matter are about the past:
former homes and workplaces (including places that no longer exist), favourite places, a
spouse's grave, whether the person drives or rides transit. Claude tailors the list to this
case; a curated list from Lost Person Behavior's dementia questionnaire is the fallback.

Place answers ("her old house on 116 St") are resolved to the map by Akshat's tip parser
(the LLM never produces coordinates) and become favourite_place evidence, so the ghosts react.
"""
from __future__ import annotations

import json
import re

from backend.agent.narrator import _call, _enabled
from contracts.models import FamilyQuestion, SubjectProfile

CURATED: list[tuple[str, str, str]] = [
    ("former_homes", "place", "Where has {name} lived before, including childhood homes and places that no longer exist?|"
     "People with dementia often head for a former home."),
    ("work", "place", "Where did {name} work, or go every day for years?|"
     "Old routines pull people back to familiar places."),
    ("grave_worship", "place", "Is there a grave, church, mosque, temple or other place that matters deeply to {name}?|"
     "In one case a man was found at his wife's grave minutes after police asked."),
    ("daily_walk", "place", "Where does {name} walk on a normal day, and how far?|"
     "Sets how far {name} could realistically get."),
    ("transport", "info", "Does {name} still drive, have access to car keys, or ride the bus alone?|"
     "Changes the chance {name} has left the area."),
    ("response", "info", "Will {name} answer to their name? How do they react to strangers or police?|"
     "Most people with dementia don't respond to searchers calling out."),
    ("exit", "info", "Which door did {name} probably leave by, and in which direction?|"
     "Direction of travel predicts where people with dementia end up."),
]

SYSTEM = """You help a police officer interview the family of a missing person with dementia.
Return the 6 most useful questions for THIS case as a JSON array of objects with keys
"text" (the question, using the person's first name), "why" (max 15 words, why it matters)
and "kind" ("place" if the answer is a location, else "info"). Prioritise: former homes and
workplaces (including places that no longer exist), favourite and spiritual places, daily
walking routes, driving or transit access, response to their name. Skip anything the case
file already answers. Output only the JSON array."""

_cache: dict[str, list[FamilyQuestion]] = {}


def curated(profile: SubjectProfile) -> list[FamilyQuestion]:
    first = profile.name.split()[0]
    out = []
    for qid, kind, tpl in CURATED:
        text, why = tpl.format(name=first).split("|")
        out.append(FamilyQuestion(id=qid, text=text, why=why, kind=kind))
    return out


def questions(profile: SubjectProfile, known: list[str]) -> list[FamilyQuestion]:
    """AI-tailored questions for this case, cached; curated list if the AI is unavailable."""
    if profile.case_id in _cache:
        return _cache[profile.case_id]
    result = curated(profile)
    if _enabled():
        prompt = (f"Case file: {profile.name}, {profile.age}, {profile.condition}, {profile.mobility} mobility. "
                  f"Notes: {profile.notes or 'none'}. Already known: {'; '.join(known) or 'nothing yet'}.")
        text = _call(SYSTEM, prompt, max_tokens=700)
        parsed = _parse(text)
        if parsed:
            result = parsed
    _cache[profile.case_id] = result
    return result


def _parse(text: str | None) -> list[FamilyQuestion]:
    if not text:
        return []
    m = re.search(r"\[.*\]", text, re.S)
    try:
        items = json.loads(m.group(0)) if m else []
    except ValueError:
        return []
    out = []
    for i, it in enumerate(items[:8]):
        if not isinstance(it, dict) or not str(it.get("text", "")).strip():
            continue
        kind = it.get("kind") if it.get("kind") in ("place", "info") else "info"
        out.append(FamilyQuestion(id=f"q{i + 1}", text=str(it["text"]).strip(),
                                  why=str(it.get("why", "")).strip()[:160], kind=kind))
    return out
