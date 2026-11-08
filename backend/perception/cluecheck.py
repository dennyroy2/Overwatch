"""Step 30: measure the clothing score on the labelled frames and choose the threshold.

Every labelled person is scored against the subject's clothing. The subject (from the scenario file's
`subject_box_xywh_norm`) is the positive; every other labelled person is a negative, including a near lookalike
in a light-grey hoodie. Then the threshold is swept and the best F1 chosen (the 'balanced' policy agreed with Denny).

    .venv/bin/python -m backend.perception.cluecheck --images <dir> --labels <dir> \\
        --scenario scenario/margaret_drone2.json --profile scenario/margaret.json --width 1280
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .clothing import ClueScorer, colour_of, combine
from .evaluate import read_yolo_labels


def f1_sweep(pos: list[float], neg: list[float], steps: int = 101) -> list[dict]:
    """Precision, recall and F1 of 'score >= t' for t from 0 to 1."""
    out = []
    for i in range(steps):
        t = i / (steps - 1)
        tp = sum(s >= t for s in pos)
        fp = sum(s >= t for s in neg)
        p = tp / (tp + fp) if tp + fp else 1.0
        r = tp / len(pos) if pos else 0.0
        out.append({"t": round(t, 2), "precision": round(p, 3), "recall": round(r, 3), "f1": round(2 * p * r / (p + r), 3) if p + r else 0.0})
    return out


def best_f1(pos: list[float], neg: list[float]) -> dict:
    """The sweep row with the best F1. When many thresholds tie (a clean gap between the two groups) the MIDDLE of
    the tied range is taken, so the choice sits in the gap instead of on the edge of one group."""
    rows = f1_sweep(pos, neg)
    top = max(r["f1"] for r in rows)
    tied = [r for r in rows if r["f1"] == top]
    return tied[len(tied) // 2]


def recolour(image, box, colour_bgr_hsv: tuple[int, int]):
    """A copy of `image` where the grey/white clothing pixels of the person in `box` are repainted with the given
    (hue, saturation) and keep their own brightness, so shading survives. Used only to test the colour logic on a
    realistic frame ('the same person in a blue jacket')."""
    import cv2

    from .clothing import colour_mask, foreground_mask

    mask, pixels = foreground_mask(image, box)
    hsv = cv2.cvtColor(pixels, cv2.COLOR_BGR2HSV)
    neutral = (colour_mask(hsv, "grey") | colour_mask(hsv, "white")) & mask
    hsv[neutral, 0], hsv[neutral, 1] = colour_bgr_hsv
    out = image.copy()
    x1, y1 = max(0, int(box.x1)), max(0, int(box.y1))
    out[y1:y1 + pixels.shape[0], x1:x1 + pixels.shape[1]] = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="backend.perception.cluecheck", description=__doc__)
    p.add_argument("--images", type=Path, required=True)
    p.add_argument("--labels", type=Path, required=True)
    p.add_argument("--scenario", type=Path, required=True, help="has `frames[].subject_box_xywh_norm`")
    p.add_argument("--profile", type=Path, required=True, help="scenario/margaret.json (its case.clothing is scored)")
    p.add_argument("--width", type=int, default=1280)
    p.add_argument("--cache", type=Path, default=None)
    args = p.parse_args(argv)

    import cv2

    clothing = json.loads(args.profile.read_text())["case"]["clothing"]
    frames = json.loads(args.scenario.read_text())["frames"]
    scorer = ClueScorer(clothing)
    rows = []
    for k, ip in enumerate(sorted(args.images.glob("*.jpg"))):
        im = cv2.imread(str(ip))
        im = cv2.resize(im, (args.width, round(im.shape[0] * args.width / im.shape[1])), interpolation=cv2.INTER_AREA)
        h, w = im.shape[:2]
        sb = frames[k]["subject_box_xywh_norm"]
        for g in read_yolo_labels(args.labels / f"{ip.stem}.txt", w, h):
            subject = bool(sb) and abs((g.x1 + g.x2) / 2 / w - sb[0]) < 0.01 and abs((g.y1 + g.y2) / 2 / h - sb[1]) < 0.01
            cs = scorer.score(im, g)
            rows.append({"frame": k, "subject": subject, "items": [(i.phrase, i.world, i.colour) for i in cs.items],
                         "generic": [(i.phrase, i.world) for i in cs.generic]})
    if args.cache:
        args.cache.write_text(json.dumps(rows))
    pos = [r for r in rows if r["subject"]]
    neg = [r for r in rows if not r["subject"]]
    print(f"{len(pos)} subject boxes, {len(neg)} other people; clothing scored: {clothing}")
    for i, phrase in enumerate(clothing):
        w_pos = [r["items"][i][1] for r in pos]
        w_neg = [r["items"][i][1] for r in neg]
        print(f"  model score  {phrase[:42]:42s} subject {min(w_pos):.3f}..{max(w_pos):.3f}   others max {max(w_neg):.3f}   colour word: {colour_of(phrase)}")

    def person(r, world_only=False, colour_only=False):
        s = []
        for phrase, wd, col in r["items"]:
            if colour_only:
                s.append(min(1.0, (col or 0) / 0.12) if col is not None else 0.0)
            elif world_only:
                s.append(combine(wd, None))
            else:
                s.append(combine(wd, col))
        return max(s)

    print("\ncheck                best threshold  precision  recall  F1")
    for name, kw in (("model only", {"world_only": True}), ("colour only", {"colour_only": True}), ("combined", {})):
        b = best_f1([person(r, **kw) for r in pos], [person(r, **kw) for r in neg])
        print(f"{name:20s} {b['t']:>9.2f}  {b['precision']:>10.2f}  {b['recall']:>6.2f}  {b['f1']:.2f}")
    recolour_test(args, frames)
    comb_pos = [person(r) for r in pos]
    comb_neg = [person(r) for r in neg]
    print(f"\ncombined score: subject {min(comb_pos):.2f}..{max(comb_pos):.2f} (median {sorted(comb_pos)[len(comb_pos)//2]:.2f}); "
          f"others {min(comb_neg):.2f}..{max(comb_neg):.2f}; highest other = {max(comb_neg):.2f}")
    return 0


def recolour_test(args, frames) -> None:
    """The roadmap's check: a blue-jacket frame scores high for a 'blue puffer jacket' profile; a red-jacket frame, the
    untouched grey frame and a patch of empty ground score low."""
    import cv2

    scorer = ClueScorer(["blue puffer jacket"])
    sample = [k for k, f in enumerate(frames) if f["subject_visible"]][3::6][:3]
    names = sorted(args.images.glob("*.jpg"))
    print("\nblue puffer jacket profile, same person recoloured (score 0-1):")
    print("frame   blue jacket   red jacket   original grey   empty ground")
    for k in sample:
        im = cv2.imread(str(names[k]))
        im = cv2.resize(im, (args.width, round(im.shape[0] * args.width / im.shape[1])), interpolation=cv2.INTER_AREA)
        h, w = im.shape[:2]
        x, y, bw, bh = frames[k]["subject_box_xywh_norm"]
        from .detect import Detection

        box = Detection((x - bw / 2) * w, (y - bh / 2) * h, (x + bw / 2) * w, (y + bh / 2) * h, 1.0)
        empty = Detection(w * 0.5, h * 0.55, w * 0.5 + box.width, h * 0.55 + box.height, 1.0)   # open ground, no one there
        s = lambda image, b: scorer.score(image, b).person
        print(f"{k:5d}   {s(recolour(im, box, (110, 170)), box):11.2f}   {s(recolour(im, box, (0, 190)), box):10.2f}   "
              f"{s(im, box):13.2f}   {s(im, empty):12.2f}")


if __name__ == "__main__":
    raise SystemExit(main())
