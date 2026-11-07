"""Agent hook: turn an officer's plain note into a structured card, keeping the SAME id.

The dashboard's tip box (frontend/src/lib/tips.ts) sends what the officer typed or said as
    POST /evidence {kind: "note", source: "officer", raw_text: "...", no location, time: <sim time>}
and shows a "Parsing" shimmer for up to 6 s, waiting for a card with the same id to come back.

The server calls this when such a note arrives (see backend/agent/README.md, "Wiring"):

    if needs_parsing(ev):
        schedule_upgrade(hub, ev)

upgrade_note() parses in a worker thread (the LLM call can take a few seconds), swaps the note
for the structured card in hub.evidence, and broadcasts it. The dashboard upserts by id, so the
same card fills in and its pin appears.
"""
from __future__ import annotations

import asyncio
import re
import threading
from datetime import timezone

from contracts.models import Evidence, EvidenceMsg, LogMsg, SubjectProfile
from backend.agent import gazetteer
from backend.agent.tip_parser import parse_tip_verbose

# Load the street map in the background as soon as the server imports this module (~1 s),
# so the first tip from the dashboard comes back in milliseconds instead of seconds.
threading.Thread(target=gazetteer.warm_up, name="agent-warm-up", daemon=True).start()

# Words that mean the officer is passing on someone else's report, not their own observation
# ("a woman" is NOT a cue: in "spotted a woman matching the description" she's the subject)
_RELAYED = re.compile(r"\b(witness|caller|neighbou?r|said|says|told|reported|passer-?by|according to)\b", re.I)


def needs_parsing(ev: Evidence) -> bool:
    """A raw officer note from the tip box: no location yet, has text."""
    return (ev.kind == "note" and ev.source == "officer" and ev.location is None
            and bool(ev.raw_text and ev.raw_text.strip()))


def structure_note(note: Evidence, case: SubjectProfile | None) -> Evidence | None:
    """The structured version of `note` (same id), or None if the parser learned nothing useful."""
    if not needs_parsing(note):
        return None
    now = note.time if note.time.tzinfo else note.time.replace(tzinfo=timezone.utc)
    if case and case.last_seen_time and case.last_seen_time.tzinfo:
        now = now.astimezone(case.last_seen_time.tzinfo)     # "2:35" means 2:35 local, not UTC
    res = parse_tip_verbose(note.raw_text or "", case, now=now)
    card = res.evidence
    if card.kind == "note" and card.location is None:
        return None                                           # leave the officer's note as it is
    source = card.source
    if source == "witness" and not _RELAYED.search(note.raw_text or ""):
        source = "officer"                                    # the officer's own observation
    return card.model_copy(update={"id": note.id, "case_id": note.case_id, "source": source})


async def upgrade_note(hub, note: Evidence) -> Evidence | None:
    """Parse off the event loop, replace the note in the hub by id, broadcast the structured card."""
    try:
        card = await asyncio.to_thread(structure_note, note, hub.profile)
    except Exception as exc:                                  # never let a bad tip take the server down
        await hub.broadcast(LogMsg(data=hub.add_log("agent", "parse_failed", f"{note.id}: {exc}")))
        return None
    if card is None:
        return None
    async with hub.lock:
        hub.evidence = [card if e.id == card.id else e for e in hub.evidence]
    await hub.broadcast(EvidenceMsg(data=card))
    await hub.broadcast(LogMsg(data=hub.add_log("agent", "evidence_parsed", card.summary)))
    return card


_running: set[asyncio.Task] = set()      # keep references so background tasks aren't garbage-collected


def schedule_upgrade(hub, note: Evidence) -> None:
    """Fire-and-forget upgrade_note(); call from the POST /evidence handler."""
    task = asyncio.create_task(upgrade_note(hub, note))
    _running.add(task)
    task.add_done_callback(_running.discard)
