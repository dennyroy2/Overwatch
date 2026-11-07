import sys
import osmnx as ox

# (west, south, east, north): must match backend/engine/graph.py
BBOX = (-113.56, 53.515, -113.47, 53.56)

G = ox.graph_from_bbox(BBOX, network_type="walk")
print(len(G.nodes), "intersections,", len(G.edges), "street segments")

ox.save_graphml(G, "data/graphs/edmonton_demo.graphml")

# Only show the picture if asked:  py data\export_graph.py --plot
if "--plot" in sys.argv:
    ox.plot_graph(G, node_size=0)