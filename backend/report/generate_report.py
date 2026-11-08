"""
Overwatch search report: turns the API's `Report` object into a PDF.

The record a police service needs after a search (after-action review, coroner,
court): the subject, every piece of evidence, every tasking request with the
officer's decision, and the full timestamped activity log.

Use from Python (e.g. a future /report/{case_id}/pdf endpoint):
    from backend.report.generate_report import build_pdf
    pdf_bytes = build_pdf(report)               # report: contracts.models.Report

Use from the terminal (run from the repo root):
    python -m backend.report.generate_report --sample -o report.pdf
    python -m backend.report.generate_report --json some_report.json -o report.pdf
    python -m backend.report.generate_report --case-id case_ab12 -o report.pdf   # live server on :8000

Drone crops: evidence with media_url "/crops/<file>.jpg" is shown from frontend/public/crops/
(also accepts http(s) URLs and data: URLs). Missing images are skipped, never an error.
    ... add --chart benchmark/results/chart.png to include the benchmark chart

Needs: pip install reportlab
Reads contracts only. Never imports engine/api internals.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import urllib.request
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer,
                                Table, TableStyle)

from contracts.models import Evidence, LogEntry, Report, TaskingRequest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
PUBLIC = os.path.join(REPO, "frontend", "public")   # where the app serves /crops/... from
SAMPLE = os.path.join(HERE, "sample_report.json")

AMBER = colors.HexColor("#f29900")
INK = colors.HexColor("#202124")
MUTED = colors.HexColor("#5f6368")
RULE = colors.HexColor("#dadce0")
ZEBRA = colors.HexColor("#f6f7f8")
GREEN, RED = "#188038", "#c5221f"

_ss = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=_ss["Title"], fontSize=20, textColor=INK, alignment=0, spaceAfter=2)
H2 = ParagraphStyle("H2", parent=_ss["Heading2"], fontSize=12.5, textColor=INK, spaceBefore=12, spaceAfter=5)
BODY = ParagraphStyle("Body", parent=_ss["BodyText"], fontSize=9.5, leading=13, textColor=INK)
SMALL = ParagraphStyle("Small", parent=BODY, fontSize=8.3, leading=11, textColor=MUTED)
CELL = ParagraphStyle("Cell", parent=BODY, fontSize=8.3, leading=10.5)
HEAD = ParagraphStyle("Head", parent=CELL, textColor=colors.white, fontName="Helvetica-Bold")
KEY = ParagraphStyle("Key", parent=CELL, textColor=MUTED)

PAGE_W = letter[0] - 1.5 * inch  # usable width


# --------------------------------------------------------------------- helpers
def esc(s) -> str:
    """Escape text for reportlab's mini-HTML."""
    return "—" if s is None or s == "" else str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def t(dt: datetime | None) -> str:
    """Show times in this computer's local time zone (Edmonton on the demo laptop)."""
    if not dt:
        return "—"
    if dt.tzinfo is not None:
        dt = dt.astimezone()
    return dt.strftime("%b %d, %H:%M")


def ll(p) -> str:
    return f"{p.lat:.4f}, {p.lon:.4f}" if p else "—"


def nice(s: str) -> str:
    return s.replace("_", " ").capitalize()


def table(header: list[str], rows: list[list], widths: list[float], empty: str = "None yet.") -> Table:
    data = [[Paragraph(h, HEAD) for h in header]]
    is_empty = not rows
    if is_empty:
        data.append([Paragraph(f"<i>{esc(empty)}</i>", SMALL)] + [""] * (len(header) - 1))
    data += [[c if isinstance(c, Paragraph) else Paragraph(esc(c), CELL) for c in r] for r in rows]
    tb = Table(data, colWidths=[w * PAGE_W for w in widths], repeatRows=1)
    style = [("BACKGROUND", (0, 0), (-1, 0), INK), ("VALIGN", (0, 0), (-1, -1), "TOP"),
             ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE),
             ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]
    if is_empty:
        style.append(("SPAN", (0, 1), (-1, 1)))
    style += [("BACKGROUND", (0, i), (-1, i), ZEBRA) for i in range(2, len(data), 2)]
    tb.setStyle(TableStyle(style))
    return tb


def key_values(pairs: list[tuple[str, str]]) -> Table:
    tb = Table([[Paragraph(k, KEY), Paragraph(v, CELL)] for k, v in pairs],
               colWidths=[0.22 * PAGE_W, 0.78 * PAGE_W])
    tb.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    return tb


def load_media(url: str | None) -> bytes | None:
    """Image bytes for an Evidence.media_url, or None (never raises).
      /crops/x.jpg or crops/x.jpg  -> frontend/public/crops/x.jpg in this repo
      data:image/...;base64,...     -> decoded inline
      http(s)://...                 -> fetched with a short timeout
    """
    if not url:
        return None
    try:
        if url.startswith("data:"):
            import base64
            return base64.b64decode(url.split(",", 1)[1])
        if url.startswith(("http://", "https://")):
            with urllib.request.urlopen(url, timeout=3) as r:
                return r.read()
        path = os.path.normpath(os.path.join(PUBLIC, url.lstrip("/\\")))
        if not path.startswith(os.path.normpath(PUBLIC)):   # no ../ escapes out of public/
            return None
        with open(path, "rb") as f:
            return f.read()
    except Exception:  # noqa: BLE001
        return None


def crop_image(data: bytes, max_w: float, max_h: float) -> Image | None:
    """Scale an image to fit max_w x max_h points, keeping its aspect ratio."""
    try:
        from reportlab.lib.utils import ImageReader
        iw, ih = ImageReader(io.BytesIO(data)).getSize()
        k = min(max_w / iw, max_h / ih)
        return Image(io.BytesIO(data), width=iw * k, height=ih * k)
    except Exception:  # noqa: BLE001
        return None


def detections_section(evidence: list[Evidence]) -> list:
    """Grid of drone crops with time, summary and reliability, two per row."""
    cells = []
    col_w = PAGE_W / 2 - 6
    for e in evidence:
        data = load_media(e.media_url)
        img = crop_image(data, col_w, 2.1 * inch) if data else None
        if img is None:
            continue
        status = "officer-confirmed" if e.confirmed else "<font color='#c5221f'>not confirmed</font>"
        caption = Paragraph(f"<b>{t(e.time)}</b> · {esc(e.summary)}<br/>"
                            f"<font color='#5f6368'>{nice(e.source)} · reliability "
                            f"{e.reliability:.0%} · {status}</font>", CELL)
        cells.append([img, Spacer(1, 3), caption])
    if not cells:
        return []
    rows = [cells[i:i + 2] + ([[""]] if len(cells[i:i + 2]) == 1 else []) for i in range(0, len(cells), 2)]
    grid = Table(rows, colWidths=[PAGE_W / 2, PAGE_W / 2])
    grid.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                              ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                              ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
    return [Paragraph(f"Drone detections ({len(cells)})", H2),
            Paragraph("Image crops the AI flagged, with the officer's confirmation status.", SMALL),
            Spacer(1, 4), grid]


def decision_log(log: list[LogEntry]) -> dict[str, list[LogEntry]]:
    """The API logs decisions as action='decision', detail='<asset>: <status> (<reason>)'.
    Group them by asset so each request can show who decided, when, and why."""
    out: dict[str, list[LogEntry]] = {}
    for e in log:
        if e.action == "decision" and ":" in e.detail:
            out.setdefault(e.detail.split(":", 1)[0].strip(), []).append(e)
    return out


def decision_cell(req: TaskingRequest, by_asset: dict[str, list[LogEntry]]) -> Paragraph:
    status = req.status
    color = {"approved": GREEN, "rejected": RED}.get(status, "#5f6368")
    text = f"<font color='{color}'><b>{status.capitalize()}</b></font>"
    entries = by_asset.get(req.asset, [])
    entry = next((e for e in entries if status in e.detail), None)
    if entry:
        text += f"<br/>by {esc(entry.actor)}, {t(entry.time)}"
        m = re.search(r"\((.*)\)\s*$", entry.detail)
        if m:
            text += f"<br/><font color='#5f6368'>{esc(m.group(1))}</font>"
    elif status == "pending":
        text += "<br/><font color='#5f6368'>Awaiting officer</font>"
    return Paragraph(text, CELL)


def outcome(log: list[LogEntry]) -> tuple[str, str]:
    found = next((e for e in reversed(log) if e.action in ("found_confirmed", "found")), None)
    closed = next((e for e in reversed(log) if e.action in ("search_closed", "case_closed")), None)
    if found:
        return f"<b>Located</b> — {t(found.time)}", esc(found.detail)
    if closed:
        return f"<b>Search closed</b> — {t(closed.time)}", esc(closed.detail)
    return "<b>Search ongoing</b>", "Report generated while the search is still active."


# --------------------------------------------------------------------- build
def build_pdf(report: Report, out_path: str | None = None, chart_path: str | None = None) -> bytes:
    buf = io.BytesIO()
    case = report.case
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=0.75 * inch, rightMargin=0.75 * inch,
                            topMargin=0.7 * inch, bottomMargin=0.75 * inch,
                            title=f"Overwatch Search Report — {case.name}", author="Overwatch")
    s = []

    # Header
    s.append(Paragraph("Overwatch Search Report", H1))
    s.append(Paragraph(f"Case {esc(case.case_id)} · Generated {datetime.now().strftime('%b %d, %Y %H:%M')}",
                       SMALL))
    s.append(Spacer(1, 5))
    bar = Table([[""]], colWidths=[PAGE_W], rowHeights=[3])
    bar.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), AMBER)]))
    s.append(bar)

    # Summary
    status, status_detail = outcome(report.log)
    approved = sum(r.status == "approved" for r in report.requests)
    confirmed = sum(e.confirmed for e in report.evidence)
    s.append(Paragraph("Summary", H2))
    s.append(key_values([
        ("Outcome", status),
        ("Subject", esc(f"{case.name}, {case.age}, {nice(case.condition)}, {case.mobility} mobility")),
        ("Clothing / items", esc(", ".join(case.clothing)) if case.clothing else "—"),
        ("Last seen", f"{ll(case.last_seen)} at {t(case.last_seen_time)}"),
        ("Notes", esc(case.notes)),
        ("Activity", f"{len(report.evidence)} evidence items ({confirmed} officer-confirmed) · "
                     f"{len(report.requests)} tasking requests ({approved} approved)"),
    ]))
    s.append(Spacer(1, 4))
    s.append(Paragraph(status_detail, BODY))

    # Map (never allowed to break the report)
    try:
        from backend.report.map_figure import render_map_png
        png = render_map_png(report)
    except Exception as exc:  # noqa: BLE001
        png = None
        print(f"[report] map skipped: {exc}")
    if png:
        s.append(KeepTogether([
            Paragraph("Search map", H2),
            Image(io.BytesIO(png), width=PAGE_W, height=PAGE_W * 4.6 / 7.0),
        ]))

    # Evidence
    ev: list[Evidence] = sorted(report.evidence, key=lambda e: e.time)
    s.append(Paragraph(f"Evidence ({len(ev)})", H2))
    s.append(Paragraph("Times are when each event happened, as reported.", SMALL))
    s.append(Spacer(1, 4))
    s.append(table(
        ["Time", "Kind", "Source", "Details", "Location", "Reliab.", "Conf."],
        [[t(e.time), nice(e.kind), nice(e.source), e.summary, ll(e.location),
          f"{e.reliability:.0%}", "Yes" if e.confirmed else "No"] for e in ev],
        [0.12, 0.11, 0.11, 0.33, 0.15, 0.09, 0.09]))

    # Drone crops (only evidence with a loadable media_url)
    s += detections_section(ev)

    # Tasking requests
    by_asset = decision_log(report.log)
    s.append(Paragraph(f"Tasking requests and decisions ({approved} of {len(report.requests)} approved)", H2))
    s.append(Paragraph("Overwatch recommends; an officer approves or rejects every deployment.", SMALL))
    s.append(Spacer(1, 4))
    s.append(table(
        ["Asset", "Why Overwatch asked", "Gain", "Time", "Decision"],
        [[r.asset, Paragraph("<br/>".join("• " + esc(x) for x in r.reasons) or "—", CELL),
          f"{r.expected_gain:.0%}", f"{r.duration_min:g} min", decision_cell(r, by_asset)]
         for r in report.requests],
        [0.14, 0.46, 0.08, 0.1, 0.22], empty="No deployments requested."))

    # Full log
    log = sorted(report.log, key=lambda e: e.time)
    s.append(Paragraph(f"Activity log ({len(log)})", H2))
    s.append(Paragraph("Times are when each action was entered in Overwatch.", SMALL))
    s.append(Spacer(1, 4))
    s.append(table(["Time", "Actor", "Action", "Detail"],
                   [[t(e.time), e.actor, nice(e.action), e.detail] for e in log],
                   [0.13, 0.15, 0.15, 0.57], empty="No activity logged."))

    # Optional benchmark chart
    if chart_path and os.path.exists(chart_path):
        s.append(KeepTogether([
            Paragraph("Method validation (simulation)", H2),
            Image(chart_path, width=PAGE_W, height=PAGE_W * 4.5 / 8),
            Paragraph("Simulated cases comparing Overwatch with standard search. Not data from this case.",
                      SMALL)]))

    s.append(Spacer(1, 14))
    s.append(Paragraph(
        "AI outputs in this record are recommendations. No deployment happens without an officer's approval, "
        "and every approval or rejection is logged above with the officer's name. Overwatch does not use "
        "face recognition.", SMALL))

    def footer(canvas, d):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(0.75 * inch, 0.45 * inch, f"Overwatch · {case.name} · {case.case_id}")
        canvas.drawRightString(letter[0] - 0.75 * inch, 0.45 * inch, f"Page {d.page}")
        canvas.restoreState()

    doc.build(s, onFirstPage=footer, onLaterPages=footer)
    pdf = buf.getvalue()
    if out_path:
        with open(out_path, "wb") as f:
            f.write(pdf)
    return pdf


def load_report(args) -> Report:
    if args.case_id:
        url = f"{args.api.rstrip('/')}/report/{args.case_id}"
        with urllib.request.urlopen(url, timeout=10) as r:
            return Report.model_validate_json(r.read())
    path = args.json or SAMPLE
    with open(path, encoding="utf-8") as f:
        return Report.model_validate(json.load(f))


def main() -> None:
    ap = argparse.ArgumentParser(description="Make an Overwatch search report PDF")
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--sample", action="store_true", help="use the fictional Margaret case (default)")
    src.add_argument("--json", help="Report JSON file")
    src.add_argument("--case-id", help="fetch from the running API")
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--chart", default=None, help="optional PNG, e.g. benchmark/results/chart.png")
    ap.add_argument("-o", "--out", default="search_report.pdf")
    args = ap.parse_args()
    build_pdf(load_report(args), args.out, args.chart)
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
