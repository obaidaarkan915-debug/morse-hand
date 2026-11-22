# Morse Hand

A local webcam instrument for typing with Morse code. Bring your index fingertip and thumb together, then open them to enter a symbol. The live decoder handles letters A–Z and digits 0–9. Keyboard Demo uses the same Python timer and decoder.

GitHub hosts the source when you publish this repository. The application runs on your own computer at **http://127.0.0.1:8000**. Each tab has its own session. Closing or refreshing the tab discards its transcript.

## Install and run

Use **CPython 3.12** on a machine with a compatible MediaPipe 0.10.32 wheel, plus a modern browser with WebSocket and camera support. Development and verification used Ubuntu x86-64, Python 3.12.3 and Google Chrome. A webcam is optional for Keyboard Demo. On Ubuntu, install the Python venv package if your Python installation lacks it.

From the repository directory, run the following commands in Bash.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[test]'
morse-hand-model
morse-hand
```

The launcher opens [Signal studio](http://127.0.0.1:8000) in your default browser when the server is ready. To start the server without opening a tab, use `morse-hand --no-browser`. Press Ctrl+C in the server terminal to shut it down. For a keyboard-only installation, skip the model download. On subsequent launches, activate the environment and run `morse-hand`.

The model installer downloads Google's [Hand Landmarker float16 v1 task bundle](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task) to `~/.cache/morse-hand/hand_landmarker.task`. It checks SHA-256 against the pinned digest before replacing the cached file. After dependency and model installation, the app can run offline. See Google's [Python Hand Landmarker guide](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/python) for the underlying tracker.

## Enter a message

1. Click **Start Camera**, grant permission and show an open hand. Either hand works. The preview is mirrored. The two green markers identify your thumb and index fingertips.
2. Briefly pinch and release for **·**. Hold for at least **2.0 seconds** for **−**. Wait for **Dash ready**, then release. Holding longer still produces one dash. Contacts shorter than 80 ms are ignored.
3. Keep pauses between symbols below **1.2 seconds**. An open-hand pause of 1.2 seconds decodes the letter. Take as long as you like between letters. For a **word space**, show an open palm, **tuck your thumb across it and fold all four fingers over it for half a second**. When you see **Space queued**, open your hand and start the next word. The gesture finishes the current letter and queues one separator.
4. Click **Keyboard Demo** to do the same with the spacebar. Press **Enter** to queue a word space. Keep focus on the demo area while typing. Standard keyboard controls remain available by Tab. Use **Sound on** to mute the feedback tones.
5. Adjust the three thresholds under **Timing settings** and click **Apply**. For automatic spacing as well, enable **Also add spaces after a word gap**. The default word gap is 2.8 seconds and must exceed the letter gap.

### Try SOS

Enter **··· / −−− / ···**. Each slash here represents a letter pause. With default settings, make three quick pinches about 0.2 seconds apart, pause for approximately 1.5 seconds, make three holds of just over 2 seconds with short releases between them, pause for 1.5 seconds, then enter three quick pinches. After the last letter pause, the transcript reads **SOS**. In Demo, substitute a spacebar press for each pinch.

**Undo** removes the newest pending symbol, then a queued space, then the last decoded character. An unknown sequence stays visible and blocks further entry. Undo corrects it and starts a fresh letter pause. **Clear sequence** discards the invalid sequence and preserves the transcript. During normal entry, **Clear** resets the message. **Copy** copies decoded text. **Stop Camera** releases the webcam immediately.

## Tracking and privacy

The browser samples at most 12.5 JPEG frames per second, each at most 640 pixels on its longer side. Only one frame can be in flight. The browser skips samples while inference is busy and captures a fresh image after acknowledgment. Frames go to the loopback FastAPI WebSocket for in-memory inference. The app stores no images and contacts no external service during use. Loading the page does not open the camera.

Python selects the largest visible palm initially and matches subsequent detections by handedness and proximity. Distances use pixel coordinates corrected for the frame aspect ratio. Thumb–index distance is normalized by palm size. Hysteresis distinguishes closing from opening, and index distance is smoothed. A space requires folded fingers and a thumb near the palm center. This gesture is a local typing command. Tracking loss cancels an unfinished spacing gesture. If tracking disappears, a closed hand can resume a pinch within 420 ms. Returning open cancels it. Longer loss disarms the input until an open hand is seen. Keep the active hand visible and avoid crossing hands. Detection and release timing are limited by the available samples.

## Tests

```bash
source .venv/bin/activate
python -m pytest -q
```

On a shell that exports ROS or other global Python packages through `PYTHONPATH`, use `env -u PYTHONPATH python -m pytest -q` to isolate the environment. Tests supply monotonic timestamps directly and require neither a camera nor a downloaded model.

| Module | Responsibility |
| --- | --- |
| `morse_hand/tracking.py` | MediaPipe inference, active hand association and normalized distances |
| `morse_hand/gesture.py` | Smoothing, hysteresis and tracking loss |
| `morse_hand/timing.py` | Pinch durations, gap timing and settings |
| `morse_hand/decoder.py` | Alphabet, pending sequence and editable transcript |
| `morse_hand/server.py` | Static assets, per-tab WebSocket session and loopback launch |
| `morse_hand/static/` | Camera sampling, mirrored preview, interface and audio feedback |

## Troubleshooting

- **Permission denied or camera unavailable.** Allow camera access for the local address in the browser, check OS permissions and close other applications using the device. Keyboard Demo works without a camera.
- **Hand not detected.** Show the entire hand in good light. Open your thumb and index finger clearly before the first pinch and after a tracking interruption.
- **Model missing.** Activate the environment, run `morse-hand-model`, then start the camera again.
- **Connection lost.** Copy any visible transcript, start the local server again and reload the page for a new session.
