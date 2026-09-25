# Geospatial helpers for parcel geometry (pixel space + GSD estimates).
#
# All metric values are ESTIMATES from either embedded GeoTIFF spatial tags
# (when present) or an assumed ground sample distance, and must be presented
# as approximate, never as survey-grade cadastre.

from __future__ import annotations

from typing import Dict, List, Sequence

M2_PER_HA = 10000.0


def pixel_area_to_sqmeters(pixel_area: float, meters_per_pixel: float) -> float:
    """Convert a pixel area to estimated square meters via GSD."""
    gsd = float(meters_per_pixel)
    if gsd <= 0:
        raise ValueError("meters_per_pixel must be positive.")
    return float(pixel_area) * gsd * gsd


def pixel_perimeter_to_meters(pixel_perimeter: float, meters_per_pixel: float) -> float:
    """Convert a pixel perimeter to estimated meters via GSD."""
    gsd = float(meters_per_pixel)
    if gsd <= 0:
        raise ValueError("meters_per_pixel must be positive.")
    return float(pixel_perimeter) * gsd


def sqmeters_to_hectares(area_m2: float) -> float:
    """Convert square meters to hectares (1 ha = 10,000 m²)."""
    return float(area_m2) / M2_PER_HA


def polygon_area_px(polygon: Sequence[Sequence[float]]) -> float:
    """Shoelace area of a ring in pixel units (absolute value)."""
    pts = [(float(x), float(y)) for x, y in polygon]
    if len(pts) < 3:
        return 0.0
    if pts[0] != pts[-1]:
        pts = pts + [pts[0]]
    s = 0.0
    for (x1, y1), (x2, y2) in zip(pts[:-1], pts[1:]):
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def polygon_perimeter_px(polygon: Sequence[Sequence[float]]) -> float:
    """Perimeter of a ring in pixel units."""
    import math

    pts = [(float(x), float(y)) for x, y in polygon]
    if len(pts) < 2:
        return 0.0
    if pts[0] != pts[-1]:
        pts = pts + [pts[0]]
    return sum(
        math.hypot(x2 - x1, y2 - y1) for (x1, y1), (x2, y2) in zip(pts[:-1], pts[1:])
    )


def parcels_to_geojson(
    parcels: List[Dict],
    image_width: int,
    image_height: int,
    gsd: float,
    disclaimer: str,
) -> Dict:
    """Build an image-pixel GeoJSON FeatureCollection for parcel polygons."""
    return {
        "type": "FeatureCollection",
        "properties": {
            "disclaimer": disclaimer,
            "coordinate_system": "image_pixels",
            "image_width_px": int(image_width),
            "image_height_px": int(image_height),
            "gsd_m_per_px": float(gsd),
        },
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "parcel_id": p.get("parcel_id"),
                    "area_m2_estimated": p.get("area_m2", p.get("area")),
                    "area_ha_estimated": p.get("area_ha"),
                    "perimeter_m_estimated": p.get("perimeter_m", p.get("perimeter")),
                    "confidence_approx": p.get("confidence"),
                    "disclaimer": "AI-estimated/approximate — not a legal cadastral boundary.",
                },
                "geometry": {"type": "Polygon", "coordinates": [p.get("polygon") or []]},
            }
            for p in parcels
        ],
    }
