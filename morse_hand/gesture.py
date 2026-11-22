"""Convert palm-normalized fingertip distances to deliberate edges."""

from .timing import Timing


class Gesture:
    recovery = 0.42
    space_hold = 0.5

    def __init__(self, timing: Timing):
        self.timing = timing
        self.armed = False
        self.closed = False
        self.distance = None
        self.space_start = None
        self.space_locked = False
        self.last_seen = None
        self.visible = False
        self.awaiting_recovery = False

    def expire(self, now):
        if self.last_seen is not None and now - self.last_seen > self.recovery:
            self.timing.cancel(now)
            self.__init__(self.timing)

    def sample(self, ratio, now, fist=False):
        self.expire(now)
        self.visible = ratio is not None
        if ratio is None:
            if self.space_start is not None:
                self.space_locked = True
                self.space_start = None
            self.distance = None
            self.awaiting_recovery = self.closed
            return None
        self.last_seen = now
        self.distance = (
            ratio if self.distance is None else 0.8 * ratio + 0.2 * self.distance
        )
        if self.space_locked:
            if not fist and self.distance >= 0.46:
                self.space_locked = False
            return None

        if self.space_start is not None:
            if not fist:
                self.space_start = None
                self.space_locked = True
            elif now - self.space_start >= self.space_hold:
                self.timing.queue_space()
                self.space_start = None
                self.space_locked = True
            return None

        if fist:
            if not self.armed or self.awaiting_recovery:
                self.timing.cancel(now)
                self.closed = False
                self.space_locked = True
                return None
            # The thumb and index can meet briefly while forming a fist.
            self.timing.cancel(now)
            self.closed = False
            self.space_start = now
            return None

        if self.distance >= 0.46:
            self.armed = True
            if self.closed:
                self.closed = False
                if self.awaiting_recovery:
                    self.timing.cancel(now)
                else:
                    return self.timing.end(now)
        elif self.distance <= 0.28:
            self.awaiting_recovery = False
            if self.armed and not self.closed:
                self.closed = True
                self.timing.begin(now)
        return None
