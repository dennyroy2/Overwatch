"""Narrator: AI-written cluster stories and tasking reasons.

The engine already writes plain template text for both, so the screen never waits.
The narrator upgrades that text in the background:

  - Cluster stories: decorate(hub, frame) swaps in a cached AI story for each of the top
    clusters and, if a cluster has new evidence behind it, asks Claude for a fresh one
    (worker thread; the next frame picks it up). Stories are regenerated only when the
    evidence behind an area changes, never just because ghosts moved.
  - Tasking reasons: schedule_reasons(hub, request) asks Claude to explain the request
    in plain words, then re-broadcasts the SAME request id (the dashboard upserts by id).
    The engine's numeric reason always stays first, so numbers are never AI-written.

Rules: the AI explains, it never decides. It sees only the case file and the evidence,
never produces coordinates, and a story claiming the person was found is rejected.
No ANTHROPIC_API_KEY (or OVERWATCH_NARRATOR=0) -> template text, no network calls.
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor

from contracts.models import Evidence, GhostFrame, TaskingMsg, TaskingRequest

MODEL = os.getenv("OVERWATCH_STORY_MODEL", "claude-sonnet-5-5")
URL = "https://api.anthropic.com/v1/messages"
TIMEOUT_S = 6.0
TOP_CLUSTERS = 2

_FOUND = re.compile(r"\b(has been|was|is|been|now)\s+(found|located|rescued|safe)\b", re.I)

STORY_SYSTEM = """You narrate a police search for a missing person for the officer in charge.
Given the case file and the evidence behind ONE likely area, write 1-2 plain sentences
(max 40 words) describing the most likely path that connects the evidence to this area.
Rules: use only facts given; say "may"/"likely", never certain; never say the person was
found, located or is safe; no percentages (the screen shows them); no coordinates;
no advice. Use the person's first name. Output only the sentences."""

REASONS_SYSTEM = """You explain a search tasking request to a police search manager.
Write 2-3 reasons, each max 18 words, plain language, each tied to a specific piece of
evidence or to the comparison with other areas. Use only facts and numbers given.
Never say the person was found. Output a JSON array of strings, nothing else."""


def _enabled() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY")) and os.getenv("OVERWATCH_NARRATOR", "1") != "0"


def _call(system: str, user: str, max_tokens: int = 200) -> str | None:
    """One Claude call; None on any failure (caller keeps the template text)."""
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return None
    try:
        import httpx

        headers = {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
        body = {"model": MODEL, "max_tokens": max_tokens, "system": system,
                "messages": [{"role": "user", "content": user}]}
        fast = {**body, "thinking": {"type": "disabled"}, "output_config": {"effort": "low"}}
        r = httpx.post(URL, timeout=TIMEOUT_S, headers=headers, json=fast)
        if r.status_code == 400:                       # settings not accepted: plain request
            r = httpx.post(URL, timeout=TIMEOUT_S, headers=headers, json=body)
        r.raise_for_status()
        text = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")
        return text.strip() or None
    except Exception:
        return None


# ------------------------------------------------------------------ prompt context
def _case_lines(hub) -> list[str]:
    p = hub.profile
    lines = [f"Missing: {p.name}, {p.age}, {p.condition.replace('_', ' ')}, {p.mobility} mobility."]
    if p.clothing:
        lines.append("Wearing: " + ", ".join(p.clothing) + ".")
    if p.last_seen_time:
        lines.append(f"Last seen at {p.last_seen_time:%H:%M}.")
    if p.notes:
        lines.append("Notes: " + p.notes)
    return lines


def _evidence_lines(evidence: list[Evidence]) -> list[str]:
    out = []
    for e in sorted(evidence, key=lambda e: e.time):
        out.append(f"- {e.time:%H:%M} {e.kind.replace('_', ' ')} from {e.source.replace('_', ' ')} "
                   f"(reliability {e.reliability:.0%}): {e.summary}")
    return out


def _where(hub, lat: float, lon: float) -> str:
    ls = hub.profile.last_seen
    if ls is None:
        return ""
    dx = (lon - ls.lon) * 111_320 * math.cos(math.radians(ls.lat))
    dy = (lat - ls.lat) * 111_320
    d = math.hypot(dx, dy)
    if d < 150:
        return "This area is close to where they were last seen."
    bearing = math.degrees(math.atan2(dx, dy)) % 360
    direction = ["north", "northeast", "east", "southeast", "south", "southwest", "west",
                 "northwest"][int((bearing + 22.5) // 45) % 8]
    return f"This area is about {d / 1000:.1f} km {direction} of where they were last seen."


# ------------------------------------------------------------------ narrator
class Narrator:
    def __init__(self) -> None:
        self._stories: dict[tuple, str] = {}
        self._pending: set[tuple] = set()
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="narrator")
        self._tasks: set[asyncio.Task] = set()

    # ---- cluster stories
    @staticmethod
    def _story_key(hub, cl) -> tuple:
        cell = (round(cl.center.lat / 0.0036), round(cl.center.lon / 0.006))   # ~400 m grid
        return (hub.profile.case_id, cell, tuple(sorted(cl.evidence_ids)))

    def decorate(self, hub, frame: GhostFrame) -> None:
        """Swap AI stories into the top clusters; request any that are missing."""
        if not _enabled():
            return
        by_id = {e.id: e for e in hub.evidence}
        for cl in frame.clusters[:TOP_CLUSTERS]:
            key = self._story_key(hub, cl)
            with self._lock:
                story = self._stories.get(key)
                start = story is None and key not in self._pending
                if start:
                    self._pending.add(key)
            if story:
                cl.story = story
            elif start:
                evid = [by_id[i] for i in cl.evidence_ids if i in by_id]
                prompt = "\n".join(_case_lines(hub) + [_where(hub, cl.center.lat, cl.center.lon),
                                                       "Evidence behind this area:"]
                                   + (_evidence_lines(evid) or ["- none yet (movement model only)"]))
                self._pool.submit(self._write_story, key, prompt)

    def _write_story(self, key: tuple, prompt: str) -> None:
        text = _call(STORY_SYSTEM, prompt, max_tokens=120)
        ok = bool(text) and len(text.split()) <= 60 and not _FOUND.search(text)
        with self._lock:
            self._pending.discard(key)
            if ok:
                self._stories[key] = text

    # ---- tasking reasons
    def schedule_reasons(self, hub, req: TaskingRequest) -> None:
        if not _enabled():
            return
        task = asyncio.get_running_loop().create_task(self._upgrade_request(hub, req))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _upgrade_request(self, hub, req: TaskingRequest) -> None:
        by_id = {e.id: e for e in hub.evidence}
        evid = [by_id[i] for i in req.evidence_ids if i in by_id]
        prompt = "\n".join(
            _case_lines(hub)
            + [f"Request: send {req.asset} to search an area for about {req.duration_min:.0f} minutes.",
               f"Expected gain: covers {req.expected_gain:.0%} of the remaining probability.",
               "Engine's reasons: " + " | ".join(req.reasons),
               "Other options: " + (" | ".join(req.alternatives) or "none"),
               "Evidence:"] + (_evidence_lines(evid) or ["- none"]))
        text = await asyncio.to_thread(_call, REASONS_SYSTEM, prompt, 220)
        reasons = _parse_reasons(text)
        if not reasons:
            return
        current = hub.requests.get(req.id)
        if current is None or current.status != "pending":
            return                                     # officer already decided: leave it alone
        upgraded = current.model_copy(update={"reasons": [current.reasons[0], *reasons]})
        hub.requests[req.id] = upgraded
        await hub.broadcast(TaskingMsg(data=upgraded))


def _parse_reasons(text: str | None) -> list[str]:
    if not text:
        return []
    m = re.search(r"\[.*\]", text, re.S)
    try:
        items = json.loads(m.group(0)) if m else []
    except ValueError:
        return []
    out = [s.strip() for s in items if isinstance(s, str) and s.strip()]
    out = [s for s in out if len(s.split()) <= 30 and not _FOUND.search(s)]
    return out[:3]


narrator = Narrator()
