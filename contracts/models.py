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


class Decision(BaseModel):
    request_id: str
    approved: bool
    reason: str | None = None
    officer: str = "Officer"


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


StreamMessage = Annotated[
    Union[GhostsMsg, EvidenceMsg, TaskingMsg, LogMsg, FoundMsg],
    Field(discriminator="type"),
]


class Report(BaseModel):
    case: SubjectProfile
    evidence: list[Evidence]
    requests: list[TaskingRequest]
    log: list[LogEntry]
