"""Field-practice requests from search and rescue feedback (Nov 8):

- First hour: send the BOLO, pull camera footage and check the obvious places before anything else.
- CCTV: a transit or witness sighting means cameras can confirm it, if footage is requested quickly.
- Building checks: a likely area is still a set of buildings, each with its own access rules.
- Police-only mode: weapon access or a history of violence means volunteers never approach.

All are suggestions on the same approve/reject cards as the drone and team requests.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from backend.engine import buildings
from backend.engine.ghost_engine import safety_words
from backend.engine.utm import utm_str
from contracts.models import Bolo, Evidence, GeoPoint, SubjectProfile, TaskingRequest

LOCAL = ZoneInfo("America/Edmonton")
FIRST_HOUR_MAX_MIN = 180      # first-hour checks are only offered early in a search
CCTV_SOURCES = ("transit", "witness")
MAX_CCTV = 2


def police_only(p: SubjectProfile | None) -> bool:
    return bool(p and (p.weapon_access or p.violence_history))


def _clock(t: datetime | None, ref: datetime | None = None) -> str:
    """Clock time in the case file's own time zone (the one the family and officers used)."""
    if t is None:
        return "unknown time"
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    t = t.astimezone(ref.tzinfo if ref is not None and ref.tzinfo else LOCAL)
    return t.strftime("%-I:%M %p").lower().replace(":00 ", " ")      # in the case file's own clock


def _square(lon: float, lat: float, half_m: float) -> list[GeoPoint]:
    dlat = half_m / 111_320
    dlon = half_m / (111_320 * math.cos(math.radians(lat)))
    return [GeoPoint(lat=round(lat + sy * dlat, 6), lon=round(lon + sx * dlon, 6))
            for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


def bolo(p: SubjectProfile) -> Bolo:
    """Be-on-the-lookout bulletin for patrol, transit, taxis and building staff."""
    danger = police_only(p)
    where = (f"UTM {utm_str(p.last_seen.lon, p.last_seen.lat)} ({p.last_seen.lat:.5f}, {p.last_seen.lon:.5f})"
             if p.last_seen else "location unknown")
    when = p.last_seen_time.strftime("%b %-d, %-I:%M %p") if p.last_seen_time else "unknown time"
    lines = [
        "BOLO: MISSING VULNERABLE PERSON" + (" | DO NOT APPROACH" if danger else ""),
        f"{p.name}, {p.age}. Condition: {p.condition.replace('_', ' ')}. Mobility: {p.mobility}.",
        f"Last seen {when} at {where}.",
        "Wearing: " + (", ".join(p.clothing) if p.clothing else "unknown") + ".",
    ]
    if p.notes:
        lines.append(f"Notes: {p.notes}")
    if danger:
        lines.append(f"SAFETY: {safety_words(p)} Do not approach. Keep sight of the person and call 911.")
    else:
        lines.append("May be confused or frightened. Approach calmly, stay with them, and call 911.")
    lines.append(f"Case {p.case_id}.")
    return Bolo(case_id=p.case_id, text="\n".join(lines), police_only=danger)


def first_hour_request(p: SubjectProfile, sim_now: datetime, engine=None) -> TaskingRequest | None:
    """BOLO + cameras + the obvious places, while footage still exists and she may still be close."""
    if p.last_seen is None or p.last_seen_time is None:
        return None
    mins = max(0, int((sim_now - p.last_seen_time).total_seconds() // 60))
    if mins > FIRST_HOUR_MAX_MIN:
        return None
    lon, lat = p.last_seen.lon, p.last_seen.lat
    since = _clock(p.last_seen_time)
    reasons = [f"Only {mins} min since she was last seen: camera footage still exists and she may still be close.",
               "In cities, about half of people with dementia are found within about 1 km of where they were "
               "last seen."]
    if police_only(p):
        reasons.insert(0, f"Safety: {safety_words(p)} Police lead; volunteers do not approach.")
    tasks = [
        "Send the BOLO to patrol, transit (ETS) and taxi companies",
        f"Ask businesses near the last-seen point and along likely routes for camera footage from {since} on",
        "Search the home again: garage, sheds, crawl spaces, vehicles",
        "Call hospitals and transit for anyone matching the description",
        "Ask the family the guided questions (favourite places, former homes, work)",
        "Check homes of friends and family she knows",
    ]
    return TaskingRequest(case_id=p.case_id, asset="First-hour checks", kind="first_hour",
                          target_area=_square(lon, lat, 500), route=[GeoPoint(lat=lat, lon=lon)],
                          expected_gain=round(buildings.prob_within(engine, lon, lat, 700), 4) if engine else 0.0,
                          duration_min=30, reasons=reasons, tasks=tasks,
                          utm=utm_str(lon, lat))


def cctv_request(p: SubjectProfile, ev: Evidence, engine=None) -> TaskingRequest | None:
    """A sighting from transit or a witness: cameras nearby can confirm it, if asked quickly."""
    if ev.kind != "sighting" or ev.source not in CCTV_SOURCES or ev.location is None:
        return None
    lon, lat = ev.location.lon, ev.location.lat
    t0, t1 = ev.time - timedelta(minutes=15), ev.time + timedelta(minutes=15)
    window = f"{_clock(t0, p.last_seen_time)} to {_clock(t1, p.last_seen_time)}"
    tasks = (["Ask ETS for footage from the bus and from the stop cameras for " + window]
             if ev.source == "transit" else [])
    tasks.append(f"Ask businesses within 200 m for camera footage from {window}")
    tasks.append("Check doorbell cameras on the nearest residential blocks")
    reasons = [f"{ev.summary}",
               "Cameras can confirm or rule out this sighting within the hour, before footage is overwritten."]
    return TaskingRequest(case_id=p.case_id, asset="CCTV request", kind="cctv",
                          target_area=_square(lon, lat, 200), route=[GeoPoint(lat=lat, lon=lon)],
                          expected_gain=round(buildings.prob_within(engine, lon, lat, 300), 4) if engine else 0.0,
                          duration_min=60,
                          reasons=reasons, tasks=tasks, evidence_ids=[ev.id], utm=utm_str(lon, lat))


def buildings_request(p: SubjectProfile, engine, lon: float, lat: float, why: str,
                      evidence_ids: list[str] | None = None) -> TaskingRequest | None:
    checks = [c for c in buildings.checks_near(engine, lon, lat) if c.share > 0.002]
    if len(checks) < 3:
        return None
    share = sum(c.share for c in checks)
    reasons = [why,
               f"{len(checks)} buildings sit right next to {share:.0%} of all the possibilities. "
               "Each needs a different kind of access: see the list."]
    if police_only(p):
        reasons.insert(0, f"Safety: {safety_words(p)} Police lead; volunteers do not approach.")
    return TaskingRequest(case_id=p.case_id, asset="Building checks", kind="buildings",
                          target_area=_square(lon, lat, buildings.SEARCH_M),
                          route=[GeoPoint(lat=lat, lon=lon)], expected_gain=round(min(share, 1.0), 4),
                          duration_min=round(10 + 8 * len(checks)), reasons=reasons, checks=checks,
                          evidence_ids=evidence_ids or [], utm=utm_str(lon, lat))
