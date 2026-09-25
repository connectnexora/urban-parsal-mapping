// Generates the controlled DEMO MODE dataset (zero dependencies, runs on node).
//
// Outputs (paths relative to the repo root):
//   frontend/public/demo/demo-aerial.png            — prepared synthetic scene
//   frontend/public/demo/demo-aerial-annotated.png  — same scene + AI overlays
//   frontend/src/data/demoResults.js                — precomputed AI results
//
// The scene is SYNTHETIC by design: every rooftop/parcel/road/tree is drawn
// by this script, and the exported "precomputed results" use the EXACT same
// geometry (no fake mismatch). DEMO MODE is always labelled as precomputed
// and never touches the live AI pipeline.
//
// Run:  node tools/make-demo-scene.mjs   (from the repo root)

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'frontend', 'public', 'demo');
const SRC = join(ROOT, 'frontend', 'src', 'data');

const W = 960;
const H = 640;
const GSD = 0.5; // m/px documented for the demo scene

// --- deterministic RNG (mulberry32) ---------------------------------------
let _s = 20260115;
function rnd() {
  _s |= 0; _s = (_s + 0x6D2B79F5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// --- tiny PNG writer (truecolor, filter 0) ---------------------------------
function crc32(buf) {
  let tab = crc32.t;
  if (!tab) {
    // Unsigned: CRC bit patterns exceed INT32_MAX and must not go negative.
    tab = crc32.t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      tab[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = tab[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function writePNG(path, px, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const p = (y * w + x) * 3;
      raw[o] = px[p]; raw[o + 1] = px[p + 1]; raw[o + 2] = px[p + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // deflate, no filter, no interlace
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
}

// --- canvas helpers ----------------------------------------------------------
function newCanvas(fill) {
  const px = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) { px[i * 3] = fill[0]; px[i * 3 + 1] = fill[1]; px[i * 3 + 2] = fill[2]; }
  return px;
}
function set(px, x, y, c) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
}
function fillRect(px, x0, y0, x1, y1, c) {
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) set(px, x, y, c);
}
function rectOutline(px, x0, y0, x1, y1, c, t = 2) {
  for (let k = 0; k < t; k++) {
    for (let x = x0 - k; x <= x1 + k; x++) { set(px, x, y0 - k, c); set(px, x, y1 + k, c); }
    for (let y = y0 - k; y <= y1 + k; y++) { set(px, x0 - k, y, c); set(px, x1 + k, y, c); }
  }
}
function fillEllipse(px, cx, cy, rx, ry, c) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) set(px, x, y, c);
    }
}
function speckle(px, x0, y0, x1, y1, c, n, rMax = 2) {
  for (let i = 0; i < n; i++) {
    const x = x0 + Math.floor(rnd() * (x1 - x0));
    const y = y0 + Math.floor(rnd() * (y1 - y0));
    const r = 1 + Math.floor(rnd() * rMax);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) set(px, x + dx, y + dy, c);
  }
}

// --- palette -----------------------------------------------------------------
const GROUND = [143, 149, 120];
const BLOCK_A = [134, 140, 112];
const BLOCK_B = [150, 154, 124];
const ROAD = [61, 63, 69];
const ROAD_EDGE = [210, 210, 210];
const ROOF = [215, 219, 220];
const ROOF_EDGE = [138, 144, 148];
const ROOF_TAN = [217, 201, 168];
const TREE = [52, 112, 62];
const VEG = [74, 138, 80];
const WATER = [74, 127, 181];
const PARCEL_LINE = [120, 116, 100];
const OVER_PARCEL = [245, 197, 66];
const OVER_BUILD = [46, 204, 113];
const OVER_ROAD = [249, 115, 22];

// --- scene geometry (single source of truth; exported to results) ------------
const PARCELS = [
  { id: 'P-001', x0: 60, y0: 60, x1: 300, y1: 280, conf: 0.86 },
  { id: 'P-002', x0: 320, y0: 60, x1: 560, y1: 280, conf: 0.89 },
  { id: 'P-003', x0: 660, y0: 60, x1: 900, y1: 280, conf: 0.84 },
  { id: 'P-004', x0: 60, y0: 360, x1: 300, y1: 580, conf: 0.81 },
  { id: 'P-005', x0: 320, y0: 360, x1: 560, y1: 580, conf: 0.88 },
  { id: 'P-006', x0: 660, y0: 360, x1: 900, y1: 580, conf: 0.83 },
];
const BUILDINGS = [
  { x0: 90, y0: 90, x1: 190, y1: 170, conf: 0.93, tan: false },
  { x0: 350, y0: 80, x1: 470, y1: 150, conf: 0.89, tan: true },
  { x0: 360, y0: 180, x1: 540, y1: 250, conf: 0.91, tan: false },
  { x0: 700, y0: 100, x1: 860, y1: 200, conf: 0.95, tan: false },
  { x0: 90, y0: 400, x1: 210, y1: 500, conf: 0.88, tan: true },
  { x0: 350, y0: 390, x1: 450, y1: 470, conf: 0.92, tan: false },
  { x0: 460, y0: 490, x1: 550, y1: 560, conf: 0.86, tan: false },
  { x0: 700, y0: 400, x1: 870, y1: 520, conf: 0.94, tan: true },
];
const ROADS = [
  { x0: 0, y0: 300, x1: 960, y1: 344, conf: 0.91, label: 'road-horizontal' },
  { x0: 600, y0: 0, x1: 644, y1: 640, conf: 0.88, label: 'road-vertical' },
];
const VEG_PATCHES = [
  { x0: 210, y0: 180, x1: 290, y1: 270, conf: 0.78 },
  { x0: 660, y0: 220, x1: 760, y1: 275, conf: 0.74 },
  { x0: 780, y0: 420, x1: 895, y1: 570, conf: 0.8 },
];
const WATER_POND = { cx: 180, cy: 470, rx: 70, ry: 40, conf: 0.82 };
const CARS = [
  { x0: 610, y0: 120, x1: 632, y1: 160, conf: 0.77 },
  { x0: 200, y0: 308, x1: 260, y1: 330, conf: 0.81 },
];

// --- paint base scene ----------------------------------------------------------
const px = newCanvas(GROUND);
speckle(px, 0, 0, W, H, BLOCK_A, 2600, 3);
speckle(px, 0, 0, W, H, BLOCK_B, 2200, 3);
// blocks
fillRect(px, 40, 40, 580, 295, BLOCK_A);
fillRect(px, 648, 40, 920, 295, BLOCK_B);
fillRect(px, 40, 348, 580, 600, BLOCK_B);
fillRect(px, 648, 348, 920, 600, BLOCK_A);
// roads
for (const r of ROADS) fillRect(px, r.x0, r.y0, r.x1, r.y1, ROAD);
for (let x = 10; x < 590; x += 40) fillRect(px, x, 319, x + 20, 325, ROAD_EDGE);
for (let y = 10; y < 630; y += 40) fillRect(px, 619, y, 625, y + 20, ROAD_EDGE);
// vegetation patches + pond
for (const v of VEG_PATCHES) { fillEllipse(px, (v.x0 + v.x1) / 2, (v.y0 + v.y1) / 2, (v.x1 - v.x0) / 2, (v.y1 - v.y0) / 2, VEG); speckle(px, v.x0, v.y0, v.x1, v.y1, TREE, 40, 2); }
fillEllipse(px, WATER_POND.cx, WATER_POND.cy, WATER_POND.rx, WATER_POND.ry, WATER);
fillEllipse(px, WATER_POND.cx - 12, WATER_POND.cy - 8, 40, 20, [110, 160, 200]);
// trees scattered on grass
for (let i = 0; i < 60; i++) {
  const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H);
  fillEllipse(px, x, y, 4 + Math.floor(rnd() * 4), 4 + Math.floor(rnd() * 4), TREE);
}
// parcel boundary lines
for (const p of PARCELS) rectOutline(px, p.x0, p.y0, p.x1, p.y1, PARCEL_LINE, 1);
// rooftops
for (const b of BUILDINGS) {
  fillRect(px, b.x0, b.y0, b.x1, b.y1, b.tan ? ROOF_TAN : ROOF);
  rectOutline(px, b.x0, b.y0, b.x1, b.y1, ROOF_EDGE, 2);
  fillRect(px, b.x0 + 8, b.y0 + 8, b.x0 + 20, b.y0 + 20, ROOF_EDGE); // roof vent detail
}
// cars
for (const c of CARS) { fillRect(px, c.x0, c.y0, c.x1, c.y1, [200, 60, 60]); rectOutline(px, c.x0, c.y0, c.x1, c.y1, [120, 30, 30], 1); }

// --- annotated copy --------------------------------------------------------------
// Center-line dashes follow each road's long axis: horizontal roads get a
// horizontal spine, the vertical road a vertical one.
const ann = Uint8Array.from(px);
for (const r of ROADS) {
  const rw = r.x1 - r.x0, rh = r.y1 - r.y0;
  if (rw >= rh) {
    const cy = Math.round((r.y0 + r.y1) / 2);
    for (let x = Math.max(0, r.x0); x < Math.min(W, r.x1); x += 4) {
      set(ann, x, cy, OVER_ROAD);
      set(ann, x, cy + 1, OVER_ROAD);
    }
  } else {
    const cx = Math.round((r.x0 + r.x1) / 2);
    for (let y = Math.max(0, r.y0); y < Math.min(H, r.y1); y += 4) {
      set(ann, cx, y, OVER_ROAD);
      set(ann, cx + 1, y, OVER_ROAD);
    }
  }
}
for (const p of PARCELS) rectOutline(ann, p.x0, p.y0, p.x1, p.y1, OVER_PARCEL, 3);
for (const b of BUILDINGS) rectOutline(ann, b.x0, b.y0, b.x1, b.y1, OVER_BUILD, 2);

// --- results (same geometry) -------------------------------------------------------
const M2_PER_HA = 10000;
const m2 = (w, h) => Math.round(w * h * GSD * GSD * 100) / 100;
const pm = (w, h) => Math.round(2 * (w + h) * GSD * 100) / 100;
const toHa = (m2v) => Math.round((m2v / M2_PER_HA) * 10000) / 10000;

const parcels = PARCELS.map((p) => {
  const w = p.x1 - p.x0, h = p.y1 - p.y0;
  return {
    parcel_id: p.id,
    area: m2(w, h),
    area_m2: m2(w, h),
    area_ha: toHa(m2(w, h)),
    perimeter: pm(w, h),
    perimeter_m: pm(w, h),
    confidence: p.conf,
    polygon: [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y1], [p.x0, p.y0]],
    area_px: w * h,
    perimeter_px: 2 * (w + h),
    bbox: [p.x0, p.y0, p.x1, p.y1],
    num_vertices: 4,
    method: 'demo-precomputed (synthetic scene)',
  };
});
const totalM2 = Math.round(parcels.reduce((s, p) => s + p.area_m2, 0) * 100) / 100;
const avgConf = Math.round(parcels.reduce((s, p) => s + p.confidence, 0) / parcels.length * 1000) / 1000;
const largest = parcels.reduce((a, b) => (b.area_m2 > a.area_m2 ? b : a));

const detections = BUILDINGS.map((b, i) => ({
  class: 'building', class_id: 0, confidence: b.conf, bbox: [b.x0, b.y0, b.x1, b.y1], index: i,
}));
const allDetections = [
  ...detections,
  ...CARS.map((c) => ({ class: 'car', class_id: 2, confidence: c.conf, bbox: [c.x0, c.y0, c.x1, c.y1] })),
];
const avgDet = Math.round(detections.reduce((s, d) => s + d.confidence, 0) / detections.length * 10000) / 10000;

const features = {
  buildings: detections.map((d) => ({ ...d, polygon: [[d.bbox[0], d.bbox[1]], [d.bbox[2], d.bbox[1]], [d.bbox[2], d.bbox[3]], [d.bbox[0], d.bbox[3]], [d.bbox[0], d.bbox[1]]], area_px: (d.bbox[2] - d.bbox[0]) * (d.bbox[3] - d.bbox[1]), method: 'demo-precomputed' })),
  roads: ROADS.map((r) => ({ class: 'road', confidence: r.conf, bbox: [r.x0, r.y0, r.x1, r.y1], polygon: [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1], [r.x0, r.y0]], area_px: (r.x1 - r.x0) * (r.y1 - r.y0), method: 'demo-precomputed' })),
  vegetation: VEG_PATCHES.map((v) => ({ class: 'vegetation', confidence: v.conf, bbox: [v.x0, v.y0, v.x1, v.y1], polygon: [[v.x0, v.y0], [v.x1, v.y0], [v.x1, v.y1], [v.x0, v.y1], [v.x0, v.y0]], area_px: (v.x1 - v.x0) * (v.y1 - v.y0), method: 'demo-precomputed' })),
  water: [{ class: 'water', confidence: WATER_POND.conf, bbox: [WATER_POND.cx - WATER_POND.rx, WATER_POND.cy - WATER_POND.ry, WATER_POND.cx + WATER_POND.rx, WATER_POND.cy + WATER_POND.ry], polygon: [[WATER_POND.cx - WATER_POND.rx, WATER_POND.cy], [WATER_POND.cx, WATER_POND.cy - WATER_POND.ry], [WATER_POND.cx + WATER_POND.rx, WATER_POND.cy], [WATER_POND.cx, WATER_POND.cy + WATER_POND.ry], [WATER_POND.cx - WATER_POND.rx, WATER_POND.cy]], area_px: Math.round(Math.PI * WATER_POND.rx * WATER_POND.ry), method: 'demo-precomputed' }],
  other: CARS.map((c) => ({ class: 'car', confidence: c.conf, bbox: [c.x0, c.y0, c.x1, c.y1], polygon: [[c.x0, c.y0], [c.x1, c.y0], [c.x1, c.y1], [c.x0, c.y1], [c.x0, c.y0]], area_px: (c.x1 - c.x0) * (c.y1 - c.y0), method: 'demo-precomputed' })),
};
const counts = Object.fromEntries(Object.entries(features).map(([k, v]) => [k, v.length]));
counts.total = Object.values(counts).reduce((a, b) => a + b, 0);

const js = `// AUTO-GENERATED by tools/make-demo-scene.mjs — do not hand-edit.
// Controlled DEMO MODE dataset: synthetic prepared scene + PRECOMPUTED results.
// These results were NOT produced by live inference; the UI must label them DEMO.
// Paths are app-relative; the app prefixes window.location.origin at load time.
export const DEMO_IMAGE_PATH = 'demo/demo-aerial.png';
export const DEMO_ANNOTATED_PATH = 'demo/demo-aerial-annotated.png';
export const DEMO_META = {
  name: 'Demo Dataset — Synthetic Urban Block',
  scene: 'synthetic (generated, no real location)',
  image: { width: ${W}, height: ${H} },
  gsd_m_per_px: ${GSD},
  precomputed: true,
};
export const DEMO_DETECTION = ${JSON.stringify({
  filename: 'demo-aerial.png', size_bytes: 0, image_width: W, image_height: H,
  model: { name: 'demo-precomputed', type: 'demo', supports_buildings: true },
  detections, all_detections: allDetections, building_count: detections.length,
  total_detections: allDetections.length, average_confidence: avgDet,
  annotated_image: '/demo/demo-aerial-annotated.png', annotated_image_file: 'demo-aerial-annotated.png',
  warning: null, timestamp: '2026-01-15T10:00:00Z', demo: true,
}, null, 2)};
export const DEMO_PARCELS = ${JSON.stringify({
  filename: 'demo-aerial.png', size_bytes: 0, image_width: W, image_height: H,
  gsd_m_per_px: GSD, area_source: 'estimated',
  area_label: 'Demo scene — estimated image-based area at the documented demo GSD, NOT real-world cadastral area.',
  georeferencing: { georeferenced: false, detail: 'Synthetic demo scene; no spatial tags.', source: 'demo' },
  method: 'demo-precomputed (synthetic scene)', used_seg_model: null,
  parcels, parcel_count: parcels.length,
  total_area_estimated_m2: totalM2, total_area_estimated_ha: Math.round(totalM2 / 10000 * 10000) / 10000,
  average_area_m2: Math.round(totalM2 / parcels.length * 100) / 100,
  average_area_ha: toHa(totalM2 / parcels.length),
  largest_parcel: { parcel_id: largest.parcel_id, area_m2: largest.area_m2, area_ha: largest.area_ha, perimeter_m: largest.perimeter_m },
  summary: {
    total_parcels: parcels.length, total_area_m2: totalM2,
    total_area_ha: toHa(totalM2),
    average_area_m2: Math.round(totalM2 / parcels.length * 100) / 100,
    average_area_ha: toHa(totalM2 / parcels.length),
    average_confidence: avgConf,
    largest_parcel: { parcel_id: largest.parcel_id, area_m2: largest.area_m2, area_ha: largest.area_ha, perimeter_m: largest.perimeter_m },
    area_source: 'estimated', area_label: 'Demo scene — estimated image-based area, NOT real-world cadastral area.',
  },
  average_confidence: avgConf,
  geojson: {
    type: 'FeatureCollection',
    properties: { disclaimer: 'Demo precomputed polygons — synthetic scene.', coordinate_system: 'image_pixels', image_width_px: W, image_height_px: H, gsd_m_per_px: GSD, area_source: 'estimated' },
    features: parcels.map((p) => ({ type: 'Feature', properties: { parcel_id: p.parcel_id, area_m2_estimated: p.area_m2, area_ha_estimated: p.area_ha, perimeter_m_estimated: p.perimeter_m, confidence_approx: p.confidence, method: p.method, disclaimer: 'Demo — not a legal cadastral boundary.' }, geometry: { type: 'Polygon', coordinates: [p.polygon] } })),
  },
  annotated_image: '/demo/demo-aerial-annotated.png', annotated_image_file: 'demo-aerial-annotated.png',
  geojson_file: null, geojson_filename: null,
  disclaimer: 'AI-estimated / approximate parcel boundaries for visualisation and planning exploration only. NOT legally valid cadastral boundaries.',
  notes: 'DEMO MODE — precomputed results for a synthetic scene; not produced by live inference.',
  timestamp: '2026-01-15T10:00:00Z', demo: true,
}, null, 2)};
export const DEMO_FEATURES = ${JSON.stringify({
  filename: 'demo-aerial.png', size_bytes: 0, image_width: W, image_height: H,
  model: { name: 'demo-precomputed', type: 'demo', supports_buildings: true, loaded: true },
  features, counts,
  reasons: { buildings: null, roads: null, vegetation: null, water: null, other: null },
  feature_colors: { buildings: '#22c55e', roads: '#f97316', vegetation: '#16a34a', water: '#3b82f6', other: '#a855f7', parcels: '#eab308' },
  detections: features.buildings, building_count: features.buildings.length, average_confidence: avgDet,
  annotated_image: '/demo/demo-aerial-annotated.png', annotated_image_file: 'demo-aerial-annotated.png',
  segmentation_stats: {}, warnings: [], timestamp: '2026-01-15T10:00:00Z', demo: true,
}, null, 2)};
`;

mkdirSync(PUB, { recursive: true });
mkdirSync(SRC, { recursive: true });
writePNG(join(PUB, 'demo-aerial.png'), px, W, H);
writePNG(join(PUB, 'demo-aerial-annotated.png'), ann, W, H);
writeFileSync(join(SRC, 'demoResults.js'), js);
console.log('demo dataset written:', { parcels: parcels.length, buildings: detections.length, features: counts.total });
