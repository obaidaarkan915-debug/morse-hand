from morse_hand.tracking import HandSelector


def hand(x, label, scale):
    points = [(x, 0)] * 21
    points[8] = (x + scale / 4, 0)
    return points, label, scale


def test_active_hand_survives_order_and_scale_changes():
    selector = HandSelector()
    left, right = hand(100, "Left", 100), hand(180, "Right", 85)
    assert selector.choose([left, right], 0) == (left[0], 0.25)
    larger = hand(180, "Right", 120)
    assert selector.choose([larger, left], 0.1) == (left[0], 0.25)
    assert selector.choose([larger], 0.2) is None
    assert selector.choose([larger], 1) == (larger[0], 0.25)


def test_folded_fingers_and_tucked_thumb_required():
    from morse_hand.tracking import is_closed_fist

    points = [(0, 0)] * 21
    for tip in (8, 12, 16, 20):
        points[tip - 3] = (0, 90)
        points[tip - 2] = (0, 120)
        points[tip] = (0, 65)
    points[4] = (15, 60)
    assert is_closed_fist(points, 90)
    points[4] = (100, 60)
    assert not is_closed_fist(points, 90)
    points[4] = (15, 60)
    points[20] = (0, 160)
    assert not is_closed_fist(points, 90)
