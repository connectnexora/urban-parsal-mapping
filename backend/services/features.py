# Multi-class urban feature-extraction pipeline.
#
# Combines two honest sources — nothing is ever invented:
#   1. YOLO detections (when a model is loaded): each raw box is mapped to
#      buildings / roads / other by its REAL class label. When no model is
#      loaded these categories come back EMPTY with a reason.
#   2. Classical colour segmentation (no model needed, pure PIL): vegetation
#      and water regions from HSV thresholds on a downsampled copy, merged
#      into regions with real bounding geometry. Empty when nothing qualifies.
#
# Roads have no reliable classical cue without a segmentation model, so the
# roads list only fills from road-capable YOLO labels; otherwise it is empty
# with an explicit reason (never fabricated).

from __future__ import annotations

from collections import deque
from pathlib import Path
from typing import Any, Dict, List, Tuple

try:
    from services.detection import _is_building_label
except ImportError:  # allow `uvicorn backend.main:app` from the project root
    from backend.services.detection import _is_building_label

try:
    from utils.cache import cached, file_fingerprint
except ImportError:  # allow `uvicorn backend.main:app` from the project root
    from backend.utils.cache import cached, file_fingerprint

from PIL import Image as PILImage, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# Taxonomy
# ---------------------------------------------------------------------------
FEATURE_TYPES = ("buildings", "roads", "vegetation", "water", "other")

# BGR-style RGB tuples reused by the PIL annotator and the frontend legend.
FEATURE_COLORS_RGB = {
    "buildings": (46, 204, 113),    # green
    "roads": (249, 115, 22),        # orange
    "vegetation": (22, 163, 74),    # dark green
    "water": (59, 130, 246),        # blue
    "other": (168, 85, 247),        # purple
}

FEATURE_COLORS_HEX = {
    "buildings": "#22c55e",
    "roads": "#f97316",
    "vegetation": "#16a34a",
    "water": "#3b82f6",
    "other": "#a855f7",
    "parcels": "#eab308",
}

ROAD_ALIASES = {
    "road",
    "roads",
    "street",
    "streets",
    "highway",
    "highways",
    "lane",
    "lanes",
    "carriageway",
    "asphalt",
    "pavement",
    "sidewalk",
    "crosswalk",
    "intersection",
    "roundabout",
}

ROAD_TOKENS = ("road", "street", "highway", "lane", "carriageway", "asphalt", "pavement")


def _is_road_label(label: str) -> bool:
    low = (label or "").strip().lower().replace("-", " ").replace("_", " ")
    if low in ROAD_ALIASES:
        return True
    # Whole-word match only: substring search would misclassify e.g.
    # "airplane" (contains "lane") as a road.
    words = set(low.split())
    return any(tok in words for tok in ROAD_TOKENS)


def categorize_label(label: str) -> str:
    """Map a real detector label onto the feature taxonomy."""
    if _is_building_label(label):
        return "buildings"
    if _is_road_label(label):
        return "roads"
    return "other"


# ---------------------------------------------------------------------------
# YOLO branch
# ---------------------------------------------------------------------------
def _rect_polygon(bbox: List[int]) -> List[List[int]]:
    x1, y1, x2, y2 = (int(v) for v in bbox)
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]


def yolo_to_features(all_detections: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Group raw YOLO boxes by feature type. Labels are never rewritten."""
    grouped: Dict[str, List[Dict[str, Any]]] = {k: [] for k in FEATURE_TYPES}
    for det in all_detections or []:
        try:
            x1, y1, x2, y2 = (int(v) for v in det["bbox"])
        except Exception:
            continue
        if x2 <= x1 or y2 <= y1:
            continue
        cat = categorize_label(det.get("class", ""))
        if cat in ("vegetation", "water"):
            cat = "other"  # YOLO boxes are objects, not land-cover regions
        grouped[cat].append(
            {
                "class": det.get("class", "object"),
                "class_id": det.get("class_id"),
                "confidence": float(det.get("confidence", 0.0)),
                "bbox": [x1, y1, x2, y2],
                "polygon": _rect_polygon([x1, y1, x2, y2]),
                "area_px": (x2 - x1) * (y2 - y1),
                "method": "yolo",
            }
        )
    return grouped


# ---------------------------------------------------------------------------
# Classical branch: vegetation / water colour segmentation (pure PIL)
# ---------------------------------------------------------------------------
SMALL_MAX_SIDE = 320   # analyse a downsampled copy; geometry is scaled back up
CELL_PX = 16           # grid cell size on the small copy
CELL_MIN_FRACTION = 0.35
REGION_MIN_CELLS = 4
MAX_REGIONS_PER_CLASS = 60

# PIL HSV channels are 0-255. Green ~ H 56-134 deg, blue ~ H 190-261 deg.
_VEG_H = (40, 95)
_WATER_H = (135, 185)


def segment_landcover(image_path: str | Path) -> Tuple[List[Dict], List[Dict], Dict[str, float]]:
    """Segment vegetation/water regions, memoised per file. Returns (veg, water, stats).

    Geometry is computed from the image itself (grid cells merged with BFS);
    coordinates are mapped back to full-resolution pixels.
    """
    path = Path(image_path)
    key = ("landcover",) + file_fingerprint(path)
    result, _hit = cached(key, lambda: _segment_landcover_uncached(path))
    return result[0], result[1], result[2]


def _segment_landcover_uncached(image_path: Path) -> Tuple[List[Dict], List[Dict], Dict[str, float]]:
    """Land-cover segmentation for one image. See segment_landcover().

    Fully vectorised with numpy: the previous per-pixel Python loop over the
    ~320 px working copy plus the per-cell Python nesting cost hundreds of
    milliseconds per call. Thresholds and cell voting are unchanged.
    """
    import numpy as np

    with PILImage.open(image_path) as im:
        rgb = im.convert("RGB")
        full_w, full_h = rgb.size
        if full_w <= 0 or full_h <= 0:
            raise ValueError("Image has invalid dimensions.")
        scale = min(1.0, SMALL_MAX_SIDE / max(full_w, full_h))
        sw, sh = max(1, int(full_w * scale)), max(1, int(full_h * scale))
        small = rgb.resize((sw, sh), PILImage.BILINEAR) if scale < 1.0 else rgb
        hsv = np.asarray(small.convert("HSV"))
        rgb_arr = np.asarray(small, dtype=np.int16)

    total = sw * sh
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    # Excess-green catches dark, muted foliage that a pure HSV test misses —
    # common in satellite parks, where tree canopy is low-saturation green.
    r_c, g_c, b_c = rgb_arr[:, :, 0], rgb_arr[:, :, 1], rgb_arr[:, :, 2]
    exg = 2 * g_c - r_c - b_c
    veg_mask = (
        ((h >= _VEG_H[0]) & (h <= _VEG_H[1]) & (s >= 28) & (v >= 35))
        | ((exg > 12) & (v >= 30) & (h >= 30) & (h <= 110))
    )
    water_mask = (
        (h >= _WATER_H[0]) & (h <= _WATER_H[1]) & (s >= 35) & (v >= 25) & (v <= 235)
    ) & ~veg_mask
    veg_px = int(veg_mask.sum())
    water_px = int(water_mask.sum())

    # Aggregate into grid cells: sum per CELL_PX block. Padding to whole cells
    # mirrors the previous loop, which counted only real pixels per cell.
    gw = (sw + CELL_PX - 1) // CELL_PX
    gh = (sh + CELL_PX - 1) // CELL_PX
    pad_w, pad_h = gw * CELL_PX, gh * CELL_PX

    def _cell_sums(mask: np.ndarray) -> np.ndarray:
        padded = np.zeros((pad_h, pad_w), dtype=np.uint8)
        padded[:sh, :sw] = mask
        return padded.reshape(gh, CELL_PX, gw, CELL_PX).sum(axis=(1, 3), dtype=np.int32)

    ones = np.zeros((pad_h, pad_w), dtype=np.uint8)
    ones[:sh, :sw] = 1
    cell_n = ones.reshape(gh, CELL_PX, gw, CELL_PX).sum(axis=(1, 3), dtype=np.int32)
    cell_veg = _cell_sums(veg_mask)
    cell_wat = _cell_sums(water_mask)

    valid = cell_n > 0
    veg_frac = np.divide(cell_veg, cell_n, out=np.zeros_like(cell_veg, dtype=np.float32), where=valid)
    wat_frac = np.divide(cell_wat, cell_n, out=np.zeros_like(cell_wat, dtype=np.float32), where=valid)
    is_veg = valid & (veg_frac >= CELL_MIN_FRACTION) & (cell_veg >= cell_wat)
    is_wat = valid & ~is_veg & (wat_frac >= CELL_MIN_FRACTION)

    cell_cls = np.where(is_veg, 1, np.where(is_wat, 2, 0)).astype(np.int8)
    cell_score = np.where(is_veg, veg_frac, np.where(is_wat, wat_frac, 0.0))
    cls_flat = cell_cls.reshape(-1)
    score_flat = cell_score.reshape(-1)

    # BFS-merge adjacent same-class cells into regions.
    seen = np.zeros(gw * gh, dtype=bool)
    regions: List[Dict[str, Any]] = []
    for start in range(gw * gh):
        cls = cls_flat[start]
        if cls == 0 or seen[start]:
            continue
        q = deque([start])
        seen[start] = True
        cells = []
        while q:
            cur = q.popleft()
            cells.append(cur)
            cx, cy = cur % gw, cur // gw
            for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                if 0 <= nx < gw and 0 <= ny < gh:
                    nb = ny * gw + nx
                    if not seen[nb] and cls_flat[nb] == cls:
                        seen[nb] = True
                        q.append(nb)
        if len(cells) < REGION_MIN_CELLS:
            continue
        xs = [c % gw for c in cells]
        ys = [c // gw for c in cells]
        regions.append(
            {
                "cls": int(cls),
                "cells": len(cells),
                "score": float(sum(score_flat[c] for c in cells) / len(cells)),
                "gx0": min(xs),
                "gy0": min(ys),
                "gx1": max(xs),
                "gy1": max(ys),
            }
        )

    sx, sy = full_w / sw, full_h / sh
    out_veg: List[Dict[str, Any]] = []
    out_water: List[Dict[str, Any]] = []
    for reg in sorted(regions, key=lambda r: r["cells"], reverse=True):
        x1 = max(0, int(reg["gx0"] * CELL_PX * sx))
        y1 = max(0, int(reg["gy0"] * CELL_PX * sy))
        x2 = min(full_w - 1, int((reg["gx1"] + 1) * CELL_PX * sx))
        y2 = min(full_h - 1, int((reg["gy1"] + 1) * CELL_PX * sy))
        if x2 <= x1 or y2 <= y1:
            continue
        item = {
            "class": "vegetation" if reg["cls"] == 1 else "water",
            "confidence": round(0.50 + 0.45 * min(1.0, reg["score"]), 3),
            "bbox": [x1, y1, x2, y2],
            "polygon": [[x1, y1], [x2, y1], [x2, y2], [x1, y2]],
            # Segmented cell area (not bbox area: L-shaped regions would
            # otherwise overstate their footprint).
            "area_px": int(round(reg["cells"] * CELL_PX * CELL_PX * sx * sy)),
            "coverage": round(
                (reg["cells"] * CELL_PX * CELL_PX * sx * sy) / (full_w * full_h), 6
            ),
            "method": "color-segmentation",
        }
        if reg["cls"] == 1:
            if len(out_veg) < MAX_REGIONS_PER_CLASS:
                out_veg.append(item)
        else:
            if len(out_water) < MAX_REGIONS_PER_CLASS:
                out_water.append(item)

    stats = {
        "vegetation_pixel_fraction": round(veg_px / total, 6) if total else 0.0,
        "water_pixel_fraction": round(water_px / total, 6) if total else 0.0,
    }
    return out_veg, out_water, stats


# ---------------------------------------------------------------------------
# Pipeline entry point
# ---------------------------------------------------------------------------
def extract_features(
    image_path: str | Path,
    yolo_detections: List[Dict[str, Any]] | None = None,
    yolo_available: bool = False,
) -> Dict[str, Any]:
    """Run the full pipeline. Returns {features, reasons}.

    Every list contains only computed detections; empty categories carry a
    human-readable reason instead of invented geometry.
    """
    features: Dict[str, List[Dict[str, Any]]] = {k: [] for k in FEATURE_TYPES}
    reasons: Dict[str, str | None] = {k: None for k in FEATURE_TYPES}

    grouped = yolo_to_features(yolo_detections or [])
    for key in ("buildings", "roads", "other"):
        features[key] = grouped[key]

    # A road-capable YOLO model always wins; otherwise fall back to the
    # classical road-corridor detector so roads are not reported as empty just
    # because no weights are installed. These are geometric approximations and
    # are labelled method="classical-road".
    road_source = "yolo"
    road_error: str | None = None
    if not features["roads"]:
        try:
            try:
                from services.roads import detect_roads
            except ImportError:  # `uvicorn backend.main:app` from project root
                from backend.services.roads import detect_roads
            corridors = detect_roads(image_path) or []
            for det in corridors:
                try:
                    x1, y1, x2, y2 = (int(v) for v in det["bbox"])
                except Exception:
                    continue
                if x2 <= x1 or y2 <= y1:
                    continue
                features["roads"].append(
                    {
                        "class": "road",
                        "confidence": float(det.get("confidence", 0.0)),
                        "bbox": [x1, y1, x2, y2],
                        # Rotated rectangle that follows the road direction.
                        "polygon": det.get("polygon")
                        or [[x1, y1], [x2, y1], [x2, y2], [x1, y2]],
                        "area_px": (x2 - x1) * (y2 - y1),
                        "length_px": det.get("length_px"),
                        "width_px": det.get("width_px"),
                        "method": det.get("method", "classical-road"),
                    }
                )
            if features["roads"]:
                road_source = "classical-road"
        except Exception as exc:
            # Never swallow this silently: a hard failure here previously made
            # roads look "empty" instead of "broken".
            road_error = f"Classical road detection failed: {exc}"

    # Classical rooftop fallback: when YOLO has no building-class boxes
    # (generic COCO weights or no model), compute rooftops from the image so
    # buildings/features counts match visible houses instead of staying 0.
    if not features["buildings"]:
        try:
            try:
                from services.rooftops import detect_rooftops
            except ImportError:
                from backend.services.rooftops import detect_rooftops
            fallback = detect_rooftops(image_path, conf_threshold=0.25) or []
            for det in fallback:
                try:
                    x1, y1, x2, y2 = (int(v) for v in det["bbox"])
                except Exception:
                    continue
                if x2 <= x1 or y2 <= y1:
                    continue
                features["buildings"].append(
                    {
                        "class": "building",
                        "confidence": float(det.get("confidence", 0.0)),
                        "bbox": [x1, y1, x2, y2],
                        "polygon": [[x1, y1], [x2, y1], [x2, y2], [x1, y2]],
                        "area_px": (x2 - x1) * (y2 - y1),
                        "method": det.get("method", "classical-rooftop"),
                    }
                )
        except Exception:
            pass

    if yolo_available:
        if not features["buildings"]:
            # YOLO ran but found no building labels; fallback above may have
            # filled buildings. Only report "none found" when still empty.
            reasons["buildings"] = "Model ran successfully but no building-class boxes were above the confidence threshold; classical rooftop fallback also found none."
        elif any(d.get("method") == "classical-rooftop" for d in features["buildings"]):
            reasons["buildings"] = None  # computed geometry present; no warning needed
        if not features["roads"]:
            reasons["roads"] = "The loaded model returned no road-class labels (e.g. road/street/highway) above threshold."
        else:
            reasons["roads"] = None  # geometry present (see each item's method)
        if not features["other"]:
            reasons["other"] = "No other urban objects (vehicles, persons, etc.) above threshold."
    else:
        if not features["buildings"]:
            reasons["buildings"] = (
                "YOLO model unavailable in this backend (missing weights or ultralytics) "
                "and the classical rooftop fallback found no rectangular rooftops."
            )
        else:
            reasons["buildings"] = None  # classical fallback supplied geometry
        if not features["roads"]:
            reasons["roads"] = (
                "Road extraction needs a road-capable model (YOLO-seg with road/street classes "
                "or a dedicated road segmentation network); none is loaded, and the classical "
                "road-corridor detector found no elongated road-like regions in this image."
                if not road_error else road_error
            )
        else:
            reasons["roads"] = None  # geometry present (see each item's method)
        if not features["other"]:
            reasons["other"] = "YOLO model unavailable — no general object detections could be produced."

    try:
        veg, water, stats = segment_landcover(image_path)
        features["vegetation"] = veg
        features["water"] = water
    except Exception as exc:
        stats = {"vegetation_pixel_fraction": 0.0, "water_pixel_fraction": 0.0}
        reasons["vegetation"] = f"Colour segmentation failed: {exc}"
        reasons["water"] = f"Colour segmentation failed: {exc}"

    if not features["vegetation"] and reasons["vegetation"] is None:
        reasons["vegetation"] = (
            f"No vegetation cover found (green-pixel fraction {stats['vegetation_pixel_fraction']:.3f})."
        )
    if not features["water"] and reasons["water"] is None:
        reasons["water"] = (
            f"No water bodies found (blue-pixel fraction {stats['water_pixel_fraction']:.3f})."
        )

    return {
        "features": features,
        "reasons": reasons,
        "segmentation_stats": stats,
        # Which detector supplied each class, so the UI/CSV can state the
        # provenance instead of implying a trained model produced everything.
        "sources": {
            "buildings": (
                "yolo" if any(d.get("method") == "yolo" for d in features["buildings"])
                else "classical-rooftop" if features["buildings"] else "none"
            ),
            "roads": road_source if features["roads"] else "none",
            "vegetation": "color-segmentation" if features["vegetation"] else "none",
            "water": "color-segmentation" if features["water"] else "none",
            "other": "yolo" if features["other"] else "none",
        },
    }


# ---------------------------------------------------------------------------
# Annotation (pure PIL so it works without OpenCV)
# ---------------------------------------------------------------------------
def annotate_features(
    image_path: str | Path,
    features: Dict[str, List[Dict[str, Any]]],
    output_path: str | Path,
    max_boxes_per_type: int = 200,
) -> Path:
    """Draw per-class boxes + counts. Only computed features are drawn."""
    image_path = Path(image_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with PILImage.open(image_path) as im:
        img = im.convert("RGB")
        w, h = img.size
        draw = ImageDraw.Draw(img)
        width = max(2, max(w, h) // 400)
        try:
            font = ImageFont.load_default(size=max(12, max(w, h) // 80))
        except Exception:
            font = ImageFont.load_default()

        for ftype in FEATURE_TYPES:
            color = FEATURE_COLORS_RGB[ftype]
            for det in (features.get(ftype) or [])[:max_boxes_per_type]:
                try:
                    x1, y1, x2, y2 = (int(v) for v in det["bbox"])
                    conf = float(det.get("confidence", 0))
                except Exception:
                    continue
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(w - 1, x2), min(h - 1, y2)
                if x2 <= x1 or y2 <= y1:
                    continue
                draw.rectangle([x1, y1, x2, y2], outline=color, width=width)
                label = f"{det.get('class', ftype)} {conf:.2f}"
                tx0, ty0, tx1, ty1 = draw.textbbox((0, 0), label, font=font)
                tw, th = tx1 - tx0, ty1 - ty0
                by1 = max(0, y1 - th - 8)
                draw.rectangle([x1, by1, x1 + tw + 8, by1 + th + 8], fill=color)
                draw.text((x1 + 4, by1 + 4), label, fill=(255, 255, 255), font=font)

        counts = {k: len(features.get(k) or []) for k in FEATURE_TYPES}
        banner = " | ".join(f"{k}: {counts[k]}" for k in FEATURE_TYPES)
        tx0, ty0, tx1, ty1 = draw.textbbox((0, 0), banner, font=font)
        draw.rectangle([8, 8, 8 + (tx1 - tx0) + 16, 8 + (ty1 - ty0) + 16], fill=(11, 18, 32))
        draw.text((16, 14), banner, fill=(56, 189, 248), font=font)

        img.save(output_path, "JPEG", quality=90)
    return output_path
