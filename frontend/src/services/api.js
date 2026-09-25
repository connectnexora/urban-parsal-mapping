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

export async function uploadImage(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await client.post('/api/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

export { API_BASE };
