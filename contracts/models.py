"""Shared data contracts for Overwatch.

Every module talks to every other module only through these objects.
Owner: Rishaan. Change this file only after telling the whole team.
Frontend types are generated from this file (see `make types`).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal, Union
from uuid import uuid4

from pydantic import BaseModel, Field


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- basics
class GeoPoint(BaseModel):
    lat: float
    lon: float


EvidenceKind = Literal[
    "last_seen", "sighting", "clue", "searched_area",
    "favourite_place", "constraint", "note",
]
EvidenceSource = Literal[
    "officer", "family", "witness", "drone_ai",
    "ground_team", "transit", "camera", "registry",
]


# ---------------------------------------------------------------- case file
class SubjectProfile(BaseModel):
    case_id: str = Field(default_factory=lambda: new_id("case"))
    name: str
    age: int
    condition: Literal["dementia", "child", "hiker", "mental_health", "other"] = "dementia"
    mobility: Literal["low", "medium", "high"] = "medium"
    clothing: list[str] = Field(default_factory=list, description="Drives the clue detector prompts")
    notes: str = ""
    last_seen: GeoPoint | None = None
    last_seen_time: datetime | None = None
    weapon_access: bool = Field(default_factory=lambda: False, description="May have a weapon: police-only mode (no volunteer teams)")
    violence_history: bool = Field(default_factory=lambda: False, description="History of violence: police-only mode (no volunteer teams)")


class Evidence(BaseModel):
    id: str = Field(default_factory=lambda: new_id("ev"))
    case_id: str
    kind: EvidenceKind
    time: datetime = Field(description="When it happened (not when it was entered)")
    location: GeoPoint | None = None
    area: list[GeoPoint] | None = Field(default=None, description="Polygon for searched_area / constraint")
    radius_m: float | None = None
    source: EvidenceSource
    reliability: float = Field(0.7, ge=0.0, le=1.0, description="AI-suggested, officer-confirmed")
    confirmed: bool = False
    summary: str = Field(description="One line, human readable")
    raw_text: str | None = None
    media_url: str | None = Field(default=None, description="Crop/frame for drone_ai clues")
    detection_prob: float | None = Field(
        default=None, ge=0.0, le=1.0,
        description="For searched_area: chance the search would have spotted the person",
    )


# ---------------------------------------------------------------- engine output
class Cluster(BaseModel):
    id: str
    center: GeoPoint
    probability: float = Field(ge=0.0, le=1.0)
    story: str | None = Field(default=None, description="AI narration of the likely path")
    evidence_ids: list[str] = Field(default_factory=list, description="Why is this hot?")


class GhostFrame(BaseModel):
    """Pushed several times per second on /stream. positions = [[lon, lat, weight], ...]."""
    case_id: str
    t: datetime = Field(description="Simulation time")
    positions: list[list[float]]
    alive_fraction: float = Field(ge=0.0, le=1.0)
    clusters: list[Cluster] = Field(default_factory=list)
    respawned: list[int] = Field(
        default_factory=list,
        description="Slots reused for a new ghost since the last frame: don't animate these, fade them in",
    )
    left_area: float = Field(
        0.0, ge=0.0, le=1.0,
        description="Chance she is no longer in the search area (bus, car, or beyond the map edge). "
                    "Search planners call this 'rest of world'.",
    )


class TaskingRequest(BaseModel):
    id: str = Field(default_factory=lambda: new_id("req"))
    case_id: str
    asset: str = Field(description='e.g. "Drone 2", "Ground Team 3"')
    target_area: list[GeoPoint]
    route: list[GeoPoint]
    expected_gain: float = Field(ge=0.0, le=1.0, description="Share of remaining probability covered")
    duration_min: float
    reasons: list[str]
    evidence_ids: list[str] = Field(default_factory=list)
    alternatives: list[str] = Field(default_factory=list)
    constraints_ok: dict[str, bool] = Field(default_factory=dict, description="battery, line_of_sight, airspace, wind")
    status: Literal["pending", "approved", "rejected"] = "pending"
    kind: Literal["search", "task_force", "first_hour", "cctv", "buildings"] = Field(
        default_factory=lambda: "search", description="search = drone/helicopter/team; first_hour = BOLO + CCTV + obvious places; "
                              "cctv = footage request; buildings = building-by-building checks")
    utm: str | None = Field(default_factory=lambda: None, description='Target in UTM, as search teams read it: "12U 0332116E 5935574N"')
    checks: list[BuildingCheck] = Field(default_factory=list, description="Buildings to check, most likely first")
    tasks: list[str] = Field(default_factory=list, description="Checklist items (first-hour and CCTV requests)")


class BuildingCheck(BaseModel):
    """One building in a likely area: what it is, whether a team can just walk in, and what to do."""
    name: str
    kind: Literal["residential", "business", "public", "care", "parkade", "industrial", "outbuilding", "other"]
    access: str = Field(description='e.g. "Private home: owner consent or a warrant needed"')
    actions: list[str]
    location: GeoPoint
    utm: str
    share: float = Field(ge=0.0, le=1.0, description="Share of the area's probability next to this building")


class Bolo(BaseModel):
    """Be-on-the-lookout bulletin for patrol, transit, taxis and building staff."""
    case_id: str
    text: str
    police_only: bool = False
    time: datetime = Field(default_factory=utcnow)


class SafetyUpdate(BaseModel):
    weapon_access: bool | None = None
    violence_history: bool | None = None
    officer: str = "Officer"


class Decision(BaseModel):
    request_id: str
    approved: bool
    reason: str | None = None
    officer: str = "Officer"


class CloseSearch(BaseModel):
    """Officer ends the search. found=True logs found_confirmed before search_closed."""
    found: bool = False
    officer: str = "Officer"
    note: str = ""


class LogEntry(BaseModel):
    time: datetime = Field(default_factory=utcnow)
    actor: str
    action: str
    detail: str


class FoundEvent(BaseModel):
    case_id: str
    location: GeoPoint
    evidence_id: str | None = None
    note: str = "Possible match located. Awaiting officer confirmation."


class AlertArea(BaseModel):
    """Suggested area for a targeted public alert (Alberta's Missing Persons Act allows police to
    alert specific communities). A suggestion only: an officer decides whether to send it."""
    id: str = Field(default_factory=lambda: new_id("alert"))
    case_id: str
    version: int = Field(description="1 = first alert; 2+ = second waves after the hot spot moved")
    polygon: list[GeoPoint]
    area_km2: float
    covers: float = Field(ge=0.0, le=1.0, description="Share of the remaining probability inside the area")
    message: str = Field(description="Ready-to-send public message")
    reason: str = Field(description="Why this area, and what changed since the last version")
    time: datetime = Field(default_factory=utcnow)


class FamilyQuestion(BaseModel):
    """A question for the family/caregiver. kind='place' answers become map pins."""
    id: str
    text: str
    why: str
    kind: Literal["place", "info"] = "info"


class FamilyAnswer(BaseModel):
    question_id: str
    answer: str


class FamilyAnswerRecord(BaseModel):
    question: str
    answer: str
    evidence_id: str | None = None
    time: datetime = Field(default_factory=utcnow)


# ---------------------------------------------------------------- WebSocket envelope
class GhostsMsg(BaseModel):
    type: Literal["ghosts"] = "ghosts"
    data: GhostFrame


class EvidenceMsg(BaseModel):
    type: Literal["evidence"] = "evidence"
    data: Evidence


class TaskingMsg(BaseModel):
    type: Literal["tasking"] = "tasking"
    data: TaskingRequest


class LogMsg(BaseModel):
    type: Literal["log"] = "log"
    data: LogEntry


class FoundMsg(BaseModel):
    type: Literal["found"] = "found"
    data: FoundEvent


class AlertMsg(BaseModel):
    type: Literal["alert"] = "alert"
    data: AlertArea


StreamMessage = Annotated[
    Union[GhostsMsg, EvidenceMsg, TaskingMsg, LogMsg, FoundMsg, AlertMsg],
    Field(discriminator="type"),
]


class Report(BaseModel):
    case: SubjectProfile
    evidence: list[Evidence]
    requests: list[TaskingRequest]
    log: list[LogEntry]
    alerts: list[AlertArea] = Field(default_factory=list, description="Every suggested alert area, in order")
    family_answers: list[FamilyAnswerRecord] = Field(default_factory=list)
    areas: list[Cluster] = Field(default_factory=list, description="Most likely areas when the report was made")
    left_area: float | None = Field(default=None, description="Chance she left the search area, at report time")
    bolo: Bolo | None = None
