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
    AlertArea, CloseSearch, utcnow, FamilyAnswer, FamilyAnswerRecord, FamilyQuestion,
    Decision, Evidence, EvidenceMsg, LogMsg, Report, StreamMessage, SubjectProfile,
    Bolo, BuildingCheck, SafetyUpdate,
)
import json

from backend.api import export, field
from backend.engine import buildings
from backend.engine.ghost_engine import safety_words
from backend.agent.hook import needs_parsing, schedule_upgrade
from backend.agent import family
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
    if field.police_only(profile):
        hub.add_log("officer", "safety_flag",
                    f"{safety_words(profile)} Police-only mode: volunteers do not approach.")
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
        if decision.approved and req.kind == "first_hour":
            text = field.bolo(hub.profile).text
            await hub.broadcast(LogMsg(data=hub.add_log(decision.officer, "bolo_sent", text.replace("\n", " | "))))
        return {"ok": True, "status": req.status}
    raise HTTPException(404, f"Unknown request {decision.request_id}")


@app.get("/report/{case_id}", response_model=Report)
def report(case_id: str) -> Report:
    hub = registry.get(case_id)
    if hub is None:
        raise HTTPException(404, f"Unknown case {case_id}")
    return Report(case=hub.profile, evidence=hub.evidence,
                  requests=list(hub.requests.values()), log=hub.log,
                  alerts=hub.alerts, family_answers=hub.family_answers,
                  areas=hub.last_clusters, left_area=hub.last_left_area, bolo=field.bolo(hub.profile))


def _hub(case_id: str):
    hub = registry.get(case_id)
    if hub is None:
        raise HTTPException(404, f"Unknown case {case_id}")
    return hub


@app.get("/case/{case_id}/bolo", response_model=Bolo)
def case_bolo(case_id: str) -> Bolo:
    """Be-on-the-lookout bulletin for patrol, transit, taxis and building staff."""
    return field.bolo(_hub(case_id).profile)


@app.post("/case/{case_id}/safety", response_model=SubjectProfile)
async def set_safety(case_id: str, body: SafetyUpdate) -> SubjectProfile:
    """Weapon access / history of violence: police-only mode (no volunteer teams are requested)."""
    hub = _hub(case_id)
    if body.weapon_access is not None:
        hub.profile.weapon_access = body.weapon_access
    if body.violence_history is not None:
        hub.profile.violence_history = body.violence_history
    on = field.police_only(hub.profile)
    detail = (f"{safety_words(hub.profile)} Police-only mode: volunteers do not approach." if on
              else "Safety concern cleared: volunteer teams may be requested again.")
    await hub.broadcast(LogMsg(data=hub.add_log(body.officer, "safety_flag", detail)))
    return hub.profile


@app.get("/case/{case_id}/buildings", response_model=list[BuildingCheck])
def case_buildings(case_id: str) -> list[BuildingCheck]:
    """Buildings in the most likely area: type, access and what to do at each."""
    hub = _hub(case_id)
    if hub.engine is None or not hub.last_clusters or not hasattr(hub.engine, "g"):
        return []
    c = hub.last_clusters[0].center
    return buildings.checks_near(hub.engine, c.lon, c.lat)


@app.get("/case/{case_id}/export.geojson")
def export_geojson(case_id: str) -> Response:
    """Likely areas, alert area, searched areas, evidence and assignments for CalTopo (import as GeoJSON)."""
    hub = _hub(case_id)
    return Response(json.dumps(export.geojson(hub)), media_type="application/geo+json",
                    headers={"Content-Disposition": f'attachment; filename="overwatch_{case_id}.geojson"'})


@app.get("/case/{case_id}/export.kml")
def export_kml(case_id: str) -> Response:
    """Same layers as KML for ATAK, CalTopo or Google Earth."""
    hub = _hub(case_id)
    return Response(export.kml(hub), media_type="application/vnd.google-earth.kml+xml",
                    headers={"Content-Disposition": f'attachment; filename="overwatch_{case_id}.kml"'})


@app.get("/case/{case_id}/alert", response_model=AlertArea)
def latest_alert(case_id: str) -> AlertArea:
    """The latest suggested public-alert area (also pushed on the stream as type "alert")."""
    hub = registry.get(case_id)
    if hub is None:
        raise HTTPException(404, f"Unknown case {case_id}")
    if not hub.alerts:
        raise HTTPException(404, "No alert area suggested yet")
    return hub.alerts[-1]


@app.get("/case/{case_id}/questions", response_model=list[FamilyQuestion])
async def family_questions(case_id: str) -> list[FamilyQuestion]:
    """Questions for the family, tailored by AI to this case (curated fallback)."""
    hub = registry.get(case_id)
    if hub is None:
        raise HTTPException(404, f"Unknown case {case_id}")
    known = [e.summary for e in hub.evidence if e.kind in ("favourite_place", "last_seen")]
    return await asyncio.to_thread(family.questions, hub.profile, known)


@app.post("/case/{case_id}/answers")
async def family_answer(case_id: str, body: FamilyAnswer) -> dict:
    """A family answer. Place answers are resolved to the map (street data only) and become a
    favourite_place card the ghosts react to; other answers become a note card."""
    hub = registry.get(case_id)
    if hub is None:
        raise HTTPException(404, f"Unknown case {case_id}")
    qs = {q.id: q for q in await asyncio.to_thread(family.questions, hub.profile, [])}
    q = qs.get(body.question_id)
    question = q.text if q else body.question_id
    answer = body.answer.strip()
    if not answer:
        raise HTTPException(422, "Empty answer")
    ev = None
    if q is None or q.kind == "place":
        from backend.agent.tip_parser import parse_tip_verbose
        res = await asyncio.to_thread(parse_tip_verbose, answer, hub.profile)
        loc = res.evidence.location
        if loc is not None:
            ev = Evidence(case_id=case_id, kind="favourite_place", source="family", time=utcnow(),
                          location=loc, radius_m=150, reliability=0.75, confirmed=True,
                          summary=f"Family: {answer}"[:160], raw_text=answer)
    if ev is None:
        needs_pin = q is None or q.kind == "place"
        ev = Evidence(case_id=case_id, kind="note", source="family", time=utcnow(),
                      summary=(f"Family (place not found on the map, drop a pin): {answer}" if needs_pin
                               else f"Family: {answer}")[:160], raw_text=f"{question} {answer}")
    async with hub.lock:
        hub.evidence.append(ev)
    record = FamilyAnswerRecord(question=question, answer=answer, evidence_id=ev.id)
    hub.family_answers.append(record)
    await hub.broadcast(EvidenceMsg(data=ev))
    await hub.broadcast(LogMsg(data=hub.add_log("family", "family_answer", f"{question} -> {answer}")))
    return {"evidence": ev.model_dump(mode="json"), "on_map": ev.kind == "favourite_place"}


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
    if hub.stop_task is not None:              # reconnected in time: keep the same run going
        hub.stop_task.cancel()
        hub.stop_task = None
    if hub.task is None or hub.task.done():
        hub.task = asyncio.create_task(run_fake_case(hub))
    try:
        while True:
            await ws.receive_text()  # keep alive; client messages ignored for now
    except WebSocketDisconnect:
        pass
    finally:
        hub.sockets.discard(ws)
        if not hub.sockets and hub.task and hub.stop_task is None:
            hub.stop_task = asyncio.create_task(_stop_when_idle(hub))


IDLE_STOP_S = float(os.getenv("OVERWATCH_IDLE_STOP_S", "300"))


async def _stop_when_idle(hub) -> None:
    """Stop a case's run only after nobody has watched it for IDLE_STOP_S seconds, so a
    dropped connection or a page reload resumes the same search instead of restarting it."""
    try:
        await asyncio.sleep(IDLE_STOP_S)
    except asyncio.CancelledError:
        return
    if not hub.sockets and hub.task:
        hub.task.cancel()
        hub.task = None
    hub.stop_task = None
