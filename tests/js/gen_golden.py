"""Record Python behaviour as fixtures for the JavaScript port (docs/engine.js).

Run from the repository root:  python tests/js/gen_golden.py
Replays random sessions through the real FastAPI /session handler (with a fake
tracker and clock) and runs HandSelector / is_closed_fist on random hands.
"""

import gzip
import json
import random
from math import dist
from pathlib import Path

from fastapi.testclient import TestClient

from morse_hand import server
from morse_hand.tracking import HandSelector, is_closed_fist

OUT = Path(__file__).with_name("golden.json.gz")
POSES = {
    "open": (0.8, False),
    "index": (0.05, False),
    "fist": (0.12, True),
    "mid": (0.37, False),
    "none": (None, None),
}
HAND = [[0.25, 0.5], [0.75, 0.5]]


def make_script(rng, macros):
    """Mostly realistic gestures and key presses, with random noise mixed in."""
    steps, clock = [], [0.0]

    def at(dt):
        clock[0] += dt
        return clock[0]

    def frames(pose, seconds, dt=0.08):
        n = max(1, round(seconds / dt))
        for _ in range(n):
            steps.append({"t": at(dt), "kind": "frame", "pose": pose})

    def op(name, value=None):
        steps.append({"t": at(rng.choice([0.0, 0.01, 0.05])), "kind": "op", "op": name, "value": value})

    def tick(seconds, dt=0.08):
        for _ in range(max(1, round(seconds / dt))):
            steps.append({"t": at(dt), "kind": "op", "op": "tick", "value": None})

    mode = rng.choice(["camera", "demo"])
    op("mode", mode)
    for _ in range(macros):
        r = rng.random()
        if r < 0.45:
            symbol = rng.choice([0.04, 0.15, 0.3, 0.3, 2.1, 2.5])
            if mode == "camera":
                frames("open", rng.choice([0.1, 0.3]))
                frames("index", symbol)
                frames("open", rng.choice([0.1, 0.2, 0.5, 1.3, 1.5, 3.0]))
            else:
                op("down")
                steps[-1]["t"] = at(0.01)
                at(symbol)
                op("up")
                tick(rng.choice([0.2, 0.6, 1.3, 1.5, 3.0]))
        elif r < 0.55:
            if mode == "camera":
                frames("open", 0.2)
                frames("fist", rng.choice([0.2, 0.4, 0.6, 0.9]))
                frames("open", 0.3)
            else:
                op("space")
        elif r < 0.62 and mode == "camera":
            frames("none", rng.choice([0.1, 0.3, 0.6, 1.0]))
            frames(rng.choice(["open", "index", "fist", "mid"]), 0.3)
        elif r < 0.72:
            tick(rng.choice([0.3, 1.3, 3.0]))
        elif r < 0.88:
            name = rng.choice(["undo", "undo", "clear", "cancel", "practice", "settings", "mode"])
            value = None
            if name == "practice":
                value = rng.choice(["A", "S", "0", "", "?"])
            elif name == "settings":
                value = rng.choice([
                    {"dash": 2.0, "character": 1.2, "word": 2.8, "automatic_spaces": False},
                    {"dash": 0.5, "character": 0.4, "word": 1.0, "automatic_spaces": True},
                    {"dash": 7, "character": 1.2, "word": 2.8, "automatic_spaces": False},
                    {"dash": 1, "character": 3, "word": 2, "automatic_spaces": False},
                ])
            elif name == "mode":
                mode = rng.choice(["camera", "demo", "demo", "camera", "idle"])
                value = mode
                if mode == "idle":
                    mode = rng.choice(["camera", "demo"])
            op(name, value)
        elif r < 0.94 and mode == "camera":
            # Dwell near the hysteresis thresholds (0.28 close, 0.46 open).
            frames("open", 0.2)
            for _ in range(rng.randint(2, 4)):
                ratio = rng.choice([0.26, 0.275, 0.285, 0.3, 0.44, 0.455, 0.465, 0.475, 0.5])
                for _ in range(rng.randint(2, 8)):
                    steps.append({"t": at(0.08), "kind": "frame", "pose": "ratio",
                                  "ratio": ratio, "fist": False})
        else:
            for _ in range(rng.randint(1, 6)):
                pose = rng.choice(list(POSES) + ["ratio"])
                if pose == "ratio":
                    steps.append({"t": at(0.08), "kind": "frame", "pose": "ratio",
                                  "ratio": rng.uniform(0, 1), "fist": rng.random() < 0.2})
                else:
                    steps.append({"t": at(rng.random() * 0.3), "kind": "frame", "pose": pose})
    return steps


def run_session(script, monkeypatch_state):
    now = 0.0
    state = monkeypatch_state

    class FakeTracker:
        def detect(self, data, _now):
            ratio, fist, visible = json.loads(data)
            return ([list(p) for p in HAND] if visible else []), ratio, fist

        def close(self):
            pass

    server.Tracker = FakeTracker
    server.monotonic = lambda: state["now"]
    client = TestClient(server.app, base_url="http://localhost")
    out = []
    with client.websocket_connect(
        "ws://localhost/session", headers={"origin": "http://localhost"}
    ) as ws:
        for step in script:
            state["now"] = step["t"]
            if step["kind"] == "frame":
                if step["pose"] == "ratio":
                    ratio, fist = step["ratio"], step["fist"]
                else:
                    ratio, fist = POSES[step["pose"]]
                ws.send_bytes(json.dumps([ratio, fist, ratio is not None]).encode())
            else:
                ws.send_json({"op": step["op"], "value": step["value"]})
            out.append(ws.receive_json())
    return out


def hand_points(rng, centre, scale, fold):
    """21 pixel landmarks; fold in [0,1] curls the fingers toward the wrist."""
    pts = [[centre[0], centre[1]] for _ in range(21)]
    pts[0] = [centre[0], centre[1] + scale]
    for finger, base in zip((8, 12, 16, 20), (5, 9, 13, 17)):
        bx = centre[0] + (base - 11) * scale * 0.12
        pts[base] = [bx, centre[1]]
        reach = scale * (1.1 - 0.9 * fold)
        pts[finger - 2] = [bx, centre[1] - scale * 0.3]
        pts[finger - 1] = [bx, centre[1] - scale * 0.3 - reach * 0.3]
        pts[finger] = [bx + rng.uniform(-3, 3), centre[1] - scale * 0.3 - reach * rng.uniform(0.4, 1.1) * (1 - fold) + fold * scale * 0.7]
    pts[4] = [centre[0] + rng.uniform(-1, 1) * scale, centre[1] + rng.uniform(-1, 1) * scale * 0.5]
    for i in (1, 2, 3):
        pts[i] = [centre[0] + i * 2, centre[1] + scale * 0.5]
    return pts


def make_tracking(rng):
    fist_cases, selector_runs = [], []
    for _ in range(300):
        scale = rng.uniform(40, 200)
        pts = hand_points(rng, (rng.uniform(100, 500), rng.uniform(100, 400)), scale, rng.random())
        fist_cases.append({"points": pts, "scale": scale, "fist": is_closed_fist(pts, scale)})
    for _ in range(60):
        selector, steps, now = HandSelector(), [], 0.0
        centres = [[rng.uniform(100, 500), rng.uniform(100, 400)] for _ in range(2)]
        for _ in range(40):
            now += rng.choice([0.05, 0.1, 0.2, 0.5, 1.0])
            cands = []
            for c in centres:
                if rng.random() < 0.8:
                    c[0] += rng.uniform(-30, 30)
                    c[1] += rng.uniform(-30, 30)
                    s = rng.uniform(60, 150)
                    label = rng.choice(["Left", "Right"]) if rng.random() < 0.3 else ("Left" if c is centres[0] else "Right")
                    pts = hand_points(rng, c, s, rng.random())
                    scale = max(dist(pts[0], pts[9]), dist(pts[5], pts[17]), 1)
                    cands.append((pts, label, scale))
            rng.shuffle(cands)
            chosen = selector.choose(cands, now)
            steps.append({
                "now": now,
                "candidates": [{"points": p, "label": l, "scale": s} for p, l, s in cands],
                "expected": None if chosen is None else {"points": chosen[0], "ratio": chosen[1]},
            })
        selector_runs.append(steps)
    return fist_cases, selector_runs


def main():
    rng = random.Random(20261128)
    sessions = []
    for i in range(60):
        script = make_script(rng, 45)
        sessions.append({"script": script, "expected": run_session(script, {"now": 0.0})})
    fist_cases, selector_runs = make_tracking(rng)
    OUT.write_bytes(gzip.compress(json.dumps({"sessions": sessions, "fist": fist_cases, "selector": selector_runs}).encode(), 9, mtime=0))
    symbols = sum(1 for s in sessions for r in s["expected"] if r["symbol"])
    texts = sorted({r["text"] for s in sessions for r in s["expected"] if r["text"]}, key=len)[-3:]
    errors = sum(1 for s in sessions for r in s["expected"] if r["error"])
    print(f"{len(sessions)} sessions, {symbols} symbols, {errors} errors, longest texts {texts}")
    print(f"fist true: {sum(c['fist'] for c in fist_cases)}/{len(fist_cases)}")
    chosen = sum(1 for run in selector_runs for s in run if s["expected"])
    print(f"selector choices: {chosen}/{sum(len(r) for r in selector_runs)}")


if __name__ == "__main__":
    main()
