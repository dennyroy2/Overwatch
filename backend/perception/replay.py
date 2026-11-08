"""Step 33: the pure function teammates import. No network, no models: it reads only the committed sidecar
(`frontend/public/footage/<clip>.detections.json`) written by `precompute`.

    from backend.perception.replay import evidence_for_clip
    items = evidence_for_clip(case_id, "margaret_drone2", sim_start)     # list[contracts.models.Evidence]

POST each to `/evidence` when it is due (`schedule_for_clip` gives the offsets). Who fires it, and when, is the
scenario driver's call; nothing here posts anything.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from contracts.models import Evidence, GeoPoint

from . import sidecar


def _summary(asset: str | None, kind: str, label: str, reliability: float) -> str:
    who = asset or "Drone"
    what = f"possible {label}" if kind == "clue" else "possible person"
    return f"{who}: {what} ({round(reliability * 100)}%)"


def schedule_for_clip(case_id: str, clip_id: str, sim_start: datetime) -> list[tuple[float, Evidence]]:
    """`(offset_s, Evidence)` for every detection that became evidence, in time order. `offset_s` is seconds from the
    start of the clip; the evidence's `time` is `sim_start + offset_s` (the simulation time the frame was seen).
    The clip is treated as playing at the start of `sim_start`: the caller picks that moment."""
    doc = sidecar.read_sidecar(clip_id)
    asset = doc.get("asset")
    out: list[tuple[float, Evidence]] = []
    for d in doc["detections"]:
        if not d.get("evidence_id") or d.get("location") is None:
            continue
        rel = float(d["reliability"])
        out.append((float(d["time_s"]), Evidence(
            id=d["evidence_id"],
            case_id=case_id,
            kind=d["kind"],
            time=sim_start + timedelta(seconds=float(d["time_s"])),
            location=GeoPoint(lat=d["location"]["lat"], lon=d["location"]["lon"]),
            radius_m=float(d["radius_m"]),
            source="drone_ai",
            reliability=rel,
            confirmed=False,
            summary=_summary(asset, d["kind"], d["label"], rel),
            media_url=f"/crops/{d['evidence_id']}.jpg",
        )))
    return sorted(out, key=lambda x: x[0])


def evidence_for_clip(case_id: str, clip_id: str, sim_start: datetime) -> list[Evidence]:
    """The throttled, fully structured evidence for a clip, ready to POST to `/evidence`."""
    return [e for _, e in schedule_for_clip(case_id, clip_id, sim_start)]
