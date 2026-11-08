from backend.perception.sidecar import crop_path, evidence_id, sidecar_path


def test_evidence_ids_are_deterministic():
    assert evidence_id("margaret_drone2", 7, 0) == "ev_margaret_drone2_7_0"
    assert evidence_id("margaret_drone2", 7, 0) == evidence_id("margaret_drone2", 7, 0)


def test_paths_land_where_the_frontend_serves_them():
    assert sidecar_path("c").as_posix().endswith("frontend/public/footage/c.detections.json")
    assert crop_path("ev_c_1_0").as_posix().endswith("frontend/public/crops/ev_c_1_0.jpg")
