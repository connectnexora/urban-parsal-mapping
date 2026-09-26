# Classical rooftop/building fallback detector (no training weights needed).
#
# Used when the loaded YOLO model has no 'building' class (e.g. generic COCO
# yolov8n.pt). Runs real computer vision on the image itself — nothing is
# hardcoded or invented:
#   1. Remove thin yellow parcel overlays (inpaint) so they don't become edges.
#   2. Colour branch: adaptive k-means (K=8) on a downsampled copy; each colour
#      cluster is cleaned and its connected components are filtered by
#      area / rectangularity / solidity / vegetation (ExG).
#   3. Bright-roof branch: HSV bright low-saturation mask for white/grey roofs.
#   4. Edge branch: Canny -> dilate -> invert -> enclosed-region components
#      filtered by shape + flatness (local std) + vegetation.
#   5. Merge all branches with IoU-NMS, filter by confidence threshold.
#
# Returns building-only boxes shaped like YOLO detections:
#   {"class": "building", "class_id": 0, "confidence": float, "bbox": [x1,y1,x2,y2]}
# Confidence is a heuristic (rectangularity/solidity/fill), NOT a learned
# score — but geometry is computed from the image.

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Tuple


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
            rgb = pil.convert("RGB")
            arr = np.asarray(rgb)
            return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    except Exception:
        return None


def _inpaint_yellow(bgr):
    """Remove thin yellow parcel overlays. Never raises; returns input on failure."""
    try:
        import cv2
        import numpy as np
        hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
        b, g, r = cv2.split(bgr)
        H, S, V = cv2.split(hsv)
        r_i = r.astype(np.int16)
        g_i = g.astype(np.int16)
        tight = (
            (H >= 24) & (H <= 38) & (S > 110) & (V > 130)
            & (b < 110) & (r > 140) & (g > 140)
            & (np.abs(r_i - g_i) < 50)
        )
        mask = (tight.astype(np.uint8)) * 255
        if (mask > 0).mean() > 0.0005:
            d = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=1)
            return cv2.inpaint(bgr, d, 3, cv2.INPAINT_TELEA)
        return bgr
    except Exception:
        return bgr


def _iou(a: List[float], b: List[float]) -> float:
    try:
        ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
        ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
        iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
        inter = iw * ih
        if inter <= 0:
            return 0.0
        aa = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
        bb = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
        u = aa + bb - inter
        return inter / u if u > 0 else 0.0
    except Exception:
        return 0.0


def _nms(boxes: List[List[int]], scores: List[float], thr: float = 0.25) -> List[int]:
    try:
        import numpy as np
        if not boxes:
            return []
        order = np.argsort(np.asarray(scores, dtype=float))[::-1]
        keep: List[int] = []
        suppressed = np.zeros(len(boxes), dtype=bool)
        for pos, idx in enumerate(order):
            if suppressed[idx]:
                continue
            keep.append(int(idx))
            for j in order[pos + 1:]:
                if suppressed[j]:
                    continue
                if _iou(boxes[idx], boxes[j]) >= thr:
                    suppressed[j] = True
        return keep
    except Exception:
        return list(range(len(boxes)))


def _exg_mean(bgr_crop, mask) -> float:
    """Excess-green mean inside mask; high values mean vegetation."""
    try:
        import numpy as np
        import cv2
        if mask.sum() < 10:
            return 0.0
        bc, gc, rc = cv2.split(bgr_crop)
        exg = (2 * gc.astype(np.int16) - rc.astype(np.int16) - bc.astype(np.int16))
        vals = exg[mask > 0]
        if vals.size == 0:
            return 0.0
        return float(vals.mean())
    except Exception:
        return 0.0


def _component_shapes(mask_comp, area_px: float):
    """Compute solidity/rect-fit/vertices for a binary component. Returns None on failure."""
    try:
        import cv2
        cnts, _ = cv2.findContours(mask_comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            return None
        cnt = max(cnts, key=cv2.contourArea)
        hull = cv2.convexHull(cnt)
        hull_area = float(cv2.contourArea(hull))
        solid = area_px / (hull_area + 1e-6)
        peri = float(cv2.arcLength(cnt, True))
        if peri < 1:
            return None
        approx = cv2.approxPolyDP(cnt, 0.025 * peri, True)
        rect = cv2.minAreaRect(cnt)
        rw, rh = float(rect[1][0]), float(rect[1][1])
        if min(rw, rh) < 1:
            return None
        rectfit = area_px / (rw * rh + 1e-6)
        return {"solidity": solid, "rectfit": rectfit, "verts": len(approx)}
    except Exception:
        return None


def detect_rooftops(
    image_path: str | Path,
    conf_threshold: float = 0.25,
    max_dim: int = 1200,
) -> List[Dict[str, Any]]:
    """Detect building rooftops with classical CV. Never raises for bad images.

    Args:
        image_path: image file to analyse.
        conf_threshold: keep boxes with heuristic confidence >= this.
        max_dim: working-resolution cap; boxes are mapped back to original px.

    Returns:
        List of {"class": "building", "class_id": 0, "confidence": float,
                 "bbox": [x1, y1, x2, y2], "method": "classical-rooftop"}.
        Empty list means nothing rectangular passed the filters (honest).
    """
    try:
        import cv2
        import numpy as np
    except Exception:
        return []

    try:
        conf_threshold = float(max(0.01, min(0.99, conf_threshold)))
    except Exception:
        conf_threshold = 0.25

    try:
        image_path = Path(image_path)
        if not image_path.is_file():
            return []
        bgr_full = _read_bgr(image_path)
        if bgr_full is None:
            return []
        full_h, full_w = bgr_full.shape[:2]
        if full_w < 40 or full_h < 40:
            return []
        img_area_full = float(full_w * full_h)

        # Working resolution (bound runtime on drone frames).
        scale = 1.0
        longest = max(full_w, full_h)
        if longest > max_dim:
            scale = max_dim / float(longest)
            work_w, work_h = int(full_w * scale), int(full_h * scale)
            bgr_work = cv2.resize(bgr_full, (work_w, work_h), interpolation=cv2.INTER_AREA)
        else:
            bgr_work = bgr_full
            work_w, work_h = full_w, full_h
        work_area = float(work_w * work_h)
        inv_scale = 1.0 / scale if scale else 1.0

        inp = _inpaint_yellow(bgr_work)
        try:
            smooth = cv2.bilateralFilter(inp, 7, 60, 60)
        except Exception:
            smooth = inp
        try:
            gray = cv2.cvtColor(smooth, cv2.COLOR_BGR2GRAY)
        except Exception:
            return []

        # Local texture (flat rooftops have low std; trees/roads higher).
        try:
            gf = gray.astype(np.float32)
            mean = cv2.boxFilter(gf, -1, (9, 9))
            sqm = cv2.boxFilter(gf * gf, -1, (9, 9))
            std = np.sqrt(np.maximum(sqm - mean * mean, 0.0))
        except Exception:
            std = None

        cands: List[Tuple[List[int], float]] = []  # (work-box, score)

        # ---- Branch 1: adaptive colour (k-means) ----
        try:
            cv2.setRNGSeed(0)
            small = cv2.resize(smooth, (360, 252), interpolation=cv2.INTER_AREA)
            data = small.reshape(-1, 3).astype(np.float32)
            criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
            K = 8
            _, lab_small, _ = cv2.kmeans(data, K, None, criteria, 2, cv2.KMEANS_PP_CENTERS)
            labels = cv2.resize(
                lab_small.reshape(small.shape[:2]).astype(np.uint8),
                (work_w, work_h), interpolation=cv2.INTER_NEAREST,
            )
            k3 = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
            k7 = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
            for k in range(K):
                mask = ((labels == k).astype(np.uint8)) * 255
                # Open small specks, close ridge gaps (same roof halves merge).
                try:
                    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k3, iterations=1)
                    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k7, iterations=1)
                except Exception:
                    pass
                n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
                for i in range(1, n):
                    area = float(stats[i, cv2.CC_STAT_AREA])
                    if area < 0.0009 * work_area or area > 0.075 * work_area:
                        continue
                    x = int(stats[i, cv2.CC_STAT_LEFT]); y = int(stats[i, cv2.CC_STAT_TOP])
                    bw = int(stats[i, cv2.CC_STAT_WIDTH]); bh = int(stats[i, cv2.CC_STAT_HEIGHT])
                    if bw < 22 or bh < 22:
                        continue
                    asp = max(bw, bh) / (min(bw, bh) + 1e-6)
                    if asp > 3.4:
                        continue
                    fill = area / (bw * bh + 1e-6)
                    if fill < 0.48:
                        continue
                    comp = ((lab == i).astype(np.uint8)) * 255
                    shp = _component_shapes(comp, area)
                    if shp is None:
                        continue
                    if shp["solidity"] < 0.68 or shp["rectfit"] < 0.52:
                        continue
                    if shp["verts"] < 4 or shp["verts"] > 9:
                        continue
                    # Vegetation reject.
                    x1c, y1c = max(0, x), max(0, y)
                    x2c, y2c = min(work_w, x + bw), min(work_h, y + bh)
                    if x2c <= x1c or y2c <= y1c:
                        continue
                    crop = inp[y1c:y2c, x1c:x2c]
                    m = ((lab[y1c:y2c, x1c:x2c] == i).astype(np.uint8)) * 255
                    # Align mask if component was clipped (rare).
                    try:
                        if m.shape[:2] != crop.shape[:2]:
                            continue
                    except Exception:
                        continue
                    if _exg_mean(crop, m) > 30:
                        continue
                    score = 0.35 + 0.25 * min(1.0, shp["rectfit"]) + 0.20 * min(1.0, shp["solidity"]) + 0.10 * min(1.0, fill)
                    touches = (x <= 2 or y <= 2 or x + bw >= work_w - 2 or y + bh >= work_h - 2)
                    if touches:
                        score -= 0.10
                    score = max(0.45, min(0.92, score))
                    cands.append(([x, y, x + bw, y + bh], float(score)))
        except Exception:
            pass

        # ---- Branch 2: bright roofs (white / light grey) ----
        try:
            hsv = cv2.cvtColor(inp, cv2.COLOR_BGR2HSV)
            _, S, V = cv2.split(hsv)
            bright = ((V > 165) & (S < 90)).astype(np.uint8) * 255
            k3b = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
            k5b = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
            bright = cv2.morphologyEx(bright, cv2.MORPH_OPEN, k3b, iterations=1)
            bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, k5b, iterations=1)
            n, lab, stats, _ = cv2.connectedComponentsWithStats(bright, connectivity=8)
            for i in range(1, n):
                area = float(stats[i, cv2.CC_STAT_AREA])
                if area < 0.0008 * work_area or area > 0.06 * work_area:
                    continue
                x = int(stats[i, cv2.CC_STAT_LEFT]); y = int(stats[i, cv2.CC_STAT_TOP])
                bw = int(stats[i, cv2.CC_STAT_WIDTH]); bh = int(stats[i, cv2.CC_STAT_HEIGHT])
                if bw < 22 or bh < 22:
                    continue
                asp = max(bw, bh) / (min(bw, bh) + 1e-6)
                if asp > 3.2:
                    continue
                fill = area / (bw * bh + 1e-6)
                if fill < 0.50:
                    continue
                comp = ((lab == i).astype(np.uint8)) * 255
                shp = _component_shapes(comp, area)
                if shp is None:
                    continue
                if shp["solidity"] < 0.70 or shp["rectfit"] < 0.55:
                    continue
                if shp["verts"] < 4 or shp["verts"] > 8:
                    continue
                score = 0.40 + 0.25 * shp["rectfit"] + 0.20 * shp["solidity"] + 0.10 * fill
                score = max(0.50, min(0.90, float(score)))
                cands.append(([x, y, x + bw, y + bh], float(score)))
        except Exception:
            pass

        # ---- Branch 3: edge-enclosed regions ----
        try:
            edges = cv2.Canny(gray, 80, 180)
            dil = cv2.dilate(edges, np.ones((5, 5), np.uint8), iterations=1)
            inv = cv2.bitwise_not(dil)
            contours, _ = cv2.findContours(inv, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
            for cnt in contours:
                area = float(cv2.contourArea(cnt))
                if area < 0.0011 * work_area or area > 0.07 * work_area:
                    continue
                x, y, bw, bh = cv2.boundingRect(cnt)
                if bw < 26 or bh < 26:
                    continue
                asp = max(bw, bh) / (min(bw, bh) + 1e-6)
                if asp > 3.2:
                    continue
                peri = float(cv2.arcLength(cnt, True))
                if peri < 80:
                    continue
                approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
                if len(approx) < 4 or len(approx) > 8:
                    continue
                hull = cv2.convexHull(cnt)
                solid = area / (float(cv2.contourArea(hull)) + 1e-6)
                if solid < 0.70:
                    continue
                rect = cv2.minAreaRect(cnt)
                rw, rh = float(rect[1][0]), float(rect[1][1])
                if min(rw, rh) < 1:
                    continue
                rf = area / (rw * rh + 1e-6)
                if rf < 0.55:
                    continue
                fill = area / (bw * bh + 1e-6)
                if fill < 0.52:
                    continue
                # Flatness: mean local std inside the region.
                try:
                    m = np.zeros((bh, bw), dtype=np.uint8)
                    shifted = cnt - np.array([[[x, y]]])
                    cv2.drawContours(m, [shifted], -1, 255, -1)
                    if std is not None:
                        vals = std[y:y + bh, x:x + bw][m > 0]
                        sm = float(vals.mean()) if vals.size else 99.0
                        if sm > 16:
                            continue
                    else:
                        sm = 8.0
                except Exception:
                    continue
                try:
                    crop = inp[y:y + bh, x:x + bw]
                    if crop.shape[:2] != m.shape[:2]:
                        continue
                    if _exg_mean(crop, m) > 30:
                        continue
                except Exception:
                    continue
                score = 0.30 + 0.28 * min(1.0, rf) + 0.20 * min(1.0, solid) + 0.12 * min(1.0, fill)
                score = max(0.45, min(0.88, float(score)))
                cands.append(([x, y, x + bw, y + bh], float(score)))
        except Exception:
            pass

        if not cands:
            return []

        # Map back to ORIGINAL pixels, clip, drop degenerate.
        orig_boxes: List[List[int]] = []
        orig_scores: List[float] = []
        for (x1, y1, x2, y2), s in cands:
            try:
                X1 = int(round(x1 * inv_scale)); Y1 = int(round(y1 * inv_scale))
                X2 = int(round(x2 * inv_scale)); Y2 = int(round(y2 * inv_scale))
                X1, Y1 = max(0, X1), max(0, Y1)
                X2, Y2 = min(full_w - 1, X2), min(full_h - 1, Y2)
                if X2 - X1 < 12 or Y2 - Y1 < 12:
                    continue
                if (X2 - X1) * (Y2 - Y1) < 0.0006 * img_area_full:
                    continue
                if (X2 - X1) * (Y2 - Y1) > 0.10 * img_area_full:
                    continue
                orig_boxes.append([X1, Y1, X2, Y2])
                orig_scores.append(float(s))
            except Exception:
                continue

        if not orig_boxes:
            return []

        keep = _nms(orig_boxes, orig_scores, thr=0.25)
        out: List[Dict[str, Any]] = []
        for idx in keep:
            try:
                sc = float(orig_scores[idx])
                if sc < conf_threshold:
                    continue
                out.append({
                    "class": "building",
                    "class_id": 0,
                    "confidence": round(max(0.01, min(0.99, sc)), 4),
                    "bbox": [int(v) for v in orig_boxes[idx]],
                    "method": "classical-rooftop",
                })
            except Exception:
                continue
        # Deterministic order: highest confidence first.
        out.sort(key=lambda d: -d["confidence"])
        return out
    except Exception:
        return []
