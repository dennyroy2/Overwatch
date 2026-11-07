"""
Imports the shared contract models from contracts/models.py (owned by Rishaan).

If contracts/ hasn't been pushed yet, falls back to a local copy of the models
exactly as written in the build plan (Section 6), so benchmark/ and
backend/report/ run tonight. Once contracts/ exists, the real models are used
automatically and this fallback is ignored. Never edit contracts/ from here.
"""

from __future__ import annotations

try:
    from contracts.models import (  # noqa: F401
        Cluster, Decision, Evidence, GeoPoint, GhostFrame, LogEntry,
        SubjectProfile, TaskingRequest,
    )
    USING_REAL_CONTRACTS = True
except ImportError:  # contracts/ not available yet -> local copy of Section 6
    from datetime import datetime
    from typing import Literal

    from pydantic import BaseModel

    USING_REAL_CONTRACTS = False

    class GeoPoint(BaseModel):
        lat: float
        lon: float

    class Evidence(BaseModel):
        id: str
        case_id: str
        kind: Literal["last_seen", "sighting", "clue", "searched_area",
                      "favourite_place", "constraint", "note"]
        time: datetime
        location: GeoPoint | None = None
        area: list[GeoPoint] | None = None
        radius_m: float | None = None
        source: Literal["officer", "family", "witness", "drone_ai", "ground_team",
                        "transit", "camera", "registry"]
        reliability: float
        confirmed: bool
        summary: str
        raw_text: str | None = None
        media_url: str | None = None
        detection_prob: float | None = None

    class SubjectProfile(BaseModel):
        case_id: str
        name: str
        age: int
        condition: Literal["dementia", "child", "hiker", "mental_health", "other"]
        mobility: Literal["low", "medium", "high"]
        clothing: list[str]
        notes: str

    class Cluster(BaseModel):
        id: str
        center: GeoPoint
        probability: float
        story: str | None = None
        evidence_ids: list[str]

    class GhostFrame(BaseModel):
        case_id: str
        t: datetime
        positions: list[list[float]]
        alive_fraction: float
        clusters: list[Cluster]

    class TaskingRequest(BaseModel):
        id: str
        case_id: str
        asset: str
        target_area: list[GeoPoint]
        route: list[GeoPoint]
        expected_gain: float
        duration_min: float
        reasons: list[str]
        evidence_ids: list[str]
        alternatives: list[str]
        constraints_ok: dict[str, bool]

    class Decision(BaseModel):
        request_id: str
        approved: bool
        reason: str | None = None
        officer: str

    class LogEntry(BaseModel):
        time: datetime
        actor: str
        action: str
        detail: str
