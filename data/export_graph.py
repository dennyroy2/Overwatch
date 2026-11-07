import osmnx as ox

# (west, south, east, north): downtown + river valley
BBOX = (-113.56, 53.515, -113.47, 53.56)

G = ox.graph_from_bbox(BBOX, network_type="walk")
print(len(G.nodes), "intersections,", len(G.edges), "street segments")

ox.save_graphml(G, "data/edmonton_walk.graphml")
ox.plot_graph(G)  # opens a picture so you can eyeball it