import { useEffect, useState } from 'react';
import { API_BASE, checkHealth, uploadImage, detectBuildings, getModelStatus } from '../services/api.js';

export default function UploadPanel({
  backendStatus,
  setBackendStatus,
  setHealthData,
  setDetection,
  setDetectionError,
  setOriginalPreview,
  isDetecting,
  setIsDetecting,
}) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [modelStatus, setModelStatus] = useState(null);
  const [confidence, setConfidence] = useState(0.25);

  const refreshModelStatus = async () => {
    try {
      const s = await getModelStatus();
      setModelStatus(s);
    } catch {
      setModelStatus(null);
    }
  };

  useEffect(() => {
    refreshModelStatus();
  }, []);

  const onSelect = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
    setOriginalPreview(url);
    setMessage('');
    setDetectionError(null);
  };

  const testConnection = async () => {
    setBusy(true);
    setMessage('Contacting backend…');
    try {
      const data = await checkHealth();
      setBackendStatus('ok');
      setHealthData(data);
      setMessage(`✅ Backend responded: ${data.status} (${data.service})`);
      await refreshModelStatus();
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

  const onDetect = async () => {
    if (!file || isDetecting) return;
    setIsDetecting(true);
    setDetectionError(null);
    setMessage('🤖 Running YOLO building detection… (first run may take a while)');
    try {
      const res = await detectBuildings(file, { confidence });
      setDetection(res);
      setBackendStatus('ok');
      const n = res.building_count ?? res.detections?.length ?? 0;
      setMessage(
        `✅ Detected ${n} building(s), avg confidence ${(res.average_confidence ?? 0).toFixed(2)}. Annotated: ${res.annotated_image}`
      );
      await refreshModelStatus();
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail;
      const help = typeof detail === 'object' ? detail?.help || detail?.message : detail;
      if (status === 503) {
        const msg =
          `⚠️ Model unavailable (HTTP 503). ` +
          (help || err.message) +
          ` See models/README.md — place a building-trained YOLO weight in models/ and restart the backend.`;
        setDetection(null);
        setDetectionError(msg);
        setMessage(msg);
      } else {
        const msg = `❌ Detection failed: ${help || err.message}`;
        setDetection(null);
        setDetectionError(msg);
        setMessage(msg);
      }
    } finally {
      setIsDetecting(false);
    }
  };

  const modelBadge = !modelStatus
    ? 'Model status: unknown — press Test Backend Connection'
    : modelStatus.loaded
      ? `Model: ${modelStatus.model_name} (${modelStatus.model_type}) · buildings: ${modelStatus.supports_buildings ? 'yes' : 'no (generic COCO fallback)'}`
      : `Model: NOT LOADED — ${modelStatus.error || 'see models/README.md'}`;

  return (
    <section className="card">
      <h2>1 · Upload &amp; AI Detection</h2>
      <p className="sub">Upload a drone/aerial image, then run real YOLO inference. No fake boxes.</p>

      <ol className="steps">
        <li className="done">✓ Project structure ready</li>
        <li className="done">✓ Backend connectivity</li>
        <li className="active">→ POST /detect/buildings (live YOLO)</li>
        <li>○ Boundaries → Area → Map → Report</li>
      </ol>

      <label className="drop">
        {file ? file.name : 'Click to choose image (JPG / PNG / TIF)'}
        <input type="file" accept=".jpg,.jpeg,.png,.tif,.tiff" onChange={onSelect} hidden />
      </label>

      {preview && <img className="preview" src={preview} alt="Selected drone view preview" />}

      <label className="conf-row">
        <span>Confidence ≥ {Number(confidence).toFixed(2)}</span>
        <input
          type="range"
          min="0.05"
          max="0.9"
          step="0.05"
          value={confidence}
          onChange={(e) => setConfidence(parseFloat(e.target.value))}
        />
      </label>

      <div style={{ height: 10 }} />

      <button className="btn" onClick={onUpload} disabled={!file || busy || isDetecting}>
        {busy ? 'Working…' : 'Upload to Backend'}
      </button>
      <button className="btn detect" onClick={onDetect} disabled={!file || busy || isDetecting}>
        {isDetecting ? 'Detecting buildings……' : '🤖 Detect Buildings (AI)'}
      </button>
      <button className="btn ghost" onClick={testConnection} disabled={busy || isDetecting}>
        Test Backend Connection
      </button>

      {message && <p className="mono" style={{ marginTop: 12 }}>{message}</p>}
      <p className="mono">API: {API_BASE}</p>
      <p className="mono">{modelBadge}</p>
    </section>
  );
}
