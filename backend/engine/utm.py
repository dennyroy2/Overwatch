"""UTM coordinates, the way search teams read them (CalTopo's readout: "12U 0291922E 5699445N").

Ground search and rescue in Canada works in UTM on WGS84, not latitude/longitude. Self-contained
(standard transverse Mercator series, accurate to well under a metre), so no pyproj is needed.
"""
from __future__ import annotations

import math

_A = 6378137.0                    # WGS84 semi-major axis (m)
_F = 1 / 298.257223563
_E2 = _F * (2 - _F)               # first eccentricity squared
_EP2 = _E2 / (1 - _E2)
_K0 = 0.9996
_BANDS = "CDEFGHJKLMNPQRSTUVWXX"  # 8-degree latitude bands from 80S (X is 12 degrees)


def zone_of(lon: float, lat: float) -> int:
    z = int((lon + 180) // 6) + 1
    if 56 <= lat < 64 and 3 <= lon < 12:          # Norway
        return 32
    if 72 <= lat < 84 and lon >= 0:               # Svalbard
        for lo, hi, zz in ((0, 9, 31), (9, 21, 33), (21, 33, 35), (33, 42, 37)):
            if lo <= lon < hi:
                return zz
    return min(max(z, 1), 60)


def band_of(lat: float) -> str:
    lat = min(max(lat, -80.0), 83.999)
    return _BANDS[int((lat + 80) // 8)]


def to_utm(lon: float, lat: float) -> tuple[int, str, float, float]:
    """(zone, band, easting m, northing m)."""
    zone = zone_of(lon, lat)
    lon0 = math.radians((zone - 1) * 6 - 180 + 3)
    phi, lam = math.radians(lat), math.radians(lon)
    n = _A / math.sqrt(1 - _E2 * math.sin(phi) ** 2)
    t = math.tan(phi) ** 2
    c = _EP2 * math.cos(phi) ** 2
    a = math.cos(phi) * (lam - lon0)
    e4, e6 = _E2 ** 2, _E2 ** 3
    m = _A * ((1 - _E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
              - (3 * _E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * phi)
              + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * phi)
              - (35 * e6 / 3072) * math.sin(6 * phi))
    east = _K0 * n * (a + (1 - t + c) * a ** 3 / 6
                      + (5 - 18 * t + t * t + 72 * c - 58 * _EP2) * a ** 5 / 120) + 500000.0
    north = _K0 * (m + n * math.tan(phi) * (a * a / 2 + (5 - t + 9 * c + 4 * c * c) * a ** 4 / 24
                                            + (61 - 58 * t + t * t + 600 * c - 330 * _EP2) * a ** 6 / 720))
    if lat < 0:
        north += 10000000.0
    return zone, band_of(lat), east, north


def utm_str(lon: float, lat: float) -> str:
    """'12U 0333915E 5935590N' (7-digit easting, as CalTopo shows it)."""
    zone, band, e, n = to_utm(lon, lat)
    return f"{zone}{band} {int(math.floor(e)):07d}E {int(math.floor(n)):07d}N"   # truncated, like CalTopo
