// Replays sessions recorded from the Python implementation (see gen_golden.py)
// against the browser engine. Run:  node --test tests/js
import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { Session, HandSelector, isClosedFist, observe } from "../../docs/engine.js";

const golden = JSON.parse(
  gunzipSync(readFileSync(new URL("./golden.json.gz", import.meta.url))),
);
const POSES = {
  open: [0.8, false],
  index: [0.05, false],
  fist: [0.12, true],
  mid: [0.37, false],
  none: [null, null],
};
const HAND = [[0.25, 0.5], [0.75, 0.5]];

test("sessions match the Python /session handler step for step", () => {
  let steps = 0;
  golden.sessions.forEach((run, n) => {
    const session = new Session();
    run.script.forEach((step, i) => {
      let got;
      if (step.kind === "frame") {
        const [ratio, fist] =
          step.pose === "ratio" ? [step.ratio, step.fist] : POSES[step.pose];
        got = session.frame(
          { points: ratio === null ? [] : HAND, ratio, fist },
          step.t,
        );
      } else {
        got = session.message(step.op, step.value, step.t);
      }
      assert.deepEqual(got, run.expected[i], `session ${n}, step ${i}: ${JSON.stringify(step)}`);
      steps++;
    });
  });
  assert.ok(steps > 2000);
});

test("is_closed_fist matches Python", () => {
  for (const c of golden.fist) assert.equal(isClosedFist(c.points, c.scale), c.fist);
});

test("HandSelector matches Python", () => {
  for (const run of golden.selector) {
    const selector = new HandSelector();
    for (const step of run) {
      const got = selector.choose(step.candidates, step.now);
      if (step.expected === null) assert.equal(got, null);
      else {
        assert.deepEqual(got.points, step.expected.points);
        assert.ok(Math.abs(got.ratio - step.expected.ratio) < 1e-9);
      }
    }
  }
});

test("observe() scales normalized landmarks and normalizes the output", () => {
  const landmarks = Array.from({ length: 21 }, (_, i) => ({ x: 0.5, y: 0.2 + i * 0.03 }));
  landmarks[8] = { x: 0.6, y: 0.4 };
  const selector = new HandSelector();
  const got = observe(selector, [{ landmarks, label: "Right" }], 640, 480, 0);
  assert.equal(got.points.length, 21);
  assert.deepEqual(got.points[8], [0.6, 0.4]);
  assert.equal(typeof got.ratio, "number");
  assert.equal(observe(new HandSelector(), [], 640, 480, 0).ratio, null);
});
