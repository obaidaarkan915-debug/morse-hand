import pytest

from morse_hand.decoder import ALPHABET, Decoder
from morse_hand.gesture import Gesture
from morse_hand.timing import Settings, Timing


@pytest.mark.parametrize(
    ("duration", "expected"),
    [(0.04, None), (0.12, "."), (1.99, "."), (2, "-"), (3, "-")],
)
def test_one_symbol_only_on_release(duration, expected):
    t = Timing()
    t.begin(0)
    for n in range(8):
        t.tick(duration * n / 8)
        assert t.decoder.sequence == ""
    assert t.end(duration) == expected
    assert t.end(duration + 1) is None
    assert t.decoder.sequence == (expected or "")


def enter(t, code, start):
    now = start
    for symbol in code:
        t.begin(now)
        now += 0.15 if symbol == "." else 2.2
        assert t.end(now) == symbol
        now += 0.16
    return now - 0.16


def test_sos_and_word_gap():
    t = Timing()
    t.settings = Settings(automatic_spaces=True)
    now = 0
    for code in ("...", "---", "..."):
        release = enter(t, code, now)
        now = release + 1.3
    t.tick(now)
    assert t.decoder.text == "SOS"
    t.tick(release + 3)
    assert t.decoder.display_text == "SOS"
    release = enter(t, ".-", release + 4)
    assert t.decoder.display_text == "SOS "
    t.tick(release + 1.3)
    assert t.decoder.text == "SOS A"


def test_hold_suspends_gaps():
    t = Timing()
    enter(t, ".", 0)
    t.begin(1)
    t.tick(7)
    assert t.decoder.text == "" and not t.decoder.word_pending
    t.end(8)
    t.tick(9.3)
    assert t.decoder.text == "A"


@pytest.mark.parametrize("edit", ["undo", "clear"])
def test_invalid_edit_preserves_previous_text(edit):
    t = Timing()
    release = enter(t, ".", 0)
    release = enter(t, "......", release + 1.3)
    t.tick(release + 1.3)
    assert t.decoder.invalid and t.decoder.text == "E"
    t.begin(release + 2)
    assert t.start is None
    t.edit(edit, release + 3)
    assert not t.decoder.invalid
    t.tick(release + 5)
    assert t.decoder.text == ("E5" if edit == "undo" else "E")
    t.edit("undo", release + 6)
    assert t.decoder.text == ("E" if edit == "undo" else "")


def test_repeat_and_hysteresis():
    t = Timing()
    g = Gesture(t)
    for n, ratio in enumerate([0.8, 0.05, 0.31, 0.40, 0.27, 0.4, 0.9, 0.9]):
        g.sample(ratio, n * 0.1)
    assert t.decoder.sequence == "."


def test_short_contact():
    t = Timing()
    g = Gesture(t)
    for now, ratio in [(0, 0.8), (0.1, 0.02), (0.15, 0.9)]:
        g.sample(ratio, now)
    assert t.decoder.sequence == ""


@pytest.mark.parametrize("reappears_open", [True, False])
def test_brief_loss(reappears_open):
    t = Timing()
    g = Gesture(t)
    g.sample(0.8, 0)
    g.sample(0.02, 0.1)
    g.sample(None, 0.2)
    g.sample(0.9 if reappears_open else 0.02, 0.34)
    g.sample(0.9, 0.45)
    assert t.decoder.sequence == ("" if reappears_open else ".")


def test_extended_loss_requires_open():
    t = Timing()
    g = Gesture(t)
    for now, ratio in [(0, 0.8), (0.1, 0.02), (0.3, None), (0.7, 0.01), (0.9, 0.8)]:
        g.sample(ratio, now)
    assert t.decoder.sequence == "" and t.start is None
    g.sample(0.02, 1)
    g.sample(0.8, 1.2)
    assert t.decoder.sequence == "."


def test_adjustable_timing():
    t = Timing()
    t.settings = Settings(0.3, 0.4, 0.8, automatic_spaces=True)
    t.begin(0)
    assert t.end(0.31) == "-"
    t.tick(0.70)
    assert t.decoder.sequence == "-"
    t.tick(0.72)
    assert t.decoder.text == "T"
    t.tick(1.12)
    assert t.decoder.word_pending
    with pytest.raises(ValueError):
        Settings(2, 2, 1)


@pytest.mark.parametrize(("sequence", "letter"), ALPHABET.items())
def test_alphabet(sequence, letter):
    decoder = Decoder(sequence=sequence)
    decoder.finish()
    assert decoder.text == letter


def test_recovery_needs_confirmed_closed_sample():
    t = Timing()
    g = Gesture(t)
    for now, ratio in [(0, 0.8), (0.1, 0.02), (0.2, None), (0.3, 0.37), (0.4, 0.8)]:
        g.sample(ratio, now)
    assert t.decoder.sequence == "" and t.start is None


def test_manual_word_spacing_and_undo():
    t = Timing()
    t.queue_space()
    assert t.decoder.text == " "
    t.edit("undo", 0)
    assert t.decoder.text == ""
    enter(t, ".", 0)
    t.tick(60)
    assert not t.decoder.word_pending
    enter(t, ".", 61)
    t.queue_space()
    t.queue_space()
    assert t.decoder.text == "EE  " and not t.decoder.word_pending
    t.edit("undo", 62)
    assert t.decoder.text == "EE " and not t.decoder.word_pending
    t.queue_space()
    end = enter(t, ".", 63)
    t.tick(end + 1.3)
    assert t.decoder.text == "EE  E"


def test_space_preserves_hold_and_invalid_sequence():
    t = Timing()
    t.begin(0)
    t.queue_space()
    assert t.end(3) == "-"
    t.decoder.text = "SOS"
    t.decoder.sequence = "......"
    t.queue_space()
    assert t.decoder.invalid and t.decoder.text == "SOS"
    assert not t.decoder.word_pending


def test_closed_fist_delimits_words_once_without_morse_input():
    t = Timing()
    g = Gesture(t)
    for now, index, fist in [
        (0, 0.8, False),
        (0.1, 0.05, False),
        (0.3, 0.8, False),  # E
        (0.4, 0.8, True),
        (0.7, 0.8, True),
        (0.91, 0.8, True),
    ]:
        g.sample(index, now, fist)
    assert t.decoder.text == "E " and not t.decoder.word_pending
    t.edit("undo", 1)
    g.sample(0.8, 1.2, True)
    assert t.decoder.text == "E"  # Still held, so no second command.
    for now, index, fist in [
        (1.3, 0.8, False),
        (1.4, 0.8, True),
        (1.7, 0.8, True),
        (1.91, 0.8, True),
        (2, 0.8, False),
        (2.1, 0.02, False),
        (2.3, 0.9, False),
    ]:
        g.sample(index, now, fist)
    t.tick(4)
    assert t.decoder.text == "E E"


@pytest.mark.parametrize("interruption", ["loss", "open", "index"])
def test_unfinished_space_pinch_cancels(interruption):
    t = Timing()
    t.decoder.text = "SOS"
    g = Gesture(t)
    g.sample(0.8, 0, False)
    g.sample(0.8, 0.1, True)
    index, fist = {"loss": (None, None), "open": (0.8, False), "index": (0.1, False)}[
        interruption
    ]
    g.sample(index, 0.3, fist)
    for now in [0.5, 0.7, 0.9]:
        g.sample(0.8, now, True)
    assert not t.decoder.word_pending and t.decoder.sequence == ""


def test_forming_fist_cancels_incidental_index_pinch():
    t = Timing()
    t.decoder.text = "A"
    g = Gesture(t)
    for now, index, fist in [
        (0, 0.9, False),
        (0.1, 0.04, False),
        (0.25, 0.08, True),
        (0.55, 0.1, True),
        (0.8, 0.09, True),
        (0.95, 0.9, False),
    ]:
        g.sample(index, now, fist)
    assert t.decoder.text == "A " and not t.decoder.word_pending
    assert not t.decoder.sequence and t.start is None
