# Optional urban change-detection module (Image A older vs Image B newer).
#
# Compares two drone/aerial frames with computer vision and attempts to
# identify: new buildings, removed structures, changed parcel areas, new
# roads and construction areas. Every item is labelled UNCHANGED / NEW /
# REMOVED / CHANGED. Nothing is invented:
#   - YOLO detections on both frames (when a model is loaded) are matched by
#     IoU for NEW / REMOVED / UNCHANGED buildings and roads.
#   - Parcel polygons on both frames (classical fallback) are matched for
#     UNCHANGED / CHANGED / NEW / REMOVED parcel areas.
#   - A structural absdiff branch finds changed regions; large unexplained
#     regions become "potential construction zones", small ones "changed
#     areas". Regions already explained by NEW/REMOVED detections are skipped.
# When the YOLO model or parcel service is unavailable, the affected
# categories come back EMPTY with explicit reasons.
#
# All coordinates are reported in Image-A pixel space (Image B is warped
# onto A when alignment succeeds). Results are AI estimates — the response
# and UI state they must be verified by a surveyor or relevant authority.

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Tuple

try:
    from services.detection import (
        get_model_status,
        run_detection,
        _is_building_label,
    )
    from services.features import _is_road_label
    from services.parcels import extract_parcels, get_parcel_status
except ImportError:  # allow `uvicorn backend.main:app` from the project root
    from backend.services.detection import (
        get_model_status,
        run_detection,
        _is_building_label,
    )
    from backend.services.features import _is_road_label
    from backend.services.parcels import extract_parcels, get_parcel_status

CHANGE_STATUSES = ("UNCHANGED", "NEW", "REMOVED", "CHANGED")

# BGR for OpenCV annotation, HEX for the frontend legend.
CHANGE_COLORS_BGR = {
    "NEW": (46, 204, 113),       # green
    "REMOVED": (113, 113, 248),  # red-ish
    "CHANGED": (36, 191, 251),   # amber
    "UNCHANGED": (160, 160, 160),  # gray
}
CHANGE_COLORS_HEX = {
    "NEW": "#2ecc71",
    "REMOVED": "#f87171",
    "CHANGED": "#fbbf24",
    "UNCHANGED": "#a0a0a0",
}

CHANGE_DISCLAIMER = (
    "Detected changes are AI estimates for visualisation and analysis only. "
    "They must be verified by a surveyor or relevant authority before any "
    "planning, legal or cadastral use. NOT legally valid boundaries."
)

CHANGE_HELP = (
    "Upload two overlapping drone/aerial frames of the same area "
    "(Image A = older, Image B = newer). Best results come from repeat-pass "
    "imagery with similar viewpoint, lighting and resolution."
)

# Heuristic: diff regions at/above this fraction of the frame become
# "potential construction zones", smaller ones "changed areas".
CONSTRUCTION_FRACTION = 0.02
# Minimum diff-region area in working-scale px (filters sensor noise).
DIFF_MIN_AREA_PX = 120.0
# IoU thresholds for matching boxes across frames / parcels.
MATCH_IOU = 0.5
PARCEL_SAME_IOU = 0.8
PARCEL_CHANGED_IOU = 0.25
PARCEL_AREA_CHANGE = 0.25
# Cap so a noisy pair cannot flood the response / map.
MAX_CHANGES = 200


# ---------------------------------------------------------------------------
# Small geometry + IO helpers (local copies: no cross-module private imports)
# ---------------------------------------------------------------------------
def _read_bgr(image_path: Path):
    import cv2

    img = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if img is not None:
        return img
    import numpy as np
    from PIL import Image

    with Image.open(image_path) as pil:
        rgb = pil.convert("RGB")
        return cv2.cvtColor(np.asarray(rgb), cv2.COLOR_RGB2BGR)


def _to_working(bgr, max_side: int = 640):
    """Downscale for the comparison branch. Returns (img, scale)."""
    import cv2

    h, w = bgr.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    if scale < 1.0:
        return cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA), scale
    return bgr, 1.0


def _align_ecc(a_gray, b_gray) -> Tuple[Any, bool, str]:
    """Estimate an affine warp B->A with ECC on small grayscale copies."""
    import cv2
    import numpy as np

    try:
        h, w = a_gray.shape[:2]
        # Work at ~320px for speed; ECC is iterative.
        s = min(1.0, 320.0 / max(h, w))
        a_small = cv2.resize(a_gray, (int(w * s), int(h * s))) if s < 1.0 else a_gray
        b_small = cv2.resize(b_gray, (int(w * s), int(h * s))) if s < 1.0 else b_gray
        warp = np.eye(2, 3, dtype=np.float32)
        criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-4)
        _cc, warp = cv2.findTransformECC(a_small, b_small, warp, cv2.MOTION_AFFINE, criteria, None, 1)
        # Rescale the translation part back to working resolution.
        warp = warp.copy()
        warp[:, 2] = warp[:, 2] / s
        return warp, True, "ECC affine alignment succeeded."
    except Exception as exc:
        import numpy as np

        return np.eye(2, 3, dtype=np.float32), False, f"ECC alignment failed ({exc}); compared unaligned."


def _diff_regions(a_gray, b_warped, min_area_px: float) -> List[Dict[str, Any]]:
    """Structural diff -> simplified polygon regions in working coords."""
    import cv2
    import numpy as np

    diff = cv2.absdiff(a_gray, b_warped)
    blur = cv2.GaussianBlur(diff, (5, 5), 0)
    _, binary = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if float(binary.mean()) < 2.0:
        # Nearly identical frames — nothing to report structurally.
        return []
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    cleaned = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=2)
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_OPEN, kernel, iterations=1)
    contours, _ = cv2.findContours(cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    regions: List[Dict[str, Any]] = []
    for cnt in contours:
        area = float(cv2.contourArea(cnt))
        if area < min_area_px:
            continue
        peri = float(cv2.arcLength(cnt, True))
        approx = cv2.approxPolyDP(cnt, max(1.0, 0.015 * peri), True)
        if len(approx) < 3:
            continue
        x, y, w, h = cv2.boundingRect(approx)
        poly = [[float(p[0][0]), float(p[0][1])] for p in approx]
        if poly[0] != poly[-1]:
            poly = poly + [poly[0]]
        regions.append({
            "bbox": [int(x), int(y), int(x + w), int(y + h)],
            "polygon": poly,
            "area_px": area,
        })
    regions.sort(key=lambda r: r["area_px"], reverse=True)
    return regions


def _iou(a: List[float], b: List[float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    aa = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    bb = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = aa + bb - inter
    return inter / union if union > 0 else 0.0


def _overlap_frac(inner: List[float], outer: List[float]) -> float:
    """Fraction of `inner` box area covered by `outer` box."""
    ix1, iy1 = max(inner[0], outer[0]), max(inner[1], outer[1])
    ix2, iy2 = min(inner[2], outer[2]), min(inner[3], outer[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    area = max(0.0, inner[2] - inner[0]) * max(0.0, inner[3] - inner[1])
    return inter / area if area > 0 else 0.0


def _rect_polygon(bbox: List[float]) -> List[List[float]]:
    x1, y1, x2, y2 = (float(v) for v in bbox)
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]


def _scale_box(bbox: List[float], s: float) -> List[int]:
    x1, y1, x2, y2 = (float(v) * s for v in bbox)
    return [int(round(x1)), int(round(y1)), int(round(x2)), int(round(y2))]


def _scale_poly(poly: List[List[float]], s: float) -> List[List[float]]:
    return [[round(float(x) * s, 1), round(float(y) * s, 1)] for x, y in poly]


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------
def detect_changes(
    image_a: str | Path,
    image_b: str | Path,
    conf: float = 0.25,
    iou: float = 0.45,
    align: bool = True,
    gsd: float = 0.1,
    work_dim: int = 640,
) -> Dict[str, Any]:
    """Compare older Image A vs newer Image B. Coordinates in A pixel space."""
    import cv2

    image_a, image_b = Path(image_a), Path(image_b)
    if not image_a.is_file():
        raise FileNotFoundError(f"Image A not found: {image_a}")
    if not image_b.is_file():
        raise FileNotFoundError(f"Image B not found: {image_b}")
    conf = float(max(0.01, min(0.99, conf)))
    iou = float(max(0.01, min(0.99, iou)))
    gsd = float(max(0.001, min(10.0, gsd)))

    a_full = _read_bgr(image_a)
    b_full = _read_bgr(image_b)
    if a_full is None:
        raise RuntimeError(f"Could not decode image A: {image_a}")
    if b_full is None:
        raise RuntimeError(f"Could not decode image B: {image_b}")
    ah, aw = a_full.shape[:2]
    bh, bw = b_full.shape[:2]

    # Working resolution + B resized onto A's frame (comparison space = A).
    a_work, a_scale = _to_working(a_full, work_dim)
    b_fit = cv2.resize(b_full, (aw, ah), interpolation=cv2.INTER_AREA) if (bw, bh) != (aw, ah) else b_full
    resized_note = (
        "Image B resampled to Image-A dimensions for comparison."
        if (bw, bh) != (aw, ah) else "Both frames share dimensions; no resampling needed."
    )
    b_work, _ = _to_working(b_fit, work_dim)
    # Working scale maps working px -> A px (same for both after resampling).
    to_a = 1.0 / a_scale if a_scale else 1.0

    a_gray = cv2.cvtColor(a_work, cv2.COLOR_BGR2GRAY)
    b_gray = cv2.cvtColor(b_work, cv2.COLOR_BGR2GRAY)

    warnings: List[str] = [resized_note]
    aligned = False
    if align:
        warp, aligned, note = _align_ecc(a_gray, b_gray)
        warnings.append(note)
        if aligned:
            h, w = b_gray.shape[:2]
            b_gray = cv2.warpAffine(b_gray, warp, (w, h),
                                   flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP,
                                   borderMode=cv2.BORDER_REPLICATE)
    else:
        warnings.append("Alignment disabled by caller; compared unaligned.")

    # --- YOLO on both frames (honest degradation when the model is missing).
    model_status = get_model_status()
    dets_a: List[Dict[str, Any]] = []
    dets_b: List[Dict[str, Any]] = []
    if model_status["loaded"]:
        try:
            dets_a = run_detection(image_a, conf=conf, iou=iou)["all_detections"]
        except Exception as exc:
            warnings.append(f"YOLO on Image A failed ({exc}); A-side objects unknown.")
        try:
            dets_b = run_detection(image_b, conf=conf, iou=iou)["all_detections"]
        except Exception as exc:
            warnings.append(f"YOLO on Image B failed ({exc}); B-side objects unknown.")
    else:
        warnings.append(
            "YOLO model unavailable — building/road change categories are empty. "
            "Structural diff + parcel fallback still run."
        )
    # B boxes live in B pixels; map them into A space (B was resampled to A).
    sx, sy = (aw / bw) if bw else 1.0, (ah / bh) if bh else 1.0
    dets_b_a = [
        {**d, "bbox": [
            int(round(d["bbox"][0] * sx)), int(round(d["bbox"][1] * sy)),
            int(round(d["bbox"][2] * sx)), int(round(d["bbox"][3] * sy))]}
        for d in dets_b
    ]

    # --- Parcels on both frames (bounded cost; guarded).
    parcels_a: List[Dict[str, Any]] = []
    parcels_b: List[Dict[str, Any]] = []
    parcel_reason: str | None = None
    if get_parcel_status().get("ready"):
        try:
            parcels_a = extract_parcels(
                image_a, gsd=gsd, max_dim=1200, max_parcels=30)["parcels"]
        except Exception as exc:
            parcel_reason = f"Parcel extraction on Image A failed ({exc})."
        try:
            res_b = extract_parcels(
                image_b, gsd=gsd, max_dim=1200, max_parcels=30)
            # Map B polygons into A space.
            parcels_b = [
                {**p,
                 "polygon": [[round(x * sx, 1), round(y * sy, 1)] for x, y in p["polygon"]],
                 "bbox": [p["bbox"][0] * sx, p["bbox"][1] * sy,
                          p["bbox"][2] * sx, p["bbox"][3] * sy]}
                for p in res_b["parcels"]
            ]
        except Exception as exc:
            parcel_reason = ((parcel_reason + " ") if parcel_reason else "") + \
                f"Parcel extraction on Image B failed ({exc})."
    else:
        parcel_reason = "Parcel service not ready — parcel-area comparison skipped."
    if parcel_reason:
        warnings.append(parcel_reason)

    changes: List[Dict[str, Any]] = []
    explained_boxes: List[List[float]] = []  # NEW/REMOVED footprints (A coords)

    def _emit(status: str, kind: str, label: str, bbox: List[float],
              polygon: List[List[float]] | None, confidence: float,
              method: str, area_px: float | None = None):
        x1, y1, x2, y2 = (float(v) for v in bbox)
        area = float(area_px) if area_px is not None else max(0.0, x2 - x1) * max(0.0, y2 - y1)
        changes.append({
            "status": status,
            "kind": kind,  # building | road | parcel | area | construction
            "label": label,
            "bbox": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
            "polygon": polygon or _rect_polygon([x1, y1, x2, y2]),
            "confidence": round(max(0.01, min(0.99, float(confidence))), 3),
            "method": method,
            "area_px": round(area, 1),
            "area_m2": round(area * gsd * gsd, 2),
        })

    # --- Building / road matching across frames (IoU, greedy).
    bld_a = [d for d in dets_a if _is_building_label(d.get("class", ""))]
    bld_b = [d for d in dets_b_a if _is_building_label(d.get("class", ""))]
    try:
        from services.features import _is_road_label as _road
    except ImportError:
        from backend.services.features import _is_road_label as _road
    road_a = [d for d in dets_a if _road(d.get("class", ""))]
    road_b = [d for d in dets_b_a if _road(d.get("class", ""))]

    def _match(list_a, list_b):
        used_b = set()
        pairs, only_a, only_b = [], [], []
        for i, da in enumerate(list_a):
            best, bj = 0.0, -1
            for j, db in enumerate(list_b):
                if j in used_b:
                    continue
                v = _iou([float(v) for v in da["bbox"]], [float(v) for v in db["bbox"]])
                if v > best:
                    best, bj = v, j
            if best >= MATCH_IOU and bj >= 0:
                used_b.add(bj)
                pairs.append((da, list_b[bj], best))
            else:
                only_a.append(da)
        for j, db in enumerate(list_b):
            if j not in used_b:
                only_b.append(db)
        return pairs, only_a, only_b

    b_pairs, b_only_a, b_only_b = _match(bld_a, bld_b)
    for da, db, ov in b_pairs:
        _emit("UNCHANGED", "building", db.get("class", "building"),
              [float(v) for v in db["bbox"]], _rect_polygon([float(v) for v in db["bbox"]]),
              float(db.get("confidence", 0.5)), "yolo-iou-match")
    for db in b_only_b:
        _emit("NEW", "building", db.get("class", "building"),
              [float(v) for v in db["bbox"]], _rect_polygon([float(v) for v in db["bbox"]]),
              float(db.get("confidence", 0.5)), "yolo-unmatched-B")
        explained_boxes.append([float(v) for v in db["bbox"]])
    for da in b_only_a:
        _emit("REMOVED", "building", da.get("class", "building"),
              [float(v) for v in da["bbox"]], _rect_polygon([float(v) for v in da["bbox"]]),
              float(da.get("confidence", 0.5)), "yolo-unmatched-A")
        explained_boxes.append([float(v) for v in da["bbox"]])

    r_pairs, r_only_a, r_only_b = _match(road_a, road_b)
    for da, db, ov in r_pairs:
        _emit("UNCHANGED", "road", db.get("class", "road"),
              [float(v) for v in db["bbox"]], _rect_polygon([float(v) for v in db["bbox"]]),
              float(db.get("confidence", 0.5)), "yolo-iou-match")
    for db in r_only_b:
        _emit("NEW", "road", db.get("class", "road"),
              [float(v) for v in db["bbox"]], _rect_polygon([float(v) for v in db["bbox"]]),
              float(db.get("confidence", 0.5)), "yolo-unmatched-B")
        explained_boxes.append([float(v) for v in db["bbox"]])
    for da in r_only_a:
        _emit("REMOVED", "road", da.get("class", "road"),
              [float(v) for v in da["bbox"]], _rect_polygon([float(v) for v in da["bbox"]]),
              float(da.get("confidence", 0.5)), "yolo-unmatched-A")
        explained_boxes.append([float(v) for v in da["bbox"]])

    # --- Parcel matching across frames (bbox IoU + area change).
    used_pb = set()
    for pa in parcels_a:
        best, bj = 0.0, -1
        for j, pb in enumerate(parcels_b):
            if j in used_pb:
                continue
            v = _iou([float(v) for v in pa["bbox"]], [float(v) for v in pb["bbox"]])
            if v > best:
                best, bj = v, j
        pb = parcels_b[bj] if bj >= 0 else None
        if pb is not None and best >= PARCEL_SAME_IOU:
            used_pb.add(bj)
            _emit("UNCHANGED", "parcel", pa["parcel_id"],
                  [float(v) for v in pa["bbox"]], pa["polygon"],
                  float(pa.get("confidence", 0.5)), "parcel-iou-match",
                  area_px=float(pa.get("area_px", 0)))
        elif pb is not None and best >= PARCEL_CHANGED_IOU:
            used_pb.add(bj)
            area_change = abs(float(pb.get("area_px", 0)) - float(pa.get("area_px", 0))) / max(1.0, float(pa.get("area_px", 1)))
            if area_change >= PARCEL_AREA_CHANGE:
                _emit("CHANGED", "parcel", f"{pa['parcel_id']}→{pb.get('parcel_id', '?')}",
                      [float(v) for v in pb["bbox"]], pb["polygon"],
                      round((float(pa.get("confidence", 0.5)) + float(pb.get("confidence", 0.5))) / 2, 3),
                      "parcel-area-change", area_px=float(pb.get("area_px", 0)))
                explained_boxes.append([float(v) for v in pb["bbox"]])
            else:
                _emit("UNCHANGED", "parcel", pa["parcel_id"],
                      [float(v) for v in pa["bbox"]], pa["polygon"],
                      float(pa.get("confidence", 0.5)), "parcel-iou-match",
                      area_px=float(pa.get("area_px", 0)))
        else:
            _emit("REMOVED", "parcel", pa["parcel_id"],
                  [float(v) for v in pa["bbox"]], pa["polygon"],
                  float(pa.get("confidence", 0.5)), "parcel-unmatched-A",
                  area_px=float(pa.get("area_px", 0)))
            explained_boxes.append([float(v) for v in pa["bbox"]])
    for j, pb in enumerate(parcels_b):
        if j not in used_pb:
            _emit("NEW", "parcel", pb.get("parcel_id", "parcel"),
                  [float(v) for v in pb["bbox"]], pb["polygon"],
                  float(pb.get("confidence", 0.5)), "parcel-unmatched-B",
                  area_px=float(pb.get("area_px", 0)))
            explained_boxes.append([float(v) for v in pb["bbox"]])

    # --- Structural diff regions (working scale -> A coords).
    regions = _diff_regions(a_gray, b_gray, DIFF_MIN_AREA_PX)
    frame_area = float(aw * ah)
    for r in regions:
        box_a = _scale_box(r["bbox"], to_a)
        poly_a = _scale_poly(r["polygon"], to_a)
        area_a = r["area_px"] * to_a * to_a
        if any(_overlap_frac([float(v) for v in box_a], eb) > 0.5 for eb in explained_boxes):
            continue  # already explained by a NEW/REMOVED detection above
        if area_a >= CONSTRUCTION_FRACTION * frame_area:
            _emit("CHANGED", "construction", "potential construction zone",
                  [float(v) for v in box_a], poly_a, 0.6, "structural-diff-large",
                  area_px=area_a)
        else:
            _emit("CHANGED", "area", "changed area",
                  [float(v) for v in box_a], poly_a, 0.5, "structural-diff",
                  area_px=area_a)

    # Cap output: NEW/REMOVED/CHANGED first, then UNCHANGED sample.
    prio = {"NEW": 0, "REMOVED": 1, "CHANGED": 2, "UNCHANGED": 3}
    changes.sort(key=lambda c: (prio[c["status"]], -c["area_px"]))
    changes = changes[:MAX_CHANGES]

    counts = {s: sum(1 for c in changes if c["status"] == s) for s in CHANGE_STATUSES}
    counts["total"] = len(changes)
    new_buildings = sum(1 for c in changes if c["status"] == "NEW" and c["kind"] == "building")
    removed_structures = sum(1 for c in changes if c["status"] == "REMOVED" and c["kind"] in ("building", "parcel", "road"))
    new_roads = sum(1 for c in changes if c["status"] == "NEW" and c["kind"] == "road")
    changed_parcel_areas = sum(1 for c in changes if c["status"] == "CHANGED" and c["kind"] == "parcel")
    changed_areas = sum(1 for c in changes if c["status"] == "CHANGED" and c["kind"] == "area")
    construction_zones = sum(1 for c in changes if c["status"] == "CHANGED" and c["kind"] == "construction")

    geojson = {
        "type": "FeatureCollection",
        "properties": {
            "coordinate_system": "image_pixels",
            "reference": "image_a",
            "image_a_px": [aw, ah],
            "image_b_px": [bw, bh],
            "disclaimer": CHANGE_DISCLAIMER,
        },
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "status": c["status"],
                    "kind": c["kind"],
                    "label": c["label"],
                    "confidence": c["confidence"],
                    "method": c["method"],
                    "area_m2_estimated": round(c["area_px"] * gsd * gsd, 2),
                },
                "geometry": {"type": "Polygon", "coordinates": [c["polygon"]]},
            }
            for c in changes
        ],
    }

    return {
        "changes": changes,
        "counts": counts,
        "summary": {
            "new_buildings": new_buildings,
            "removed_structures": removed_structures,
            "new_roads": new_roads,
            "changed_parcel_areas": changed_parcel_areas,
            "changed_areas": changed_areas,
            "construction_zones": construction_zones,
        },
        "image_a": {"width": aw, "height": ah},
        "image_b": {"width": bw, "height": bh},
        "reference": "image_a",
        "alignment": {"aligned": aligned, "method": "ECC-affine" if align else "disabled"},
        "gsd_m_per_px": gsd,
        "change_colors": CHANGE_COLORS_HEX,
        "geojson": geojson,
        "warnings": warnings,
        "yolo_loaded": model_status["loaded"],
        "disclaimer": CHANGE_DISCLAIMER,
        "notes": (
            "Coordinates are in Image-A (older) pixel space. "
            "YOLO-derived items carry detector confidence; structural items "
            "carry heuristic confidence. " + CHANGE_HELP
        ),
    }


def annotate_changes(image_path: str | Path, changes: List[Dict[str, Any]], output_path: str | Path) -> Path:
    """Draw color-coded change overlays onto the Image-A frame."""
    import cv2
    import numpy as np

    image_path = Path(image_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    img = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if img is None:
        from PIL import Image

        with Image.open(image_path) as pil:
            rgb = pil.convert("RGB")
            img = cv2.cvtColor(np.asarray(rgb), cv2.COLOR_RGB2BGR)
    if img is None:
        raise RuntimeError(f"Could not read image for annotation: {image_path}")
    h, w = img.shape[:2]
    overlay = img.copy()

    thickness = max(2, round(max(h, w) / 600))
    font_scale = max(0.5, max(h, w) / 1400.0)

    for c in changes or []:
        if c["status"] == "UNCHANGED":
            continue  # listed, not drawn — keeps the snapshot readable
        color = CHANGE_COLORS_BGR.get(c["status"], (255, 255, 255))
        pts = np.array([[int(round(x)), int(round(y))] for x, y in c["polygon"]], dtype=np.int32)
        if len(pts) < 3:
            continue
        cv2.fillPoly(overlay, [pts], color)
        cv2.polylines(img, [pts], True, color, thickness, cv2.LINE_AA)
        label = f"{c['status']} {c['kind']} {c['confidence']:.2f}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
        x0 = int(np.clip(pts[:, 0].min(), 0, max(0, w - tw - 12)))
        y0 = int(max(0, pts[:, 1].min() - th - 12))
        cv2.rectangle(img, (x0, y0), (x0 + tw + 8, y0 + th + 10), (6, 18, 31), -1)
        cv2.putText(img, label, (x0 + 4, y0 + th + 4),
                    cv2.FONT_HERSHEY_SIMPLEX, font_scale, color, thickness, cv2.LINE_AA)

    blended = cv2.addWeighted(overlay, 0.28, img, 0.72, 0)
    n_new = sum(1 for c in changes or [] if c["status"] == "NEW")
    n_rem = sum(1 for c in changes or [] if c["status"] == "REMOVED")
    n_chg = sum(1 for c in changes or [] if c["status"] == "CHANGED")
    banner = f"CHANGES  NEW:{n_new}  REMOVED:{n_rem}  CHANGED:{n_chg}  (AI estimates — verify)"
    (tw, th), _ = cv2.getTextSize(banner, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
    cv2.rectangle(blended, (8, 8), (8 + tw + 16, 8 + th + 16), (6, 18, 31), -1)
    cv2.putText(blended, banner, (16, 16 + th + 4),
                cv2.FONT_HERSHEY_SIMPLEX, font_scale, (251, 191, 36), thickness, cv2.LINE_AA)

    ok = cv2.imwrite(str(output_path), blended)
    if not ok:
        raise RuntimeError(f"Failed to write change image: {output_path}")
    return output_path
