"""Tip parser: free text from an officer -> a draft Evidence card.

    from backend.agent.tip_parser import parse_tip
    card = parse_tip("Bus driver saw her get off at the Emily Murphy Park stop around 2:35", case)

How it works
  1. EXTRACT the facts as words: what kind of tip, who said it, which place, what time.
     - With ANTHROPIC_API_KEY set: Claude does the extraction (handles messy wording).
     - Without a key (or if the call fails): keyword rules do it. The demo never depends on wifi.
  2. RESOLVE the place words to coordinates with gazetteer.py (our own map data only),
     so a location can never be invented.
  3. Return an Evidence with confirmed=False. The officer confirms it with one tap.
"""
from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from contracts.models import Evidence, GeoPoint, SubjectProfile
from backend.agent import gazetteer as gz

LLM_MODEL = os.getenv("OVERWATCH_LLM_MODEL", "claude-haiku-5-5")
LLM_URL = "https://api.anthropic.com/v1/messages"
LLM_BUDGET_S = 5.0                 # dashboard waits 6 s for the structured card

SOURCE_LABEL = {
    "officer": "Officer", "family": "Family", "witness": "Witness", "drone_ai": "Drone",
    "ground_team": "Ground team", "transit": "Transit", "camera": "Camera", "registry": "Registry",
}
BASE_RELIABILITY = {
    "family": 0.8, "transit": 0.75, "witness": 0.6, "ground_team": 0.9,
    "camera": 0.85, "officer": 0.85, "drone_ai": 0.8, "registry": 0.9,
}
RADIUS_M = {"last_seen": 50, "favourite_place": 150, "sighting": 100, "clue": 50,
            "searched_area": 300, "constraint": 300, "note": 200}

NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
             "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "a": 1, "an": 1}


@dataclass
class Extraction:
    kind: str = "note"
    source: str = "witness"
    place_text: str | None = None
    street_a: str | None = None
    street_b: str | None = None
    kind_hint: str | None = None          # cafe / bus_stop / park / place_of_worship
    clock: tuple[int, int] | None = None   # (hour, minute) as said, hour may be 1-12
    pm: bool | None = None                 # True/False if am/pm was said
    minutes_ago: float | None = None
    reliability: float | None = None
    radius_m: float | None = None
    summary: str | None = None


@dataclass
class ParseResult:
    evidence: Evidence
    place_label: str | None
    method: str                            # "llm" or "rules"
    warnings: list[str] = field(default_factory=list)


# ------------------------------------------------------------------ rules
def _has(pattern: str, t: str) -> bool:
    return re.search(pattern, t) is not None


def detect_source(t: str) -> str:
    if _has(r"\b(bus driver|transit|ets\b|lrt|train operator|bus operator)", t):
        return "transit"
    if _has(r"\b(ground team|search team|team \d|we searched|we checked|we cleared|volunteers? searched)", t):
        return "ground_team"
    if _has(r"\b(camera|cctv|security footage|doorbell)", t):
        return "camera"
    if _has(r"\b(officer|constable|cst\.|patrol|dispatch)\b", t):
        return "officer"
    if _has(r"\b(my (mom|mother|dad|father|grandma|grandmother|grandpa|wife|husband|aunt|uncle|sister|brother)"
            r"|daughter|son\b|family|niece|nephew|caregiver)", t):
        return "family"
    return "witness"


def detect_kind(t: str) -> str:
    if _has(r"\b(searched|cleared|checked|swept|canvass\w*)\b", t) and \
       _has(r"\b(nothing|no sign|not there|negative|did ?n[o']t find|no one|nobody|clear)\b", t):
        return "searched_area"
    if _has(r"\b(found|picked up|recovered)\b.{0,25}\b(scarf|glove|hat|toque|purse|bag|shoe|wallet|cane|walker|"
            r"jacket|coat|phone|keys|glasses|mitten)", t):
        return "clue"
    if _has(r"\b(last (saw|seen)|left (her|his|the) (apartment|home|house|building|suite)|walked out)", t):
        return "last_seen"
    if _has(r"\b(loves?|favou?rite|goes (to|there)|used to (live|go|work)|every (day|morning|afternoon)|"
            r"usually|always (walks|goes)|old (home|house|neighbourhood))", t):
        return "favourite_place"
    if _has(r"\b(saw|seen|spotted|noticed|got (off|on)|walking|sitting|standing|wandering|heading|looked lost)\b", t):
        return "sighting"
    if _has(r"\b(camera|cctv|footage|doorbell)\b", t) and \
       _has(r"\b(shows?|showed|caught|captured|recorded|picked up)\b", t):
        return "sighting"
    return "note"


def detect_kind_hint(t: str) -> str | None:
    if _has(r"\b(stop|bus|transit centre|lrt|station)\b", t):
        return "bus_stop"
    if _has(r"\b(coffee|caf[eé]|tim hortons|starbucks)\b", t):
        return "cafe"
    if _has(r"\b(church|mosque|temple|gurdwara|synagogue|chapel|cathedral)\b", t):
        return "place_of_worship"
    if _has(r"\b(park|ravine|trail|river valley)\b", t):
        return "park"
    return None


def find_streets(text: str) -> list[str]:
    """Street mentions in the order they appear: '124 St', 'Jasper Avenue', 'Groat Road'."""
    t = text.lower()
    found: list[tuple[int, str]] = []
    for m in re.finditer(r"\b(\d{2,3}[a-z]?)(?:st|nd|rd|th)?\s*(street|st\b\.?|avenue|ave\b\.?|av\b)", t):
        found.append((m.start(), f"{m.group(1)} {m.group(2)}"))
    long_names = {"st": "street", "ave": "avenue", "rd": "road", "dr": "drive", "blvd": "boulevard",
                  "cres": "crescent", "pkwy": "parkway"}
    for key in gz.street_keys():
        if key[0].isdigit():
            continue
        words = key.split()
        stem, suf = " ".join(words[:-1]), words[-1]
        alts = {key, f"{stem} {long_names.get(suf, suf)}"} if stem else {key}
        for a in alts:
            for m in re.finditer(r"\b" + re.escape(a) + r"\b", t):
                found.append((m.start(), key))
    # Named streets said without a suffix: "on Jasper", "down Groat"
    for key in gz.street_keys():
        words = key.split()
        if key[0].isdigit() or len(words) != 2 or len(words[0]) < 5:
            continue
        for m in re.finditer(r"\b" + re.escape(words[0]) + r"\b(?!\s+(?:park|ravine|trail|centre|center))", t):
            if not any(abs(m.start() - p) < 3 for p, _ in found):
                found.append((m.start(), key))
    # Bare numbers paired with a street: "109 and Jasper" -> 109 St; "116 St and 102" -> 102 Ave
    for m in re.finditer(r"\b(\d{2,3}[a-z]?)\s*(?:and|&|at|/)\s*([a-z0-9 ]{3,25})", t):
        num = m.group(1)
        if any(abs(m.start() - p) < 2 for p, _ in found):
            continue
        other = next((s for p, s in found if m.end(1) < p <= m.end()), None)
        if other:
            kind = "avenue" if (gz.norm_street(other) or "").endswith(" st") else "street"
            found.append((m.start(), f"{num} {kind}"))
    for m in re.finditer(r"\b([a-z0-9 ]{3,25}?)\s*(?:and|&|at|/)\s*(\d{2,3}[a-z]?)\b(?!\s*(?:st|street|ave|avenue|av|blocks?|minutes?|pm|am|:))", t):
        other = next((s for p, s in found if m.start() <= p < m.start(2)), None)
        if other and not any(abs(m.start(2) - p) < 2 for p, _ in found):
            kind = "avenue" if (gz.norm_street(other) or "").endswith(" st") else "street"
            found.append((m.start(2), f"{m.group(2)} {kind}"))
    found.sort()
    out: list[str] = []
    for _, s in found:
        k = gz.norm_street(s)
        if k and k not in [gz.norm_street(o) for o in out]:
            out.append(s)
    return out


def detect_time(t: str) -> tuple[tuple[int, int] | None, bool | None, float | None]:
    m = re.search(r"\b(\d+|an?|half an)\s*(minutes?|mins?|hours?|hrs?)\s+ago\b", t)
    if m:
        n = 0.5 if m.group(1) == "half an" else NUM_WORDS.get(m.group(1), None) or float(m.group(1))
        return None, None, n * (60 if m.group(2).startswith("h") else 1)
    m = re.search(r"\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?", t)
    if m:
        ap = m.group(3)
        return (int(m.group(1)), int(m.group(2))), (None if not ap else ap.startswith("p")), None
    m = re.search(r"\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)", t)
    if m:
        return (int(m.group(1)), 0), m.group(2).startswith("p"), None
    if _has(r"\bnoon\b", t):
        return (12, 0), True, None
    m = re.search(r"\b(?:around|about|at|by|after|before)\s+(one|two|three|four|five|six|seven|eight|nine|ten|"
                  r"eleven|twelve|\d{1,2})(?:\s*o'?clock)?\b(?!\s*(?:blocks?|minutes?|hours?|km|m\b|metres?))", t)
    if m:
        h = NUM_WORDS.get(m.group(1)) or int(m.group(1))
        if 1 <= h <= 12:
            return (h, 0), None, None
    return None, None, None


def _first_sentence(text: str, limit: int = 110) -> str:
    safe = re.sub(r"\b(St|Ave|Dr|Rd|Mr|Mrs|Ms|Mt|Blvd)\.", r"\1<dot>", text.strip())
    s = [x.replace("<dot>", ".") for x in re.split(r"(?<=[.!?])\s+", safe)]
    # skip "I'm a bus driver." style openers that carry no facts
    pick = next((x for x in s if len(x.split()) > 4), s[0] if s else text)
    pick = pick.strip().rstrip(".")
    return pick if len(pick) <= limit else pick[: limit - 1].rsplit(" ", 1)[0] + "…"


def extract_rules(text: str) -> Extraction:
    t = text.lower()
    ex = Extraction(kind=detect_kind(t), source=detect_source(t))
    streets = find_streets(text)
    ex.street_a = streets[0] if streets else None
    ex.street_b = streets[1] if len(streets) > 1 else None
    ex.place_text = text
    ex.kind_hint = detect_kind_hint(t)
    if ex.kind_hint is None and ex.kind == "favourite_place" and _has(r"\b(shop|store)\b", t):
        ex.kind_hint = "cafe" if "coffee" in t else None
    ex.clock, ex.pm, ex.minutes_ago = detect_time(t)
    m = re.search(r"\b(\d+|one|two|three|four|five|six|ten)\s+blocks?\b", t)
    if m and ex.kind == "searched_area":
        ex.radius_m = (NUM_WORDS.get(m.group(1)) or int(m.group(1))) * 100
    rel = BASE_RELIABILITY.get(ex.source, 0.6)
    if _has(r"\b(maybe|i think|not sure|might|possibly|could have been|probably|i guess)\b", t):
        rel -= 0.15
    ex.reliability = rel
    return ex


# ------------------------------------------------------------------ LLM (optional)
LLM_SYSTEM = """You extract facts from police notes about a missing person. Reply with ONLY a JSON object:
{"kind": "last_seen|sighting|clue|searched_area|favourite_place|note",
 "source": "officer|family|witness|ground_team|transit|camera",
 "place_text": "the place words exactly as written, e.g. 'Emily Murphy Park stop on Groat Road', or null",
 "street_a": "first street named, e.g. '124 Street', or null",
 "street_b": "second street if an intersection, e.g. 'Jasper Avenue', or null",
 "kind_hint": "cafe|bus_stop|park|place_of_worship or null (type of place mentioned)",
 "time_24h": "HH:MM if a clock time is given (assume afternoon for 1-7 without am/pm), else null",
 "minutes_ago": number or null,
 "reliability": 0..1 (camera 0.85, family 0.8, transit 0.75, witness 0.6, ground team 0.9; lower it for 'maybe', 'I think'),
 "summary": "one line, max 100 chars, starting with who said it, e.g. 'Bus driver: woman in grey jacket got off at Emily Murphy Park stop'"}
Never invent coordinates or places that are not in the text."""


def extract_llm(text: str) -> Extraction | None:
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return None
    try:
        import httpx

        headers = {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
        body = {"model": LLM_MODEL, "max_tokens": 400, "system": LLM_SYSTEM,
                "messages": [{"role": "user", "content": text}]}
        # Haiku 5.5 thinks by default; a one-sentence extraction doesn't need it, and it adds delay.
        fast = {**body, "thinking": {"type": "disabled"}, "output_config": {"effort": "low"}}
        # The dashboard shows "Parsing" for 6 s, so the whole call, retry included, must fit in 5 s.
        deadline = time.monotonic() + LLM_BUDGET_S
        r = httpx.post(LLM_URL, timeout=LLM_BUDGET_S, headers=headers, json=fast)
        left = deadline - time.monotonic()
        if r.status_code == 400 and left > 0.5:   # settings not accepted: retry with the plain request
            r = httpx.post(LLM_URL, timeout=left, headers=headers, json=body)
        r.raise_for_status()
        raw = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")
        return extraction_from_llm_json(raw)
    except Exception:
        return None


def extraction_from_llm_json(raw: str) -> Extraction | None:
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        return None
    d = json.loads(m.group(0))
    ex = Extraction(
        kind=d.get("kind") if d.get("kind") in RADIUS_M else "note",
        source=d.get("source") if d.get("source") in SOURCE_LABEL else "witness",
        place_text=d.get("place_text"), street_a=d.get("street_a"), street_b=d.get("street_b"),
        kind_hint=d.get("kind_hint") if d.get("kind_hint") in gz.KIND_WORDS else None,
        minutes_ago=d.get("minutes_ago"), summary=d.get("summary"),
    )
    if d.get("time_24h") and re.fullmatch(r"\d{1,2}:\d{2}", d["time_24h"]):
        h, mi = map(int, d["time_24h"].split(":"))
        ex.clock, ex.pm = (h, mi), None if h <= 12 else True
    if isinstance(d.get("reliability"), (int, float)):
        ex.reliability = float(d["reliability"])
    return ex


# ------------------------------------------------------------------ assemble
def _when(ex: Extraction, now: datetime, case: SubjectProfile | None) -> datetime:
    """When it happened. Anchored to the case: nothing can happen before she was last seen."""
    lst = case.last_seen_time if case and case.last_seen_time else None
    if lst is not None and now < lst:          # demo case dated in the future: treat 'now' as 1 h in
        now = lst + timedelta(hours=1)
    if ex.minutes_ago is not None:
        t = now - timedelta(minutes=float(ex.minutes_ago))
    elif ex.clock:
        h, mi = ex.clock
        if ex.pm is True and h < 12:
            h += 12
        elif ex.pm is False and h == 12:
            h = 0
        options = [h] if (ex.pm is not None or h > 12) else [h % 12, h % 12 + 12]
        base = lst or now
        cands = [base.replace(hour=hh, minute=mi, second=0, microsecond=0) + timedelta(days=d)
                 for d in (-1, 0, 1) for hh in options]
        if lst is not None:
            # earliest reading at or after the last-seen time (with a little slack for "around")
            ok = [c for c in cands if c >= lst - timedelta(minutes=30)]
            t = min(ok) if ok else now
        else:
            ok = [c for c in cands if c <= now + timedelta(minutes=15)]
            t = max(ok) if ok else now
    elif ex.kind == "last_seen" and lst is not None:
        t = lst
    else:
        t = now
    if lst is not None and ex.kind in ("sighting", "clue", "searched_area") and t < lst:
        t = lst
    return t


# Colours people mix up. A witness who says "navy" for a dark jacket, or "silver" for grey, still counts.
COLOUR_FAMILY = {
    "grey": "grey", "gray": "grey", "silver": "grey", "charcoal": "grey", "ash": "grey",
    "blue": "blue", "navy": "blue", "teal": "blue", "denim": "blue",
    "black": "dark", "dark": "dark",
    "white": "light", "cream": "light", "beige": "light", "light": "light", "tan": "light",
    "red": "red", "maroon": "red", "burgundy": "red", "pink": "red",
    "green": "green", "olive": "green", "khaki": "green",
    "brown": "brown", "yellow": "yellow", "orange": "orange", "purple": "purple",
}
NEAR_FAMILY = {("dark", "grey"), ("dark", "blue"), ("dark", "brown"), ("light", "grey")}
_NOT_GARMENT = {"with", "and", "the", "side", "white", "stripes", "stripe"}

# How much a clothing match moves reliability. People misremember colours, cameras don't:
# a witness gets the same bump for a near colour and no penalty for a wrong one; a camera is
# only rewarded for the right colour family and is marked down for a clearly different colour.
CLOTHING_BONUS = {
    "witness": {"exact": 0.10, "near": 0.10, "none": 0.05, "wrong": 0.0},
    "camera":  {"exact": 0.10, "near": 0.03, "none": 0.03, "wrong": -0.15},
}


def _family(word: str) -> str | None:
    return COLOUR_FAMILY.get(word)


def _colours_agree(a: str, b: str) -> str:
    """'exact' (same family), 'near' (easily confused), or 'wrong'."""
    if a == b:
        return "exact"
    return "near" if (a, b) in NEAR_FAMILY or (b, a) in NEAR_FAMILY else "wrong"


def _clothing_match(text: str, case: SubjectProfile | None) -> str | None:
    """Best match between the tip and the case's clothing: 'exact', 'near', 'none' (garment named
    with no colour), 'wrong' (garment named in a different colour), or None (no garment matched).
    The colour must sit just before the garment word ("grey hoodie", "dark blue jacket")."""
    if not case:
        return None
    tokens = re.findall(r"[a-z]+", text.lower())
    best, order = None, ["wrong", "none", "near", "exact"]
    for item in case.clothing:
        words = re.findall(r"[a-z]+", item.lower())
        colour = next((_family(w) for w in words if _family(w)), None)
        garments = {w[:4] for w in words if len(w) > 3 and not _family(w) and w not in _NOT_GARMENT}
        for i, tok in enumerate(tokens):
            if len(tok) < 4 or tok[:4] not in garments:
                continue
            said = [_family(w) for w in tokens[max(0, i - 3):i] if _family(w)]
            if not said or colour is None:
                found = "none"
            else:
                found = max((_colours_agree(s, colour) for s in said), key=order.index)
            if best is None or order.index(found) > order.index(best):
                best = found
    return best


def _clothing_bonus(match: str | None, source: str) -> float:
    if match is None:
        return 0.0
    table = CLOTHING_BONUS["camera"] if source in ("camera", "drone_ai") else CLOTHING_BONUS["witness"]
    return table[match]


def parse_tip(text: str, case: SubjectProfile | dict | None = None, now: datetime | None = None,
              use_llm: bool | None = None) -> Evidence:
    """Free-text tip -> unconfirmed Evidence. See parse_tip_verbose for the details."""
    return parse_tip_verbose(text, case, now, use_llm).evidence


def parse_tip_verbose(text: str, case: SubjectProfile | dict | None = None, now: datetime | None = None,
                      use_llm: bool | None = None) -> ParseResult:
    if isinstance(case, dict):
        case = SubjectProfile.model_validate(case)
    tz = case.last_seen_time.tzinfo if case and case.last_seen_time and case.last_seen_time.tzinfo else timezone.utc
    now = now or datetime.now(tz)
    warnings: list[str] = []

    rules = extract_rules(text)
    if rules.kind == "favourite_place" and rules.source == "witness":
        rules.source = "family"
        rules.reliability = BASE_RELIABILITY["family"] - (0.2 if rules.reliability < 0.6 else 0)
    ex, method = rules, "rules"
    if use_llm is not False:
        llm = extract_llm(text)
        if llm:
            ex, method = llm, "llm"
        elif use_llm is True:
            warnings.append("LLM unavailable (no ANTHROPIC_API_KEY or call failed); used rules")

    near = (case.last_seen.lat, case.last_seen.lon) if case and case.last_seen else None
    loc = gz.resolve(ex.place_text, ex.street_a, ex.street_b, ex.kind_hint, near)
    if loc is None and ex is not rules:      # LLM words didn't match our map: try the rule words
        loc = gz.resolve(rules.place_text, rules.street_a, rules.street_b, rules.kind_hint, near)
    if loc is None:
        warnings.append("No place found on the map; card has no location. Officer should pick it on the map.")
    elif not loc.precise:
        warnings.append(f"Only a street was given ({loc.label}); using a wide radius.")

    kind = ex.kind
    rel = ex.reliability if ex.reliability is not None else BASE_RELIABILITY.get(ex.source, 0.6)
    if kind == "sighting":
        rel += _clothing_bonus(_clothing_match(text, case), ex.source)
    rel = max(0.2, min(0.95, rel))
    radius = ex.radius_m or RADIUS_M.get(kind, 200)
    if loc is not None and not loc.precise:
        radius = max(radius, 250)

    suffix = ""
    if loc is not None:
        place = loc.label.split(" (")[0]
        suffix = f" · {place}"
    body = ex.summary
    if not body:
        first = _first_sentence(text, limit=150 - len(suffix))
        # don't double up "Transit: Bus driver: ..." when the tip already says who it is
        body = first if re.match(r"^[\w' ]{2,24}:\s", first) else f"{SOURCE_LABEL.get(ex.source, 'Witness')}: {first}"
    summary = body if (not suffix or suffix[3:].lower() in body.lower()) else body + suffix

    ev = Evidence(
        case_id=case.case_id if case else "unknown",
        kind=kind,
        time=_when(ex, now, case),
        location=GeoPoint(lat=round(loc.lat, 6), lon=round(loc.lon, 6)) if loc else None,
        radius_m=float(radius) if loc else None,
        source=ex.source,
        reliability=round(rel, 2),
        confirmed=False,
        summary=summary,
        raw_text=text,
        detection_prob=0.7 if kind == "searched_area" else None,
    )
    return ParseResult(ev, loc.label if loc else None, method, warnings)
