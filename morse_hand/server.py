"""Loopback web server. Each socket owns its timing, transcript and tracker."""

import argparse
import asyncio
import json
import logging
import webbrowser
from pathlib import Path
from threading import Thread
from time import monotonic
from urllib.parse import urlsplit

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .gesture import Gesture
from .timing import Settings, Timing
from .tracking import Tracker

STATIC = Path(__file__).with_name("static")
app = FastAPI(docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.websocket("/session")
async def session(ws: WebSocket):
    origin = urlsplit(ws.headers.get("origin", ""))
    if origin.hostname not in {
        "localhost",
        "127.0.0.1",
        "::1",
    } or origin.netloc != ws.headers.get("host"):
        await ws.close(code=1008)
        return
    await ws.accept()
    timing = Timing()
    gesture = Gesture(timing)
    tracker = None
    points = []
    mode = "idle"
    try:
        while True:
            event = await ws.receive()
            if event["type"] == "websocket.disconnect":
                break
            now = monotonic()
            symbol = error = None
            frame = event.get("bytes") is not None
            op = None
            try:
                if frame and mode == "camera":
                    points, ratio, fist = await asyncio.to_thread(
                        tracker.detect, event["bytes"], now
                    )
                    symbol = gesture.sample(ratio, now, fist)
                elif not frame:
                    msg = json.loads(event["text"])
                    op = msg["op"]
                    if op == "mode":
                        mode = "idle"
                        if tracker:
                            await asyncio.to_thread(tracker.close)
                            tracker = None
                        points = []
                        timing.cancel(now)
                        gesture = Gesture(timing)
                        if msg["value"] == "camera":
                            tracker = await asyncio.to_thread(Tracker)
                            mode = "camera"
                        elif msg["value"] == "demo":
                            mode = "demo"
                    elif op in ("down", "up") and mode == "demo":
                        if op == "down":
                            timing.begin(now)
                        else:
                            symbol = timing.end(now)
                    elif op == "space" and mode == "demo":
                        timing.queue_space()
                    elif op == "cancel":
                        timing.cancel(now)
                    elif op in ("undo", "clear"):
                        timing.edit(op, now)
                        gesture = Gesture(timing)
                    elif op == "settings":
                        timing.settings = Settings(**msg["value"])
                if mode == "camera":
                    gesture.expire(now)
                    if not gesture.visible:
                        points = []
                timing.tick(now)
            except (ValueError, KeyError, TypeError) as exc:
                error = str(exc)
            except Exception:
                logging.getLogger(__name__).exception("Camera processing failed")
                error = "Camera processing failed. Check the model installation and restart the camera."
            progress = (
                0
                if timing.start is None
                else min(1, (now - timing.start) / timing.settings.dash)
            )
            status = "Open"
            if mode == "idle":
                status = "Standby"
            elif mode == "camera" and not gesture.visible:
                status = "Hand not detected"
            elif mode == "camera" and gesture.space_start is not None:
                status = "Hold for space"
                progress = min(1, (now - gesture.space_start) / gesture.space_hold)
            elif mode == "camera" and gesture.space_locked:
                status = "Open hand to continue"
            elif timing.start is not None:
                status = "Dash ready" if progress >= 1 else "Pinching"
            elif mode == "camera" and not gesture.armed:
                status = "Open hand to begin"
            decoder = timing.decoder
            await ws.send_json(
                {
                    "mode": mode,
                    "status": status,
                    "progress": progress,
                    "sequence": decoder.sequence,
                    "text": decoder.display_text,
                    "invalid": decoder.invalid,
                    "symbol": symbol,
                    "points": points,
                    "frame": frame,
                    "tick": (not frame and op == "tick"),
                    "error": error,
                    "pending": decoder.word_pending,
                }
            )
    except WebSocketDisconnect:
        pass
    finally:
        if tracker:
            await asyncio.to_thread(tracker.close)


def main():
    import uvicorn

    parser = argparse.ArgumentParser(description="Launch Morse Hand locally.")
    parser.add_argument(
        "--no-browser", action="store_true", help="Skip opening a browser tab."
    )
    options = parser.parse_args()

    class LocalServer(uvicorn.Server):
        async def startup(self, sockets=None):
            await super().startup(sockets=sockets)
            if self.started and not options.no_browser:
                Thread(
                    target=webbrowser.open_new_tab,
                    args=("http://127.0.0.1:8000/",),
                    daemon=True,
                ).start()

    LocalServer(
        uvicorn.Config(app, host="127.0.0.1", port=8000, ws_max_size=512_000)
    ).run()


if __name__ == "__main__":
    main()
