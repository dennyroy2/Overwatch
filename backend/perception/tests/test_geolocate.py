from pathlib import Path

import pytest

from backend.perception.geolocate import FlightPath, FlightPoint, load_flight_path

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "flight_margaret_drone2.json"


def test_fixture_loads_with_akshats_camera():
    fp = load_flight_path(FIXTURE)
    assert fp.clip == "margaret_drone2"
    assert (fp.width, fp.height, fp.fps) == (1280, 720, 30)
    assert len(fp.points) == 16
    assert fp.points[0].alt_m == 40
    assert (fp.points[0].pitch_deg, fp.points[0].fov_h_deg) == (45, 76.25)


def test_at_is_clamped_before_and_after_the_route():
    fp = load_flight_path(FIXTURE)
    assert fp.at(-5) == fp.points[0]
    assert fp.at(999) == fp.points[-1]


def test_at_interpolates_between_points():
    fp = load_flight_path(FIXTURE)
    a, b = fp.points[0], fp.points[1]
    mid = fp.at((a.t_s + b.t_s) / 2)
    assert mid.lat == pytest.approx((a.lat + b.lat) / 2)
    assert mid.lon == pytest.approx((a.lon + b.lon) / 2)


def _p(t, heading):
    return FlightPoint(t, 53.0, -113.0, 40, heading, 90, 84)


def test_heading_turns_the_short_way_across_north():
    fp = FlightPath("x", 1280, 720, 30, (_p(0, 350), _p(1, 10)))
    assert fp.at(0.5).heading_deg == pytest.approx(0.0, abs=1e-9) or fp.at(0.5).heading_deg == pytest.approx(360.0)


def test_empty_or_unordered_route_is_rejected(tmp_path):
    empty = tmp_path / "empty.json"
    empty.write_text('{"route": []}')
    with pytest.raises(ValueError, match="no route points"):
        load_flight_path(empty)
    bad = tmp_path / "bad.json"
    bad.write_text('{"route": [{"t_s": 2, "lat": 1, "lon": 1, "alt_m": 1, "heading_deg": 0},'
                   ' {"t_s": 1, "lat": 1, "lon": 1, "alt_m": 1, "heading_deg": 0}]}')
    with pytest.raises(ValueError, match="time order"):
        load_flight_path(bad)


def test_a_point_can_override_the_camera(tmp_path):
    f = tmp_path / "f.json"
    f.write_text('{"camera": {"pitch_deg": 90, "fov_h_deg": 84}, "route": '
                 '[{"t_s": 0, "lat": 1, "lon": 1, "alt_m": 1, "heading_deg": 0, "pitch_deg": 60}]}')
    p = load_flight_path(f).points[0]
    assert (p.pitch_deg, p.fov_h_deg) == (60, 84)
