"""Step 32: the sidecar JSON the drone-feed panel reads, the crops, and the manifest."""
from __future__ import annotations

from pathlib import Path

from .paths import CROPS_DIR, FOOTAGE_DIR

SCHEMA_VERSION = 1


def sidecar_path(clip_id: str) -> Path:
    return FOOTAGE_DIR / f"{clip_id}.detections.json"


def crop_path(evidence_id: str) -> Path:
    return CROPS_DIR / f"{evidence_id}.jpg"


def evidence_id(clip_id: str, frame_index: int, n: int) -> str:
    """Deterministic, so committed crops always match the evidence the replay posts."""
    return f"ev_{clip_id}_{frame_index}_{n}"


def write_sidecar(clip_id: str, detections: list[dict]) -> Path:
    raise NotImplementedError("step 32")
