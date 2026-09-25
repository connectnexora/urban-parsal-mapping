// Shared pixel<->map geometry helpers for the AI overlay map.
//
// All AI geometry arrives in IMAGE-PIXEL coordinates (origin top-left).
// The map renders them through ONE shared schematic frame fitted around
// CENTER so parcels, buildings, roads and other features align with each
// other. This frame is NOT georeferencing and NOT legal cadastre — it is a
// hackathon-presentation overlay; true geometry lives in the annotated
// images + GeoJSON under outputs/.

export const CENTER = [12.9716, 77.5946]; // Bengaluru demo anchor

/** Frame bounds for an image of {w,h} px, aspect-preserving, ~0.06 deg. */
export function imageFrame(dims) {
  const w = Math.max(1, dims?.w || 1);
  const h = Math.max(1, dims?.h || 1);
  const dLat = 0.06;
  const dLng = dLat * (w / h);
  return [
    [CENTER[0] - dLat / 2, CENTER[1] - dLng / 2],
    [CENTER[0] + dLat / 2, CENTER[1] + dLng / 2],
  ];
}

/** Pixel [x, y] (origin top-left) -> [lat, lng] inside bounds. */
export function pxToLatLng(x, y, dims, bounds) {
  const [[s, w] = [], [n, e] = []] = bounds || [];
  if (n == null) return [CENTER[0], CENTER[1]];
  return [n - (y / dims.h) * (n - s), w + (x / dims.w) * (e - w)];
}

/** Ring of [x, y] px -> ring of [lat, lng]. */
export function ringToLatLngs(ring, dims, bounds) {
  return (ring || []).map(([x, y]) => pxToLatLng(x, y, dims, bounds));
}

/** Ray-casting point-in-ring test in PIXEL space. */
export function pointInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Bounding-box centre in pixels. */
export function bboxCenter(bbox) {
  const [x1, y1, x2, y2] = bbox;
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

/** Bounding-box area in px². */
export function bboxArea(bbox) {
  const [x1, y1, x2, y2] = bbox;
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

/**
 * Honest heuristic building coverage per parcel (PIXEL space):
 * a building counts toward a parcel when its bbox centre falls inside the
 * parcel ring. Coverage % = Σ inside-bbox areas / parcel area_px * 100,
 * capped at 100. Labelled approximate in the UI.
 */
export function buildingCoverage(parcels, buildings) {
  const out = {};
  for (const p of parcels || []) {
    const ring = p.polygon || [];
    let count = 0;
    let area = 0;
    const ids = [];
    for (const b of buildings || []) {
      if (!b?.bbox) continue;
      const [cx, cy] = bboxCenter(b.bbox);
      if (ring.length >= 3 && pointInRing(cx, cy, ring)) {
        count += 1;
        area += bboxArea(b.bbox);
        ids.push(b.class ? `${b.class}@${Math.round(cx)},${Math.round(cy)}` : `box@${Math.round(cx)},${Math.round(cy)}`);
      }
    }
    const denom = p.area_px || 1;
    out[p.parcel_id] = {
      count,
      coveragePct: Math.min(100, Math.round((area / denom) * 1000) / 10),
      buildingIds: ids,
    };
  }
  return out;
}

/** Parcels -> GeoJSON FeatureCollection (image-pixel CRS, properties enriched). */
export function parcelsToGeoJSON(parcelResult, coverageById = {}) {
  const parcels = parcelResult?.parcels || [];
  return {
    type: 'FeatureCollection',
    properties: {
      kind: 'parcels-approx',
      disclaimer: 'AI-estimated/approximate — NOT legal cadastre.',
      coordinate_system: 'image_pixels',
      image_width_px: parcelResult?.image_width,
      image_height_px: parcelResult?.image_height,
    },
    features: parcels.map((p) => ({
      type: 'Feature',
      properties: {
        kind: 'parcel',
        parcel_id: p.parcel_id,
        area_m2_estimated: p.area,
        perimeter_m_estimated: p.perimeter,
        confidence_approx: p.confidence,
        method: p.method,
        num_vertices: p.num_vertices,
        building_count: coverageById[p.parcel_id]?.count ?? 0,
        building_coverage_pct: coverageById[p.parcel_id]?.coveragePct ?? 0,
      },
      geometry: { type: 'Polygon', coordinates: [p.polygon || []] },
    })),
  };
}

/** Flat bbox detections -> GeoJSON polygons (image pixels). */
export function detectionsToGeoJSON(detections, kind = 'building') {
  return {
    type: 'FeatureCollection',
    properties: { kind, coordinate_system: 'image_pixels' },
    features: (detections || []).map((d, i) => {
      const [x1, y1, x2, y2] = d.bbox;
      return {
        type: 'Feature',
        properties: {
          kind,
          class: d.class,
          confidence: d.confidence,
          bbox: d.bbox,
          index: i,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]],
        },
      };
    }),
  };
}

/** Feature-category items (bbox or polygon) -> GeoJSON (image pixels). */
export function featureItemsToGeoJSON(items, kind) {
  return {
    type: 'FeatureCollection',
    properties: { kind, coordinate_system: 'image_pixels' },
    features: (items || []).map((d, i) => {
      const poly = d.polygon && d.polygon.length >= 3
        ? d.polygon
        : (() => {
          const [x1, y1, x2, y2] = d.bbox;
          return [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]];
        })();
      return {
        type: 'Feature',
        properties: {
          kind,
          class: d.class,
          confidence: d.confidence,
          bbox: d.bbox,
          method: d.method,
          index: i,
        },
        geometry: { type: 'Polygon', coordinates: [poly] },
      };
    }),
  };
}
