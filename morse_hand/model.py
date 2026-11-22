"""Install the pinned Google model atomically in the user's cache."""

import hashlib
import shutil
import tempfile
from pathlib import Path
from urllib.request import urlopen

MODEL = Path.home() / ".cache/morse-hand/hand_landmarker.task"
URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
DIGEST = "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1"


def main():
    MODEL.parent.mkdir(parents=True, exist_ok=True)
    if MODEL.exists() and hashlib.sha256(MODEL.read_bytes()).hexdigest() == DIGEST:
        print(f"Model ready at {MODEL}")
        return
    with tempfile.NamedTemporaryFile(dir=MODEL.parent, delete=False) as output:
        path = Path(output.name)
    try:
        with urlopen(URL, timeout=60) as source, path.open("wb") as output:
            shutil.copyfileobj(source, output)
        if hashlib.sha256(path.read_bytes()).hexdigest() != DIGEST:
            raise ValueError("Downloaded model failed its SHA-256 check.")
        path.replace(MODEL)
    finally:
        path.unlink(missing_ok=True)
    print(f"Installed {MODEL}")
