"""Export the case map for the tools search teams already use (field feedback: "it has to fit what we
have, not be a whole new thing"). GeoJSON imports into CalTopo; KML imports into ATAK, CalTopo and
Google Earth. Every feature carries its UTM position, as teams read coordinates.
"""
from __future__ import annotations

import math
from xml.sax.saxutils import escape

from backend.api.hub import CaseHub
from backend.engine.utm import utm_str

CLUSTER_RADIUS_M = 350.0


def _circle(lon: float, lat: float, r_m: float, n: int = 36) -> list[list[float]]:
    pts = []
    for k in range(n + 1):
        a = 2 * math.pi * k / n
        pts.append([round(lon + r_m * math.sin(a) / (111_320 * math.cos(math.radians(lat))), 6),
                    round(lat + r_m * math.cos(a) / 111_320, 6)])
    return pts


def _feature(geom: dict, title: str, description: str, colour: str, **props) -> dict:
    # title / description / stroke / fill / marker-color: read by CalTopo and most GeoJSON viewers
    return {"type": "Feature", "geometry": geom,
            "properties": {"title": title, "description": description, "stroke": colour,
                           "fill": colour, "marker-color": colour, "stroke-width": 2,
                           "fill-opacity": 0.15, **props}}


def features(hub: CaseHub) -> list[dict]:
    p = hub.profile
    out: list[dict] = []
    if p.last_seen:
        out.append(_feature({"type": "Point", "coordinates": [p.last_seen.lon, p.last_seen.lat]},
                            f"Last seen: {p.name}", f"UTM {utm_str(p.last_seen.lon, p.last_seen.lat)}",
                            "#FFFFFF", layer="last_seen"))
    for i, c in enumerate(hub.last_clusters or []):
        out.append(_feature({"type": "Polygon", "coordinates": [_circle(c.center.lon, c.center.lat, CLUSTER_RADIUS_M)]},
                            f"Likely area {i + 1}: {c.probability:.0%}",
                            f"{c.probability:.0%} of the remaining possibilities within {CLUSTER_RADIUS_M:.0f} m. "
                            f"Centre UTM {utm_str(c.center.lon, c.center.lat)}. {c.story or ''}".strip(),
                            "#FF4D4D" if i == 0 else "#FF9F1C", layer="likely_area", probability=c.probability))
    if hub.alerts:
        a = hub.alerts[-1]
        ring = [[g.lon, g.lat] for g in a.polygon] + [[a.polygon[0].lon, a.polygon[0].lat]]
        out.append(_feature({"type": "Polygon", "coordinates": [ring]}, f"Suggested alert area (v{a.version})",
                            f"Covers {a.covers:.0%} of the possibilities, {a.area_km2:.1f} km². {a.reason}",
                            "#FFD166", layer="alert_area"))
    for ev in hub.evidence:
        if ev.location is None:
            continue
        lon, lat = ev.location.lon, ev.location.lat
        desc = f"{ev.source}, reliability {ev.reliability:.0%}. UTM {utm_str(lon, lat)}"
        if ev.kind == "searched_area":
            out.append(_feature({"type": "Polygon", "coordinates": [_circle(lon, lat, ev.radius_m or 300)]},
                                f"Searched: {ev.summary}", desc, "#4CC9F0", layer="searched_area"))
        else:
            out.append(_feature({"type": "Point", "coordinates": [lon, lat]}, ev.summary, desc,
                                "#B388FF", layer=f"evidence_{ev.kind}"))
    for req in hub.requests.values():
        if req.status == "rejected" or not req.target_area:
            continue
        ring = [[g.lon, g.lat] for g in req.target_area] + [[req.target_area[0].lon, req.target_area[0].lat]]
        desc = " ".join(req.reasons[:2]) + (f" UTM {req.utm}." if req.utm else "")
        out.append(_feature({"type": "Polygon", "coordinates": [ring]}, f"{req.asset} ({req.status})", desc,
                            "#06D6A0", layer="assignment"))
        for b in req.checks:
            out.append(_feature({"type": "Point", "coordinates": [b.location.lon, b.location.lat]},
                                f"Check: {b.name}", f"{b.access} Do: {'; '.join(b.actions)}. UTM {b.utm}",
                                "#F4A261", layer="building_check"))
    return out


def geojson(hub: CaseHub) -> dict:
    return {"type": "FeatureCollection", "features": features(hub),
            "properties": {"title": f"Overwatch: {hub.profile.name} ({hub.profile.case_id})"}}


def _kml_colour(hex_rgb: str, alpha: str) -> str:
    h = hex_rgb.lstrip("#")
    return f"{alpha}{h[4:6]}{h[2:4]}{h[0:2]}".lower()   # KML is aabbggrr


def kml(hub: CaseHub) -> str:
    marks = []
    for i, f in enumerate(features(hub)):
        pr, g = f["properties"], f["geometry"]
        style = (f"<Style><LineStyle><color>{_kml_colour(pr['stroke'], 'ff')}</color><width>2</width></LineStyle>"
                 f"<PolyStyle><color>{_kml_colour(pr['fill'], '40')}</color></PolyStyle>"
                 f"<IconStyle><color>{_kml_colour(pr['marker-color'], 'ff')}</color></IconStyle></Style>")
        if g["type"] == "Point":
            lon, lat = g["coordinates"]
            shape = f"<Point><coordinates>{lon},{lat},0</coordinates></Point>"
        else:
            coords = " ".join(f"{lon},{lat},0" for lon, lat in g["coordinates"][0])
            shape = (f"<Polygon><outerBoundaryIs><LinearRing><coordinates>{coords}</coordinates>"
                     f"</LinearRing></outerBoundaryIs></Polygon>")
        marks.append(f"<Placemark id=\"f{i}\"><name>{escape(pr['title'])}</name>"
                     f"<description>{escape(pr['description'])}</description>{style}{shape}</Placemark>")
    name = escape(f"Overwatch: {hub.profile.name} ({hub.profile.case_id})")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
            f"<name>{name}</name>{''.join(marks)}</Document></kml>\n")
