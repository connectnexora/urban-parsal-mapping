import { useState } from 'react';
import { API_BASE, checkHealth, uploadImage } from '../services/api.js';

export default function UploadPanel({ backendStatus, setBackendStatus, setHealthData }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const onSelect = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setMessage('');
  };

  const testConnection = async () => {
    setBusy(true);
    setMessage('Contacting backend…');
    try {
      const data = await checkHealth();
      setBackendStatus('ok');
      setHealthData(data);
      setMessage(`✅ Backend responded: ${data.status} (${data.service})`);
    } catch (err) {
      setBackendStatus('down');
      setMessage(`❌ Cannot reach backend at ${API_BASE}. Is uvicorn running?`);
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async () => {
    if (!file) return;
    setBusy(true);
    setMessage('Uploading…');
    try {
      const res = await uploadImage(file);
      setBackendStatus('ok');
      setMessage(`📤 ${res.message} (saved as ${res.filename})`);
    } catch (err) {
      const detail = err.response?.data?.detail || err.message;
      setMessage(`❌ Upload failed: ${detail}. Check backend is running.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>1 · Upload &amp; Connection</h2>
      <p className="sub">Drop a drone/aerial image. No AI runs yet — Step 2 adds detection.</p>

      <ol className="steps">
        <li className="done">✓ Project structure ready</li>
        <li className="active">→ Upload image &amp; verify backend link</li>
        <li>○ AI detection (Step 2)</li>
        <li>○ Boundaries → Area → Map → Report</li>
      </ol>

      <label className="drop">
        {file ? file.name : 'Click to choose image (JPG / PNG / TIF)'}
        <input type="file" accept=".jpg,.jpeg,.png,.tif,.tiff" onChange={onSelect} hidden />
      </label>

      {preview && <img className="preview" src={preview} alt="Selected drone view preview" />}

      <div style={{ height: 10 }} />

      <button className="btn" onClick={onUpload} disabled={!file || busy}>
        {busy ? 'Working…' : 'Upload to Backend'}
      </button>
      <button className="btn ghost" onClick={testConnection} disabled={busy}>
        Test Backend Connection
      </button>

      {message && <p className="mono" style={{ marginTop: 12 }}>{message}</p>}
      <p className="mono">API: {API_BASE}</p>
    </section>
  );
}
