"""
Pitch kit from the latest benchmark run.

Reads benchmark/results/{results.csv, summary.json} (written by run_benchmark.py) and makes:
  results/pitch_chart.png      16:9 slide: % found vs area searched, Overwatch vs standard search
  results/pitch_tip_chart.png  16:9 slide: the value of one witness tip
  results/how_we_tested.md     "How we tested it" text for the submission, numbers filled in

Run (after run_benchmark.py):
  python benchmark/pitch_assets.py
  python benchmark/pitch_assets.py --combine benchmark/results/seed1 benchmark/results/seed2
      -> merges both case sets into benchmark/results/final/ (pitch uses this)

Styled to frontend/DESIGN.md ("The Watch Floor"): IBM Plex Sans + Plex Mono (benchmark/fonts/,
converted from the app's @fontsource files, SIL Open Font License), dark ground, panel cards with
hairline borders, amber only for Overwatch's probability figure, numbers in mono. If the run used a
placeholder engine (StubEngine or the local stand-in), each chart carries a red
"PLACEHOLDER ENGINE · NOT FOR PITCH" chip so stub numbers never reach a slide.
"""

from __future__ import annotations

import argparse
import csv
import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.font_manager import FontProperties  # noqa: E402
from matplotlib.patches import FancyBboxPatch  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "fonts")

# Design tokens: frontend/DESIGN.md ("The Watch Floor")
T = {
    "ground": "#06080b", "panel": "#0c1015", "raised": "#121820", "control": "#1a222d",
    "line": "#232c39", "line_strong": "#3a4757",
    "ink": "#e9edf2", "ink2": "#a8b2bf", "ink3": "#8592a2",
    "amber": "#ffb224", "amber_dim": "#7a5410", "danger": "#ff6459",
}


def _font(name, fallback_family):
    path = os.path.join(FONTS, name)
    if os.path.exists(path):
        return FontProperties(fname=path)
    return FontProperties(family=fallback_family)


SANS = {w: _font(f"ibm-plex-sans-{w}.ttf", "sans-serif") for w in (400, 500, 600)}
MONO = {w: _font(f"ibm-plex-mono-{w}.ttf", "monospace") for w in (400, 500)}

W, H = 16, 9          # inches; saved at 120 dpi -> 1920 x 1080
PX = 1 / (W * 120)    # one pixel in figure-width units


def text(fig, x, y, s, size, font, color, **kw):
    return fig.text(x, y, s, fontproperties=font, fontsize=size, color=color, **kw)


def card(fig, x, y, w, h):
    """Panel surface with a hairline border and 4px radius, like the app's cards."""
    fig.patches.append(FancyBboxPatch(
        (x, y), w, h, boxstyle=f"round,pad=0,rounding_size={4 * PX}", transform=fig.transFigure,
        facecolor=T["panel"], edgecolor=T["line"], linewidth=1.0, zorder=-10))


def style_axes(ax):
    ax.set_facecolor(T["panel"])
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(T["line_strong"])
        ax.spines[side].set_linewidth(1.0)
    ax.tick_params(colors=T["ink3"], length=0, pad=8)
    for lbl in ax.get_xticklabels() + ax.get_yticklabels():
        lbl.set_fontproperties(MONO[400])
        lbl.set_fontsize(12)
    ax.grid(color=T["line"], linewidth=0.8)
    ax.set_axisbelow(True)


def load(results_dir):
    with open(os.path.join(results_dir, "summary.json")) as f:
        summary = json.load(f)
    rows = []
    with open(os.path.join(results_dir, "results.csv"), newline="") as f:
        for r in csv.DictReader(f):
            r["area_km2"] = float(r["area_km2"]) if r["area_km2"] not in ("", "None") else None
            r["has_sighting"] = r["has_sighting"] == "True"
            rows.append(r)
    return summary, rows


def combine(dirs: list[str], out_dir: str):
    """Merge several benchmark runs (e.g. --seed 1 and --seed 2) into one summary + CSV,
    recomputed from the raw rows, and remember each run's own headline numbers."""
    import sys
    sys.path.insert(0, HERE)
    from run_benchmark import summarize, tip_value

    rows, sets = [], []
    first_settings = None
    for d in dirs:
        summ, r = load(d)
        first_settings = first_settings or summ.get("settings", {})
        rows += r
        ow, sd = summ["overwatch"], summ["standard_search"]
        sets.append({
            "name": os.path.basename(os.path.normpath(d)),
            "cases": summ.get("settings", {}).get("cases"),
            "engine": summ.get("settings", {}).get("engine"),
            "overwatch_median_km2": ow.get("median_area_km2"),
            "standard_median_km2": sd.get("median_area_km2"),
            "area_reduction": (round(1 - ow["median_area_km2"] / sd["median_area_km2"], 3)
                               if ow.get("median_area_km2") and sd.get("median_area_km2") else None),
            "overwatch_found_within_1km2": ow.get("found_within_1km2"),
            "standard_found_within_1km2": sd.get("found_within_1km2"),
            "tip_area_reduction": (summ.get("tip_value") or {}).get("area_reduction_from_tip"),
        })
    engines = {x["engine"] for x in sets}
    if len(engines) > 1:
        raise SystemExit(f"Runs used different engines {engines}; re-run them on the same engine.")
    summary = summarize(rows, ["overwatch", "standard_search"])
    tv = tip_value(rows)
    if tv:
        summary["tip_value"] = tv
    summary["settings"] = dict(first_settings, cases=sum(x["cases"] or 0 for x in sets))
    summary["sets"] = sets

    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    with open(os.path.join(out_dir, "results.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    return summary, rows


def per_set_text(summary, key):
    """'36% and 28%' for each case set, or None for a single run."""
    vals = [x.get(key) for x in summary.get("sets", []) if x.get(key) is not None]
    return " and ".join(f"{v:.0%}" for v in vals) if len(vals) > 1 else None


def is_placeholder(summary) -> bool:
    eng = str(summary.get("settings", {}).get("engine", ""))
    return "StubEngine" in eng or "local" in eng


def header(fig, summary, eyebrow, title, subtitle):
    st = summary.get("settings", {})
    text(fig, 0.05, 0.915, eyebrow.upper(), 12, MONO[500], T["ink3"])
    text(fig, 0.05, 0.855, title, 30, SANS[600], T["ink"])
    text(fig, 0.05, 0.815, subtitle, 15, SANS[400], T["ink2"])
    if is_placeholder(summary):
        x, y, w, h = 0.70, 0.900, 0.25, 0.042
        fig.patches.append(FancyBboxPatch(
            (x, y), w, h, boxstyle=f"round,pad=0,rounding_size={4 * PX}", transform=fig.transFigure,
            facecolor=T["ground"], edgecolor=T["danger"], linewidth=1.2))
        text(fig, x + w / 2, y + h / 2, "PLACEHOLDER ENGINE · NOT FOR PITCH", 11, MONO[500],
             T["danger"], ha="center", va="center")
    graph = str(st.get("graph", "")).replace("\\", "/").split("/")[-1]
    engine = str(st.get("engine", "?"))
    engine = engine[engine.find("(") + 1:engine.rfind(")")] if "(" in engine else engine
    n_sets = len(summary.get("sets", [])) or 1
    cases_txt = (f"{st.get('cases', '?')} cases in {n_sets} independent sets" if n_sets > 1
                 else f"{st.get('cases', '?')} cases")
    text(fig, 0.05, 0.045,
         f"SIMULATION, NOT REAL INCIDENTS   ·   {cases_txt}   ·   {graph}   ·   "
         f"{st.get('familiar_places', '?')} real places   ·   detection {st.get('pod', '?')} per pass   ·   "
         f"engine {engine}", 10, MONO[400], T["ink3"])


def readout(fig, x, y, label, value, value_color, note=None):
    """A stacked label + figure, like the expected-gain readout on a tasking card."""
    text(fig, x, y, label, 13, SANS[500], T["ink3"])
    text(fig, x, y - 0.075, value, 40, MONO[500], value_color)
    if note:
        text(fig, x, y - 0.115, note, 12, MONO[400], T["ink3"])


def rule(fig, x, y, w):
    fig.lines.append(plt.Line2D([x, x + w], [y, y], transform=fig.transFigure, color=T["line"], lw=1))


def pct_found_curve(rows, strategy, xs):
    vals = [r["area_km2"] for r in rows if r["strategy"] == strategy]
    n = len(vals) or 1
    return [100 * sum(v is not None and v <= x for v in vals) / n for x in xs]


def pitch_chart(summary, rows, path):
    ow, sd = summary["overwatch"], summary["standard_search"]
    xmax = 5.0
    xs = [i * 0.02 for i in range(0, int(xmax / 0.02) + 1)]
    fig = plt.figure(figsize=(W, H), dpi=120, facecolor=T["ground"])
    header(fig, summary, "Overwatch · benchmark",
           "People found, by area searched",
           "Same simulated cases and the same detection luck for both methods.")

    card(fig, 0.05, 0.12, 0.62, 0.65)
    ax = fig.add_axes([0.10, 0.20, 0.50, 0.52], zorder=5)
    y_sd = pct_found_curve(rows, "standard_search", xs)
    y_ow = pct_found_curve(rows, "overwatch", xs)
    ax.plot(xs, y_sd, color=T["ink3"], lw=2.0, solid_capstyle="butt")
    ax.plot(xs, y_ow, color=T["amber"], lw=3.0, solid_capstyle="butt")
    ax.set_xlim(0, xmax)
    ax.set_ylim(0, 100)
    ax.set_xticks([0, 1, 2, 3, 4, 5])
    ax.set_yticks([0, 25, 50, 75, 100])
    ax.set_yticklabels(["0%", "25%", "50%", "75%", "100%"])
    style_axes(ax)
    ax.set_xlabel("Area searched, km²", fontproperties=SANS[500], fontsize=13, color=T["ink3"], labelpad=10)
    # direct labels at the right end of each line (no legend box)
    ax.text(xmax * 0.985, y_ow[-1] + 3, "Overwatch", fontproperties=SANS[600], fontsize=14,
            color=T["amber"], ha="right", va="bottom")
    ax.text(xmax * 0.985, y_sd[-1] - 3, "Standard search", fontproperties=SANS[500], fontsize=14,
            color=T["ink2"], ha="right", va="top")
    ax.axvline(1.0, color=T["line_strong"], lw=1, ls=(0, (3, 3)))
    ax.text(1.04, 3, "1 km²", fontproperties=MONO[400], fontsize=11, color=T["ink3"])

    # right rail
    card(fig, 0.69, 0.12, 0.26, 0.65)
    rx = 0.715
    a, b = ow["found_within_1km2"], sd["found_within_1km2"]
    readout(fig, rx, 0.70, "Found within the first km²", f"{a:.0%}", T["amber"], f"standard search {b:.0%}")
    rule(fig, rx, 0.535, 0.21)
    ma, mb = ow.get("median_area_km2"), sd.get("median_area_km2")
    if ma and mb:
        readout(fig, rx, 0.49, "Median area to find", f"{ma:.2f} km²", T["ink"], f"standard search {mb:.2f} km²")
        rule(fig, rx, 0.325, 0.21)
        if ma < mb:
            per_set = per_set_text(summary, "area_reduction")
            readout(fig, rx, 0.28, "Less area searched", f"{1 - ma / mb:.0%}", T["ink"],
                    f"median case · per set {per_set}" if per_set else "median case")
    fig.savefig(path, facecolor=T["ground"])
    plt.close(fig)


def tip_chart(summary, path):
    tv = summary.get("tip_value")
    if not tv:
        return False
    a, b = tv["found_within_1km2_with_tip"], tv["found_within_1km2_without_tip"]
    fig = plt.figure(figsize=(W, H), dpi=120, facecolor=T["ground"])
    header(fig, summary, "Overwatch · benchmark",
           "What one witness tip is worth",
           "The same cases, searched by Overwatch with and without the witness sighting.")

    card(fig, 0.05, 0.12, 0.62, 0.65)
    ax = fig.add_axes([0.23, 0.30, 0.38, 0.32], zorder=5)
    labels = ["Without the tip", "With the tip"]
    vals = [b * 100, a * 100]
    ax.barh([1, 0], vals, height=0.42, color=[T["ink3"], T["amber"]])
    ax.set_yticks([1, 0])
    ax.set_yticklabels(labels)
    ax.set_xlim(0, 100)
    ax.set_xticks([0, 25, 50, 75, 100])
    ax.set_xticklabels(["0%", "25%", "50%", "75%", "100%"])
    style_axes(ax)
    ax.grid(axis="y", visible=False)
    for lbl in ax.get_yticklabels():
        lbl.set_fontproperties(SANS[500])
        lbl.set_fontsize(15)
        lbl.set_color(T["ink2"])
    for yv, v, c in ((1, vals[0], T["ink2"]), (0, vals[1], T["amber"])):
        ax.text(v + 1.5, yv, f"{v:.0f}%", fontproperties=MONO[500], fontsize=18, color=c, va="center")
    ax.set_xlabel("Found within the first km² searched", fontproperties=SANS[500], fontsize=13,
                  color=T["ink3"], labelpad=10)

    card(fig, 0.69, 0.12, 0.26, 0.65)
    rx = 0.715
    red = tv.get("area_reduction_from_tip")
    if red is not None:
        per_set = per_set_text(summary, "tip_area_reduction")
        readout(fig, rx, 0.70, "Smaller search with the tip", f"{red:.0%}", T["amber"],
                f"median area · per set {per_set}" if per_set else "median area to find")
        rule(fig, rx, 0.535, 0.21)
    ma, mb = tv["median_area_km2_with_tip"], tv["median_area_km2_without_tip"]
    if ma and mb:
        readout(fig, rx, 0.49, "Median area to find", f"{ma:.2f} km²", T["ink"], f"without the tip {mb:.2f} km²")
        rule(fig, rx, 0.325, 0.21)
    readout(fig, rx, 0.28, "Cases with a tip", f"{tv['cases_with_tip']}", T["ink"])
    fig.savefig(path, facecolor=T["ground"])
    plt.close(fig)
    return True


def how_we_tested(summary) -> str:
    st, ow, sd = summary.get("settings", {}), summary["overwatch"], summary["standard_search"]
    tv = summary.get("tip_value") or {}
    warn = ("> ⚠️ These numbers come from a PLACEHOLDER engine. Re-run on the real engine before "
            "submitting.\n\n" if is_placeholder(summary) else "")
    lines = [
        "# How we tested it", "", warn +
        f"We built a benchmark that runs {st.get('cases', '?')} simulated missing-person cases"
        + (f" (two independent sets of {summary['sets'][0]['cases']})" if len(summary.get("sets", [])) > 1 else "")
        + " on the "
        f"real Edmonton walking network (OpenStreetMap, downtown and the river valley) with "
        f"{st.get('familiar_places', '?')} real cafés, parks and places of worship as familiar places. "
        "In each case a simulated person (80% with dementia) leaves a last-seen point and walks for 1 to 3 "
        "hours: slowly, tending to keep going straight, drawn toward familiar places, with pauses. "
        "Their true path is hidden from the search, and its walking behaviour is randomly varied, so "
        "the engine never gets the exact answer for free. About 60% of cases include a noisy "
        "witness sighting partway through.",
        "",
        "We compare two ways of searching the same 100 m cells with the same detection luck: "
        "standard practice (check each familiar place, then an expanding ring from the latest "
        "known location) and searching where Overwatch's ghosts say the person most likely is. "
        f"Each pass over the right cell finds the person {st.get('pod', 0.8):.0%} of the time, and "
        "a missed person can be found on a later pass.",
        "",
        f"**Result:** Overwatch found {ow['found_within_1km2']:.0%} of people within the first km² "
        f"searched, vs {sd['found_within_1km2']:.0%} for standard search"
        + (f". The median case needed {ow['median_area_km2']:g} km² vs {sd['median_area_km2']:g} km², "
           f"{1 - ow['median_area_km2'] / sd['median_area_km2']:.0%} less area"
           if ow.get("median_area_km2") and sd.get("median_area_km2") else "")
        + (f" ({per_set_text(summary, 'area_reduction')} in the two sets measured separately)."
           if per_set_text(summary, "area_reduction") else "."),
    ]
    if tv.get("area_reduction_from_tip") is not None:
        tip_sets = per_set_text(summary, "tip_area_reduction")
        lines += ["", f"**Value of a tip:** in the {tv['cases_with_tip']} cases with a witness "
                      f"sighting, entering it shrank the median area Overwatch needed by "
                      f"{tv['area_reduction_from_tip']:.0%}"
                      + (f" ({tip_sets} in the two sets separately)." if tip_sets else ".")]
    lines += ["", "This is a simulation, not data from real incidents. The code is in `benchmark/` "
                  "and reruns with one command: `python benchmark/run_benchmark.py`."]
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default=os.path.join(HERE, "results"),
                    help="one benchmark run folder (default benchmark/results)")
    ap.add_argument("--combine", nargs="+", metavar="DIR",
                    help="merge several runs, e.g. --combine benchmark/results/seed1 benchmark/results/seed2")
    ap.add_argument("--out", default=os.path.join(HERE, "results", "final"),
                    help="where combined outputs go (with --combine)")
    args = ap.parse_args()
    if args.combine:
        summary, rows = combine(args.combine, args.out)
        args.results = args.out
    else:
        summary, rows = load(args.results)
    pitch_chart(summary, rows, os.path.join(args.results, "pitch_chart.png"))
    made_tip = tip_chart(summary, os.path.join(args.results, "pitch_tip_chart.png"))
    text = how_we_tested(summary)
    with open(os.path.join(args.results, "how_we_tested.md"), "w", encoding="utf-8") as f:
        f.write(text)
    print("Wrote pitch_chart.png" + (", pitch_tip_chart.png" if made_tip else "") +
          f", how_we_tested.md ({len(text)} chars) to {args.results}")
    if is_placeholder(summary):
        print("WARNING: placeholder engine. Charts are stamped NOT FOR PITCH.")


if __name__ == "__main__":
    main()
