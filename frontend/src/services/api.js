import axios from 'axios';

// Base URL of the FastAPI backend.
// - Local dev default: http://localhost:8000
// - Override with frontend/.env file: VITE_API_URL=http://localhost:8000
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const client = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
});

export async function checkHealth() {
  const res = await client.get('/api/health');
  return res.data;
}

export async function getInfo() {
  const res = await client.get('/api/info');
  return res.data;
}

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

export { API_BASE };
