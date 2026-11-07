"""
Overwatch benchmark: does searching where Overwatch points find people with
less searching than the standard expanding-ring search?

For each simulated case (see cases.py):
  - Overwatch:      ask the engine for ghost positions at search start, then search
                    100 m cells in order of ghost weight (most likely first).
  - Standard search: quick checks of each familiar place first, then cells in order
                    of distance from the latest known location (the sighting if there is
                    one, else last seen). This is what a search manager does without Overwatch.
Both use the same probability of detection per pass and the same detection luck.

Metric: area searched (km^2) before the person is found. Also converted to
search-team hours with a stated coverage rate. Clearly labelled as simulation.

Run:
  python benchmark/run_benchmark.py                       # synthetic graph, 200 cases
  python benchmark/run_benchmark.py --graph data/edmonton.graphml --cases 200
Outputs in benchmark/results/: results.csv, summary.json, chart.png
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))                   # benchmark/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # repo root

import engine_adapter                                    # noqa: E402
from cases import make_case                              # noqa: E402
from contracts_compat import USING_REAL_CONTRACTS        # noqa: E402
from graph import load_graph, to_xy                      # noqa: E402

CELL_M = 100.0                # search cell size
POD = 0.8                     # chance one pass over the right cell spots them (urban, daylight)
MAX_AREA_KM2 = 20.0           # give up after this much searching (incl. repeat passes)
TEAM_KM2_PER_HOUR = 0.5       # stated coverage rate for converting area -> team-hours
CELL_KM2 = (CELL_M / 1000) ** 2


def cell_of(x: float, y: float) -> tuple[int, int]:
    return (math.floor(x / CELL_M), math.floor(y / CELL_M))


def all_cells(graph) -> list[tuple[int, int]]:
    """Every 100 m cell in the graph's bounding box (people can be between nodes)."""
    xs = [x for x, _ in graph.xy]
    ys = [y for _, y in graph.xy]
    (x0, y0), (x1, y1) = cell_of(min(xs), min(ys)), cell_of(max(xs), max(ys))
    return [(i, j) for i in range(x0, x1 + 1) for j in range(y0, y1 + 1)]


def ring_order(cells, cx: float, cy: float):
    return sorted(cells, key=lambda c: math.hypot((c[0] + 0.5) * CELL_M - cx, (c[1] + 0.5) * CELL_M - cy))


def overwatch_order(cells, ghosts):
    mass: dict[tuple[int, int], float] = {}
    sx = sy = 0.0
    for lon, lat, w in ghosts:
        x, y = to_xy(lat, lon)
        c = cell_of(x, y)
        mass[c] = mass.get(c, 0.0) + w
        sx, sy = sx + w * x, sy + w * y
    hot = sorted(mass, key=mass.get, reverse=True)
    hot_set = set(hot)
    rest = [c for c in ring_order(cells, sx, sy) if c not in hot_set]  # then spread out from centroid
    return hot + rest


def area_to_find(order, target_cell, detect_rolls) -> float | None:
    """km^2 searched until found. Repeats passes over the same order if missed."""
    try:
        idx = order.index(target_cell)
    except ValueError:
        return None
    for k, u in enumerate(detect_rolls):
        searched = (k * len(order) + idx + 1) * CELL_KM2
        if searched > MAX_AREA_KM2:
            return None
        if u < POD:
            return round(searched, 3)
    return None


def standard_order(cells, case):
    """What a search manager does without Overwatch: quick checks of each familiar
    place (~150 m around it), then an expanding ring from the latest known location."""
    first = []
    for e in case.evidence:
        if e.kind == "favourite_place" and e.location:
            fx, fy = to_xy(e.location.lat, e.location.lon)
            for c in ring_order(cells, fx, fy):
                if math.hypot((c[0] + 0.5) * CELL_M - fx, (c[1] + 0.5) * CELL_M - fy) > 150:
                    break
                if c not in first:
                    first.append(c)
    seen = set(first)
    return first + [c for c in ring_order(cells, *latest_known_xy(case)) if c not in seen]


def latest_known_xy(case):
    located = [e for e in case.evidence if e.kind in ("last_seen", "sighting") and e.location]
    e = max(located, key=lambda e: e.time)
    return to_xy(e.location.lat, e.location.lon)


def summarize(rows, strategies):
    out = {}
    for s in strategies:
        vals = [r["area_km2"] for r in rows if r["strategy"] == s]
        found = sorted(v for v in vals if v is not None)
        n = len(vals)
        med = found[(n + 1) // 2 - 1] if len(found) >= (n + 1) // 2 else None  # counts unfound cases
        out[s] = {
            "found_rate": round(len(found) / n, 3),
            "found_within_1km2": round(sum(v <= 1 for v in found) / n, 3),
            "found_within_3km2": round(sum(v <= 3 for v in found) / n, 3),
            "median_area_km2": med,
            "median_team_hours": round(med / TEAM_KM2_PER_HOUR, 1) if med else None,
        }
    a, b = out["overwatch"]["median_area_km2"], out["standard_search"]["median_area_km2"]
    if a and b:
        out["area_reduction"] = f"{(1 - a / b):.0%} less area searched (median)"
    return out


def make_chart(rows, path, n_cases):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    style = {"standard_search": ("Standard search (familiar places, then expanding ring)", "#80868b", 2),
             "overwatch": ("Overwatch", "#f29900", 3)}
    xs = [i * 0.05 for i in range(int(MAX_AREA_KM2 / 2 / 0.05) + 1)]
    fig, ax = plt.subplots(figsize=(8, 4.5), dpi=150)
    for s, (label, color, lw) in style.items():
        vals = [r["area_km2"] for r in rows if r["strategy"] == s]
        ys = [100 * sum(v is not None and v <= x for v in vals) / len(vals) for x in xs]
        ax.plot(xs, ys, label=label, color=color, linewidth=lw)
    ax.set_xlabel(f"Area searched (km²)   ·   1 team ≈ {TEAM_KM2_PER_HOUR} km² per hour")
    ax.set_ylabel("% of missing people found")
    ax.set_title(f"Simulated Edmonton cases (n={n_cases}) — simulation, not real incidents", fontsize=10)
    ax.set_ylim(0, 100)
    ax.set_xlim(0, xs[-1])
    ax.grid(alpha=0.3)
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend(frameon=False, loc="lower right")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", type=int, default=200)
    ap.add_argument("--ghosts", type=int, default=1000)
    ap.add_argument("--graph", default=None, help="GraphML from data/ (default: synthetic grid)")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "results"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    graph = load_graph(args.graph)
    cells = all_cells(graph)
    print(f"graph: {graph.n} nodes, {len(cells)} cells | real contracts: {USING_REAL_CONTRACTS} | "
          f"real engine: {engine_adapter.USING_REAL_ENGINE}")

    rows, start = [], time.time()
    for i in range(args.cases):
        seed = args.seed * 100_000 + i
        case = make_case(graph, seed)
        target = cell_of(*case.true_xy)
        rolls = [random.Random(seed + 7).random() for _ in range(1)] + \
                [random.Random(seed * 31 + k).random() for k in range(1, 20)]

        ghosts = engine_adapter.predict_ghosts(graph, case.profile, case.evidence,
                                               case.report_delay_s, args.ghosts, seed)
        orders = {
            "overwatch": overwatch_order(cells, ghosts),
            "standard_search": standard_order(cells, case),
        }
        has_sighting = any(e.kind == "sighting" for e in case.evidence)
        for s, order in orders.items():
            rows.append({"case": case.case_id, "strategy": s, "condition": case.profile.condition,
                         "mobility": case.profile.mobility, "has_sighting": has_sighting,
                         "report_delay_min": round(case.report_delay_s / 60),
                         "area_km2": area_to_find(order, target, rolls)})
        if (i + 1) % 20 == 0:
            print(f"  {i + 1}/{args.cases} cases  ({time.time() - start:.0f}s)")

    with open(os.path.join(args.out, "results.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    summary = summarize(rows, ["overwatch", "standard_search"])
    summary["settings"] = {"cases": args.cases, "ghosts": args.ghosts, "cell_m": CELL_M, "pod": POD,
                           "team_km2_per_hour": TEAM_KM2_PER_HOUR, "graph": args.graph or "synthetic",
                           "real_engine": engine_adapter.USING_REAL_ENGINE,
                           "note": "Simulation only. Not data from real incidents."}
    with open(os.path.join(args.out, "summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    make_chart(rows, os.path.join(args.out, "chart.png"), args.cases)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
