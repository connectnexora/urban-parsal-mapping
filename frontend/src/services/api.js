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

export async function uploadImage(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await client.post('/api/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
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
  form.append('file', file);
  const res = await detectClient.post('/detect/buildings', form, {
    params: { confidence, iou },
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

/** Resolve a backend-served asset path (e.g. `/outputs/x.jpg`) to a full URL. */
export function resolveAssetUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
}

export { API_BASE };
