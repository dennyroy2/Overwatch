"""Steps 25 and 31: the drone's flight path, and turning a box in the frame into a point on the ground.

Flight-path file (JSON), agreed format. Times are seconds from the start of the clip:
    {"clip": "margaret_drone2", "width": 1280, "height": 720, "fps": 30,
     "camera": {"pitch_deg": 90, "fov_h_deg": 84},
     "route": [{"t_s": 0.0, "lat": 53.5, "lon": -113.5, "alt_m": 40, "heading_deg": 51}, ...]}
`pitch_deg` is the camera's angle below the horizon (90 = looking straight down). `heading_deg` is the
compass bearing the drone faces (0 = north, clockwise). A route point may also carry its own
`pitch_deg` and `fov_h_deg`, which override the file-level `camera`.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class FlightPoint:
    t_s: float
    lat: float
    lon: float
    alt_m: float
    heading_deg: float
    pitch_deg: float
    fov_h_deg: float


@dataclass(frozen=True)
class FlightPath:
    clip: str
    width: int
    height: int
    fps: float
    points: tuple[FlightPoint, ...]

    def at(self, t_s: float) -> FlightPoint:
        """The drone's state at clip time `t_s`: linear between points, clamped at both ends,
        heading interpolated the short way round the compass."""
        pts = self.points
        if t_s <= pts[0].t_s:
            return pts[0]
        if t_s >= pts[-1].t_s:
            return pts[-1]
        for a, b in zip(pts, pts[1:]):
            if a.t_s <= t_s <= b.t_s:
                k = 0.0 if b.t_s == a.t_s else (t_s - a.t_s) / (b.t_s - a.t_s)
                lerp = lambda x, y: x + (y - x) * k
                dh = ((b.heading_deg - a.heading_deg + 180) % 360) - 180
                return FlightPoint(t_s, lerp(a.lat, b.lat), lerp(a.lon, b.lon), lerp(a.alt_m, b.alt_m),
                                   (a.heading_deg + dh * k) % 360, lerp(a.pitch_deg, b.pitch_deg),
                                   lerp(a.fov_h_deg, b.fov_h_deg))
        return pts[-1]  # unreachable for sorted points


def load_flight_path(path: Path) -> FlightPath:
    """Read a flight-path file. Raises ValueError when the route is empty or not in time order."""
    raw = json.loads(Path(path).read_text())
    cam = raw.get("camera", {})
    pitch, fov = float(cam.get("pitch_deg", 90)), float(cam.get("fov_h_deg", 84))
    points = tuple(
        FlightPoint(float(p["t_s"]), float(p["lat"]), float(p["lon"]), float(p["alt_m"]),
                    float(p["heading_deg"]), float(p.get("pitch_deg", pitch)), float(p.get("fov_h_deg", fov)))
        for p in raw.get("route", [])
    )
    if not points:
        raise ValueError(f"{path}: flight path has no route points")
    if any(b.t_s < a.t_s for a, b in zip(points, points[1:])):
        raise ValueError(f"{path}: route points are not in time order")
    return FlightPath(raw.get("clip", Path(path).stem), int(raw.get("width", 1280)), int(raw.get("height", 720)),
                      float(raw.get("fps", 30)), points)


def box_to_ground(point: FlightPoint, box_norm: tuple[float, float, float, float], width: int, height: int):
    """Box (x1, y1, x2, y2 in 0-1) -> (GeoPoint-like lat/lon, radius_m) on flat ground. Step 31."""
    raise NotImplementedError("step 31")
