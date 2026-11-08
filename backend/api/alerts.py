"""Targeted public alert areas.

Alberta's Missing Persons Act lets police alert *specific communities* when a vulnerable senior
goes missing. Province-wide alerts are a poor fit for someone on foot; the question police
actually face is which neighbourhoods to alert. Overwatch answers it from the ghost map:
the smallest area holding most of the remaining probability, re-drawn as a "second wave"
when new evidence moves it. Always a suggestion: an officer decides whether to send.
"""
from __future__ import annotations

import math

import numpy as np

from contracts.models import AlertArea, AlertMsg, Evidence, GeoPoint, LogMsg

FIRST_ALERT_AFTER_S = 10.0     # demo seconds before the first suggestion
MOVE_M = 400.0                 # a new wave only when the area's centre moves this far ...
GROW = 0.6                     # ... or the area grows by this fraction. A shrinking area is already
                               # covered by the earlier alert: no re-alerting (alert fatigue).
TRIGGERS = ("favourite_place", "sighting", "clue")


def _clothing(clothing: list[str]) -> str:
    if not clothing:
        return ""
    items = clothing[0] if len(clothing) == 1 else ", ".join(clothing[:-1]) + " and " + clothing[-1]
    return f" Last seen wearing {items}."


def alert_message(profile) -> str:
    name = profile.name
    condition = {"dementia": "has dementia", "child": "is a child", "mental_health": "may be in crisis",
                 "hiker": "may be lost"}.get(profile.condition, "may need help")
    when = f" since {profile.last_seen_time:%I:%M %p}".replace(" 0", " ") if profile.last_seen_time else ""
    return (f"Police are asking for help finding {name}, {profile.age}, who {condition} and has "
            f"been missing{when}.{_clothing(profile.clothing)} {name} may be confused and may not answer "
            f"when called. Please check yards, garages, sheds and parked cars. If you see {name}, stay "
            f"with {name} and call 911.")


def _bearing(dx: float, dy: float) -> str:
    deg = math.degrees(math.atan2(dx, dy)) % 360
    return ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][
        int((deg + 22.5) // 45) % 8]


async def maybe_alert(hub, engine, seconds: float, new: list[Evidence]) -> None:
    """Suggest the first alert area, then a new wave when evidence moves or resizes it."""
    if not hasattr(engine, "alert_area"):
        return
    trigger = next((e for e in reversed(new) if e.kind in TRIGGERS), None)
    first = not hub.alerts
    if first and seconds < FIRST_ALERT_AFTER_S and trigger is None:
        return
    if not first and trigger is None:
        return
    a = engine.alert_area()
    if a is None:
        return
    centre = a["centre_xy"]
    if not first:
        prev = hub.alert_centre
        moved = float(np.linalg.norm(centre - prev))
        grew = (a["area_km2"] - hub.alerts[-1].area_km2) / max(hub.alerts[-1].area_km2, 1e-6)
        if moved < MOVE_M and grew < GROW:
            return
    version = len(hub.alerts) + 1
    reason = f"Covers {a['covers']:.0%} of the remaining probability in {a['area_km2']:.1f} km²."
    if first:
        reason += " First alert: neighbours and businesses closest to the most likely locations."
    else:
        dx, dy = centre - hub.alert_centre
        shift = math.hypot(dx, dy)
        where = f"moved {shift / 1000:.1f} km {_bearing(dx, dy)}" if shift >= MOVE_M else "grew"
        reason += f" Second wave, for people not reached before: the area {where} after: {trigger.summary}"
    alert = AlertArea(case_id=hub.profile.case_id, version=version,
                      polygon=[GeoPoint(lat=round(lat, 6), lon=round(lon, 6)) for lon, lat in a["polygon"]],
                      area_km2=round(a["area_km2"], 2), covers=round(min(a["covers"], 1.0), 3),
                      message=alert_message(hub.profile), reason=reason)
    hub.alerts.append(alert)
    hub.alert_centre = centre
    await hub.broadcast(AlertMsg(data=alert))
    await hub.broadcast(LogMsg(data=hub.add_log(
        "system", "alert_area_suggested", f"Alert area v{version}: {reason}")))
