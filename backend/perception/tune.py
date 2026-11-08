"""Step 28: score sliced-inference settings on the labelled frames, split so the result stays honest.

Frames are numbered 0, 1, 2... in file order: even ones are the TUNING half (settings are chosen on them),
odd ones the CHECK half (never used to choose). Both are reported.

    .venv/bin/python -m backend.perception.tune --images <dir> --labels <dir> --tiles 320 640 --overlaps 0.2
"""
from __future__ import annotations

import argparse
import itertools
import json
from pathlib import Path

from .evaluate import Counts, match, read_yolo_labels
from .paths import SCRATCH_DIR

MIN_PRECISION = 0.8   # the goal agreed with Denny: most recall while precision stays around 80% or better


def split_halves(items: list) -> tuple[list, list]:
    """(tuning half, check half): even positions and odd positions."""
    return items[0::2], items[1::2]


def pick_best(rows: list[dict], min_precision: float = MIN_PRECISION) -> dict | None:
    """The row with the best TUNING recall whose TUNING precision is at least `min_precision`
    (ties: fewer boxes). None if no row reaches it."""
    ok = [r for r in rows if r["tune"]["precision"] >= min_precision]
    return max(ok, key=lambda r: (r["tune"]["recall"], -r["tune"]["boxes"])) if ok else None


def total(counts) -> Counts:
    """Add up Counts. (`sum()` alone starts from the integer 0, which cannot be added to a Counts.)"""
    return sum(counts, Counts(0, 0, 0, 0))


def summarise(c: Counts) -> dict:
    return {"found": c.found, "truth": c.truth, "boxes": c.boxes, "correct": c.correct,
            "recall": round(c.recall, 4), "precision": round(c.precision, 4)}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="backend.perception.tune", description=__doc__)
    p.add_argument("--images", type=Path, required=True)
    p.add_argument("--labels", type=Path, required=True)
    p.add_argument("--tiles", type=int, nargs="+", default=[320, 480, 640])
    p.add_argument("--overlaps", type=float, nargs="+", default=[0.1, 0.2, 0.3])
    p.add_argument("--imgszs", type=int, nargs="+", default=[640])
    p.add_argument("--standard", type=int, nargs="+", default=[1], help="1 = also run a whole-frame pass, 0 = tiles only")
    p.add_argument("--width", type=int, default=None, help="shrink every image to this width first (the demo clip is 1280 wide)")
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--weights", default=None)
    p.add_argument("--out", type=Path, default=SCRATCH_DIR / "tune_results.json")
    args = p.parse_args(argv)

    import cv2

    from . import detect

    weights = args.weights or detect.DEFAULT_WEIGHTS
    paths = sorted(args.images.glob("*.jpg"))
    images = [cv2.imread(str(x)) for x in paths]
    if args.width:
        images = [cv2.resize(im, (args.width, round(im.shape[0] * args.width / im.shape[1])), interpolation=cv2.INTER_AREA) for im in images]
    truths = [read_yolo_labels(args.labels / f"{x.stem}.txt", *im.shape[1::-1][:2]) for x, im in zip(paths, images)]
    idx_tune, idx_check = split_halves(list(range(len(paths))))
    rows = []
    for tile, overlap, imgsz, std in itertools.product(args.tiles, args.overlaps, args.imgszs, args.standard):
        per = [match(truths[i], detect.detect_people_sliced(images[i], weights, args.conf, tile, overlap, imgsz, bool(std)))
               for i in range(len(paths))]
        tune = total(per[i] for i in idx_tune)
        check = total(per[i] for i in idx_check)
        row = {"tile": tile, "overlap": overlap, "imgsz": imgsz, "standard_pass": bool(std),
               "tune": summarise(tune), "check": summarise(check)}
        rows.append(row)
        print(f"tile {tile:4d} overlap {overlap:.1f} imgsz {imgsz:4d} std {std}  "
              f"TUNE recall {tune.recall:4.0%} prec {tune.precision:4.0%} ({tune.found}/{tune.truth}, {tune.boxes} boxes)   "
              f"CHECK recall {check.recall:4.0%} prec {check.precision:4.0%} ({check.found}/{check.truth}, {check.boxes} boxes)", flush=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"weights": weights, "conf": args.conf, "rows": rows}, indent=1))
    best = pick_best(rows)
    print("BEST on the tuning half:", best if best else f"no row reaches precision {MIN_PRECISION:.0%}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
