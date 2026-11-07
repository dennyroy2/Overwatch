"""
Street/trail graph for the benchmark.

- With Akshat's export:  load_graph("data/edmonton.graphml")
  (OSMnx GraphML: nodes have x=lon, y=lat; edges have length in metres.)
- Without it (tonight):  load_graph(None) builds a synthetic downtown-Edmonton-like
  grid (100 m blocks) with a diagonal river-valley trail band, centred near
  124 St & Jasper Ave.

Either way you get a `StreetGraph` with fast plain-Python adjacency, which the
walker needs (networkx lookups are too slow for thousands of ghosts).
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

import networkx as nx

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
    places: list[int]                             # places of interest (cafés, stops, parks)

    @property
    def n(self) -> int:
        return len(self.xy)

    def nearest_node(self, x: float, y: float) -> int:
        return min(range(self.n), key=lambda i: (self.xy[i][0] - x) ** 2 + (self.xy[i][1] - y) ** 2)


def _from_networkx(g: nx.Graph, places: list[int] | None = None) -> StreetGraph:
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
    if places is None:
        rnd = random.Random(7)
        places = rnd.sample(range(len(ids)), k=min(25, len(ids)))
    return StreetGraph(xy=xy, nbrs=nbrs, places=places)


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
            # river valley: diagonal band south of the origin with winding trails
            if -14 <= (i + j) <= -10 and (i + 1, j + 1) in g:
                g.add_edge((i, j), (i + 1, j + 1), length=block_m * math.sqrt(2))
    sg = _from_networkx(g)
    return sg


def load_graph(path: str | None = None) -> StreetGraph:
    if path:
        return _from_networkx(nx.read_graphml(path))
    return synthetic_graph()
