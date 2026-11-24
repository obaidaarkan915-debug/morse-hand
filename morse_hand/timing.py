"""Input-independent Morse timing. All timestamps are monotonic seconds."""

from dataclasses import dataclass

from .decoder import Decoder


@dataclass(frozen=True)
class Settings:
    dash: float = 2.0
    character: float = 1.2
    word: float = 2.8
    automatic_spaces: bool = False

    def __post_init__(self):
        if not (0.2 <= self.dash <= 6 and 0.2 <= self.character < self.word <= 10):
            raise ValueError(
                "Use a dash of 0.2–6 s and gaps of 0.2–10 s with word > letter."
            )


class Timing:
    def __init__(self):
        self.settings = Settings()
        self.decoder = Decoder()
        self.start = None
        self.release = None

    def tick(self, now):
        if self.release is None or self.start is not None:
            return
        gap = now - self.release
        if gap >= self.settings.character:
            self.decoder.finish()
        if (
            self.settings.automatic_spaces
            and gap >= self.settings.word
            and not self.decoder.sequence
            and not self.decoder.text.endswith(" ")
        ):
            self.decoder.word_pending = bool(self.decoder.text)

    def queue_space(self):
        if self.start is not None:
            return
        self.decoder.finish()
        if not self.decoder.invalid:
            self.decoder.text += " "
            self.decoder.word_pending = False
            self.release = None

    def begin(self, now):
        self.tick(now)
        if self.start is None and not self.decoder.invalid:
            self.start = now
            self.release = None

    def end(self, now):
        if self.start is None:
            return None
        duration = now - self.start
        self.start = None
        self.release = now
        if duration < 0.08:
            return None
        symbol = "-" if duration >= self.settings.dash else "."
        self.decoder.sequence += symbol
        return symbol

    def cancel(self, now):
        if self.start is not None:
            self.start = None
            self.release = now

    def edit(self, action, now):
        self.start = self.release = None
        if action == "undo":
            self.decoder.undo()
            if self.decoder.sequence:
                self.release = now
        elif self.decoder.invalid:
            self.decoder.sequence = ""
            self.decoder.invalid = False
            self.decoder.last_sequence = ""
        else:
            self.decoder = Decoder()
