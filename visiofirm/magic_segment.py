"""Point-prompted SAM 2.1 inference for the image annotation editor."""

from pathlib import Path
from threading import Lock

import cv2
import numpy as np
import torch
from PIL import Image
from ultralytics import SAM

from visiofirm.utils.downloader import get_or_download_model


MAGIC_MODELS = {
    "sam2.1_t": "sam2.1_t.pt",
    "sam2.1_s": "sam2.1_s.pt",
}
_models = {}
_model_locks = {name: Lock() for name in MAGIC_MODELS}


def segment_image(image_path: Path, point: tuple[float, float], model_name: str, setup_type: str):
    """Return an editor annotation from a positive point, or None for an empty mask."""
    if model_name not in MAGIC_MODELS:
        raise ValueError("Unsupported Magic model")

    with Image.open(image_path) as source:
        image = source.convert("RGB")
    width, height = image.size
    x, y = point
    if not 0 <= x < width or not 0 <= y < height:
        raise ValueError("Point is outside the image")

    with _model_locks[model_name]:
        model = _models.get(model_name)
        if model is None:
            model = SAM(get_or_download_model(MAGIC_MODELS[model_name]))
            _models[model_name] = model
        device = "cuda" if torch.cuda.is_available() else "cpu"
        results = model.predict(image, points=[x, y], labels=[1], device=device, verbose=False)

    if not results or results[0].masks is None or len(results[0].masks.data) == 0:
        return None

    mask = results[0].masks.data[0].cpu().numpy()
    if mask.shape != (height, width):
        mask = cv2.resize(mask, (width, height), interpolation=cv2.INTER_NEAREST)
    binary = (mask > 0.5).astype(np.uint8)
    if not binary.any():
        return None

    if setup_type == "Segmentation":
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None
        clicked = [contour for contour in contours if cv2.pointPolygonTest(contour, (x, y), False) >= 0]
        contour = max(clicked or contours, key=cv2.contourArea)
        contour = cv2.approxPolyDP(contour, 2, True).reshape(-1, 2)
        if len(contour) < 3:
            return None
        return {
            "type": "polygon",
            "points": [{"x": int(px), "y": int(py)} for px, py in contour],
            "closed": True,
        }

    ys, xs = np.where(binary)
    return {
        "type": "obbox" if setup_type == "Oriented Bounding Box" else "rect",
        "x": int(xs.min()),
        "y": int(ys.min()),
        "width": int(xs.max() - xs.min() + 1),
        "height": int(ys.max() - ys.min() + 1),
        "rotation": 0,
    }
