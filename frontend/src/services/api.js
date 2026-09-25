import axios from 'axios';

// Base URL of the FastAPI backend.
// - Local dev default: http://localhost:8000
// - Override with frontend/.env file: VITE_API_URL=http://localhost:8000
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const client = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
});

// Long timeout for YOLO inference (first run also downloads/loads weights).
const detectClient = axios.create({
  baseURL: API_BASE,
  timeout: 180000,
});

// Parcel extraction can take a while on large drone frames.
const parcelClient = axios.create({
  baseURL: API_BASE,
  timeout: 240000,
});

export async function checkHealth() {
  const res = await client.get('/api/health');
  return res.data;
}

export async function getInfo() {
  const res = await client.get('/api/info');
  return res.data;
}

export async function getModelStatus() {
  const res = await client.get('/detect/model-status');
  return res.data;
}

<<<<<<< HEAD
export async function getParcelStatus() {
  const res = await client.get('/detect/parcel-status');
  return res.data;
}

=======
>>>>>>> 9eda01f47b9656667c8a9f396762fe912c12f763
export async function uploadImage(file, onProgress) {
  const form = new FormData();
  // Third arg preserves the original filename in the multipart payload.
  form.append('file', file, file.name);
  const res = await client.post('/api/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // Drone frames can be tens of MB — give the upload room to finish.
    timeout: 120000,
    onUploadProgress: (e) => {
      if (typeof onProgress === 'function' && e.total) {
        onProgress(Math.min(100, Math.round((e.loaded * 100) / e.total)));
      }
    },
  });
  return res.data;
}

/**
 * Run real YOLO building detection.
 * POST /detect/buildings with multipart `file` (+ optional query
 * `confidence`, `iou`). Returns structured JSON:
 * { detections:[{class, confidence, bbox}], building_count,
 *   average_confidence, annotated_image, ... }
 * Never returns hardcoded boxes — everything comes from the backend.
 */
export async function detectBuildings(file, { confidence = 0.25, iou = 0.45 } = {}) {
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await detectClient.post('/detect/buildings', form, {
    params: { confidence, iou },
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

/**
<<<<<<< HEAD
 * Extract approximate parcel polygons.
 * POST /detect/parcels with multipart `file` (+ `gsd`, `epsilon`, `conf`,
 * `max_parcels`). Returns:
 * { parcels:[{parcel_id, area, perimeter, confidence, polygon}],
 *   parcel_count, annotated_image, geojson_file, disclaimer, ... }
 * Areas are AI-estimated via GSD — NOT legal cadastre.
 */
export async function extractParcels(
  file,
  { gsd = 0.1, epsilon = 0.012, conf = 0.25, maxParcels = 60 } = {},
) {
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await parcelClient.post('/detect/parcels', form, {
    params: { gsd, epsilon, conf, max_parcels: maxParcels },
=======
 * Run the full feature-extraction pipeline.
 * POST /detect/features with multipart `file` (+ optional query
 * `confidence`, `iou`). Returns { features: {buildings, roads, vegetation,
 * water, other}, counts, reasons, annotated_image, ... } where every item
 * carries {class, confidence, bbox, polygon}. Empty categories are honest
 * (see `reasons`) — never fabricated.
 */
export async function detectFeatures(file, { confidence = 0.25, iou = 0.45 } = {}) {
  const form = new FormData();
  form.append('file', file);
  const res = await detectClient.post('/detect/features', form, {
    params: { confidence, iou },
>>>>>>> 9eda01f47b9656667c8a9f396762fe912c12f763
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

<<<<<<< HEAD
/** Resolve a backend-served asset path (e.g. `/outputs/x.jpg`) to a full URL. */
export function resolveAssetUrl(path) {
=======
/** Resolve a backend-served asset path (e.g. `/outputs/x.jpg`) to a full URL. */export function resolveAssetUrl(path) {
>>>>>>> 9eda01f47b9656667c8a9f396762fe912c12f763
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
}

export { API_BASE };
