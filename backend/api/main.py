"""Overwatch API server.

Run:  make dev        (or: uvicorn backend.api.main:app --reload --port 8000)
Docs: http://localhost:8000/docs
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path


def _load_env_file() -> None:
    """Read KEY=value lines from the repo's .env (never committed) without overriding
    variables already set in the shell. Keeps ANTHROPIC_API_KEY out of the code."""
    path = Path(__file__).resolve().parents[2] / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip().removeprefix("export ").strip(), value.strip().strip("\"'"))


_load_env_file()

from fastapi import FastAPI, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from contracts.models import (
    CloseSearch,
    Decision, Evidence, EvidenceMsg, LogMsg, Report, StreamMessage, SubjectProfile,
)
from backend.agent.hook import needs_parsing, schedule_upgrade
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
    if needs_parsing(ev):                       # officer's raw note from the tip box
        schedule_upgrade(hub, ev)               # same id comes back structured
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


@app.get("/report/{case_id}/pdf", response_class=Response,
         responses={200: {"content": {"application/pdf": {}}}})
def report_pdf(case_id: str) -> Response:
    # Imported here so the server still starts if reportlab isn't installed yet
    from backend.report.generate_report import build_pdf
    pdf = build_pdf(report(case_id))
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="overwatch-{case_id}.pdf"'})


@app.post("/case/{case_id}/close")
async def close_search(case_id: str, body: CloseSearch) -> dict:
    """Ends the search. Log actions match the report: found_confirmed, search_closed."""
    hub = registry.get(case_id)
    if hub is None:
        raise HTTPException(404, f"Unknown case {case_id}")
    if any(e.action == "search_closed" for e in hub.log):
        # Already closed (e.g. a double click): change nothing, report the original outcome
        found = any(e.action == "found_confirmed" for e in hub.log)
        return {"ok": True, "found": found, "already_closed": True}
    if body.found:
        detail = body.note or f"{hub.profile.name} located and confirmed by {body.officer}"
        await hub.broadcast(LogMsg(data=hub.add_log(body.officer, "found_confirmed", detail)))
    detail = body.note or ("Subject located" if body.found else "Search closed without locating subject")
    await hub.broadcast(LogMsg(data=hub.add_log(body.officer, "search_closed", detail)))
    return {"ok": True, "found": body.found, "already_closed": False}


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
