import { useEffect, useRef, useState } from 'react';
import { API_BASE, detectChanges, resolveAssetUrl } from '../services/api.js';

const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.tif', '.tiff'];
const PREVIEWABLE_EXT = ['.jpg', '.jpeg', '.png'];
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/tiff'];
const MAX_BYTES = 100 * 1024 * 1024;

const CHANGE_ORDER = ['NEW', 'REMOVED', 'CHANGED', 'UNCHANGED'];
const CHANGE_DOT = {
  NEW: '#2ecc71',
  REMOVED: '#f87171',
  CHANGED: '#fbbf24',
  UNCHANGED: '#a0a0a0',
};

const extOf = (name) => {
  const i = (name || '').lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
};

function validateFile(f) {
  const ext = extOf(f.name);
  if (!ext || !ALLOWED_EXT.includes(ext)) {
    return `Unsupported file type '${ext || '(none)'}'. Allowed: JPG, JPEG, PNG, TIF/TIFF.`;
  }
  if (f.type && !ALLOWED_MIME.includes(f.type.toLowerCase())) {
    return `Rejected MIME type '${f.type}'. Please choose a JPG, PNG or TIFF image.`;
  }
  if (f.size === 0) return 'File is empty (0 bytes).';
  if (f.size > MAX_BYTES) return 'File exceeds the 100 MB limit.';
  return null;
}

/**
 * Optional urban change-detection: upload Image A (older) + Image B (newer),
 * compare with computer vision, and review UNCHANGED / NEW / REMOVED /
 * CHANGED items on the map and in the table below. All changes are AI
 * estimates — verify by a surveyor or relevant authority.
 */
export default function ChangeView({
  changeResult,
  setChangeResult,
  setChangeError,
  isComparing,
  setIsComparing,
  recordTiming,
  setBackendStatus,
}) {
  const [fileA, setFileA] = useState(null);
  const [fileB, setFileB] = useState(null);
  const [prevA, setPrevA] = useState(null);
  const [prevB, setPrevB] = useState(null);
  const [fileError, setFileError] = useState('');
  const [message, setMessage] = useState('');
  const [messageOk, setMessageOk] = useState(false);
  const [confidence, setConfidence] = useState(0.25);
  const [align, setAlign] = useState(true);
  const [statusTab, setStatusTab] = useState('ALL');
  const urls = useRef([]);

  useEffect(() => () => {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const pick = (which) => (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const err = validateFile(f);
    if (err) {
      setFileError(err);
      return;
    }
    setFileError('');
    setMessage('');
    if (which === 'A') {
      setFileA(f);
      if (PREVIEWABLE_EXT.includes(extOf(f.name))) {
        const u = URL.createObjectURL(f);
        urls.current.push(u);
        setPrevA(u);
      } else setPrevA(null);
    } else {
      setFileB(f);
      if (PREVIEWABLE_EXT.includes(extOf(f.name))) {
        const u = URL.createObjectURL(f);
        urls.current.push(u);
        setPrevB(u);
      } else setPrevB(null);
    }
  };

  const onCompare = async () => {
    if (!fileA || !fileB || isComparing) return;
    setIsComparing(true);
    setChangeError?.(null);
    setMessage('Comparing frames… (alignment → YOLO matching → parcels → structural diff)');
    setMessageOk(false);
    const t0 = performance.now();
    try {
      const res = await detectChanges(fileA, fileB, { confidence, align });
      setChangeResult(res);
      recordTiming?.('changes', performance.now() - t0);
      setBackendStatus?.('ok');
      const s = res.summary || {};
      setMessage(
        `Compared ${res.file_a} → ${res.file_b}: ` +
        `${s.new_buildings ?? 0} new building(s), ${s.changed_areas ?? 0} changed area(s), ` +
        `${s.construction_zones ?? 0} construction zone(s).`,
      );
      setMessageOk(true);
      setStatusTab('ALL');
    } catch (err) {
      const detail = err.response?.data?.detail;
      const help = typeof detail === 'object' ? detail?.help || detail?.message : detail;
      const msg = `Change comparison failed: ${help || err.message}`;
      setChangeResult(null);
      setChangeError?.(msg);
      setMessage(msg);
    } finally {
      setIsComparing(false);
    }
  };

  const changes = changeResult?.changes || [];
  const counts = changeResult?.counts || {};
  const summary = changeResult?.summary || {};
  const shown = statusTab === 'ALL' ? changes : changes.filter((c) => c.status === statusTab);
  const annotatedUrl = resolveAssetUrl(changeResult?.annotated_image);
  const canRun = fileA && fileB && !isComparing;

  return (
    <section className="card detect-section">
      <div className="detect-head">
        <div>
          <h2>8 · Urban Change Detection (optional)</h2>
          <p className="sub">
            Upload Image A (older) + Image B (newer) of the same area. Statuses:
            UNCHANGED · NEW · REMOVED · CHANGED — AI estimates, verify by a surveyor.
          </p>
        </div>
        <div className="detect-badges">
          {summary.new_buildings != null && <span className="badge">🏗️ {summary.new_buildings} new buildings</span>}
          {summary.changed_areas != null && <span className="badge">🔶 {summary.changed_areas} changed areas</span>}
          {summary.construction_zones != null && <span className="badge">🚧 {summary.construction_zones} construction zones</span>}
        </div>
      </div>

      <div className="detect-grid">
        <div>
          <label className="drop">
            {fileA ? `A (older): ${fileA.name}` : 'Image A — Older image (click to choose)'}
            <input type="file" accept=".jpg,.jpeg,.png,.tif,.tiff" onChange={pick('A')} hidden />
          </label>
          {prevA && <img className="preview" src={prevA} alt="Older frame preview (Image A)" />}
        </div>
        <div>
          <label className="drop">
            {fileB ? `B (newer): ${fileB.name}` : 'Image B — Newer image (click to choose)'}
            <input type="file" accept=".jpg,.jpeg,.png,.tif,.tiff" onChange={pick('B')} hidden />
          </label>
          {prevB && <img className="preview" src={prevB} alt="Newer frame preview (Image B)" />}
        </div>
      </div>

      {fileError && <p className="alert-err">{fileError}</p>}

      <label className="conf-row">
        <span>Confidence ≥ {Number(confidence).toFixed(2)}</span>
        <input
          type="range" min="0.05" max="0.9" step="0.05" value={confidence}
          onChange={(e) => setConfidence(parseFloat(e.target.value))}
        />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={align} onChange={(e) => setAlign(e.target.checked)} />
        <span>Align Image B onto Image A before comparing (ECC; uncheck for pre-registered pairs)</span>
      </label>

      <div style={{ height: 10 }} />

      <button className="btn" onClick={onCompare} disabled={!canRun}>
        {isComparing ? 'Comparing frames…' : 'Compare A → B (AI change detection)'}
      </button>

      {isComparing && (
        <div style={{ marginTop: 12 }}>
          <div className="progress-bar"><div className="progress-fill anim" /></div>
        </div>
      )}

      {message && <p className={messageOk ? 'mono ok-text' : 'mono'} style={{ marginTop: 12 }}>{message}</p>}
      <p className="mono">API: {API_BASE}</p>

      {changeResult && (
        <>
          <div className="stats stats-3" style={{ marginTop: 12 }}>
            <div className="stat"><div className="v">{summary.new_buildings ?? 0}</div><div className="l">New buildings detected</div></div>
            <div className="stat"><div className="v">{summary.changed_areas ?? 0}</div><div className="l">Changed areas</div></div>
            <div className="stat"><div className="v">{summary.construction_zones ?? 0}</div><div className="l">Potential construction zones</div></div>
            <div className="stat"><div className="v">{summary.removed_structures ?? 0}</div><div className="l">Removed structures</div></div>
            <div className="stat"><div className="v">{summary.new_roads ?? 0}</div><div className="l">New roads</div></div>
            <div className="stat"><div className="v">{summary.changed_parcel_areas ?? 0}</div><div className="l">Changed parcel areas</div></div>
          </div>

          {(changeResult.warnings || []).map((w, i) => (
            <p key={i} className="warn-box" style={{ marginTop: 8 }}>{w}</p>
          ))}

          {annotatedUrl && (
            <figure className="compare-single">
              <figcaption>Change map (Image-A frame — NEW green · REMOVED red · CHANGED amber)</figcaption>
              <img src={annotatedUrl} alt="Annotated change map with color-coded NEW, REMOVED and CHANGED overlays" />
              <figcaption className="mono">{changeResult.annotated_image}</figcaption>
            </figure>
          )}

          <div className="detect-badges" role="tablist" aria-label="Change status filter" style={{ marginTop: 12 }}>
            {['ALL', ...CHANGE_ORDER].map((st) => (
              <button
                key={st}
                role="tab"
                aria-selected={statusTab === st}
                className={`badge badge-tab${statusTab === st ? ' active' : ''}`}
                onClick={() => setStatusTab(st)}
              >
                <span className="legend-dot" style={st === 'ALL' ? {} : { background: CHANGE_DOT[st] }} />
                {' '}{st}{st === 'ALL' ? ` (${changes.length})` : ` (${counts[st] ?? 0})`}
              </button>
            ))}
          </div>

          {shown.length > 0 ? (
            <div className="table-wrap">
              <table className="det-table">
                <thead>
                  <tr><th>Status</th><th>Kind</th><th>Label</th><th>Conf.</th><th>Area (m² est.)</th><th>Method</th></tr>
                </thead>
                <tbody>
                  {shown.slice(0, 100).map((c, i) => (
                    <tr key={i}>
                      <td>
                        <span className="legend-dot" style={{ background: CHANGE_DOT[c.status] || '#fff' }} />
                        {' '}<b>{c.status}</b>
                      </td>
                      <td>{c.kind ?? '—'}</td>
                      <td>{c.label ?? '—'}</td>
                      <td>{Number(c.confidence ?? 0).toFixed(3)}</td>
                      <td>{c.area_m2 ?? c.area_px ?? '—'}</td>
                      <td className="mono">{c.method ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mono">No changes with this status. Try the ALL tab or a lower confidence.</p>
          )}
          {shown.length > 100 && (
            <p className="mono">…and {shown.length - 100} more — see the map layers.</p>
          )}

          <p className="warn-box" style={{ marginTop: 12 }}>{changeResult.disclaimer}</p>
        </>
      )}
    </section>
  );
}
