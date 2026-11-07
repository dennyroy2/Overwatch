"""Street/trail graph loading for the ghost engine.

Akshat exports graphs into data/graphs/ (GraphML). This module loads them and
turns them into flat NumPy arrays the engine can move ghosts along quickly.
If no cached file exists, it can download from OpenStreetMap via OSMnx.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

GRAPH_DIR = Path(__file__).resolve().parents[2] / "data" / "graphs"

# Downtown Edmonton + North Saskatchewan River valley (north, south, east, west)
EDMONTON_DEMO_BBOX = (53.560, 53.515, -113.470, -113.560)


@dataclass
class StreetGraph:
    node_ids: np.ndarray       # (N,) original OSM node ids
    node_lonlat: np.ndarray    # (N, 2)
    edge_u: np.ndarray         # (E,) index into nodes
    edge_v: np.ndarray         # (E,)
    edge_len_m: np.ndarray     # (E,)
    neighbours: list[np.ndarray]  # per node: edge indices leaving it

    @property
    def n_nodes(self) -> int:
        return len(self.node_ids)


def load_graph(name: str = "edmonton_demo", download_if_missing: bool = True) -> StreetGraph:
    """Load data/graphs/<name>.graphml, downloading the demo bbox if missing."""
    import networkx as nx

    path = GRAPH_DIR / f"{name}.graphml"
    if path.exists():
        g = nx.read_graphml(path)
    elif download_if_missing:
        g = download_walk_graph(EDMONTON_DEMO_BBOX, path)
    else:
        raise FileNotFoundError(path)
    return to_arrays(g)


def download_walk_graph(bbox: tuple[float, float, float, float], save_to: Path):
    """Download a walkable network (streets, paths, trails) and cache it."""
    import osmnx as ox  # heavy import, only when needed

    north, south, east, west = bbox
    g = ox.graph_from_bbox(bbox=(west, south, east, north), network_type="walk", simplify=True)
    save_to.parent.mkdir(parents=True, exist_ok=True)
    ox.save_graphml(g, save_to)
    return g


def to_arrays(g) -> StreetGraph:
    nodes = list(g.nodes)
    index = {n: i for i, n in enumerate(nodes)}
    lonlat = np.array([[float(g.nodes[n]["x"]), float(g.nodes[n]["y"])] for n in nodes])

    us, vs, lens = [], [], []
    for u, v, data in g.edges(data=True):
        length = float(data.get("length", 0.0) or 0.0)
        us.append(index[u]); vs.append(index[v]); lens.append(length)
        if not g.is_directed():  # make undirected graphs walkable both ways
            us.append(index[v]); vs.append(index[u]); lens.append(length)

    edge_u = np.array(us, dtype=np.int64)
    edge_v = np.array(vs, dtype=np.int64)
    order = np.argsort(edge_u, kind="stable")
    neighbours: list[np.ndarray] = [np.empty(0, dtype=np.int64) for _ in nodes]
    for i in order:
        neighbours[edge_u[i]] = np.append(neighbours[edge_u[i]], i)

    return StreetGraph(
        node_ids=np.array(nodes), node_lonlat=lonlat,
        edge_u=edge_u, edge_v=edge_v, edge_len_m=np.array(lens), neighbours=neighbours,
    )


def nearest_node(graph: StreetGraph, lon: float, lat: float) -> int:
    d = (graph.node_lonlat[:, 0] - lon) ** 2 + (graph.node_lonlat[:, 1] - lat) ** 2
    return int(np.argmin(d))
