// Browser port of morse_hand/{decoder,timing,gesture,tracking,server}.py.
// All timestamps are monotonic seconds. Behaviour mirrors the Python source;
// tests/js/parity.test.mjs replays recorded Python sessions against this file.

const CODES = (
  ".- -... -.-. -.. . ..-. --. .... .. .--- -.- .-.. -- -. --- .--. " +
  "--.- .-. ... - ..- ...- .-- -..- -.-- --.. " +
  "----- .---- ..--- ...-- ....- ..... -.... --... ---.. ----."
).split(" ");
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const ALPHABET = Object.fromEntries(CODES.map((c, i) => [c, LETTERS[i]]));
// character -> code, as served by /api/alphabet in the Python app
export const CODE_OF = Object.fromEntries(
  Object.entries(ALPHABET).map(([code, ch]) => [ch, code]),
);

export class Decoder {
  constructor() {
    this.text = "";
    this.sequence = "";
    this.invalid = false;
    this.wordPending = false;
    this.lastSequence = "";
  }
  get displayText() {
    return this.text + (this.wordPending && this.sequence ? " " : "");
  }
  finish() {
    if (this.sequence && !this.invalid) {
      this.lastSequence = this.sequence;
      const letter = ALPHABET[this.sequence];
      if (letter === undefined) {
        this.invalid = true;
        return;
      }
      this.text += (this.wordPending && this.text ? " " : "") + letter;
      this.sequence = "";
      this.wordPending = false;
    }
  }
  undo() {
    this.lastSequence = "";
    if (this.sequence) this.sequence = this.sequence.slice(0, -1);
    else if (this.wordPending) this.wordPending = false;
    else {
      this.text = this.text.slice(0, -1);
      this.wordPending = false;
    }
    this.invalid = false;
  }
}

export class Settings {
  constructor({ dash = 2.0, character = 1.2, word = 2.8, automatic_spaces = false } = {}) {
    if (
      !(
        0.2 <= dash &&
        dash <= 6 &&
        0.2 <= character &&
        character < word &&
        word <= 10
      )
    )
      throw new RangeError(
        "Use a dash of 0.2–6 s and gaps of 0.2–10 s with word > letter.",
      );
    Object.assign(this, { dash, character, word, automatic_spaces });
  }
}

export class Timing {
  constructor() {
    this.settings = new Settings();
    this.decoder = new Decoder();
    this.start = null;
    this.release = null;
  }
  tick(now) {
    if (this.release === null || this.start !== null) return;
    const gap = now - this.release;
    if (gap >= this.settings.character) this.decoder.finish();
    if (
      this.settings.automatic_spaces &&
      gap >= this.settings.word &&
      !this.decoder.sequence &&
      !this.decoder.text.endsWith(" ")
    )
      this.decoder.wordPending = this.decoder.text.length > 0;
  }
  queueSpace() {
    if (this.start !== null) return;
    this.decoder.finish();
    if (!this.decoder.invalid) {
      this.decoder.text += " ";
      this.decoder.wordPending = false;
      this.release = null;
    }
  }
  begin(now) {
    this.tick(now);
    if (this.start === null && !this.decoder.invalid) {
      this.start = now;
      this.release = null;
    }
  }
  end(now) {
    if (this.start === null) return null;
    const duration = now - this.start;
    this.start = null;
    this.release = now;
    if (duration < 0.08) return null;
    const symbol = duration >= this.settings.dash ? "-" : ".";
    this.decoder.sequence += symbol;
    return symbol;
  }
  cancel(now) {
    if (this.start !== null) {
      this.start = null;
      this.release = now;
    }
  }
  edit(action, now) {
    this.start = this.release = null;
    if (action === "undo") {
      this.decoder.undo();
      if (this.decoder.sequence) this.release = now;
    } else if (this.decoder.invalid) {
      this.decoder.sequence = "";
      this.decoder.invalid = false;
      this.decoder.lastSequence = "";
    } else this.decoder = new Decoder();
  }
}

export class Gesture {
  static recovery = 0.42;
  static spaceHold = 0.5;
  constructor(timing) {
    this.timing = timing;
    this.reset();
  }
  reset() {
    this.armed = false;
    this.closed = false;
    this.distance = null;
    this.spaceStart = null;
    this.spaceLocked = false;
    this.lastSeen = null;
    this.visible = false;
    this.awaitingRecovery = false;
  }
  expire(now) {
    if (this.lastSeen !== null && now - this.lastSeen > Gesture.recovery) {
      this.timing.cancel(now);
      this.reset();
    }
  }
  sample(ratio, now, fist = false) {
    this.expire(now);
    this.visible = ratio !== null;
    if (ratio === null) {
      if (this.spaceStart !== null) {
        this.spaceLocked = true;
        this.spaceStart = null;
      }
      this.distance = null;
      this.awaitingRecovery = this.closed;
      return null;
    }
    this.lastSeen = now;
    this.distance =
      this.distance === null ? ratio : 0.8 * ratio + 0.2 * this.distance;
    if (this.spaceLocked) {
      if (!fist && this.distance >= 0.46) this.spaceLocked = false;
      return null;
    }
    if (this.spaceStart !== null) {
      if (!fist) {
        this.spaceStart = null;
        this.spaceLocked = true;
      } else if (now - this.spaceStart >= Gesture.spaceHold) {
        this.timing.queueSpace();
        this.spaceStart = null;
        this.spaceLocked = true;
      }
      return null;
    }
    if (fist) {
      if (!this.armed || this.awaitingRecovery) {
        this.timing.cancel(now);
        this.closed = false;
        this.spaceLocked = true;
        return null;
      }
      // The thumb and index can meet briefly while forming a fist.
      this.timing.cancel(now);
      this.closed = false;
      this.spaceStart = now;
      return null;
    }
    if (this.distance >= 0.46) {
      this.armed = true;
      if (this.closed) {
        this.closed = false;
        if (this.awaitingRecovery) this.timing.cancel(now);
        else return this.timing.end(now);
      }
    } else if (this.distance <= 0.28) {
      this.awaitingRecovery = false;
      if (this.armed && !this.closed) {
        this.closed = true;
        this.timing.begin(now);
      }
    }
    return null;
  }
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Folded fingertips lie closer to the wrist than their middle joints. */
export function isClosedFist(points, scale) {
  const folded = [8, 12, 16, 20].every(
    (tip) => dist(points[tip], points[0]) < dist(points[tip - 2], points[0]),
  );
  const palm = [0, 1].map(
    (axis) => [0, 5, 9, 13, 17].reduce((s, n) => s + points[n][axis], 0) / 5,
  );
  return folded && dist(points[4], palm) < 0.65 * scale;
}

export class HandSelector {
  constructor() {
    this.anchor = null;
    this.label = null;
    this.scale = 1;
    this.seen = -Infinity;
  }
  /** candidates: [{points, label, scale}] in pixel coordinates. */
  choose(candidates, now) {
    if (!candidates.length) return null;
    let chosen;
    if (now - this.seen <= Gesture.recovery) {
      let best = null;
      for (const item of candidates) {
        const travel = dist(item.points[9], this.anchor) / this.scale;
        if (travel < 1.2 && item.label === this.label)
          if (best === null || travel < best.travel) best = { travel, item };
      }
      if (best === null) return null;
      chosen = best.item;
    } else {
      chosen = candidates.reduce((a, b) => (b.scale > a.scale ? b : a));
    }
    this.label = chosen.label;
    this.scale = chosen.scale;
    this.anchor = chosen.points[9];
    this.seen = now;
    return { points: chosen.points, ratio: dist(chosen.points[4], chosen.points[8]) / this.scale };
  }
}

/**
 * Turn MediaPipe output into {points (normalized), ratio, fist}, or
 * {points: [], ratio: null, fist: null} when no usable hand is visible.
 * `hands`: [{landmarks: [{x,y}...21], label}], w/h: frame size in pixels.
 */
export function observe(selector, hands, w, h, now) {
  const candidates = hands.map(({ landmarks, label }) => {
    const points = landmarks.map((p) => [p.x * w, p.y * h]);
    const scale = Math.max(dist(points[0], points[9]), dist(points[5], points[17]), 1);
    return { points, label, scale };
  });
  const chosen = selector.choose(candidates, now);
  if (chosen === null) return { points: [], ratio: null, fist: null };
  return {
    points: chosen.points.map(([x, y]) => [x / w, y / h]),
    ratio: chosen.ratio,
    fist: isClosedFist(chosen.points, selector.scale),
  };
}

/** One browser tab's session: the logic of the Python /session WebSocket. */
export class Session {
  constructor() {
    this.timing = new Timing();
    this.gesture = new Gesture(this.timing);
    this.studioDecoder = this.timing.decoder;
    this.studioRelease = null;
    this.practice = "";
    this.points = [];
    this.mode = "idle";
  }

  /** A control message (the JSON frames of the old protocol). */
  message(op, value, now) {
    return this._step(now, { op, value }, null);
  }

  /** A camera observation from observe(); ignored unless mode is camera. */
  frame(obs, now) {
    return this._step(now, null, obs);
  }

  _step(now, msg, obs) {
    const timing = this.timing;
    let symbol = null,
      error = null,
      op = null;
    const isFrame = obs !== null;
    try {
      if (isFrame && this.mode === "camera") {
        this.points = obs.points;
        symbol = this.gesture.sample(obs.ratio, now, obs.fist);
      } else if (!isFrame) {
        op = msg.op;
        const value = msg.value;
        if (op === "mode") {
          this.mode = "idle";
          this.points = [];
          timing.cancel(now);
          this.gesture = new Gesture(timing);
          if (value === "camera") this.mode = "camera";
          else if (value === "demo") this.mode = "demo";
        } else if ((op === "down" || op === "up") && this.mode === "demo") {
          if (op === "down") timing.begin(now);
          else symbol = timing.end(now);
        } else if (op === "space" && this.mode === "demo") {
          timing.queueSpace();
        } else if (op === "cancel") {
          timing.cancel(now);
        } else if (op === "undo" || op === "clear") {
          timing.edit(op, now);
          this.gesture = new Gesture(timing);
        } else if (op === "practice") {
          const ch = value;
          if (Object.values(ALPHABET).includes(ch) || (this.practice && ch === "")) {
            if (!this.practice) {
              timing.cancel(now);
              this.studioDecoder = timing.decoder;
              this.studioRelease = timing.release;
            }
            this.practice = ch;
            timing.start = null;
            timing.release = this.practice ? null : this.studioRelease;
            timing.decoder = this.practice ? new Decoder() : this.studioDecoder;
            this.gesture = new Gesture(timing);
          }
        } else if (op === "settings") {
          timing.settings = new Settings(value);
        }
      }
      if (this.mode === "camera") {
        this.gesture.expire(now);
        if (!this.gesture.visible) this.points = [];
      }
      timing.tick(now);
    } catch (exc) {
      if (exc instanceof RangeError || exc instanceof TypeError) error = exc.message;
      else throw exc;
    }
    return this._snapshot(now, symbol, error, isFrame, op);
  }

  _snapshot(now, symbol, error, isFrame, op) {
    const { timing, gesture, mode } = this;
    let progress =
      timing.start === null ? 0 : Math.min(1, (now - timing.start) / timing.settings.dash);
    let status = "Open";
    if (mode === "idle") status = "Standby";
    else if (mode === "camera" && !gesture.visible) status = "Hand not detected";
    else if (mode === "camera" && gesture.spaceStart !== null) {
      status = "Hold for space";
      progress = Math.min(1, (now - gesture.spaceStart) / Gesture.spaceHold);
    } else if (mode === "camera" && gesture.spaceLocked) status = "Open hand to continue";
    else if (timing.start !== null) status = progress >= 1 ? "Dash ready" : "Pinching";
    else if (mode === "camera" && !gesture.armed) status = "Open hand to begin";
    const d = timing.decoder;
    return {
      mode,
      status,
      progress,
      sequence: d.sequence,
      text: d.displayText,
      invalid: d.invalid,
      symbol,
      points: this.points,
      frame: isFrame,
      tick: !isFrame && op === "tick",
      error,
      pending: d.wordPending,
      practice: this.practice,
      attempt: this.practice ? d.lastSequence : "",
    };
  }
}
