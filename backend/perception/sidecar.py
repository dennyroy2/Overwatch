"""Step 32: the sidecar JSON the drone-feed panel reads, the crops, and the manifest.

`frontend/public/footage/<clip>.detections.json` (schema 1). Boxes are `[x1, y1, x2, y2]`, each 0-1 across and down the
video frame. `frames` is the sampled times with the drone's state at each; `detections` is flat, one entry per box, in
time order. The drone-feed panel shows the boxes whose `time_s` is nearest the video's `currentTime` (samples are
`1 / fps_sampled` apart). A detection that became evidence has `kind` ("clue" or "sighting") and `evidence_id`; the
rest are plain boxes. Everything is rounded and written in a fixed order, so running it twice gives the same bytes.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .paths import CROPS_DIR, FOOTAGE_DIR

SCHEMA_VERSION = 1
MIN_CROP_SIDE = 96          # crops are enlarged so their short side is at least this many pixels
CROP_PAD = 0.5              # context kept around the box, as a share of its longer side (at least 12 px)


def sidecar_path(clip_id: str) -> Path:
    return FOOTAGE_DIR / f"{clip_id}.detections.json"


def manifest_path() -> Path:
    return FOOTAGE_DIR / "manifest.json"


def crop_path(evidence_id: str) -> Path:
    return CROPS_DIR / f"{evidence_id}.jpg"


def evidence_id(clip_id: str, frame_index: int, n: int) -> str:
    """Deterministic, so committed crops always match the evidence the replay posts."""
    return f"ev_{clip_id}_{frame_index}_{n}"


def dumps(obj) -> str:
    """The one way JSON is written here: fixed order (as built), 1-space indent, trailing newline, no timestamps."""
    return json.dumps(obj, indent=1, ensure_ascii=False) + "\n"


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dumps(obj))


def read_sidecar(clip_id: str) -> dict:
    return json.loads(sidecar_path(clip_id).read_text())


def crop_image(image, box_px: tuple[float, float, float, float]):
    """The box with some context around it, enlarged if it is tiny. `box_px` is (x1, y1, x2, y2) in pixels."""
    import cv2

    h, w = image.shape[:2]
    x1, y1, x2, y2 = box_px
    pad = max(12.0, CROP_PAD * max(x2 - x1, y2 - y1))
    ix1, iy1, ix2, iy2 = max(0, int(x1 - pad)), max(0, int(y1 - pad)), min(w, int(x2 + pad) + 1), min(h, int(y2 + pad) + 1)
    crop = image[iy1:iy2, ix1:ix2]
    short = min(crop.shape[:2])
    if 0 < short < MIN_CROP_SIDE:
        scale = min(6.0, MIN_CROP_SIDE / short)
        crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    return crop


def write_crops(clip_id: str, crops: dict[str, object], directory: Path = CROPS_DIR) -> None:
    """Write `{evidence_id: image}` as JPEGs, and delete this clip's crops that are no longer wanted, so a re-run
    never leaves orphans."""
    import cv2

    directory.mkdir(parents=True, exist_ok=True)
    for eid, image in crops.items():
        cv2.imwrite(str(directory / f"{eid}.jpg"), image, [cv2.IMWRITE_JPEG_QUALITY, 88])
    stale = re.compile(rf"^ev_{re.escape(clip_id)}_\d+_\d+\.jpg$")
    for f in directory.iterdir():
        if stale.match(f.name) and f.stem not in crops:
            f.unlink()


def update_manifest(entry: dict, path: Path | None = None) -> dict:
    """Add or replace this clip's entry (by `id`) in manifest.json, keeping the others, sorted by id."""
    path = path or manifest_path()
    clips = json.loads(path.read_text())["clips"] if path.is_file() else []
    clips = sorted([c for c in clips if c["id"] != entry["id"]] + [entry], key=lambda c: c["id"])
    manifest = {"schema": SCHEMA_VERSION, "clips": clips}
    write_json(path, manifest)
    return manifest
