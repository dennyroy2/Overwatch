"""
Search map for the PDF report: real Edmonton streets with the last-seen point, every
located piece of evidence, searched areas, and the areas Overwatch asked to search.

    from backend.report.map_figure import render_map_png
    png_bytes = render_map_png(report)      # None if nothing in the report has a location

Streets come from Akshat's data/graphs/edmonton_demo.graphml (parsed once per process,
then cached). Without it the map still draws, just without streets. Printed on paper,
so it uses a light style rather than the app's dark theme.
"""

from __future__ import annotations

import io
import math
import os
from functools import lru_cache

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.collections import LineCollection  # noqa: E402
from matplotlib.patches import Circle, Polygon  # noqa: E402

from contracts.models import Report

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GRAPH = os.path.join(REPO, "data", "graphs", "edmonton_demo.graphml")

INK, MUTED, STREET = "#202124", "#5f6368", "#d6d9de"
KIND_STYLE = {  # kind -> (label, colour, marker, size)
    "last_seen": ("Last seen", INK, "s", 90),
    "favourite_place": ("Familiar place", "#1a73e8", "D", 60),
    "sighting": ("Sighting", "#e37400", "o", 80),
    "clue": ("Clue (drone)", "#c5221f", "^", 90),
    "note": ("Note", MUTED, "o", 40),
    "constraint": ("Constraint", MUTED, "x", 50),
}


class _Proj:
    """lat/lon <-> local metres around a centre point."""

    def __init__(self, lat0: float, lon0: float):
        self.lat0, self.lon0 = lat0, lon0
        self.kx = 111_320.0 * math.cos(math.radians(lat0))
        self.ky = 111_320.0

    def xy(self, lat, lon):
        return (np.asarray(lon) - self.lon0) * self.kx, (np.asarray(lat) - self.lat0) * self.ky


@lru_cache(maxsize=1)
def _streets():
    """(lon, lat) start/end arrays of every street segment, or None if no graph."""
    if not os.path.exists(GRAPH):
        return None
    import networkx as nx

    g = nx.read_graphml(GRAPH)
    pos = {n: (float(d["x"]), float(d["y"])) for n, d in g.nodes(data=True)}
    seg = np.array([(*pos[u], *pos[v]) for u, v in g.edges() if u in pos and v in pos])
    return seg if len(seg) else None


def _points(report: Report):
    pts = []  # (kind, lat, lon)
    if report.case.last_seen:
        pts.append(("last_seen", report.case.last_seen.lat, report.case.last_seen.lon))
    for e in report.evidence:
        if e.location and e.kind != "searched_area":
            pts.append((e.kind, e.location.lat, e.location.lon))
    return pts


def render_map_png(report: Report, width_in: float = 7.0, height_in: float = 4.6, dpi: int = 200):
    pts = _points(report)
    searched = [e for e in report.evidence if e.kind == "searched_area" and e.location]
    areas = [r for r in report.requests if r.target_area]
    lats = [p[1] for p in pts] + [e.location.lat for e in searched] + \
           [g.lat for r in areas for g in r.target_area]
    lons = [p[2] for p in pts] + [e.location.lon for e in searched] + \
           [g.lon for r in areas for g in r.target_area]
    if not lats:
        return None

    proj = _Proj((min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2)
    xs, ys = proj.xy(lats, lons)
    pad = 400.0
    x0, x1 = float(np.min(xs)) - pad, float(np.max(xs)) + pad
    y0, y1 = float(np.min(ys)) - pad, float(np.max(ys)) + pad
    # match the figure's aspect ratio so streets aren't stretched
    want = width_in / height_in
    w, h = x1 - x0, y1 - y0
    if w / h < want:
        extra = (h * want - w) / 2
        x0, x1 = x0 - extra, x1 + extra
    else:
        extra = (w / want - h) / 2
        y0, y1 = y0 - extra, y1 + extra

    fig, ax = plt.subplots(figsize=(width_in, height_in), dpi=dpi)
    ax.set_facecolor("white")

    seg = _streets()
    if seg is not None:
        ax_, ay_ = proj.xy(seg[:, 1], seg[:, 0])
        bx_, by_ = proj.xy(seg[:, 3], seg[:, 2])
        keep = ((np.minimum(ax_, bx_) < x1) & (np.maximum(ax_, bx_) > x0) &
                (np.minimum(ay_, by_) < y1) & (np.maximum(ay_, by_) > y0))
        lines = np.stack([np.stack([ax_[keep], ay_[keep]], 1), np.stack([bx_[keep], by_[keep]], 1)], 1)
        ax.add_collection(LineCollection(lines, colors=STREET, linewidths=0.6, zorder=1))

    # areas Overwatch asked to search
    for r in areas:
        px, py = proj.xy([g.lat for g in r.target_area], [g.lon for g in r.target_area])
        approved = r.status == "approved"
        ax.add_patch(Polygon(np.column_stack([px, py]), closed=True, zorder=2,
                             facecolor="#f29900" if approved else "none", alpha=0.25 if approved else 1,
                             edgecolor="#f29900", linewidth=1.4, linestyle="-" if approved else "--"))
        ax.text(float(np.mean(px)), float(np.max(py)) + 40, f"{r.asset} ({r.status})", fontsize=6.5,
                ha="center", va="bottom", color="#b06000", zorder=6,
                bbox=dict(boxstyle="round,pad=0.15", facecolor="white", edgecolor="none", alpha=0.8))

    # searched areas
    for e in searched:
        cx, cy = proj.xy(e.location.lat, e.location.lon)
        ax.add_patch(Circle((float(cx), float(cy)), e.radius_m or 200, facecolor=MUTED, alpha=0.18,
                            edgecolor=MUTED, linewidth=1, zorder=2))

    # evidence points
    seen = set()
    for kind, lat, lon in pts:
        label, color, marker, size = KIND_STYLE.get(kind, (kind, MUTED, "o", 40))
        x, y = proj.xy(lat, lon)
        ax.scatter([x], [y], s=size, c=color, marker=marker, edgecolors="white", linewidths=1.2,
                   zorder=5, label=None if label in seen else label)
        seen.add(label)

    # legend extras
    if searched:
        ax.scatter([], [], s=120, c=MUTED, alpha=0.3, marker="o", label="Searched area")
    if areas:
        ax.plot([], [], color="#f29900", ls="--", label="Requested search area")

    ax.set_xlim(x0, x1)
    ax.set_ylim(y0, y1)
    ax.set_aspect("equal")
    ax.set_xticks([])
    ax.set_yticks([])
    for sp in ax.spines.values():
        sp.set_color("#dadce0")

    # scale bar + north arrow
    span = x1 - x0
    bar = 1000 if span > 4000 else 500 if span > 1800 else 200
    sx, sy = x0 + 0.04 * span, y0 + 0.05 * (y1 - y0)
    ax.plot([sx, sx + bar], [sy, sy], color=INK, lw=2.5, zorder=7)
    ax.text(sx + bar / 2, sy + 0.025 * (y1 - y0), f"{bar} m" if bar < 1000 else "1 km",
            ha="center", fontsize=7, color=INK, zorder=7)
    nx_, ny_ = x1 - 0.04 * span, y1 - 0.12 * (y1 - y0)
    ax.annotate("N", xy=(nx_, ny_ + 0.08 * (y1 - y0)), xytext=(nx_, ny_), ha="center", fontsize=8,
                color=INK, arrowprops=dict(arrowstyle="-|>", color=INK, lw=1.2), zorder=7)

    ax.legend(loc="upper left", fontsize=6.5, frameon=True, framealpha=0.9, edgecolor="#dadce0",
              scatterpoints=1)
    ax.text(x1 - 0.01 * span, y0 + 0.015 * (y1 - y0), "Streets © OpenStreetMap contributors",
            fontsize=5.5, color=MUTED, ha="right", zorder=7)
    fig.tight_layout(pad=0.2)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor="white")
    plt.close(fig)
    return buf.getvalue()
