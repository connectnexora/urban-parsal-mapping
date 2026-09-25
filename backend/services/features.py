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
    return any(tok in low for tok in ROAD_TOKENS)


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


def _classify_pixel(h: int, s: int, v: int) -> int:
    if _VEG_H[0] <= h <= _VEG_H[1] and s >= 50 and v >= 50:
        return 1  # vegetation
    if _WATER_H[0] <= h <= _WATER_H[1] and s >= 45 and 35 <= v <= 230:
        return 2  # water
    return 0


def segment_landcover(image_path: str | Path) -> Tuple[List[Dict], List[Dict], Dict[str, float]]:
    """Segment vegetation/water regions. Returns (veg, water, stats).

    Geometry is computed from the image itself (grid cells merged with BFS);
    coordinates are mapped back to full-resolution pixels.
    """
    path = Path(image_path)
    with PILImage.open(path) as im:
        rgb = im.convert("RGB")
        full_w, full_h = rgb.size
        if full_w <= 0 or full_h <= 0:
            raise ValueError("Image has invalid dimensions.")
        scale = min(1.0, SMALL_MAX_SIDE / max(full_w, full_h))
        sw, sh = max(1, int(full_w * scale)), max(1, int(full_h * scale))
        small = rgb.resize((sw, sh), PILImage.BILINEAR) if scale < 1.0 else rgb
        hsv = small.convert("HSV")
        px = list(hsv.getdata())

    total = sw * sh
    codes = bytearray(total)
    veg_px = water_px = 0
    for i, (h, s, v) in enumerate(px):
        c = _classify_pixel(h, s, v)
        codes[i] = c
        if c == 1:
            veg_px += 1
        elif c == 2:
            water_px += 1

    # Aggregate into grid cells.
    gw = (sw + CELL_PX - 1) // CELL_PX
    gh = (sh + CELL_PX - 1) // CELL_PX
    cell_cls = bytearray(gw * gh)
    cell_score = [0.0] * (gw * gh)
    for gy in range(gh):
        for gx in range(gw):
            veg = wat = n = 0
            for yy in range(gy * CELL_PX, min((gy + 1) * CELL_PX, sh)):
                base = yy * sw
                for xx in range(gx * CELL_PX, min((gx + 1) * CELL_PX, sw)):
                    c = codes[base + xx]
                    n += 1
                    if c == 1:
                        veg += 1
                    elif c == 2:
                        wat += 1
            if n == 0:
                continue
            if veg / n >= CELL_MIN_FRACTION and veg >= wat:
                cell_cls[gy * gw + gx] = 1
                cell_score[gy * gw + gx] = veg / n
            elif wat / n >= CELL_MIN_FRACTION:
                cell_cls[gy * gw + gx] = 2
                cell_score[gy * gw + gx] = wat / n

    # BFS-merge adjacent same-class cells into regions.
    seen = bytearray(gw * gh)
    regions: List[Dict[str, Any]] = []
    for start in range(gw * gh):
        cls = cell_cls[start]
        if cls == 0 or seen[start]:
            continue
        q = deque([start])
        seen[start] = 1
        cells = []
        while q:
            cur = q.popleft()
            cells.append(cur)
            cx, cy = cur % gw, cur // gw
            for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                if 0 <= nx < gw and 0 <= ny < gh:
                    nb = ny * gw + nx
                    if not seen[nb] and cell_cls[nb] == cls:
                        seen[nb] = 1
                        q.append(nb)
        if len(cells) < REGION_MIN_CELLS:
            continue
        xs = [c % gw for c in cells]
        ys = [c // gw for c in cells]
        regions.append(
            {
                "cls": cls,
                "cells": len(cells),
                "score": sum(cell_score[c] for c in cells) / len(cells),
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
            "area_px": (x2 - x1) * (y2 - y1),
            "coverage": round(((x2 - x1) * (y2 - y1)) / (full_w * full_h), 6),
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

    if yolo_available:
        if not features["buildings"]:
            reasons["buildings"] = "Model ran successfully but no building-class boxes were above the confidence threshold."
        if not features["roads"]:
            reasons["roads"] = "The loaded model returned no road-class labels (e.g. road/street/highway) above threshold."
        if not features["other"]:
            reasons["other"] = "No other urban objects (vehicles, persons, etc.) above threshold."
    else:
        if not features["buildings"]:
            reasons["buildings"] = (
                "YOLO model unavailable in this backend (missing weights or ultralytics). "
                "Add a building-capable weight to models/ to enable building detection."
            )
        reasons["roads"] = (
            "Road extraction needs a road-capable model (YOLO-seg with road/street classes "
            "or a dedicated road segmentation network); none is loaded, so no road geometry is reported."
        )
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

    return {"features": features, "reasons": reasons, "segmentation_stats": stats}


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
                except Exception:
                    continue
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(w - 1, x2), min(h - 1, y2)
                if x2 <= x1 or y2 <= y1:
                    continue
                draw.rectangle([x1, y1, x2, y2], outline=color, width=width)
                label = f"{det.get('class', ftype)} {float(det.get('confidence', 0)):.2f}"
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
