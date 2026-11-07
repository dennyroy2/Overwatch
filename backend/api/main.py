"""Overwatch API server.

Run:  make dev        (or: uvicorn backend.api.main:app --reload --port 8000)
Docs: http://localhost:8000/docs
"""
from __future__ import annotations

import asyncio

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from contracts.models import (
    Decision, Evidence, EvidenceMsg, LogMsg, Report, StreamMessage, SubjectProfile,
)
from backend.api.fake_stream import run_fake_case
from backend.api.hub import registry
from backend.engine.interface import EDMONTON_DEFAULT

app = FastAPI(title="Overwatch API", version="0.1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "cases": len(registry.cases)}


@app.post("/case", response_model=SubjectProfile)
async def create_case(profile: SubjectProfile) -> SubjectProfile:
    if profile.last_seen is None:
        profile.last_seen = EDMONTON_DEFAULT
    hub = registry.create(profile)
    hub.add_log("officer", "case_opened", f"{profile.name}, {profile.age}, {profile.condition}")
    return profile


@app.post("/evidence", response_model=Evidence)
async def add_evidence(ev: Evidence) -> Evidence:
    hub = registry.get(ev.case_id)
    if hub is None:
        raise HTTPException(404, f"Unknown case {ev.case_id}")
    async with hub.lock:
        hub.evidence.append(ev)
    await hub.broadcast(EvidenceMsg(data=ev))
    await hub.broadcast(LogMsg(data=hub.add_log(ev.source, "evidence_added", ev.summary)))
    return ev


@app.post("/decision")
async def decide(decision: Decision) -> dict:
    for hub in registry.cases.values():
        req = hub.requests.get(decision.request_id)
        if req is None:
            continue
        req.status = "approved" if decision.approved else "rejected"
        detail = f"{req.asset}: {req.status}" + (f" ({decision.reason})" if decision.reason else "")
        await hub.broadcast(LogMsg(data=hub.add_log(decision.officer, "decision", detail)))
        return {"ok": True, "status": req.status}
    raise HTTPException(404, f"Unknown request {decision.request_id}")


@app.get("/report/{case_id}", response_model=Report)
def report(case_id: str) -> Report:
    hub = registry.get(case_id)
    if hub is None:
        raise HTTPException(404, f"Unknown case {case_id}")
    return Report(case=hub.profile, evidence=hub.evidence,
                  requests=list(hub.requests.values()), log=hub.log)


@app.get("/schema/stream", response_model=StreamMessage, include_in_schema=True)
def stream_schema() -> StreamMessage:
    """Never called. Exists so the WebSocket message types appear in OpenAPI
    and get generated into frontend TypeScript types."""
    raise HTTPException(501, "Schema only")


@app.websocket("/stream/{case_id}")
async def stream(ws: WebSocket, case_id: str) -> None:
    hub = registry.get(case_id)
    if hub is None:
        await ws.close(code=4404)
        return
    await ws.accept()
    hub.sockets.add(ws)
    if hub.task is None or hub.task.done():
        hub.task = asyncio.create_task(run_fake_case(hub))
    try:
        while True:
            await ws.receive_text()  # keep alive; client messages ignored for now
    except WebSocketDisconnect:
        hub.sockets.discard(ws)
        if not hub.sockets and hub.task:
            hub.task.cancel()
            hub.task = None
