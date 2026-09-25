import { useEffect, useRef, useState } from 'react';
import { API_BASE, checkHealth, uploadImage, detectBuildings, detectFeatures, getModelStatus } from '../services/api.js';

const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.tif', '.tiff'];
// Browsers can render these directly; TIFF gets a file card instead.
const PREVIEWABLE_EXT = ['.jpg', '.jpeg', '.png'];
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/tiff'];
// Must match backend MAX_UPLOAD_BYTES.
const MAX_BYTES = 100 * 1024 * 1024;

const extOf = (name) => {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
};

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Client-side validation. Returns an error string, or null when the file is acceptable. */
function validateFile(f) {
  const ext = extOf(f.name);
  if (!ext || !ALLOWED_EXT.includes(ext)) {
    return `Unsupported file type '${ext || '(none)'}'. Allowed: JPG, JPEG, PNG, TIF/TIFF (GeoTIFF).`;
  }
  // Some browsers report an empty MIME type (notably for .tif) — only
  // reject when a type IS reported and it isn't an image type we accept.
  if (f.type && !ALLOWED_MIME.includes(f.type.toLowerCase())) {
    return `Rejected MIME type '${f.type}'. Please choose a JPG, PNG or TIFF image.`;
  }
  if (f.size === 0) return 'File is empty (0 bytes).';
  if (f.size > MAX_BYTES) {
    return `File is ${formatBytes(f.size)} — over the ${formatBytes(MAX_BYTES)} limit.`;
  }
  return null;
}

export default function UploadPanel({
  backendStatus,
  setBackendStatus,
  setHealthData,
  setDetection,
  setDetectionError,
  setOriginalPreview,
  isDetecting,
  setIsDetecting,
  setFeatures,
  setFeaturesError,
  isExtracting,
  setIsExtracting,
}) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [localDims, setLocalDims] = useState(null);
  const [fileError, setFileError] = useState('');
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageOk, setMessageOk] = useState(false);
  const [uploaded, setUploaded] = useState(null);
  const [modelStatus, setModelStatus] = useState(null);
  const [confidence, setConfidence] = useState(0.25);
  const urlRef = useRef(null);

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

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const clearPreview = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPreview(null);
  };

  const working = busy || isDetecting || isExtracting;

  const onSelect = (e) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!f) return;
    clearPreview();
    setUploaded(null);
    setProgress(null);
    setMessage('');
    setDetectionError(null);
    setFeaturesError(null);

    const err = validateFile(f);
    if (err) {
      setFile(null);
      setLocalDims(null);
      setFileError(err);
      return;
    }
    setFileError('');
    setFile(f);

    if (PREVIEWABLE_EXT.includes(extOf(f.name))) {
      const url = URL.createObjectURL(f);
      urlRef.current = url;
      setPreview(url);
      setOriginalPreview(url);
      // Read real pixel dimensions locally — no upload needed.
      const img = new Image();
      img.onload = () => setLocalDims({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => {
        clearPreview();
        setFile(null);
        setLocalDims(null);
        setFileError('This file looks corrupted — the browser cannot decode it as an image.');
      };
      img.src = url;
    } else {
      // GeoTIFF: browsers can't render .tif — dimensions arrive with the server response.
      setLocalDims(null);
      setOriginalPreview(null);
    }
  };

  const testConnection = async () => {
    setBusy(true);
    setMessage('Contacting backend…');
    setMessageOk(false);
    try {
      const data = await checkHealth();
      setBackendStatus('ok');
      setHealthData(data);
      setMessage(`Backend responded: ${data.status} (${data.service})`);
      setMessageOk(true);
      await refreshModelStatus();
    } catch (err) {
      setBackendStatus('down');
      setMessage(`Cannot reach backend at ${API_BASE}. Is uvicorn running?`);
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async () => {
    if (!file || busy) return;
    setBusy(true);
    setProgress(0);
    setMessage('Uploading…');
    setMessageOk(false);
    setUploaded(null);
    try {
      const res = await uploadImage(file, setProgress);
      setBackendStatus('ok');
      setUploaded(res);
      setMessage(`Saved as ${res.filename} — ${res.width}×${res.height} px, ${formatBytes(res.size_bytes)}.`);
      setMessageOk(true);
    } catch (err) {
      // A 4xx means the backend IS reachable (validation failed server-side);
      // only a missing response means it is offline.
      if (err.response) {
        setBackendStatus('ok');
        setMessage(`Upload rejected: ${err.response?.data?.detail || `HTTP ${err.response.status}`}.`);
      } else {
        setBackendStatus('down');
        setMessage(`Upload failed: ${err.message}. Check the backend is running.`);
      }
    } finally {
      setBusy(false);
    }
  };

  const runInference = async (kind) => {
    if (!file || isDetecting || isExtracting) return;
    const isFeatures = kind === 'features';
    if (isFeatures) setIsExtracting(true);
    else setIsDetecting(true);
    setDetectionError(null);
    setFeaturesError(null);
    setMessage(isFeatures ? 'Running feature-extraction pipeline…' : 'Running YOLO building detection… (first run may take a while)');
    setMessageOk(false);
    try {
      const res = isFeatures
        ? await detectFeatures(file, { confidence })
        : await detectBuildings(file, { confidence });
      setBackendStatus('ok');
      if (isFeatures) {
        setFeatures(res);
        const c = res.counts || {};
        setMessage(
          `Features extracted — buildings ${c.buildings ?? 0}, roads ${c.roads ?? 0}, ` +
          `vegetation ${c.vegetation ?? 0}, water ${c.water ?? 0}, other ${c.other ?? 0}. ` +
          `Annotated: ${res.annotated_image}`
        );
      } else {
        setDetection(res);
        const n = res.building_count ?? res.detections?.length ?? 0;
        setMessage(
          `Detected ${n} building(s), avg confidence ${(res.average_confidence ?? 0).toFixed(2)}. Annotated: ${res.annotated_image}`
        );
      }
      setMessageOk(true);
      await refreshModelStatus();
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail;
      const help = typeof detail === 'object' ? detail?.help || detail?.message : detail;
      if (status === 503) {
        const msg =
          `Model unavailable (HTTP 503). ` +
          (help || err.message) +
          ` See models/README.md — place a building-trained YOLO weight in models/ and restart the backend.`;
        if (isFeatures) setFeaturesError(msg);
        else {
          setDetection(null);
          setDetectionError(msg);
        }
        setMessage(msg);
      } else {
        const msg = `AI run failed: ${help || err.message}`;
        if (isFeatures) setFeaturesError(msg);
        else {
          setDetection(null);
          setDetectionError(msg);
        }
        setMessage(msg);
      }
    } finally {
      if (isFeatures) setIsExtracting(false);
      else setIsDetecting(false);
    }
  };

  const modelBadge = !modelStatus
    ? 'Model status: unknown — press Test Backend Connection'
    : modelStatus.loaded
      ? `Model: ${modelStatus.model_name} (${modelStatus.model_type}) · buildings: ${modelStatus.supports_buildings ? 'yes' : 'no (generic COCO fallback)'}`
      : `Model: NOT LOADED — ${modelStatus.error || 'see models/README.md'}`;

  const dimsLabel = localDims
    ? `${localDims.w} × ${localDims.h} px`
    : uploaded
      ? `${uploaded.width} × ${uploaded.height} px (from server)`
      : extOf(file?.name || '') === '.tif' || extOf(file?.name || '') === '.tiff'
        ? 'TIFF — dimensions available after upload'
        : '—';

  return (
    <section className="card">
      <h2>1 · Upload &amp; AI Detection</h2>
      <p className="sub">Upload a drone/aerial image, then run real inference. No fake boxes.</p>

      <ol className="steps">
        <li className="done">✓ Project structure ready</li>
        <li className="done">✓ Backend connectivity + upload</li>
        <li className="active">→ POST /detect/features (live pipeline)</li>
        <li>○ Boundaries → Area → Map → Report</li>
      </ol>

      <label className="drop">
        {file ? file.name : 'Click to choose image (JPG / JPEG / PNG / TIF)'}
        <input type="file" accept=".jpg,.jpeg,.png,.tif,.tiff" onChange={onSelect} hidden />
      </label>

      {fileError && <p className="alert-err">{fileError}</p>}

      {file && !fileError && (
        <div className="file-meta">
          <div className="meta-row"><span>File name</span><strong>{file.name}</strong></div>
          <div className="meta-row"><span>Dimensions</span><strong>{dimsLabel}</strong></div>
          <div className="meta-row"><span>File size</span><strong>{formatBytes(file.size)}</strong></div>
        </div>
      )}

      {preview && <img className="preview" src={preview} alt="Selected drone view preview" />}
      {file && !preview && !fileError && (
        <div className="tiff-fallback">
          <div className="tiff-icon">TIF</div>
          <p>GeoTIFF selected — browsers can&apos;t preview .tif, but the backend reads it. Upload to confirm dimensions.</p>
        </div>
      )}

      {progress !== null && (
        <div className="upload-progress">
          <div className="progress-track" role="progressbar" aria-valuenow={progress} aria-valuemin="0" aria-valuemax="100" aria-label="Upload progress">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="mono">{busy ? `Uploading… ${progress}%` : progress === 100 ? 'Upload complete' : `${progress}%`}</span>
        </div>
      )}

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

      <button className="btn" onClick={onUpload} disabled={!file || !!fileError || working}>
        {busy ? 'Uploading…' : 'Upload to Backend'}
      </button>
      <button className="btn process" onClick={() => runInference('features')} disabled={!file || !!fileError || working}>
        {isExtracting ? 'Extracting features…' : 'Process Image (AI Features)'}
      </button>
      <button className="btn detect" onClick={() => runInference('buildings')} disabled={!file || !!fileError || working}>
        {isDetecting ? 'Detecting buildings…' : 'Detect Buildings (AI)'}
      </button>
      <button className="btn ghost" onClick={testConnection} disabled={working}>
        Test Backend Connection
      </button>

      {uploaded && (
        <div className="upload-summary">
          <div className="meta-row"><span>Stored as</span><strong>{uploaded.filename}</strong></div>
          <div className="meta-row"><span>Dimensions</span><strong>{uploaded.width} × {uploaded.height} px</strong></div>
          <div className="meta-row"><span>Size</span><strong>{formatBytes(uploaded.size_bytes)}</strong></div>
          <div className="meta-row"><span>Status</span><strong className="status-ok">{uploaded.status}</strong></div>
        </div>
      )}

      {message && <p className={messageOk ? 'mono ok-text' : 'mono'} style={{ marginTop: 12 }}>{message}</p>}
      <p className="mono">API: {API_BASE}</p>
      <p className="mono">{modelBadge}</p>
    </section>
  );
}
