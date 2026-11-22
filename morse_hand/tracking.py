"""Local inference and spatial association in aspect-correct pixel coordinates."""

import io
from math import dist

from .gesture import Gesture
from .model import MODEL


def is_closed_fist(points, scale):
    """Folded fingertips lie closer to the wrist than their middle joints."""
    folded = all(
        dist(points[tip], points[0]) < dist(points[tip - 2], points[0])
        for tip in (8, 12, 16, 20)
    )
    palm_center = tuple(
        sum(points[n][axis] for n in (0, 5, 9, 13, 17)) / 5 for axis in (0, 1)
    )
    return folded and dist(points[4], palm_center) < 0.65 * scale


class HandSelector:
    def __init__(self):
        self.anchor = None
        self.label = None
        self.scale = 1
        self.seen = float("-inf")

    def choose(self, candidates, now):
        if not candidates:
            return None
        if now - self.seen <= Gesture.recovery:
            ranked = []
            for item in candidates:
                points, label, _scale = item
                travel = dist(points[9], self.anchor) / self.scale
                if travel < 1.2 and label == self.label:
                    ranked.append((travel, item))
            if not ranked:
                return None
            chosen = min(ranked, key=lambda entry: entry[0])[1]
        else:
            chosen = max(candidates, key=lambda item: item[2])
        points, self.label, self.scale = chosen
        self.anchor = points[9]
        self.seen = now
        return points, dist(points[4], points[8]) / self.scale


class Tracker:
    def __init__(self):
        if not MODEL.is_file():
            raise ValueError("Run morse-hand-model and start the camera again.")
        import mediapipe as mp

        self.mp = mp
        vision = mp.tasks.vision
        self.detector = vision.HandLandmarker.create_from_options(
            vision.HandLandmarkerOptions(
                base_options=mp.tasks.BaseOptions(model_asset_path=str(MODEL)),
                running_mode=vision.RunningMode.VIDEO,
                num_hands=2,
            )
        )
        self.selector = HandSelector()

    def detect(self, data, now):
        import numpy as np
        from PIL import Image

        with Image.open(io.BytesIO(data)) as source:
            w, h = source.size
            if source.format != "JPEG" or max(w, h) > 960:
                raise ValueError("Unsupported camera frame.")
            rgb = np.asarray(source.convert("RGB"))
        result = self.detector.detect_for_video(
            self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb),
            int(now * 1000),
        )
        candidates = []
        for hand, side in zip(result.hand_landmarks, result.handedness):
            points = [(p.x * w, p.y * h) for p in hand]
            scale = max(dist(points[0], points[9]), dist(points[5], points[17]), 1)
            candidates.append((points, side[0].category_name, scale))
        chosen = self.selector.choose(candidates, now)
        if chosen is None:
            return [], None, None
        points, ratio = chosen
        fist = is_closed_fist(points, self.selector.scale)
        return [(x / w, y / h) for x, y in points], ratio, fist

    def close(self):
        self.detector.close()
