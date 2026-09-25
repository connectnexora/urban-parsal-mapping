# Automated urban parcel boundary extraction (approximate, NOT cadastral).
#
# Pipeline (all real computation, nothing hardcoded):
#   drone image -> preprocessing -> segmentation -> boundary extraction
#   -> polygon generation -> polygon simplification -> parcel area calculation
#
# Segmentation strategy (honest, dependency-light):
#   1. If a deep segmentation weight is present in models/ it is preferred:
#      - YOLO-seg weights (*-seg.pt / *-seg.onnx, e.g. yolov8n-seg.pt or a
#        custom parcel/building-footprint seg model trained on SpaceNet /
#        OpenCities AI / INRIA / CrowdAI) run through `ultralytics` and their
#        masks are converted to polygons. U-Net / SAM / SAM2 weights
#        (*unet*, *sam*.pth) are *detected and reported* but need their own
#        runtime libs (torch + segment-anything / segmentation-models-pytorch),
#        so when those libs are absent the service clearly reports that and
#        falls back instead of faking results.
#   2. Otherwise a classical OpenCV fallback runs: preprocessing (downscale
#      cap, bilateral filter, CLAHE, blur) -> Otsu/adaptive segmentation +
#      morphological cleanup -> distance-transform watershed split ->
#      contour boundary extraction -> approxPolyDP polygon simplification ->
#      shapely validation + area/perimeter (px -> m^2/m via GSD).
#
# Every parcel is labelled AI-estimated/approximate and the API + UI repeat
# that these are NOT legally valid cadastral boundaries.

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Tuple

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent
MODELS_DIR = PROJECT_ROOT / "models"
OUTPUTS_DIR = PROJECT_ROOT / "outputs"

APPROX_DISCLAIMER = (
    "AI-estimated / approximate parcel boundaries for visualisation and "
    "planning exploration only. NOT legally valid cadastral boundaries. "
    "Areas and perimeters are estimates derived from pixel geometry and an "
    "assumed ground sample distance (GSD)."
)

SEG_HELP_MESSAGE = (
    "For learned segmentation, place a segmentation weight in models/ and "
    "restart the backend. Supported: YOLO-seg weights (*-seg.pt / *-seg.onnx, "
    "e.g. yolov8n-seg.pt or a custom parcel/footprint model trained on "
    "SpaceNet, OpenCities AI, INRIA Aerial, CrowdAI Mapping Challenge); "
    "U-Net weights (*unet*.pt/*.onnx, needs torch + segmentation-models-pytorch); "
    "SAM/SAM2 weights (*sam*.pth/*.pt, needs torch + segment-anything / sam2). "
    "Without those, the service uses an OpenCV watershed/contour fallback and "
    "labels results as approximate."
)

_init_error: str | None = None
_seg_status: Dict[str, Any] = {}


def _scan_seg_weights() -> Dict[str, List[str]]:
    found: Dict[str, List[str]] = {"yolo_seg": [], "unet": [], "sam": [], "other": []}
    if not MODELS_DIR.is_dir():
        return found
    for p in sorted(MODELS_DIR.iterdir()):
        if not p.is_file():
            continue
        name = p.name.lower()
        suf = p.suffix.lower()
        if suf not in {".pt", ".pth", ".onnx", ".bin"}:
            continue
        if "seg" in name and suf in {".pt", ".onnx"}:
            found["yolo_seg"].append(p.name)
        elif "unet" in name:
            found["unet"].append(p.name)
        elif "sam" in name:
            found["sam"].append(p.name)
        elif suf in {".pt", ".onnx"}:
            found["other"].append(p.name)
    return found


def init_parcel_service() -> Dict[str, Any]:
    """Probe segmentation backends safely (called at startup, never raises)."""
    global _init_error, _seg_status
    try:
        weights = _scan_seg_weights()
        cv_ok = True
        try:
            import cv2  # noqa: F401
            import numpy  # noqa: F401
            from shapely.geometry import Polygon  # noqa: F401
        except Exception as exc:
            cv_ok = False
            _init_error = f"Classical CV deps missing ({exc}). pip install -r backend/requirements.txt."
        _seg_status = {
            "ready": cv_ok,
            "classical_fallback_available": cv_ok,
            "weights_found": weights,
            "yolo_seg_available": bool(weights["yolo_seg"]),
            "unet_weights_present": weights["unet"],
            "sam_weights_present": weights["sam"],
            "disclaimer": APPROX_DISCLAIMER,
            "help": SEG_HELP_MESSAGE,
            "error": None if cv_ok else _init_error,
        }
    except Exception as exc:
        _seg_status = {
            "ready": False,
            "classical_fallback_available": False,
            "weights_found": {},
            "yolo_seg_available": False,
            "unet_weights_present": [],
            "sam_weights_present": [],
            "disclaimer": APPROX_DISCLAIMER,
            "help": SEG_HELP_MESSAGE,
            "error": str(exc),
        }
    return get_parcel_status()


def get_parcel_status() -> Dict[str, Any]:
    if not _seg_status:
        return init_parcel_service()
    return dict(_seg_status)


# ---------------------------------------------------------------------------
# Image IO / preprocessing
# ---------------------------------------------------------------------------
def _read_bgr(image_path: Path):
    import cv2

    img = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if img is not None:
        return img
    # TIF / exotic: retry via PIL -> numpy (BGR).
    import numpy as np
    from PIL import Image

    with Image.open(image_path) as pil:
        rgb = pil.convert("RGB")
        arr = np.asarray(rgb)
        return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def _preprocess(bgr, max_dim: int = 1600):
    """Downscale-cap + denoise + contrast normalisation. Returns (img, scale)."""
    import cv2

    h, w = bgr.shape[:2]
    scale = 1.0
    longest = max(h, w)
    if longest > max_dim:
        scale = max_dim / float(longest)
        bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    # Edge-preserving denoise, then CLAHE on L channel for aerial shadows.
    smooth = cv2.bilateralFilter(bgr, 7, 60, 60)
    lab = cv2.cvtColor(smooth, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l = clahe.apply(l)
    enhanced = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
    blur = cv2.GaussianBlur(enhanced, (5, 5), 0)
    return blur, scale


# ---------------------------------------------------------------------------
# Segmentation backends
# ---------------------------------------------------------------------------
def _try_yolo_seg_masks(small_bgr, conf: float = 0.25) -> Tuple[List[Any], str | None]:
    """Run a *-seg.pt model via ultralytics if one exists. Returns (masks, name)."""
    weights = _scan_seg_weights()["yolo_seg"]
    if not weights:
        return [], None
    try:
        from ultralytics import YOLO
    except Exception:
        return [], None
    last: List[Any] = []
    used: str | None = None
    for name in weights:
        try:
            model = YOLO(str(MODELS_DIR / name))
            res = model.predict(source=small_bgr, conf=conf, verbose=False)
            if res and getattr(res[0], "masks", None) is not None:
                data = res[0].masks.data  # torch tensor (n, h, w)
                try:
                    import numpy as np

                    arr = data.detach().cpu().numpy()
                except Exception:
                    arr = data.numpy() if hasattr(data, "numpy") else None
                if arr is not None:
                    last = [arr[i] for i in range(arr.shape[0])]
                    used = name
                    break
        except Exception:
            continue
    return last, used


def _classical_segments(pre, min_area_px: float) -> Tuple[List[Any], Any]:
    """Otsu + morphology + watershed split. Returns (regions, markers)."""
    import cv2
    import numpy as np

    gray = cv2.cvtColor(pre, cv2.COLOR_BGR2GRAY)
    # Otsu picks a global land-cover split; adaptive fallback for flat scenes.
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if binary.mean() < 8 or binary.mean() > 247:
        binary = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 51, 5
        )
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    opened = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=2)
    closed = cv2.morphologyEx(opened, cv2.MORPH_CLOSE, kernel, iterations=3)

    # Distance-transform watershed to split touching blocks/parcels.
    dist = cv2.distanceTransform(closed, cv2.DIST_L2, 5)
    if float(dist.max()) <= 0:
        return [], None
    _, sure_fg = cv2.threshold(dist, 0.35 * dist.max(), 255, 0)
    sure_fg = sure_fg.astype("uint8")
    sure_bg = cv2.dilate(closed, kernel, iterations=3)
    unknown = cv2.subtract(sure_bg, sure_fg)
    _, markers = cv2.connectedComponents(sure_fg)
    markers = markers + 1
    markers[unknown == 255] = 0
    markers = cv2.watershed(pre, markers)

    regions: List[Any] = []
    for label in np.unique(markers):
        if label <= 1:  # 1 = background, 0/-1 = unknown/border
            continue
        mask = (markers == label).astype("uint8") * 255
        area = float(cv2.countNonZero(mask))
        if area < min_area_px:
            continue
        regions.append(mask)
    return regions, markers


# ---------------------------------------------------------------------------
# Boundary extraction -> polygon generation -> simplification -> measurement
# ---------------------------------------------------------------------------
def _masks_to_parcels(
    masks: List[Any],
    scale: float,
    orig_w: int,
    orig_h: int,
    gsd: float,
    epsilon_factor: float,
    method: str,
) -> List[Dict[str, Any]]:
    import cv2
    import numpy as np
    from shapely.geometry import Polygon

    parcels: List[Dict[str, Any]] = []
    inv_scale = 1.0 / scale if scale else 1.0
    for mask in masks:
        m = (np.asarray(mask) > 0.5).astype("uint8") * 255 if mask.dtype != np.uint8 else mask
        contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        # Largest contour per watershed region / seg mask.
        cnt = max(contours, key=cv2.contourArea)
        raw_area = float(cv2.contourArea(cnt))
        if raw_area < 1.0:
            continue
        peri = float(cv2.arcLength(cnt, True))
        eps = max(1.0, epsilon_factor * peri)
        approx = cv2.approxPolyDP(cnt, eps, True)
        if len(approx) < 3:
            continue
        # Back to ORIGINAL pixel coordinates (never boxes: true contour rings).
        pts = [(float(p[0][0]) * inv_scale, float(p[0][1]) * inv_scale) for p in approx]
        # Clamp + close ring.
        pts = [(min(max(x, 0.0), float(orig_w - 1)), min(max(y, 0.0), float(orig_h - 1))) for x, y in pts]
        if pts[0] != pts[-1]:
            pts = pts + [pts[0]]
        if len(pts) < 4:  # need >=3 distinct + closure
            continue
        try:
            poly = Polygon(pts)
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.is_empty or poly.area < 1.0:
                continue
            area_px = float(poly.area)
            perim_px = float(poly.length)
            x1, y1, x2, y2 = (float(v) for v in poly.bounds)
        except Exception:
            continue
        # Heuristic confidence: larger, compact, well-simplified regions score
        # higher. Explicitly NOT a learned cadastral confidence.
        compact = (4 * 3.14159 * area_px / (perim_px * perim_px + 1e-6)) if perim_px else 0.0
        area_share = area_px / float(orig_w * orig_h + 1e-6)
        conf = max(0.05, min(0.95, 0.35 + 0.45 * min(1.0, compact * 1.6) + 0.2 * min(1.0, area_share * 12)))
        parcels.append(
            {
                "polygon": [[round(x, 1), round(y, 1)] for x, y in poly.exterior.coords],
                "area_px": round(area_px, 1),
                "perimeter_px": round(perim_px, 1),
                "area": round(area_px * gsd * gsd, 2),
                "perimeter": round(perim_px * gsd, 2),
                "confidence": round(float(conf), 3),
                "bbox": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
                "num_vertices": len(poly.exterior.coords) - 1,
                "method": method,
            }
        )
    # Deterministic IDs: largest estimated area first.
    parcels.sort(key=lambda p: p["area_px"], reverse=True)
    for i, p in enumerate(parcels, start=1):
        p["parcel_id"] = f"P-{i:03d}"
    # Reorder keys to match the requested example shape first.
    ordered = []
    for p in parcels:
        ordered.append(
            {
                "parcel_id": p["parcel_id"],
                "area": p["area"],
                "perimeter": p["perimeter"],
                "confidence": p["confidence"],
                "polygon": p["polygon"],
                "area_px": p["area_px"],
                "perimeter_px": p["perimeter_px"],
                "bbox": p["bbox"],
                "num_vertices": p["num_vertices"],
                "method": p["method"],
            }
        )
    return ordered


def extract_parcels(
    image_path: str | Path,
    gsd: float = 0.1,
    min_area_px: float = 800.0,
    epsilon_factor: float = 0.012,
    conf: float = 0.25,
    max_dim: int = 1600,
    max_parcels: int = 60,
) -> Dict[str, Any]:
    """Full pipeline. Raises RuntimeError when CV deps/images are unusable."""
    import cv2

    status = get_parcel_status()
    if not status.get("ready"):
        raise RuntimeError(status.get("error") or "Parcel service not ready. " + SEG_HELP_MESSAGE)

    image_path = Path(image_path)
    if not image_path.is_file():
        raise FileNotFoundError(f"Image not found: {image_path}")
    gsd = float(gsd)
    if not (0.001 <= gsd <= 10.0):
        raise ValueError("gsd must be within [0.001, 10.0] meters/pixel.")
    epsilon_factor = float(min(0.08, max(0.002, epsilon_factor)))

    bgr = _read_bgr(image_path)
    if bgr is None:
        raise RuntimeError(f"Could not decode image: {image_path}")
    orig_h, orig_w = bgr.shape[:2]

    pre, scale = _preprocess(bgr, max_dim=max_dim)
    small_h, small_w = pre.shape[:2]
    # Scale-aware minimum area so tiny specks never become "parcels".
    adaptive_min = max(float(min_area_px) * scale * scale, small_h * small_w * 0.0008)

    method = "classical-watershed-contours"
    used_seg = None
    # Prefer learned masks when a *-seg.pt weight exists.
    seg_masks, used_seg = _try_yolo_seg_masks(pre, conf=conf)
    parcels: List[Dict[str, Any]] = []
    if seg_masks:
        method = f"yolo-seg ({used_seg})"
        parcels = _masks_to_parcels(seg_masks, scale, orig_w, orig_h, gsd, epsilon_factor, method)
    if not parcels:
        regions, _ = _classical_segments(pre, adaptive_min)
        if regions:
            method = "classical-watershed-contours"
            parcels = _masks_to_parcels(regions, scale, orig_w, orig_h, gsd, epsilon_factor, method)
    parcels = parcels[: max(1, int(max_parcels))]

    total_area = round(sum(p["area"] for p in parcels), 2)
    avg_conf = round(sum(p["confidence"] for p in parcels) / len(parcels), 3) if parcels else 0.0

    geojson = {
        "type": "FeatureCollection",
        "properties": {
            "disclaimer": APPROX_DISCLAIMER,
            "coordinate_system": "image_pixels",
            "image_width_px": orig_w,
            "image_height_px": orig_h,
            "gsd_m_per_px": gsd,
        },
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "parcel_id": p["parcel_id"],
                    "area_m2_estimated": p["area"],
                    "perimeter_m_estimated": p["perimeter"],
                    "confidence_approx": p["confidence"],
                    "method": p["method"],
                    "disclaimer": "AI-estimated/approximate — not a legal cadastral boundary.",
                },
                "geometry": {"type": "Polygon", "coordinates": [p["polygon"]]},
            }
            for p in parcels
        ],
    }

    seg_w = _scan_seg_weights()
    return {
        "parcels": parcels,
        "parcel_count": len(parcels),
        "total_area_estimated_m2": total_area,
        "average_confidence": avg_conf,
        "geojson": geojson,
        "image_width": orig_w,
        "image_height": orig_h,
        "gsd_m_per_px": gsd,
        "method": method,
        "seg_weights_found": seg_w,
        "used_seg_model": used_seg,
        "disclaimer": APPROX_DISCLAIMER,
        "notes": (
            "Polygons are contour-derived parcel approximations (simplified with "
            "approxPolyDP), not rectangles and not survey-grade. "
            + (f"Learned masks from {used_seg} used. " if used_seg else "Classical OpenCV fallback used. ")
            + SEG_HELP_MESSAGE
        ),
    }


def annotate_parcels(
    image_path: str | Path,
    parcels: List[Dict[str, Any]],
    output_path: str | Path,
) -> Path:
    """Draw parcel polygons (true rings, not boxes) + labels onto the image."""
    import cv2
    import numpy as np

    image_path = Path(image_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    img = _read_bgr(image_path)
    if img is None:
        raise RuntimeError(f"Could not read image for annotation: {image_path}")
    h, w = img.shape[:2]
    overlay = img.copy()

    palette = [
        (56, 189, 248), (52, 211, 153), (167, 139, 250),
        (251, 191, 36), (248, 113, 113), (34, 211, 238),
    ]
    thickness = max(2, round(max(h, w) / 600))
    font_scale = max(0.5, max(h, w) / 1400.0)

    for i, p in enumerate(parcels or []):
        color = palette[i % len(palette)]
        pts = np.array([[int(round(x)), int(round(y))] for x, y in p["polygon"]], dtype=np.int32)
        if len(pts) < 3:
            continue
        cv2.fillPoly(overlay, [pts], color)
        cv2.polylines(img, [pts], True, color, thickness, cv2.LINE_AA)
        # Label near first vertex: id + estimated area.
        x0, y0 = int(pts[0][0]), int(pts[0][1])
        label = f"{p['parcel_id']} ~{p['area']}m2"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
        lx, ly = min(max(x0, 0), w - tw - 12), min(max(y0 - th - 12, 0), h - th - 12)
        cv2.rectangle(img, (lx, ly), (lx + tw + 8, ly + th + 10), (6, 18, 31), -1)
        cv2.putText(img, label, (lx + 4, ly + th + 4),
                    cv2.FONT_HERSHEY_SIMPLEX, font_scale, color, thickness, cv2.LINE_AA)

    blended = cv2.addWeighted(overlay, 0.25, img, 0.75, 0)
    # Disclaimer banner (burned in so screenshots stay honest).
    banner = f"APPROX parcels: {len(parcels or [])} (AI-estimated, NOT legal cadastre)"
    (tw, th), _ = cv2.getTextSize(banner, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
    cv2.rectangle(blended, (8, 8), (8 + tw + 16, 8 + th + 16), (6, 18, 31), -1)
    cv2.putText(blended, banner, (16, 16 + th + 4),
                cv2.FONT_HERSHEY_SIMPLEX, font_scale, (251, 191, 36), thickness, cv2.LINE_AA)

    ok = cv2.imwrite(str(output_path), blended)
    if not ok:
        raise RuntimeError(f"Failed to write annotated image: {output_path}")
    return output_path
