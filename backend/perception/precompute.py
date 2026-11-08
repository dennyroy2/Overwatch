"""`python -m backend.perception.precompute --clip <id>` runs steps 26-32 in one go: frames at 2 fps, sliced person
detection, clothing score, ground location, which detections become evidence (the throttle), then it writes
`frontend/public/footage/<id>.detections.json`, the crops in `frontend/public/crops/`, and `manifest.json`.
Running it twice gives byte-identical files. It also writes annotated frames to `scratch/<id>/` (never committed).
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

from . import sidecar, throttle
from .clothing import MATCH_THRESHOLD, WORLD_WEIGHTS
from .detect import DEFAULT_WEIGHTS, SLICE_IMGSZ, SLICE_OVERLAP, SLICE_TILE, SLICED_CONF, Detection
from .frames import ClipInfo, Frame, clip_info, extract_frames
from .geolocate import FlightPath, load_flight_path, locate
from .paths import FIXTURES_DIR, REPO_ROOT, SCRATCH_DIR, clip_path

GENERIC_MIN_SCORE = 0.5     # a backpack, cane or hat is recorded when its score reaches this


@dataclass
class ClipResult:
    sidecar: dict
    crops: dict[str, object]          # evidence id -> crop image
    manifest_entry: dict


def build_clip(clip_id: str, frames: Iterable[Frame], detector: Callable, scorer, flight: FlightPath, info: ClipInfo,
               fps: float, sightings: bool = True, params: dict | None = None,
               on_frame: Callable | None = None) -> ClipResult:
    """Everything the sidecar needs, as plain data. `detector(image) -> list[Detection]` and `scorer.score(image, box)`
    are passed in, so this runs (and is tested) without any model."""
    records: list[dict] = []
    candidates: list[tuple[int, throttle.Candidate]] = []
    images: dict[int, object] = {}
    samples: list[dict] = []
    for frame in frames:
        h, w = frame.image.shape[:2]
        d = flight.at(frame.time_s)
        samples.append({"index": frame.index, "time_s": frame.time_s,
                        "drone": {"lat": round(d.lat, 6), "lon": round(d.lon, 6), "alt_m": round(d.alt_m, 1),
                                  "heading_deg": round(d.heading_deg, 1)}})
        dets: list[Detection] = sorted(detector(frame.image), key=lambda x: (-x.confidence, x.x1, x.y1))
        if on_frame:
            on_frame(frame, dets)
        for n, det in enumerate(dets):
            cs = scorer.score(frame.image, det)
            box = (det.x1 / w, det.y1 / h, det.x2 / w, det.y2 / h)
            ground = locate(flight, frame.time_s, box)
            matched = cs.is_match
            best = cs.best
            rec = {
                "frame": frame.index, "n": n, "time_s": frame.time_s,
                "box": [round(v, 4) for v in box],
                "label": best.phrase if matched and best else "person",
                "confidence": round(det.confidence, 3),
                "matched": matched,
                "clue": best.phrase if matched and best else None,
                "clue_score": round(cs.person, 3),
                "generic": [{"label": g.phrase, "score": round(g.score, 3)} for g in cs.generic if g.score >= GENERIC_MIN_SCORE],
                "location": None if ground is None else {"lat": round(ground.lat, 6), "lon": round(ground.lon, 6)},
                "radius_m": None if ground is None else ground.radius_m,
                "kind": None, "evidence_id": None,
            }
            records.append(rec)
            images.setdefault(frame.index, frame.image)
            if ground is not None and (matched or det.confidence >= throttle.MIN_SIGHTING_CONF):
                candidates.append((len(records) - 1, throttle.Candidate(
                    "clue" if matched else "sighting", ground.lat, ground.lon, ground.radius_m,
                    cs.person if matched else det.confidence, frame.time_s, det.confidence)))

    # In time order; within one frame clues come first, so a sighting beside a clue in the same frame is dropped
    # no matter which box the detector listed first.
    candidates.sort(key=lambda ic: (records[ic[0]]["frame"], ic[1].kind != "clue", records[ic[0]]["n"]))
    flags = throttle.select([c for _, c in candidates], sightings=sightings)
    crops: dict[str, object] = {}
    for (idx, cand), emit in zip(candidates, flags):
        if not emit:
            continue
        rec = records[idx]
        eid = sidecar.evidence_id(clip_id, rec["frame"], rec["n"])
        rec["kind"], rec["evidence_id"] = cand.kind, eid
        img = images[rec["frame"]]
        h, w = img.shape[:2]
        x1, y1, x2, y2 = rec["box"]
        crops[eid] = sidecar.crop_image(img, (x1 * w, y1 * h, x2 * w, y2 * h))
    for rec in records:
        del rec["n"]

    route = flight.points
    doc = {
        "schema": sidecar.SCHEMA_VERSION, "clip": clip_id, "asset": flight.asset,
        "width": info.width, "height": info.height, "duration_s": info.duration_s, "fps_sampled": fps,
        "model": params or {},
        "clothing": list(getattr(scorer, "clothing", [])), "match_threshold": MATCH_THRESHOLD,
        "frames": samples, "detections": records,
    }
    entry = {
        "id": clip_id, "video": f"/footage/{clip_id}.mp4", "sidecar": f"/footage/{clip_id}.detections.json",
        "asset": flight.asset, "width": info.width, "height": info.height, "duration_s": info.duration_s,
        "time_range_s": [0.0, info.duration_s],
        "placement": {"lat": round(sum(p.lat for p in route) / len(route), 6), "lon": round(sum(p.lon for p in route) / len(route), 6)},
        "detections": len(records), "evidence": len(crops),
    }
    return ClipResult(doc, crops, entry)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="backend.perception.precompute", description=__doc__)
    p.add_argument("--clip", required=True, help="clip id, e.g. margaret_drone2")
    p.add_argument("--fps", type=float, default=2.0, help="frames sampled per second of video")
    p.add_argument("--flight", type=Path, default=None, help="flight-path file (default: fixtures/flight_<clip>.json)")
    p.add_argument("--profile", type=Path, default=REPO_ROOT / "scenario" / "margaret.json",
                   help="JSON with case.clothing, the subject's clothing")
    p.add_argument("--weights", default=DEFAULT_WEIGHTS, help="YOLO weights name or path")
    p.add_argument("--no-sightings", action="store_true", help="only clothing matches become evidence")
    p.add_argument("--no-annotate", action="store_true", help="do not write annotated frames to scratch/")
    args = p.parse_args(argv)

    import cv2  # heavy imports only when run as a script

    from . import detect
    from .clothing import ClueScorer

    video = clip_path(args.clip)
    info = clip_info(video)
    flight = load_flight_path(args.flight or FIXTURES_DIR / f"flight_{args.clip}.json")
    clothing = json.loads(args.profile.read_text())["case"]["clothing"]
    scorer = ClueScorer(clothing)
    out_dir = SCRATCH_DIR / args.clip
    if not args.no_annotate:
        out_dir.mkdir(parents=True, exist_ok=True)

    def annotate(frame: Frame, dets: list[Detection]) -> None:
        if not args.no_annotate:
            cv2.imwrite(str(out_dir / f"{frame.index:03d}_{frame.time_s:06.2f}s.jpg"), detect.draw_detections(frame.image, dets))

    params = {"detector": args.weights, "tile": SLICE_TILE, "overlap": SLICE_OVERLAP, "imgsz": SLICE_IMGSZ,
              "conf": SLICED_CONF, "clothing": WORLD_WEIGHTS}
    result = build_clip(args.clip, extract_frames(video, args.fps),
                        lambda im: detect.detect_people_sliced(im, args.weights), scorer, flight, info, args.fps,
                        sightings=not args.no_sightings, params=params, on_frame=annotate)
    sidecar.write_json(sidecar.sidecar_path(args.clip), result.sidecar)
    sidecar.write_crops(args.clip, result.crops)
    sidecar.update_manifest(result.manifest_entry)
    kinds = [d["kind"] for d in result.sidecar["detections"] if d["kind"]]
    print(f"{len(result.sidecar['frames'])} frames, {len(result.sidecar['detections'])} boxes, "
          f"{len(kinds)} become evidence ({kinds.count('clue')} clue, {kinds.count('sighting')} sighting)")
    print(f"wrote {sidecar.sidecar_path(args.clip)}\n      {len(result.crops)} crops in {sidecar.CROPS_DIR}\n      {sidecar.manifest_path()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
