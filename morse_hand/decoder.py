"""International Morse alphabet and editable transcript."""

from dataclasses import dataclass

_CODES = (
    ".- -... -.-. -.. . ..-. --. .... .. .--- -.- .-.. -- -. --- .--. "
    "--.- .-. ... - ..- ...- .-- -..- -.-- --.. "
    "----- .---- ..--- ...-- ....- ..... -.... --... ---.. ----."
)
ALPHABET = dict(
    zip(_CODES.split(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", strict=True)
)


@dataclass
class Decoder:
    text: str = ""
    sequence: str = ""
    invalid: bool = False
    word_pending: bool = False
    last_sequence: str = ""

    @property
    def display_text(self):
        return self.text + (" " if self.word_pending and self.sequence else "")

    def finish(self):
        if self.sequence and not self.invalid:
            self.last_sequence = self.sequence
            letter = ALPHABET.get(self.sequence)
            if letter is None:
                self.invalid = True
                return
            self.text += (" " if self.word_pending and self.text else "") + letter
            self.sequence = ""
            self.word_pending = False

    def undo(self):
        self.last_sequence = ""
        if self.sequence:
            self.sequence = self.sequence[:-1]
        elif self.word_pending:
            self.word_pending = False
        else:
            self.text = self.text[:-1]
            self.word_pending = False
        self.invalid = False
