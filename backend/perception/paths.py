"""Where perception reads and writes. Everything is relative to the repo root."""
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
FOOTAGE_DIR = REPO_ROOT / "frontend" / "public" / "footage"   # *.mp4 are gitignored, JSON is committed
CROPS_DIR = REPO_ROOT / "frontend" / "public" / "crops"
SCRATCH_DIR = Path(__file__).resolve().parent / "scratch"     # annotated frames, never committed
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
WEIGHTS_DIR = Path(__file__).resolve().parent / "weights"     # *.pt, never committed


def clip_path(clip_id: str) -> Path:
    return FOOTAGE_DIR / f"{clip_id}.mp4"
