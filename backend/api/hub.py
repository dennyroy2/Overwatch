"""In-memory case state + WebSocket fan-out. One hub per case."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from fastapi import WebSocket
from pydantic import TypeAdapter

from contracts.models import (
    Evidence, LogEntry, StreamMessage, SubjectProfile, TaskingRequest,
)

_stream_adapter = TypeAdapter(StreamMessage)


@dataclass
class CaseHub:
    profile: SubjectProfile
    evidence: list[Evidence] = field(default_factory=list)
    requests: dict[str, TaskingRequest] = field(default_factory=dict)
    log: list[LogEntry] = field(default_factory=list)
    sockets: set[WebSocket] = field(default_factory=set)
    task: asyncio.Task | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def broadcast(self, msg) -> None:
        payload = _stream_adapter.dump_json(msg).decode()
        dead = []
        for ws in list(self.sockets):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.sockets.discard(ws)

    def add_log(self, actor: str, action: str, detail: str) -> LogEntry:
        entry = LogEntry(actor=actor, action=action, detail=detail)
        self.log.append(entry)
        return entry


class Registry:
    def __init__(self) -> None:
        self.cases: dict[str, CaseHub] = {}

    def get(self, case_id: str) -> CaseHub | None:
        return self.cases.get(case_id)

    def create(self, profile: SubjectProfile) -> CaseHub:
        hub = CaseHub(profile=profile)
        self.cases[profile.case_id] = hub
        return hub


registry = Registry()
