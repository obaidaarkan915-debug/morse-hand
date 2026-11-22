from fastapi.testclient import TestClient

from morse_hand import server


def test_camera_session_queues_space_from_closed_fist(monkeypatch):
    # Replace only the hardware observations and clock. Exercise the actual
    # camera session, gesture recognizer, decoder and browser-facing states.
    poses = {"open": (0.8, False), "index": (0.05, False), "fist": (0.12, True)}
    now = 0.0

    class FakeTracker:
        def detect(self, data, _now):
            return [], *poses[data.decode()]

        def close(self):
            pass

    monkeypatch.setattr(server, "Tracker", FakeTracker)
    monkeypatch.setattr(server, "monotonic", lambda: now)
    client = TestClient(server.app, base_url="http://localhost")
    with client.websocket_connect(
        "ws://localhost/session", headers={"origin": "http://localhost"}
    ) as ws:
        ws.send_json({"op": "mode", "value": "camera"})
        assert ws.receive_json()["mode"] == "camera"

        def observe(time, pose):
            nonlocal now
            now = time
            ws.send_bytes(pose.encode())
            return ws.receive_json()

        observe(0, "open")
        observe(0.1, "index")
        assert observe(0.3, "open")["symbol"] == "."
        assert observe(0.4, "fist")["status"] == "Hold for space"
        assert 0 < observe(0.7, "fist")["progress"] < 1
        ready = observe(0.91, "fist")
        assert ready["pending"] and ready["symbol"] is None and ready["text"] == "E"
        observe(1, "open")
        observe(1.2, "index")
        observe(1.4, "open")
        now = 2.8
        ws.send_json({"op": "tick"})
        assert ws.receive_json()["text"] == "E E"
