"""Steps 25 and 31: the drone's flight path, and turning a box in the frame into a point on the ground.

Flight-path file (JSON), agreed format. Times are seconds from the start of the clip:
    {"clip": "margaret_drone2", "width": 1280, "height": 720, "fps": 30,
     "camera": {"pitch_deg": 45, "fov_h_deg": 76.25},
     "route": [{"t_s": 0.0, "lat": 53.5, "lon": -113.5, "alt_m": 40, "heading_deg": 51}, ...]}
`pitch_deg` is the camera's angle below the horizon (90 = looking straight down). `heading_deg` is the
compass bearing the drone faces (0 = north, clockwise). A route point may also carry its own
`pitch_deg` and `fov_h_deg`, which override the file-level `camera`.

`position_error_m` (optional, default 5, a consumer GPS) is how far off the route's positions may be. It goes into every
detection's radius, so a synthetic or rough flight path never claims more certainty than it has. It may also be set
per route point.
"""
from __future__ import annotations

import json
import math
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
    position_error_m: float = 5.0


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
                                   lerp(a.fov_h_deg, b.fov_h_deg), lerp(a.position_error_m, b.position_error_m))
        return pts[-1]  # unreachable for sorted points


def load_flight_path(path: Path) -> FlightPath:
    """Read a flight-path file. Raises ValueError when the route is empty or not in time order."""
    raw = json.loads(Path(path).read_text())
    cam = raw.get("camera", {})
    pitch, fov = float(cam.get("pitch_deg", 90)), float(cam.get("fov_h_deg", 84))
    err = float(raw.get("position_error_m", GPS_ERROR_M))
    points = tuple(
        FlightPoint(float(p["t_s"]), float(p["lat"]), float(p["lon"]), float(p["alt_m"]),
                    float(p["heading_deg"]), float(p.get("pitch_deg", pitch)), float(p.get("fov_h_deg", fov)),
                    float(p.get("position_error_m", err)))
        for p in raw.get("route", [])
    )
    if not points:
        raise ValueError(f"{path}: flight path has no route points")
    if any(b.t_s < a.t_s for a, b in zip(points, points[1:])):
        raise ValueError(f"{path}: route points are not in time order")
    return FlightPath(raw.get("clip", Path(path).stem), int(raw.get("width", 1280)), int(raw.get("height", 720)),
                      float(raw.get("fps", 30)), points)


# ---------------------------------------------------------------- step 31: from a box in the frame to the ground
EARTH_M_PER_DEG = 111_320.0     # metres per degree of latitude (longitude shrinks with cos(latitude))
GPS_ERROR_M = 5.0               # typical consumer GPS error, added to every radius
ANGLE_ERROR = 0.05              # pitch, field-of-view and heading are estimates: about 3 degrees, i.e. 5% of the range


@dataclass(frozen=True)
class Ground:
    """A spot on the ground: where, and how sure (the radius of the circle the person is probably inside)."""
    lat: float
    lon: float
    radius_m: float


def offset_to_latlon(lat: float, lon: float, east_m: float, north_m: float) -> tuple[float, float]:
    """Move a point by metres east and north (flat-earth, fine at a few hundred metres)."""
    return (lat + north_m / EARTH_M_PER_DEG, lon + east_m / (EARTH_M_PER_DEG * math.cos(math.radians(lat))))


def latlon_distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Straight-line metres between two (lat, lon) points (flat-earth)."""
    dy = (a[0] - b[0]) * EARTH_M_PER_DEG
    dx = (a[1] - b[1]) * EARTH_M_PER_DEG * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dx, dy)


def pixel_to_ground_offset(point: FlightPoint, u: float, v: float, aspect: float) -> tuple[float, float, float] | None:
    """The spot on flat ground that pixel (u, v) looks at, as (east_m, north_m, slant_range_m) from the point on
    the ground directly below the drone. (u, v) are 0-1 across and down the frame; `aspect` is width / height.
    Pinhole camera, no lens distortion, no roll, camera looking along the drone's heading, `pitch_deg` below the
    horizon. Returns None when the pixel looks at or above the horizon (it never meets the ground)."""
    tan_h = math.tan(math.radians(point.fov_h_deg) / 2)
    x = (u - 0.5) * 2 * tan_h                         # right of the optical axis, per unit forward
    y = (0.5 - v) * 2 * tan_h / aspect                # above the optical axis, per unit forward
    pitch = math.radians(point.pitch_deg)
    down = math.sin(pitch) - y * math.cos(pitch)      # how steeply the ray points down
    if down <= 1e-9:
        return None
    t = point.alt_m / down                            # ray length until it reaches the ground
    forward = t * (math.cos(pitch) + y * math.sin(pitch))
    right = t * x
    h = math.radians(point.heading_deg)
    east = forward * math.sin(h) + right * math.cos(h)
    north = forward * math.cos(h) - right * math.sin(h)
    return east, north, t * math.sqrt(1 + x * x + y * y)


def locate(path: FlightPath, t_s: float, box_norm: tuple[float, float, float, float]) -> Ground | None:
    """Where a detection seen at clip time `t_s` is on the ground, using the flight path's own frame size."""
    return box_to_ground(path.at(t_s), box_norm, path.width, path.height)


def box_to_ground(point: FlightPoint, box_norm: tuple[float, float, float, float], width: int, height: int) -> Ground | None:
    """Where on the ground a detection is. `box_norm` is (x1, y1, x2, y2), each 0-1 across the frame. The location is
    the box centre; the radius covers the box's own footprint on the ground, an allowance for the estimated camera
    angles (`ANGLE_ERROR` of the range) and the flight data's own `position_error_m`. None if the box centre is at or
    above the horizon."""
    x1, y1, x2, y2 = box_norm
    aspect = width / height
    centre = pixel_to_ground_offset(point, (x1 + x2) / 2, (y1 + y2) / 2, aspect)
    if centre is None:
        return None
    east, north, rng = centre
    reach = 0.0
    for u, v in ((x1, y1), (x2, y1), (x1, y2), (x2, y2)):
        c = pixel_to_ground_offset(point, u, v, aspect)
        if c is not None:                              # a corner above the horizon is skipped, not guessed
            reach = max(reach, math.hypot(c[0] - east, c[1] - north))
    lat, lon = offset_to_latlon(point.lat, point.lon, east, north)
    return Ground(lat, lon, round(reach + ANGLE_ERROR * rng + point.position_error_m, 1))
