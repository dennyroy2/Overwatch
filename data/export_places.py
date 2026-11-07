from pathlib import Path
import osmnx as ox

# Same box as the street graph
BBOX = (-113.56, 53.515, -113.47, 53.56)

# Which OpenStreetMap tags to download
TAGS = {
    "amenity": ["cafe", "place_of_worship"],
    "highway": "bus_stop",
    "leisure": "park",
}

places = ox.features_from_bbox(BBOX, TAGS)
print(len(places), "places downloaded")

def kind_of(row):
    if row.get("amenity") == "cafe":
        return "cafe"
    if row.get("amenity") == "place_of_worship":
        return "place_of_worship"
    if row.get("highway") == "bus_stop":
        return "bus_stop"
    if row.get("leisure") == "park":
        return "park"
    return None

places["kind"] = places.apply(kind_of, axis=1)
places["geometry"] = places.geometry.representative_point()

out = places[["name", "kind", "geometry"]].reset_index(drop=True)
print(out["kind"].value_counts())

Path("data/places").mkdir(exist_ok=True)
out.to_file("data/places/edmonton_places.geojson", driver="GeoJSON")