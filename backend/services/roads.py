# Classical road-corridor extraction (no training weights needed).
#
# Roads have no reliable colour signature on their own — asphalt, concrete and
# bare ground overlap — but they DO have a shape signature: long, thin, smooth
# ribbons that form a connected network. This module finds that shape:
#
#   1. Adaptive "road-like" mask: low saturation and mid-low value, with the
#      thresholds derived from the image's own percentiles so it works on
#      bright and dark scenes (a fixed HSV range only fits one exposure).
#   2. Vegetation and water are removed, otherwise parks read as tarmac.
#   3. Morphological closing with LINEAR kernels at several orientations
#      reconnects road segments that are broken by shadows or vehicles.
#   4. Each component is judged by the second moments of its pixels: a road is
#      strongly elongated (lambda_max / lambda_min >> 1) with a plausible
#      effective width = area / major_length.
#   5. The output polygon is the component's minAreaRect — a rotated rectangle
#      that follows the road direction, unlike an axis-aligned bbox.
#
# HONESTY: these are road-*like corridors* found by geometry, not by a learned
# road model. Each item carries method="classical-road" and the API reports a
# reason saying so. Railway lines and long building shadows of similar shape
# can also qualify, so the UI must present them as approximate.

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Tuple

try:
    from utils.cache import cached, file_fingerprint
except ImportError:  # allow `uvicorn backend.main:app` from the project root
    from backend.utils.cache import cached, file_fingerprint

# Tunables. Loosened from a "clean synthetic scene" mindset to real urban ones.
MIN_ELONGATION = 2.8     # sqrt(lambda_max / lambda_min)
MAX_SEGMENTS = 80
MIN_AREA_FRAC = 0.0004   # of the working frame
MAX_AREA_FRAC = 0.30
MIN_WIDTH_PX = 1.5
MAX_WIDTH_RATIO = 0.22   # effective width / major length — a road is thin
# A road ribbon fills its own rotated rectangle; a block, plaza or L-shaped
# cluster of buildings does not. This is the main guard against reporting
# whole city blocks as roads.
MIN_RECT_FILL = 0.45


def _read_bgr(image_path: Path):
    try:
        import cv2
    except Exception:
        return None
    img = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if img is not None:
        return img
    try:
        import numpy as np
        from PIL import Image

        with Image.open(image_path) as pil:
            return cv2.cvtColor(np.asarray(pil.convert("RGB")), cv2.COLOR_RGB2BGR)
    except Exception:
        return None


def _close_multidirectional(mask, length: int = 15, width: int = 3):
    """Close the mask with linear kernels at 0/45/90/135 degrees, keep the max.

    A single isotropic closing would also merge the gaps *between* parallel
    streets into solid blocks; directional kernels only bridge gaps that lie
    along one road direction.
    """
    import cv2
    import numpy as np

    best = np.zeros_like(mask)
    base = np.zeros((length, width), np.uint8)
    base[length // 2, :] = 1
    for angle in (0, 45, 90, 135):
        m = cv2.getRotationMatrix2D((width / 2 - 0.5, length / 2 - 0.5), angle, 1.0)
        k = cv2.warpAffine(base, m, (width, length), flags=cv2.INTER_NEAREST)
        if k.sum() == 0:
            continue
        closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k)
        best = np.maximum(best, closed)
    return best


def _shape_stats(comp) -> Tuple[float, float, float, float] | None:
    """(elongation, major_len, minor_len, effective_width) from pixel moments."""
    try:
        import cv2
        import numpy as np

        area = float(cv2.countNonZero(comp))
        if area < 1:
            return None
        m = cv2.moments(comp, binaryImage=True)
        if abs(m["m00"]) < 1:
            return None
        mu20 = m["mu20"] / m["m00"]   # variance along x
        mu02 = m["mu02"] / m["m00"]   # variance along y
        mu11 = m["mu11"] / m["m00"]   # covariance
        cov = np.array([[mu20, mu11], [mu11, mu02]], dtype=np.float64)
        evals = np.linalg.eigvalsh(cov)
        evals = np.clip(evals, 0.0, None)
        lam_max, lam_min = float(evals[1]), float(evals[0])
        major = 4.0 * float(np.sqrt(lam_max))   # ~full length of the blob
        minor = 4.0 * float(np.sqrt(lam_min))
        elong = float(np.sqrt(lam_max / lam_min)) if lam_min > 1e-6 else 99.0
        width = area / major if major > 1e-6 else area
        return elong, major, minor, width
    except Exception:
        return None


def detect_roads(
    image_path: str | Path,
    max_dim: int = 1200,
    conf_threshold: float = 0.25,
) -> List[Dict[str, Any]]:
    """Find road-like corridors (memoised). Never raises for a bad image.

    Returns [{"class": "road", "class_id": 0, "confidence": float,
              "bbox": [x1,y1,x2,y2], "polygon": [[x,y]...], "length_px": float,
              "width_px": float, "method": "classical-road"}, ...]
    """
    path = Path(image_path)
    if not path.is_file():
        return []
    key = ("roads", int(max_dim), round(float(conf_threshold), 4)) + file_fingerprint(path)
    result, _hit = cached(
        key, lambda: _detect_roads_uncached(path, int(max_dim), float(conf_threshold))
    )
    return result


def _detect_roads_uncached(
    image_path: Path,
    max_dim: int = 1200,
    conf_threshold: float = 0.25,
) -> List[Dict[str, Any]]:
    try:
        import cv2
        import numpy as np
    except Exception:
        return []

    bgr_full = _read_bgr(image_path)
    if bgr_full is None:
        return []
    full_h, full_w = bgr_full.shape[:2]
    if full_w < 60 or full_h < 60:
        return []

    scale = 1.0
    longest = max(full_w, full_h)
    if longest > max_dim:
        scale = max_dim / float(longest)
        bgr_work = cv2.resize(
            bgr_full, (int(full_w * scale), int(full_h * scale)),
            interpolation=cv2.INTER_AREA,
        )
    else:
        bgr_work = bgr_full
    work_h, work_w = bgr_work.shape[:2]
    work_area = float(work_w * work_h)
    inv_scale = 1.0 / scale if scale else 1.0

    hsv = cv2.cvtColor(bgr_work, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    b_ch, g_ch, r_ch = cv2.split(bgr_work)
    exg = 2 * g_ch.astype(np.int16) - r_ch.astype(np.int16) - b_ch.astype(np.int16)

    # Adaptive asphalt window from this image's own distribution. The upper
    # value bound is deliberately at the 70th percentile: concrete roofs and
    # plazas are also grey and low-saturation, but they are brighter, and
    # letting them in merges whole blocks into "roads".
    s_lo = float(np.percentile(s, 60))
    v_lo = float(np.percentile(v, 25))
    v_hi = float(np.percentile(v, 70))
    road_like = (s <= min(90.0, max(35.0, s_lo))) & (v >= max(25.0, v_lo * 0.75)) & (v <= v_hi)
    # Parks/trees and water are not tarmac.
    green = (exg > 10) | ((h >= 35) & (h <= 95) & (s >= 30))
    water = (h >= 100) & (h <= 200) & (s >= 45)
    mask = (road_like & ~green & ~water).astype(np.uint8) * 255
    if cv2.countNonZero(mask) == 0:
        return []

    # Roads are darker than their surroundings; suppress very dark pixels
    # (deep shadow) which otherwise form huge elongated blobs.
    dark = v < float(np.percentile(v, 12))
    mask[dark] = 0

    k3 = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k3, iterations=1)
    mask = _close_multidirectional(mask)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k3, iterations=1)

    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    area_lo = max(40.0, MIN_AREA_FRAC * work_area)
    area_hi = MAX_AREA_FRAC * work_area

    cands: List[Tuple[List[float], float, float, float]] = []
    for i in range(1, n):
        area = float(stats[i, cv2.CC_STAT_AREA])
        if area < area_lo or area > area_hi:
            continue
        comp = ((lab == i).astype(np.uint8)) * 255
        st = _shape_stats(comp)
        if st is None:
            continue
        elong, major, minor, width = st
        if elong < MIN_ELONGATION:
            continue
        if width < MIN_WIDTH_PX or width > MAX_WIDTH_RATIO * major:
            continue
        # A genuine road is a modest fraction of its own bounding box.
        cnts, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            continue
        cnt = max(cnts, key=cv2.contourArea)
        rect = cv2.minAreaRect(cnt)
        rw, rh = float(rect[1][0]), float(rect[1][1])
        rect_area = max(1e-6, rw * rh)
        rect_fill = area / rect_area
        # Ribbon test: fills its own rotated box (road) vs. a ragged cluster
        # of blocks (building block / plaza), which is the dominant
        # false-positive in dense frames.
        if rect_fill < MIN_RECT_FILL:
            continue
        cands.append((list(rect), elong, width, major))

    if not cands:
        return []

    # Prefer the longest corridors, then NMS on axis-aligned boxes to drop the
    # overlapping duplicates produced by closing at several angles.
    cands.sort(key=lambda c: -c[3])
    boxes: List[List[int]] = []
    scores: List[float] = []
    keep_meta: List[Tuple[List[float], float, float]] = []
    for rect, elong, width, major in cands:
        (cx, cy), (rw, rh), _ang = rect
        x1, y1 = int(cx - rw / 2), int(cy - rh / 2)
        x2, y2 = int(cx + rw / 2), int(cy + rh / 2)
        cand_box = [x1, y1, x2, y2]
        dup = False
        for kb in boxes:
            ix1, iy1 = max(cand_box[0], kb[0]), max(cand_box[1], kb[1])
            ix2, iy2 = min(cand_box[2], kb[2]), min(cand_box[3], kb[3])
            inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
            aa = (cand_box[2] - cand_box[0]) * (cand_box[3] - cand_box[1])
            bb = (kb[2] - kb[0]) * (kb[3] - kb[1])
            u = aa + bb - inter
            if u > 0 and inter / u > 0.35:
                dup = True
                break
        if dup:
            continue
        # Confidence: elongation and how well the blob fills its own length.
        elong_score = min(1.0, (elong - MIN_ELONGATION) / 6.0)
        width_score = 1.0 - min(1.0, abs(width - 6.0) / 18.0)
        conf = max(0.30, min(0.88, 0.45 + 0.35 * elong_score + 0.20 * width_score))
        if conf < conf_threshold:
            continue
        boxes.append(cand_box)
        scores.append(conf)
        keep_meta.append((rect, width, major))
        if len(boxes) >= MAX_SEGMENTS:
            break

    out: List[Dict[str, Any]] = []
    for (rect, width, major), conf in zip(keep_meta, scores):
        (cx, cy), (rw, rh), _ = rect
        corners = cv2.boxPoints(rect)
        poly = [
            [min(max(float(px * inv_scale), 0.0), float(full_w - 1)),
             min(max(float(py * inv_scale), 0.0), float(full_h - 1))]
            for px, py in corners
        ]
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        out.append(
            {
                "class": "road",
                "class_id": 0,
                "confidence": round(float(conf), 4),
                "bbox": [
                    int(max(0, min(xs))), int(max(0, min(ys))),
                    int(min(full_w - 1, max(xs))), int(min(full_h - 1, max(ys))),
                ],
                "polygon": [[round(px, 1), round(py, 1)] for px, py in poly],
                "length_px": round(float(major * inv_scale), 1),
                "width_px": round(float(width * inv_scale), 1),
                "method": "classical-road",
            }
        )
    out.sort(key=lambda d: -d["confidence"])
    return out
