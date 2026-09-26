import { useEffect, useRef, useState } from 'react';
import {
  API_BASE,
  checkHealth,
  uploadImage,
  detectBuildings,
  detectFeatures,
  extractParcels,
  getModelStatus,
  getParcelStatus,
} from '../services/api.js';

const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.tif', '.tiff'];
// Browsers can render these directly; TIFF gets a file card instead.
const PREVIEWABLE_EXT = ['.jpg', '.jpeg', '.png'];
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/tiff', 'image/x-tiff', 'image/tif'];
// Must match backend MAX_UPLOAD_BYTES.
const MAX_BYTES = 100 * 1024 * 1024;

const extOf = (name) => {
  const i = (name || '').lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
};

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Client-side validation. Returns an error string, or null when acceptable. */
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
  setParcelResult,
  setParcelError,
  setFeatures,
  setFeaturesError,
  isExtracting,
  setIsExtracting,
  extractKind,
  setExtractKind,
  recordTiming,
  demoMode,
  onEnterDemo,
  resetSignal,
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
  const [parcelStatus, setParcelStatus] = useState(null);
  const [confidence, setConfidence] = useState(0.25);
  const [gsd, setGsd] = useState(0.1);
  // One-click full pipeline state: 'upload' | 'buildings' | 'parcels' | 'features' | ''.
  const [fullRunning, setFullRunning] = useState(false);
  const [fullStage, setFullStage] = useState('');
  const urlRef = useRef(null);
  // Guards stale auto-uploads: if the user picks file B while file A is
  // still uploading, A's late response is discarded.
  const uploadToken = useRef(0);

  const refreshStatuses = async () => {
    try {
      const s = await getModelStatus();
      setModelStatus(s);
    } catch {
      setModelStatus(null);
    }
    try {
      const p = await getParcelStatus();
      setParcelStatus(p);
    } catch {
      setParcelStatus(null);
    }
  };

  useEffect(() => {
    refreshStatuses();
    // Silent auto health-check so "Backend: connected" appears without a
    // manual click. Failure just marks the backend down; the user can retry
    // with the Test button.
    (async () => {
      try {
        const data = await checkHealth();
        setBackendStatus('ok');
        setHealthData(data);
      } catch {
        setBackendStatus((s) => (s === 'ok' ? s : 'down'));
      }
    })();
  }, []);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  // Global reset from Navbar: clear the selected file + previews + messages.
  useEffect(() => {
    if (!resetSignal) return;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setFile(null);
    setPreview(null);
    setLocalDims(null);
    setFileError('');
    setProgress(null);
    setBusy(false);
    setFullRunning(false);
    setFullStage('');
    setMessage('');
    setMessageOk(false);
    setUploaded(null);
  }, [resetSignal]);

  const clearPreview = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPreview(null);
  };

  const working = busy || fullRunning || isDetecting || isExtracting;

  /**
   * Upload `target` to the backend (POST /api/upload).
   * Retries once on pure network failure. Returns the server JSON or null.
   * When `announce` is true the panel message + progress UI reflect it;
   * the auto-upload after file select uses announce=true so the user SEES
   * the backend confirmation ("Saved as ... — W×H px").
   */
  const doUpload = async (target, { announce = true } = {}) => {
    if (!target) return null;
    const token = ++uploadToken.current;
    if (announce) {
      setBusy(true);
      setProgress(0);
      setMessage('Uploading to backend…');
      setMessageOk(false);
      setUploaded(null);
    }
    try {
      const t0 = performance.now();
      let res = null;
      let lastErr = null;
      for (let attempt = 0; attempt < 2 && !res; attempt += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          res = await uploadImage(target, announce ? setProgress : undefined);
        } catch (err) {
          lastErr = err;
          // Retry only when the backend never responded (offline/flake).
          if (err.response) break;
          if (attempt === 0 && announce) setMessage('Upload hiccup — retrying…');
        }
      }
      if (res) {
        if (token !== uploadToken.current) return res; // stale: newer file selected
        if (announce) {
          recordTiming?.('upload', performance.now() - t0, {
            filename: res.filename || target.name,
            width: res.width,
            height: res.height,
            size_bytes: res.size_bytes ?? target.size,
          });
          setBackendStatus('ok');
          setUploaded(res);
          setProgress(100);
          setMessage(`Saved as ${res.filename} — ${res.width}×${res.height} px, ${formatBytes(res.size_bytes)}.`);
          setMessageOk(true);
        }
        return res;
      }
      if (announce) {
        if (token !== uploadToken.current) return null; // stale failure: ignore
        if (lastErr?.response) {
          setBackendStatus('ok'); // reachable — it rejected the file
          setMessage(`Upload rejected: ${lastErr.response?.data?.detail || `HTTP ${lastErr.response.status}`}.`);
        } else {
          setBackendStatus('down');
          setMessage(`Upload failed: ${lastErr?.message || 'network error'}. Is the backend running at ${API_BASE}? Will retry automatically on Run.`);
        }
        setMessageOk(false);
      }
      return null;
    } finally {
      if (announce) setBusy(false);
    }
  };

  const onSelect = (e) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!f || fullRunning || isDetecting || isExtracting) return;
    clearPreview();
    setUploaded(null);
    setProgress(null);
    setMessage('');
    setDetectionError?.(null);
    setParcelError?.(null);
    setFeaturesError?.(null);
    // Old AI results belong to the previous frame — clear them so stale
    // parcels/buildings never overlay the newly selected image.
    setDetection?.(null);
    setFeatures?.(null);
    setParcelResult?.(null);

    const err = validateFile(f);
    if (err) {
      setFile(null);
      setLocalDims(null);
      setFileError(err);
      setOriginalPreview?.(null);
      return;
    }
    setFileError('');
    setFile(f);

    if (PREVIEWABLE_EXT.includes(extOf(f.name))) {
      const url = URL.createObjectURL(f);
      urlRef.current = url;
      setPreview(url);
      setOriginalPreview?.(url);
      // Read real pixel dimensions locally — no upload needed.
      const img = new Image();
      img.onload = () => setLocalDims({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => {
        clearPreview();
        setFile(null);
        setLocalDims(null);
        setOriginalPreview?.(null);
        setFileError('This file looks corrupted — the browser cannot decode it as an image.');
      };
      img.src = url;
    } else {
      // GeoTIFF: browsers can't render .tif — dimensions arrive with the server response.
      setLocalDims(null);
      setOriginalPreview?.(null);
    }

    // SEAMLESS: upload to the backend right away so "select photo" ==
    // "photo is in the backend". Failures are shown but non-fatal — the
    // Run buttons retry the upload path via the /detect/* endpoints.
    void doUpload(f);
  };

  const testConnection = async () => {
    if (fullRunning || isDetecting || isExtracting) return;
    setBusy(true);
    setMessage('Contacting backend…');
    setMessageOk(false);
    try {
      const data = await checkHealth();
      setBackendStatus('ok');
      setHealthData(data);
      setMessage(`Backend responded: ${data.status} (${data.service})`);
      setMessageOk(true);
      await refreshStatuses();
    } catch (err) {
      setBackendStatus('down');
      setHealthData(null);
      setMessage(`Cannot reach backend at ${API_BASE}. Is uvicorn running?`);
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async () => {
    if (!file || working) return;
    await doUpload(file);
  };

  const failMsg = (err) => {
    const detail = err.response?.data?.detail;
    return typeof detail === 'object' ? detail?.help || detail?.message : detail;
  };

  const runInference = async (kind) => {
    if (!file || isDetecting || isExtracting || fullRunning || busy) return;
    const isFeatures = kind === 'features';
    if (isFeatures) {
      setIsExtracting(true);
      setExtractKind('features');
    } else {
      setIsDetecting(true);
    }
    setDetectionError?.(null);
    setFeaturesError?.(null);
    setMessage(isFeatures ? 'Running feature-extraction pipeline…' : 'Running YOLO building detection… (first run may take a while)');
    setMessageOk(false);
    const t0 = performance.now();
    try {
      const res = isFeatures
        ? await detectFeatures(file, { confidence })
        : await detectBuildings(file, { confidence });
      setBackendStatus('ok');
      if (isFeatures) {
        setFeatures?.(res);
        const c = res.counts || {};
        setMessage(
          `Features extracted — buildings ${c.buildings ?? 0}, roads ${c.roads ?? 0}, ` +
          `vegetation ${c.vegetation ?? 0}, water ${c.water ?? 0}, other ${c.other ?? 0}. ` +
          `Annotated: ${res.annotated_image}`
        );
      } else {
        setDetection?.(res);
        const n = res.building_count ?? res.detections?.length ?? 0;
        setMessage(
          `Detected ${n} building(s), avg confidence ${(res.average_confidence ?? 0).toFixed(2)}. Annotated: ${res.annotated_image}`
        );
      }
      setMessageOk(true);
      recordTiming?.(isFeatures ? 'features' : 'buildings', performance.now() - t0);
      await refreshStatuses();
    } catch (err) {
      const status = err.response?.status;
      const help = failMsg(err);
      if (status === 503) {
        const msg =
          `Model unavailable (HTTP 503). ` +
          (help || err.message) +
          ` See models/README.md — place a building-trained YOLO weight in models/ and restart the backend.`;
        if (isFeatures) {
          setFeatures?.(null);
          setFeaturesError?.(msg);
        } else {
          setDetection?.(null);
          setDetectionError?.(msg);
        }
        setMessage(msg);
      } else {
        const msg = `AI run failed: ${help || err.message}`;
        if (isFeatures) {
          setFeatures?.(null);
          setFeaturesError?.(msg);
        } else {
          setDetection?.(null);
          setDetectionError?.(msg);
        }
        setMessage(msg);
      }
    } finally {
      if (isFeatures) {
        setIsExtracting(false);
        setExtractKind(null);
      } else {
        setIsDetecting(false);
      }
    }
  };

  const onExtractParcels = async () => {
    if (!file || isExtracting || isDetecting || fullRunning || busy) return;
    setIsExtracting(true);
    setExtractKind('parcels');
    setParcelError?.(null);
    setMessage('Extracting approximate parcel polygons… (preprocessing → segmentation → contours)');
    setMessageOk(false);
    const t0 = performance.now();
    try {
      const res = await extractParcels(file, { gsd, epsilon: 0.012, conf: confidence });
      recordTiming?.('parcels', performance.now() - t0);
      setParcelResult?.(res);
      setBackendStatus('ok');
      setMessage(`Extracted ${res.parcel_count} approximate parcel(s) via ${res.method}. Annotated: ${res.annotated_image}`);
      setMessageOk(true);
      await refreshStatuses();
    } catch (err) {
      const msg = `Parcel extraction failed: ${failMsg(err) || err.message}`;
      setParcelResult?.(null);
      setParcelError?.(msg);
      setMessage(msg);
    } finally {
      setIsExtracting(false);
      setExtractKind(null);
    }
  };

  /**
   * SEAMLESS one-click pipeline: upload (confirm in backend) → buildings →
   * parcels → features. A 503/empty stage never aborts the later stages;
   * every stage updates its own panel so counters fill progressively.
   * Each /detect/* endpoint re-validates + stores the file server-side, so
   * this works even if the explicit /api/upload step hit a flake.
   */
  const runFullAnalysis = async () => {
    if (!file || !!fileError || working) return;
    setFullRunning(true);
    setDetectionError?.(null);
    setParcelError?.(null);
    setFeaturesError?.(null);
    setMessageOk(false);
    const summary = { buildings: null, parcels: null, features: null };
    try {
      setFullStage('upload');
      setMessage('Stage 1/4: uploading to backend…');
      // "Upload (if needed)": selecting a file already auto-uploads it, and
      // every /detect/* endpoint re-stores the file server-side anyway — so
      // only re-upload when we have no server confirmation for this file.
      const up = uploaded ? { alreadyUploaded: true } : await doUpload(file);
      if (!up) {
        setMessage('Stage 1/4 failed: could not upload. Check the backend is running, then retry.');
        return;
      }
      // --- Stage 2: buildings (YOLO). 503 = model missing → warn, continue.
      setFullStage('buildings');
      setIsDetecting(true);
      setMessage('Stage 2/4: detecting buildings (YOLO)…');
      try {
        const t0 = performance.now();
        const res = await detectBuildings(file, { confidence });
        setDetection?.(res);
        setBackendStatus('ok');
        recordTiming?.('buildings', performance.now() - t0);
        summary.buildings = res.building_count ?? res.detections?.length ?? 0;
      } catch (err) {
        const status = err.response?.status;
        const help = failMsg(err) || err.message;
        const msg = status === 503
          ? `Buildings unavailable (HTTP 503): ${help}. Parcels/features still run.`
          : `Buildings failed: ${help}`;
        setDetection?.(null);
        setDetectionError?.(msg);
        summary.buildings = msg;
      } finally {
        setIsDetecting(false);
      }
      // --- Stage 3: parcels (polygons).
      setFullStage('parcels');
      setIsExtracting(true);
      setExtractKind('parcels');
      setMessage('Stage 3/4: extracting parcel polygons…');
      try {
        const t0 = performance.now();
        const res = await extractParcels(file, { gsd, epsilon: 0.012, conf: confidence });
        recordTiming?.('parcels', performance.now() - t0);
        setParcelResult?.(res);
        setBackendStatus('ok');
        summary.parcels = res.parcel_count;
      } catch (err) {
        const msg = `Parcel extraction failed: ${failMsg(err) || err.message}`;
        setParcelResult?.(null);
        setParcelError?.(msg);
        summary.parcels = msg;
      } finally {
        setIsExtracting(false);
        setExtractKind(null);
      }
      // --- Stage 4: full feature pipeline.
      setFullStage('features');
      setIsExtracting(true);
      setExtractKind('features');
      setMessage('Stage 4/4: extracting AI features…');
      try {
        const t0 = performance.now();
        const res = await detectFeatures(file, { confidence });
        setFeatures?.(res);
        setBackendStatus('ok');
        recordTiming?.('features', performance.now() - t0);
        summary.features = res.counts?.total ?? 0;
      } catch (err) {
        const msg = `Feature extraction failed: ${failMsg(err) || err.message}`;
        setFeatures?.(null);
        setFeaturesError?.(msg);
        summary.features = msg;
      } finally {
        setIsExtracting(false);
        setExtractKind(null);
      }
      const b = typeof summary.buildings === 'number' ? `${summary.buildings} building(s)` : 'buildings skipped';
      const p = typeof summary.parcels === 'number' ? `${summary.parcels} parcel(s)` : 'parcels failed';
      const f = typeof summary.features === 'number' ? `${summary.features} feature(s)` : 'features failed';
      setMessage(`Full analysis done — ${b}, ${p}, ${f}. See Results + map layers.`);
      setMessageOk(true);
      await refreshStatuses();
    } finally {
      setFullRunning(false);
      setFullStage('');
    }
  };

  const dimsLabel = localDims
    ? `${localDims.w} × ${localDims.h} px`
    : uploaded
      ? `${uploaded.width} × ${uploaded.height} px (from server)`
      : extOf(file?.name || '') === '.tif' || extOf(file?.name || '') === '.tiff'
        ? 'TIFF — dimensions available after upload'
        : '—';

  const modelBadge = !modelStatus
    ? 'YOLO status: unknown — press Test Backend Connection'
    : modelStatus.loaded
      ? `YOLO: ${modelStatus.model_name} (${modelStatus.model_type}) · buildings: ${modelStatus.supports_buildings ? 'yes' : 'no (generic COCO fallback)'}`
      : `YOLO: NOT LOADED — ${modelStatus.error || 'see models/README.md'}`;

  const parcelBadge = !parcelStatus
    ? 'Parcel status: unknown'
    : parcelStatus.ready
      ? `Parcels: ready (${parcelStatus.yolo_seg_available ? 'YOLO-seg masks' : 'classical watershed/contours'})`
      : `Parcels: NOT READY — ${parcelStatus.error || 'install backend requirements'}`;

  return (
    <section className="card">
      <h2>1 · Upload &amp; AI Analysis</h2>
      <p className="sub">Choose an image — it uploads to the backend automatically. Then run the one-click full analysis. No fake results.</p>

      <ol className="steps">
        <li className="done">✓ Project structure ready</li>
        <li className="done">✓ Backend connectivity + upload</li>
        <li className="active">→ Buildings (YOLO) + Parcels (polygons) + Features</li>
        <li>○ Report</li>
      </ol>

      <label className="drop" title={file ? file.name : undefined}>
        {file ? <span className="drop-name">{file.name}</span> : 'Click to choose image (JPG / JPEG / PNG / TIF)'}
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

      <label className="conf-row">
        <span title="Meters per pixel for area estimates">GSD (m/px): {Number(gsd).toFixed(3)}</span>
        <input
          type="range"
          min="0.02"
          max="1"
          step="0.01"
          value={gsd}
          onChange={(e) => setGsd(parseFloat(e.target.value))}
        />
      </label>

      <div style={{ height: 10 }} />

      <button className="btn full-run" onClick={runFullAnalysis} disabled={!file || !!fileError || working} title="Upload (if needed) then run buildings + parcels + features in one go">
        {fullRunning ? `Running full analysis… (${fullStage || 'starting'})` : 'Upload & Run Full AI Analysis'}
      </button>
      <button className="btn" onClick={onUpload} disabled={!file || !!fileError || working}>
        {busy && !fullRunning ? 'Uploading…' : 'Upload to Backend'}
      </button>
      <button className="btn detect" onClick={() => runInference('buildings')} disabled={!file || !!fileError || working}>
        {isDetecting ? 'Detecting buildings…' : 'Detect Buildings (YOLO)'}
      </button>
      <button className="btn parcel" onClick={onExtractParcels} disabled={!file || !!fileError || working}>
        {isExtracting && extractKind === 'parcels' ? 'Extracting parcels…' : 'Extract Parcels (polygons)'}
      </button>
      <button className="btn process" onClick={() => runInference('features')} disabled={!file || !!fileError || working}>
        {isExtracting && extractKind === 'features' ? 'Extracting features…' : 'Process Image (AI Features)'}
      </button>
      <button className="btn ghost" onClick={testConnection} disabled={working}>
        Test Backend Connection
      </button>
      <button className="btn ghost" onClick={onEnterDemo} disabled={working || demoMode !== 'off'} title="Load the prepared demo dataset (precomputed results)">
        {demoMode === 'loading' ? 'Loading demo…' : demoMode === 'active' ? 'Demo active ✓' : 'Try Demo Dataset'}
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
      <p className="mono">{parcelBadge}</p>
    </section>
  );
}
