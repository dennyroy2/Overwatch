"""`python -m backend.perception.precompute --clip <id>` runs steps 26-32 in one go (frames, detection,
clues, geolocation, sidecar, crops, manifest)."""
from __future__ import annotations

import argparse


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="backend.perception.precompute", description=__doc__)
    p.add_argument("--clip", required=True, help="clip id, e.g. margaret_drone2")
    p.add_argument("--fps", type=float, default=2.0, help="frames sampled per second of video")
    p.parse_args(argv)
    raise NotImplementedError("steps 26-32")


if __name__ == "__main__":
    raise SystemExit(main())
