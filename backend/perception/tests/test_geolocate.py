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


def test_position_error_defaults_to_gps_and_the_demo_route_declares_75(tmp_path):
    assert load_flight_path(FIXTURE).points[0].position_error_m == 75
    f = tmp_path / "f.json"
    f.write_text('{"route": [{"t_s": 0, "lat": 1, "lon": 1, "alt_m": 1, "heading_deg": 0}]}')
    assert load_flight_path(f).points[0].position_error_m == 5.0
    g = tmp_path / "g.json"
    g.write_text('{"position_error_m": 20, "route": [{"t_s": 0, "lat": 1, "lon": 1, "alt_m": 1, "heading_deg": 0, "position_error_m": 8}]}')
    assert load_flight_path(g).points[0].position_error_m == 8


def test_a_point_can_override_the_camera(tmp_path):
    f = tmp_path / "f.json"
    f.write_text('{"camera": {"pitch_deg": 90, "fov_h_deg": 84}, "route": '
                 '[{"t_s": 0, "lat": 1, "lon": 1, "alt_m": 1, "heading_deg": 0, "pitch_deg": 60}]}')
    p = load_flight_path(f).points[0]
    assert (p.pitch_deg, p.fov_h_deg) == (60, 84)


# ---------------------------------------------------------------- step 31: boxes to the ground
import math  # noqa: E402

from backend.perception.geolocate import (  # noqa: E402
    ANGLE_ERROR, GPS_ERROR_M, box_to_ground, latlon_distance_m, locate, offset_to_latlon, pixel_to_ground_offset,
)


def cam(heading=0.0, pitch=90.0, fov=90.0, alt=100.0):
    return FlightPoint(0.0, 53.5, -113.5, alt, heading, pitch, fov)


def test_nadir_box_at_the_centre_is_directly_below_the_drone():
    east, north, rng = pixel_to_ground_offset(cam(), 0.5, 0.5, 16 / 9)
    assert (east, north) == pytest.approx((0, 0), abs=1e-6)
    assert rng == pytest.approx(100)


def test_nadir_edges_land_at_the_expected_offsets_for_each_compass_heading():
    # 90 degree horizontal field of view looking straight down from 100 m: the left/right edges are 100 m to the sides
    # and, on 16:9, the top/bottom edges are 100 * 9/16 = 56.25 m ahead/behind.
    right = pixel_to_ground_offset(cam(heading=0), 1.0, 0.5, 16 / 9)
    assert right[:2] == pytest.approx((100, 0), abs=1e-6)                 # facing north: right is east
    right_e = pixel_to_ground_offset(cam(heading=90), 1.0, 0.5, 16 / 9)
    assert right_e[:2] == pytest.approx((0, -100), abs=1e-6)              # facing east: right is south
    top = pixel_to_ground_offset(cam(heading=0), 0.5, 0.0, 16 / 9)
    assert top[:2] == pytest.approx((0, 56.25), abs=1e-6)                 # top of the picture is ahead, north
    bottom_w = pixel_to_ground_offset(cam(heading=270), 0.5, 1.0, 16 / 9)
    assert bottom_w[:2] == pytest.approx((56.25, 0), abs=1e-6)            # facing west: behind is east


def test_a_tilted_camera_looks_ahead_along_its_heading():
    # 45 degrees down from 40 m: the centre of the picture meets the ground 40 m ahead
    east, north, rng = pixel_to_ground_offset(cam(heading=51, pitch=45, fov=76.25, alt=40), 0.5, 0.5, 16 / 9)
    assert math.hypot(east, north) == pytest.approx(40)
    assert math.degrees(math.atan2(east, north)) == pytest.approx(51)     # bearing = heading
    assert rng == pytest.approx(40 * math.sqrt(2))


def test_pixels_at_or_above_the_horizon_have_no_ground_point():
    assert pixel_to_ground_offset(cam(pitch=10, fov=90), 0.5, 0.0, 16 / 9) is None
    g = box_to_ground(cam(pitch=10, fov=90), (0.4, 0.0, 0.6, 0.1), 1280, 720)
    assert g is None


def test_box_to_ground_gives_a_point_and_a_radius_from_the_box_size_and_range():
    small = box_to_ground(cam(), (0.49, 0.49, 0.51, 0.51), 1280, 720)
    big = box_to_ground(cam(), (0.3, 0.3, 0.7, 0.7), 1280, 720)
    assert (small.lat, small.lon) == pytest.approx((53.5, -113.5), abs=1e-6)
    assert small.radius_m >= GPS_ERROR_M + ANGLE_ERROR * 100          # never smaller than the error allowance
    assert big.radius_m > small.radius_m + 30                          # a bigger box covers more ground
    assert box_to_ground(cam(alt=200), (0.49, 0.49, 0.51, 0.51), 1280, 720).radius_m > small.radius_m   # higher, so less sure


def test_the_flight_datas_own_error_is_part_of_every_radius():
    exact = box_to_ground(cam(), (0.49, 0.49, 0.51, 0.51), 1280, 720)
    rough = box_to_ground(FlightPoint(0.0, 53.5, -113.5, 100.0, 0.0, 90.0, 90.0, position_error_m=50.0), (0.49, 0.49, 0.51, 0.51), 1280, 720)
    assert rough.radius_m == pytest.approx(exact.radius_m + 45, abs=0.2)     # 50 instead of the default 5


def test_locate_uses_the_paths_own_frame_size_and_time():
    fp = load_flight_path(FIXTURE)
    g = locate(fp, 4.0, (0.45, 0.45, 0.55, 0.55))
    assert g is not None and g.radius_m > 75                                 # includes the route's 75 m
    assert latlon_distance_m((g.lat, g.lon), (53.5335, -113.538)) < 100      # ahead of the drone, near the park


def test_offset_and_distance_helpers_agree_with_each_other():
    lat, lon = offset_to_latlon(53.5, -113.5, 100.0, 0.0)
    assert latlon_distance_m((53.5, -113.5), (lat, lon)) == pytest.approx(100, rel=1e-3)
    lat, lon = offset_to_latlon(53.5, -113.5, 0.0, -250.0)
    assert latlon_distance_m((53.5, -113.5), (lat, lon)) == pytest.approx(250, rel=1e-3)
    assert lon == pytest.approx(-113.5) and lat < 53.5                 # south is lower latitude


def test_the_demo_clip_places_the_subject_near_the_scenarios_park():
    fp = load_flight_path(FIXTURE)
    g = box_to_ground(fp.at(13.75), (0.6906 - 0.039, 0.9495 - 0.05, 0.6906 + 0.039, 0.9495 + 0.05), 1280, 720)
    assert latlon_distance_m((g.lat, g.lon), (53.534, -113.537)) < 40    # scenario/margaret_drone2.json: the subject's spot
