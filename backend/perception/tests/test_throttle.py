from backend.perception.throttle import CONF_RISE, SETTLE_S, Candidate, select


def clue(conf, t=0.0, tie=0.0, lat=53.534, lon=-113.537, r=80.0):
    return Candidate("clue", lat, lon, r, conf, t, tie)


def sighting(conf, t=0.0, lat=53.534, lon=-113.537, r=80.0):
    return Candidate("sighting", lat, lon, r, conf, t)


LATE = SETTLE_S + 1.0     # a time after a place has settled


def test_thirty_frames_of_the_same_jacket_send_one_item():
    seen = [clue(0.9, t=i * 0.5, lon=-113.537 + i * 0.00001) for i in range(30)]    # drifts about 0.7 m per frame
    assert sum(select(seen)) == 1


def test_a_new_place_waits_and_the_best_look_in_the_window_is_sent():
    flags = select([clue(0.50, t=0.0), clue(0.97, t=0.5), clue(0.80, t=1.0)])
    assert flags == [False, True, False]                       # not the first, blurry look


def test_equal_scores_are_broken_by_the_detectors_own_confidence_then_earliest():
    assert select([clue(1.0, t=0.0, tie=0.4), clue(1.0, t=0.5, tie=0.6), clue(1.0, t=1.0, tie=0.6)]) == [False, True, False]


def test_a_look_after_the_window_is_judged_against_the_sent_one():
    # settles at 0.9 (sent at t=0.5); a later, weaker look is quiet; a much clearer one is new evidence
    assert select([clue(0.6, t=0.0), clue(0.9, t=0.5), clue(0.5, t=LATE)]) == [False, True, False]
    assert select([clue(0.5, t=0.0), clue(0.5 + CONF_RISE, t=LATE)]) == [True, True]
    assert select([clue(0.5, t=0.0), clue(0.5 + CONF_RISE - 0.01, t=LATE)]) == [True, False]


def test_the_rise_is_measured_from_the_best_look_sent_there():
    assert select([clue(0.5, t=0.0), clue(0.8, t=LATE), clue(0.9, t=LATE + 1)]) == [True, True, False]


def test_moving_outside_the_radius_is_a_new_place():
    far = clue(0.9, t=LATE, lat=53.534 + 0.002)             # about 220 m north, radius 80 m
    assert select([clue(0.9, t=0.0), far]) == [True, True]


def test_a_sighting_next_to_a_clue_is_dropped_even_if_the_clue_is_still_settling():
    assert select([clue(0.9, t=0.0), sighting(0.7, t=0.5)]) == [True, False]
    assert select([clue(0.9, t=0.0), sighting(0.7, t=LATE)]) == [True, False]
    assert select([clue(0.9, t=0.0), sighting(0.7, t=0.5, lat=53.534 + 0.002)]) == [True, True]


def test_a_sighting_before_the_clue_is_still_sent_and_kinds_do_not_block_each_other():
    assert select([sighting(0.7, t=0.0), clue(0.9, t=LATE)]) == [True, True]


def test_sightings_can_be_switched_off():
    assert select([sighting(0.9), clue(0.9, lat=53.6)], sightings=False) == [False, True]


def test_the_last_places_best_look_is_sent_even_if_the_clip_ends_inside_the_window():
    assert select([clue(0.4, t=10.0), clue(0.7, t=10.5)]) == [False, True]


def test_empty_input():
    assert select([]) == []
