"""Download building outlines for the demo area from OpenStreetMap (run once, on a machine with internet).

    python data/export_buildings.py

Writes data/places/edmonton_buildings.geojson: one point per building (its centre) with the tags
Overwatch uses to say what kind of building it is and who can get in (backend/engine/buildings.py).
"""
from pathlib import Path

import osmnx as ox

BBOX = (-113.56, 53.515, -113.47, 53.56)   # same box as the street graph
KEEP = ["name", "building", "amenity", "shop", "office", "tourism", "leisure", "healthcare",
        "opening_hours", "addr:housenumber", "addr:street", "building:levels"]

b = ox.features_from_bbox(BBOX, {"building": True})
b = b[b.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
print(len(b), "buildings downloaded")

area = b.to_crs(epsg=32612).geometry.area          # UTM zone 12N, metres
b["area_m2"] = area.round(0).values
b["geometry"] = b.geometry.representative_point()
for k in KEEP:
    if k not in b.columns:
        b[k] = None
out = b[KEEP + ["area_m2", "geometry"]].reset_index(drop=True)
out.columns = [c.replace(":", "_") for c in out.columns]

Path("data/places").mkdir(exist_ok=True)
out.to_file("data/places/edmonton_buildings.geojson", driver="GeoJSON")
print("wrote data/places/edmonton_buildings.geojson")
