"""Building checks: "we narrowed it to 6 buildings, but then what?" (field feedback).

For a likely area, rank the buildings next to where the ghosts are, and say for each one what kind
of building it is, whether a team can simply walk in (private homes, businesses, restricted sites),
and what to do there (BOLO to staff, door knock, camera footage). Uses
data/places/edmonton_buildings.geojson from data/export_buildings.py; without it, no checks.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np

from backend.engine.utm import utm_str
from contracts.models import BuildingCheck, GeoPoint

FILE = Path(__file__).resolve().parents[2] / "data" / "places" / "edmonton_buildings.geojson"
NEAR_M = 45.0          # a ghost this close to a building's centre counts for that building
SEARCH_M = 300.0       # buildings considered around an area's centre
MAX_CHECKS = 6

_RES = {"house", "residential", "apartments", "detached", "semidetached_house", "terrace", "dormitory",
        "bungalow", "duplex", "row_house"}
_PUBLIC_AMENITY = {"library", "community_centre", "place_of_worship", "school", "college", "university",
                   "townhall", "police", "fire_station", "theatre", "arts_centre", "social_centre",
                   "bus_station", "courthouse", "museum"}
_PUBLIC_BUILDING = {"church", "cathedral", "chapel", "mosque", "synagogue", "temple", "school", "civic",
                    "public", "government", "train_station", "transportation", "university", "college",
                    "kindergarten", "museum", "sports_centre", "stadium"}
_CARE = {"nursing_home", "hospital", "clinic", "social_facility", "doctors", "dentist"}
_BUSINESS_AMENITY = {"cafe", "restaurant", "fast_food", "bar", "pub", "bank", "pharmacy", "fuel",
                     "cinema", "nightclub", "marketplace", "car_wash", "post_office"}
_BUSINESS_BUILDING = {"retail", "commercial", "office", "hotel", "supermarket", "kiosk"}
_PARKADE = {"parking", "garage", "garages", "carport"}
_INDUSTRIAL = {"industrial", "warehouse", "construction", "service", "manufacture", "transformer_tower"}

ACCESS = {
    "residential": "Private home: needs the owner's consent to search inside; without it, police need "
                   "grounds or a warrant to enter.",
    "business": "Business: open to the public during opening hours; back rooms and after hours need the "
                "owner or manager.",
    "public": "Public building: staff can sweep it; after hours, call the facility manager.",
    "care": "Care or medical facility: staff can check quickly; she may have been brought in as an "
            "unidentified patient.",
    "parkade": "Parkade: usually open; the operator for locked levels and cameras.",
    "industrial": "Restricted site: the owner or security must open it.",
    "outbuilding": "Shed or garage on private land: owner consent needed; a common hiding or shelter spot.",
    "other": "Use unknown: find the owner before going inside.",
}
ACTIONS = {
    "residential": ["Door knock: show the BOLO, ask residents to check yards, sheds and garages",
                    "Ask about doorbell or home cameras"],
    "business": ["Show staff the BOLO", "Ask the manager to check washrooms, stairwells and back rooms",
                 "Request camera footage"],
    "public": ["Ask staff to sweep washrooms and quiet areas", "Leave the BOLO at the front desk",
               "Request camera footage"],
    "care": ["Call the front desk: any unidentified older woman seen or admitted?", "Leave the BOLO"],
    "parkade": ["Check stairwells and every level", "Request camera footage from the operator"],
    "industrial": ["Call site security to check yards and fenced areas"],
    "outbuilding": ["Ask the owner to open it", "Look through windows and around it"],
    "other": ["Walk around the outside; door knock if occupied"],
}
LABEL = {"residential": "Home", "business": "Business", "public": "Public building", "care": "Care facility",
         "parkade": "Parkade", "industrial": "Industrial site", "outbuilding": "Shed or garage", "other": "Building"}


def kind_of(tags: dict) -> str:
    b, a = (tags.get("building") or ""), (tags.get("amenity") or "")
    if a in _CARE or tags.get("healthcare") or b in {"hospital"}:
        return "care"
    if a in _PUBLIC_AMENITY or b in _PUBLIC_BUILDING or tags.get("leisure") in {"sports_centre"}:
        return "public"
    if tags.get("shop") or tags.get("office") or tags.get("tourism") or a in _BUSINESS_AMENITY \
            or b in _BUSINESS_BUILDING:
        return "business"
    if b in _PARKADE or a == "parking":
        return "parkade"
    if b in _INDUSTRIAL:
        return "industrial"
    if b in _RES:
        return "residential"
    if b in {"shed", "hut", "roof"}:
        return "outbuilding"
    area = float(tags.get("area_m2") or 0)
    if b == "yes" and not tags.get("name") and 0 < area < 45:
        return "outbuilding"            # untagged and tiny: a shed or a garage
    if b == "yes" and not tags.get("name") and 45 <= area < 400:
        return "residential"            # untagged, house-sized (most of Edmonton's untagged buildings)
    return "other"


def _name(tags: dict, kind: str) -> str:
    if tags.get("name"):
        return str(tags["name"])
    num, street = tags.get("addr_housenumber"), tags.get("addr_street")
    if num and street:
        return f"{LABEL[kind]}, {num} {street}"
    return LABEL[kind]


@lru_cache(maxsize=1)
def load(path: str = str(FILE)) -> tuple[np.ndarray, list[dict]] | None:
    p = Path(path)
    if not p.exists():
        return None
    feats = json.loads(p.read_text())["features"]
    pts, props = [], []
    for f in feats:
        g = f.get("geometry") or {}
        if g.get("type") != "Point":
            continue
        pts.append(g["coordinates"][:2])
        props.append({k: v for k, v in (f.get("properties") or {}).items() if v not in (None, "")})
    return (np.array(pts, dtype=float), props) if pts else None


def prob_within(engine, lon: float, lat: float, r_m: float) -> float:
    """Share of all the possibilities within r_m of a point."""
    if not hasattr(engine, "g"):
        return 0.0
    w = engine.w / engine.w.sum()
    d2 = ((engine._xy() - engine.g.to_xy(lon, lat)) ** 2).sum(1)
    return float(w[d2 < r_m ** 2].sum())


def checks_near(engine, lon: float, lat: float, max_n: int = MAX_CHECKS) -> list[BuildingCheck]:
    """Buildings around (lon, lat), ranked by how much of the ghost probability is right next to them."""
    data = load()
    if data is None:
        return []
    lonlat, props = data
    bxy = engine.g.to_xy(lonlat[:, 0], lonlat[:, 1])
    c = engine.g.to_xy(lon, lat)
    idx = np.flatnonzero(((bxy - c) ** 2).sum(1) < SEARCH_M ** 2)
    if len(idx) == 0:
        return []
    gxy = engine._xy()
    w = engine.w / engine.w.sum()                      # share of ALL the possibilities
    area = ((gxy - c) ** 2).sum(1) < (SEARCH_M + NEAR_M) ** 2
    gxy, w = gxy[area], w[area]
    # each ghost counts once, for the nearest building within NEAR_M (no double counting)
    d2 = ((gxy[:, None, :] - bxy[idx][None, :, :]) ** 2).sum(2)          # (ghosts, buildings)
    nearest = d2.argmin(1)
    ok = d2[np.arange(len(gxy)), nearest] < NEAR_M ** 2
    scores = np.bincount(nearest[ok], weights=w[ok], minlength=len(idx)).tolist()
    dist = np.sqrt(((bxy[idx] - c) ** 2).sum(1))
    order = sorted(range(len(idx)), key=lambda k: (-scores[k], dist[k]))
    out: list[BuildingCheck] = []
    for k in order[:max_n]:
        i = int(idx[k])
        tags = props[i]
        kind = kind_of(tags)
        access = ACCESS[kind]
        if kind == "business" and tags.get("opening_hours"):
            access += f" Hours: {tags['opening_hours']}."
        blon, blat = float(lonlat[i, 0]), float(lonlat[i, 1])
        out.append(BuildingCheck(name=_name(tags, kind), kind=kind, access=access, actions=ACTIONS[kind],
                                 location=GeoPoint(lat=round(blat, 6), lon=round(blon, 6)),
                                 utm=utm_str(blon, blat), share=round(min(scores[k], 1.0), 4)))
    return out
