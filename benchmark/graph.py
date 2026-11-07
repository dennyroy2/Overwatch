"""
Street/trail graph + places of interest for the benchmark.

Map (first one found wins):
  1. --graph <path>                          (any OSMnx GraphML)
  2. data/graphs/edmonton_demo.graphml       (Akshat's committed Edmonton walk graph)
  3. synthetic downtown-like grid            (fallback so the benchmark always runs)

Places (used as each case's "familiar places"):
  data/places/edmonton_places.geojson        (Akshat: Point features with name + kind;
                                              GeoJSON coordinates are [lon, lat])
  Only kinds that make sense as somewhere a person with dementia is drawn to are
  used: cafe, place_of_worship, park. Each place is snapped to its nearest street node.
  If the file is missing, random nodes are used instead.

You get a `StreetGraph` with fast plain-Python adjacency, which the walker needs
(networkx lookups are too slow for thousands of ghosts).
"""

from __future__ import annotations

import json
import math
import os
import random
from dataclasses import dataclass, field

import networkx as nx
import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_GRAPH = os.path.join(REPO, "data", "graphs", "edmonton_demo.graphml")
DEFAULT_PLACES = os.path.join(REPO, "data", "places", "edmonton_places.geojson")
FAMILIAR_KINDS = {"cafe", "place_of_worship", "park"}

ORIGIN_LAT, ORIGIN_LON = 53.5418, -113.5370   # ~124 St & Jasper Ave
M_PER_DEG_LAT = 111_320.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(ORIGIN_LAT))


def to_xy(lat: float, lon: float) -> tuple[float, float]:
    """lat/lon -> local metres (x east, y north) around the origin."""
    return (lon - ORIGIN_LON) * M_PER_DEG_LON, (lat - ORIGIN_LAT) * M_PER_DEG_LAT


def to_latlon(x: float, y: float) -> tuple[float, float]:
    return ORIGIN_LAT + y / M_PER_DEG_LAT, ORIGIN_LON + x / M_PER_DEG_LON


@dataclass
class StreetGraph:
    xy: list[tuple[float, float]]                 # node index -> (x, y) metres
    nbrs: list[list[tuple[int, float]]]           # node index -> [(neighbour, length_m)]
    places: list[int]                             # familiar-place candidates (node indices)
    place_info: dict[int, tuple[str, str]] = field(default_factory=dict)  # node -> (name, kind)
    source: str = "synthetic"

    @property
    def n(self) -> int:
        return len(self.xy)

    def nearest_node(self, x: float, y: float) -> int:
        arr = self._arr()
        return int(np.argmin((arr[:, 0] - x) ** 2 + (arr[:, 1] - y) ** 2))

    def _arr(self) -> np.ndarray:
        if not hasattr(self, "_xy_arr"):
            self._xy_arr = np.asarray(self.xy)
        return self._xy_arr


def _from_networkx(g: nx.Graph, source: str) -> StreetGraph:
    g = nx.Graph(g)  # undirected, simple (collapses OSMnx MultiDiGraph)
    g = g.subgraph(max(nx.connected_components(g), key=len)).copy()
    ids = list(g.nodes)
    index = {nid: i for i, nid in enumerate(ids)}
    xy = [to_xy(float(g.nodes[n]["y"]), float(g.nodes[n]["x"])) for n in ids]
    nbrs: list[list[tuple[int, float]]] = [[] for _ in ids]
    for u, v, data in g.edges(data=True):
        a, b = index[u], index[v]
        length = float(data.get("length") or math.dist(xy[a], xy[b])) or 1.0
        nbrs[a].append((b, length))
        nbrs[b].append((a, length))
    return StreetGraph(xy=xy, nbrs=nbrs, places=[], source=source)


def synthetic_graph(half_size_m: float = 3500, block_m: float = 100) -> StreetGraph:
    """Grid of streets + a diagonal trail band (stand-in for the river valley)."""
    g = nx.Graph()
    k = int(half_size_m // block_m)
    rnd = random.Random(42)
    for i in range(-k, k + 1):
        for j in range(-k, k + 1):
            lat, lon = to_latlon(i * block_m, j * block_m)
            g.add_node((i, j), x=lon, y=lat)
    for i in range(-k, k + 1):
        for j in range(-k, k + 1):
            for di, dj in ((1, 0), (0, 1)):
                a, b = (i, j), (i + di, j + dj)
                if b in g and rnd.random() > 0.06:        # a few missing blocks
                    g.add_edge(a, b, length=block_m)
            if -14 <= (i + j) <= -10 and (i + 1, j + 1) in g:
                g.add_edge((i, j), (i + 1, j + 1), length=block_m * math.sqrt(2))
    return _from_networkx(g, "synthetic")


def attach_places(sg: StreetGraph, path: str = DEFAULT_PLACES, max_snap_m: float = 150) -> int:
    """Snap familiar-kind places from Akshat's GeoJSON onto street nodes. Returns count."""
    if not os.path.exists(path):
        return 0
    with open(path, encoding="utf-8") as f:
        features = json.load(f).get("features", [])
    arr = sg._arr()
    for feat in features:
        props = feat.get("properties") or {}
        geom = feat.get("geometry") or {}
        kind = (props.get("kind") or "").strip()
        if kind not in FAMILIAR_KINDS or geom.get("type") != "Point":
            continue
        lon, lat = geom["coordinates"][:2]            # GeoJSON is [lon, lat]
        x, y = to_xy(lat, lon)
        d2 = (arr[:, 0] - x) ** 2 + (arr[:, 1] - y) ** 2
        node = int(np.argmin(d2))
        if d2[node] > max_snap_m ** 2 or node in sg.place_info:
            continue                                  # off the map, or duplicate
        name = (props.get("name") or "").strip() or f"unnamed {kind.replace('_', ' ')}"
        sg.place_info[node] = (name, kind)
        sg.places.append(node)
    return len(sg.places)


def load_graph(path: str | None = None, places_path: str = DEFAULT_PLACES) -> StreetGraph:
    if path is None and os.path.exists(DEFAULT_GRAPH):
        path = DEFAULT_GRAPH
    sg = _from_networkx(nx.read_graphml(path), os.path.relpath(path, REPO)) if path else synthetic_graph()
    if attach_places(sg, places_path) < 5:            # no/too few places: random stand-ins
        rnd = random.Random(7)
        sg.places = rnd.sample(range(sg.n), k=min(25, sg.n))
        sg.place_info = {p: ("simulated place", "cafe") for p in sg.places}
    return sg
