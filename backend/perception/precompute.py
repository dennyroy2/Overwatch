"""`python -m backend.perception.precompute --clip <id>` runs steps 26-32 in one go (frames, detection,
clues, geolocation, sidecar, crops, manifest). So far it runs steps 26 and 28: frames, person detection (sliced by default), and
annotated frames written to `backend/perception/scratch/<clip>/` (never committed)."""
from __future__ import annotations

import argparse
import json

from .paths import SCRATCH_DIR, clip_path


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="backend.perception.precompute", description=__doc__)
    p.add_argument("--clip", required=True, help="clip id, e.g. margaret_drone2")
    p.add_argument("--fps", type=float, default=2.0, help="frames sampled per second of video")
    p.add_argument("--weights", default=None, help="YOLO weights name or path (default: detect.DEFAULT_WEIGHTS)")
    p.add_argument("--mode", choices=["sliced", "whole"], default="sliced",
                   help="sliced inference (step 28, the default) or a single whole-frame pass (step 26)")
    p.add_argument("--conf", type=float, default=None, help="confidence threshold (default: the mode's own)")
    args = p.parse_args(argv)

    import cv2  # heavy imports only when run as a script

    from . import detect
    from .frames import extract_frames

    out_dir = SCRATCH_DIR / args.clip
    out_dir.mkdir(parents=True, exist_ok=True)
    weights = args.weights or detect.DEFAULT_WEIGHTS
    summary = []
    for frame in extract_frames(clip_path(args.clip), args.fps):
        if args.mode == "sliced":
            dets = detect.detect_people_sliced(frame.image, weights, **({} if args.conf is None else {"conf": args.conf}))
        else:
            dets = detect.detect_people(frame.image, weights, 0.25 if args.conf is None else args.conf)
        cv2.imwrite(str(out_dir / f"{frame.index:03d}_{frame.time_s:06.2f}s.jpg"), detect.draw_detections(frame.image, dets))
        summary.append({"index": frame.index, "time_s": frame.time_s, "people": len(dets)})
        print(f"frame {frame.index:3d}  t={frame.time_s:6.2f}s  people boxed: {len(dets)}")
    (out_dir / "summary.json").write_text(json.dumps({"weights": weights, "mode": args.mode, "conf": args.conf, "frames": summary}, indent=1))
    print(f"{len(summary)} frames, {sum(s['people'] for s in summary)} boxes; annotated frames in {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
