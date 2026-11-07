"""Turn place words in a tip into real coordinates.

The LLM (or the rule parser) only ever extracts *words* ("Emily Murphy Park",
"124 St and Jasper"). This module is the only thing that turns words into
lat/lon, using two files from data/:

  - data/places/edmonton_places.geojson   (cafes, bus stops, parks, places of worship)
  - data/graphs/edmonton_demo.graphml     (street names -> intersections)

So a place can never be invented: if it isn't in our data, resolve() says so.
"""
from __future__ import annotations

import ast
import json
import math
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PLACES_FILE = ROOT / "data" / "places" / "edmonton_places.geojson"
GRAPH_FILE = ROOT / "data" / "graphs" / "edmonton_demo.graphml"

# Generic words for each place kind, used for "the coffee shop on 109 St"
KIND_WORDS = {
    "cafe": ["coffee shop", "coffee place", "coffee", "cafe", "café", "tim hortons", "starbucks"],
    "bus_stop": ["bus stop", "bus", "stop", "transit", "lrt"],
    "park": ["park", "ravine", "trail", "river valley"],
    "place_of_worship": ["church", "mosque", "temple", "gurdwara", "synagogue", "chapel", "cathedral"],
}

_SUFFIXES = {
    "street": "st", "st": "st", "st.": "st",
    "avenue": "ave", "ave": "ave", "ave.": "ave", "av": "ave",
    "road": "rd", "rd": "rd", "drive": "dr", "dr": "dr",
    "boulevard": "blvd", "blvd": "blvd", "way": "way", "crescent": "cres", "cres": "cres",
    "trail": "trail", "parkway": "pkwy", "pkwy": "pkwy",
}


@dataclass
class Place:
    name: str
    kind: str
    lat: float
    lon: float


@dataclass
class Resolved:
    lat: float
    lon: float
    label: str          # human readable, e.g. "Groat Road & Emily Murphy Park Road (bus stop)"
    how: str            # "place", "intersection", "street", "kind_near_street"
    precise: bool       # True for a named place or intersection, False for "somewhere on a street"


def dist_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dy = (lat2 - lat1) * 111_320
    dx = (lon2 - lon1) * 111_320 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def norm_street(text: str) -> str | None:
    """'124 Street NW' / '124th st' / 'Jasper Ave' -> '124 st' / 'jasper ave'."""
    t = text.lower().replace("’", "'")
    t = re.sub(r"\b(nw|ne|sw|se)\b", "", t)
    t = re.sub(r"(\d+)(st|nd|rd|th)\b", r"\1", t)          # 124th -> 124
    words = t.replace(".", " ").split()
    if not words:
        return None
    if words[-1] in _SUFFIXES:
        words[-1] = _SUFFIXES[words[-1]]
    return " ".join(words).strip() or None


def _norm_name(text: str) -> str:
    return re.sub(r"[^a-z0-9& ]+", " ", text.lower().replace("’", "'")).strip()


@lru_cache(maxsize=1)
def load_places() -> list[Place]:
    feats = json.loads(PLACES_FILE.read_text(encoding="utf-8"))["features"]
    out = []
    for f in feats:
        p = f.get("properties") or {}
        lon, lat = f["geometry"]["coordinates"][:2]      # GeoJSON is [lon, lat]
        out.append(Place(p.get("name") or "", p.get("kind") or "", float(lat), float(lon)))
    return out


@lru_cache(maxsize=1)
def load_streets() -> dict[str, list[tuple[float, float]]]:
    """street key -> list of (lat, lon) of the graph nodes on that street."""
    import networkx as nx

    g = nx.read_graphml(GRAPH_FILE)
    pos = {n: (float(d["y"]), float(d["x"])) for n, d in g.nodes(data=True)}
    streets: dict[str, set] = {}
    for u, v, d in g.edges(data=True):
        raw = d.get("name")
        if not raw:
            continue
        names = ast.literal_eval(raw) if raw.startswith("[") else [raw]
        for n in names:
            key = norm_street(n)
            if key:
                streets.setdefault(key, set()).update((u, v))
    return {k: [pos[n] for n in nodes] for k, nodes in streets.items()}


def street_keys() -> list[str]:
    return list(load_streets())


def intersection(a: str, b: str) -> tuple[float, float] | None:
    """Closest meeting point of two streets (within ~80 m), or None."""
    s = load_streets()
    ka, kb = norm_street(a), norm_street(b)
    if ka not in s or kb not in s:
        return None
    best, best_d = None, 1e9
    pb = s[kb]
    for la, lo in s[ka]:
        for lb, lob in pb:
            d = abs(la - lb) * 111_320 + abs(lo - lob) * 66_000   # cheap, fine for ranking
            if d < best_d:
                best, best_d = ((la + lb) / 2, (lo + lob) / 2), d
    if best_d < 80:
        return best
    # Edmonton's numbered grid: streets run north-south, avenues east-west. If the map has no shared
    # corner (simplified or split ways), cross the street's longitude with the avenue's latitude.
    st, av = (ka, kb) if ka.endswith(" st") else (kb, ka)
    if st.endswith(" st") and av.endswith(" ave"):
        lons = sorted(p[1] for p in s[st])
        lats = sorted(p[0] for p in s[av])
        lon, lat = lons[len(lons) // 2], lats[len(lats) // 2]
        if lons[-1] - lons[0] < 0.004 and lats[-1] - lats[0] < 0.004:
            return (lat, lon)
    return None


def nearest_on_street(street: str, lat: float, lon: float) -> tuple[float, float] | None:
    pts = load_streets().get(norm_street(street) or "")
    if not pts:
        return None
    return min(pts, key=lambda p: dist_m(lat, lon, *p))


def find_named_places(text: str) -> list[Place]:
    """Places whose full name appears in the text (longest names first)."""
    t = " " + _norm_name(text) + " "
    hits: list[tuple[int, Place]] = []
    for p in load_places():
        n = _norm_name(p.name)
        if len(n) < 5 or n.isdigit():                    # skip '2316'-style stop ids
            continue
        if f" {n} " in t:
            hits.append((len(n), p))
            continue
        # Shorter forms people actually say: "Hawrelak Park" for "William Hawrelak Park".
        # Not for bus stops: their names are street pairs ("121 Street & 102 Avenue").
        if p.kind == "bus_stop":
            continue
        words = n.split()
        for k in range(1, len(words) - 1):
            tail = " ".join(words[k:])
            if len(tail) >= 8 and f" {tail} " in t:
                hits.append((len(tail), p))
                break
    hits.sort(key=lambda h: -h[0])
    return [p for _, p in hits]


def _matched_part(p: Place, text: str) -> str:
    """The part of p's name that appears in text (full name, or its longest spoken tail)."""
    t = " " + _norm_name(text) + " "
    words = _norm_name(p.name).split()
    for k in range(len(words)):
        if k and len(words) - k < 2:
            break
        part = " ".join(words[k:])
        if f" {part} " in t:
            return part
    return ""


def resolve(place_text: str | None = None, street_a: str | None = None, street_b: str | None = None,
            kind_hint: str | None = None, near: tuple[float, float] | None = None) -> Resolved | None:
    """Best real location for the extracted words. `near` breaks ties (e.g. last-seen point)."""
    near = near or (53.5422, -113.5337)

    # 1. A named place ("Emily Murphy Park", "Groat Road & Emily Murphy Park Road")
    if place_text:
        hits = find_named_places(place_text)
        if kind_hint and hits and not any(h.kind == kind_hint for h in hits):
            # "the Emily Murphy Park stop" -> a bus stop whose name contains "Emily Murphy Park"
            key = _norm_name(hits[0].name)
            same = [p for p in load_places() if p.kind == kind_hint and key in _norm_name(p.name)]
            if same:
                h = min(same, key=lambda p: dist_m(hits[0].lat, hits[0].lon, p.lat, p.lon))
                return Resolved(h.lat, h.lon, f"{h.name} ({h.kind.replace('_', ' ')})", "place", True)
        if kind_hint:
            hits = [h for h in hits if h.kind == kind_hint] or hits
        if hits:
            best_len = len(_matched_part(hits[0], place_text))
            top = [h for h in hits if len(_matched_part(h, place_text)) == best_len]
            # Same match length (e.g. "Hawrelak Park" fits the park and the "... & Hawrelak Park" stop):
            # prefer the kind the words point to ("park" -> park), then the one nearest.
            said = _norm_name(place_text)
            spoken = [h for h in top if any(w in said for w in KIND_WORDS.get(h.kind, []))
                      and not (h.kind == "bus_stop" and "stop" not in said and "bus" not in said)]
            pool = spoken or top
            street_pts = load_streets().get(norm_street(street_a) or "") if street_a else None
            if street_pts and len(pool) > 1:
                # several branches ("Tim Hortons on Jasper"): take the one closest to that street
                h = min(pool, key=lambda p: min(dist_m(p.lat, p.lon, *q) for q in street_pts))
            else:
                h = min(pool, key=lambda p: dist_m(*near, p.lat, p.lon))
            return Resolved(h.lat, h.lon, f"{h.name} ({h.kind.replace('_', ' ')})", "place", True)

    # 2. Two streets -> intersection ("124 St & Jasper Ave")
    if street_a and street_b:
        x = intersection(street_a, street_b)
        if x and kind_hint:
            cands = [p for p in load_places() if p.kind == kind_hint and dist_m(p.lat, p.lon, *x) < 120]
            if cands:
                h = min(cands, key=lambda p: dist_m(p.lat, p.lon, *x))
                return Resolved(h.lat, h.lon, f"{h.name or kind_hint} ({kind_hint.replace('_', ' ')}) near {_pretty(street_a)} & {_pretty(street_b)}",
                                "kind_near_street", True)
        if x:
            return Resolved(x[0], x[1], f"{_pretty(street_a)} & {_pretty(street_b)}", "intersection", True)

    # 3. A kind on a street ("the coffee shop on 109 St") -> nearest place of that kind to that street
    if kind_hint and street_a:
        pts = load_streets().get(norm_street(street_a) or "")
        if pts:
            cands = [p for p in load_places() if p.kind == kind_hint]
            scored = [(min(dist_m(p.lat, p.lon, *q) for q in pts), p) for p in cands]
            close = [p for d, p in scored if d < 60]
            if close:
                h = min(close, key=lambda p: dist_m(*near, p.lat, p.lon))
                return Resolved(h.lat, h.lon, f"{h.name or kind_hint} on {_pretty(street_a)}", "kind_near_street", True)

    # 4. Just a street -> point on that street nearest the tie-breaker
    if street_a:
        q = nearest_on_street(street_a, *near)
        if q:
            return Resolved(q[0], q[1], _pretty(street_a), "street", False)
    return None


def _pretty(street: str) -> str:
    key = norm_street(street) or street
    parts = key.split()
    names = {"st": "St", "ave": "Ave", "rd": "Rd", "dr": "Dr", "blvd": "Blvd", "cres": "Cres", "pkwy": "Pkwy"}
    return " ".join(names.get(w, w.title() if not w[0].isdigit() else w.upper()) for w in parts)
