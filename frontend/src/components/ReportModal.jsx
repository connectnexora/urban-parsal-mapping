import { useEffect } from 'react';
import { resolveAssetUrl } from '../services/api.js';
import { buildingCoverage, computeSummary } from '../utils/mapGeo.js';

export const REPORT_DISCLAIMER =
  'AI-generated parcel boundaries are estimates for visualization and analysis and are not a substitute for legally surveyed cadastral boundaries.';

function fmtMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso || '—';
  }
}

/**
 * Automatic parcel analysis report. Assembled entirely from live AI results
 * (upload metadata, parcel polygons, building/feature detections, measured
 * client-side timings) — nothing hardcoded. Export is via the browser print
 * pipeline (choose "Save as PDF"); print CSS isolates the report.
 */
export default function ReportModal({
  parcelResult,
  detection,
  features,
  timings,
  uploadedInfo,
  originalPreview,
  onClose,
}) {
  useEffect(() => {
    document.body.classList.add('report-open');
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('report-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!parcelResult) return null;

  const parcels = parcelResult.parcels || [];
  const buildings = features?.features?.buildings?.length
    ? features.features.buildings
    : (detection?.detections || []);
  const roads = features?.features?.roads || [];
  const roadCount = features?.counts?.roads ?? roads.length;
  const coverageById = buildingCoverage(parcels, buildings);
  const summary = computeSummary(parcelResult, buildings);

  const filename = uploadedInfo?.filename || parcelResult.filename || '—';
  const imgW = uploadedInfo?.width || parcelResult.image_width || '—';
  const imgH = uploadedInfo?.height || parcelResult.image_height || '—';
  const t = timings || {};
  const aiTotal = ['buildings', 'parcels', 'features']
    .map((k) => t[k])
    .filter((v) => Number.isFinite(v))
    .reduce((s, v) => s + v, 0);
  const generatedAt = new Date().toLocaleString();

  // Map snapshot showing detected parcel boundaries: prefer the backend
  // parcel annotation, then feature/building annotations, then the preview.
  const snapshotSrc = resolveAssetUrl(
    parcelResult.annotated_image
    || features?.annotated_image
    || detection?.annotated_image,
  ) || originalPreview;
  const snapshotCaption = parcelResult.annotated_image
    ? `Parcel boundaries overlay (${parcelResult.annotated_image})`
    : 'Annotated AI output (parcel overlay unavailable)';

  const exportPdf = () => window.print();

  return (
    <div className="report-backdrop" onClick={onClose}>
      <div
        className="card report-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Parcel analysis report"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="report-print-area">
          <header className="report-head">
            <div>
              <p className="report-kicker">Project: AI-Based Automated Urban Parcel Mapping</p>
              <h2>Parcel Analysis Report</h2>
              <p className="mono">Generated {generatedAt}</p>
            </div>
            <div className="detect-badges no-print">
              <button className="btn small" onClick={exportPdf}>Export as PDF</button>
              <button className="btn small ghost" onClick={onClose}>Close</button>
            </div>
          </header>

          <h3>1 · Image information</h3>
          <div className="file-meta">
            <div className="meta-row"><span>File name</span><strong>{filename}</strong></div>
            <div className="meta-row"><span>Image dimensions</span><strong>{imgW} × {imgH} px</strong></div>
            <div className="meta-row"><span>Upload time</span><strong>{fmtMs(t.upload)}</strong></div>
            <div className="meta-row"><span>Building detection time</span><strong>{fmtMs(t.buildings)}</strong></div>
            <div className="meta-row"><span>Parcel extraction time</span><strong>{fmtMs(t.parcels)}</strong></div>
            <div className="meta-row"><span>Feature pipeline time</span><strong>{fmtMs(t.features)}</strong></div>
            <div className="meta-row"><span>Total AI processing time</span><strong>{aiTotal ? fmtMs(aiTotal) : '—'}</strong></div>
            <div className="meta-row"><span>Parcel method</span><strong>{parcelResult.method}</strong></div>
            <div className="meta-row"><span>Area basis</span><strong>{parcelResult.area_source === 'georeferenced' ? '🛰️ Georeferenced' : '📐 Estimated image-based'} · GSD {parcelResult.gsd_m_per_px} m/px</strong></div>
          </div>

          <h3>2 · Detection summary</h3>
          <div className="stats stats-3">
            <div className="stat"><div className="v">{summary.totalParcels}</div><div className="l">Number of parcels</div></div>
            <div className="stat"><div className="v">{summary.totalBuildings}</div><div className="l">Number of buildings</div></div>
            <div className="stat"><div className="v">{roadCount}</div><div className="l">Number of roads</div></div>
            <div className="stat"><div className="v">~{summary.totalAreaM2.toLocaleString()} m²</div><div className="l">Total estimated area ({summary.totalAreaHa.toLocaleString()} ha)</div></div>
            <div className="stat"><div className="v">~{summary.averageAreaM2.toLocaleString()} m²</div><div className="l">Average parcel area</div></div>
            <div className="stat"><div className="v">~{summary.averageCoveragePct}%</div><div className="l">Average building coverage</div></div>
          </div>

          <h3>3 · Parcel table</h3>
          <p className="mono">Parcel ID | Area | Perimeter | Buildings | Confidence</p>
          {parcels.length > 0 ? (
            <div className="table-wrap">
              <table className="det-table">
                <thead>
                  <tr><th>Parcel ID</th><th>Area</th><th>Perimeter</th><th>Buildings</th><th>Confidence</th></tr>
                </thead>
                <tbody>
                  {parcels.map((p) => {
                    const cov = coverageById[p.parcel_id] || { count: 0, coveragePct: 0 };
                    const areaM2 = p.area_m2 ?? p.area;
                    const areaHa = p.area_ha ?? (areaM2 / 10000);
                    return (
                      <tr key={p.parcel_id}>
                        <td><b>{p.parcel_id}</b></td>
                        <td>{areaM2} m² ({Number(areaHa).toFixed(4)} ha)</td>
                        <td>{p.perimeter_m ?? p.perimeter} m</td>
                        <td>{cov.count} (~{cov.coveragePct}%)</td>
                        <td>{Number(p.confidence).toFixed(3)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mono">No parcels detected.</p>
          )}

          <h3>4 · Map snapshot — detected parcel boundaries</h3>
          {snapshotSrc ? (
            <figure className="report-figure">
              <img src={snapshotSrc} alt="Map snapshot showing detected parcel boundaries" />
              <figcaption className="mono">{snapshotCaption}</figcaption>
            </figure>
          ) : (
            <p className="mono">Snapshot unavailable — no annotated image produced for this run.</p>
          )}

          <h3>5 · Backend record</h3>
          <p className="mono">
            {filename} · {fmtDate(parcelResult.timestamp)} · {parcelResult.image_width}×{parcelResult.image_height}px
          </p>

          <p className="warn-box report-disclaimer">{REPORT_DISCLAIMER}</p>
        </div>

        <div className="parcel-actions no-print">
          <button className="btn small" onClick={exportPdf}>Export as PDF</button>
          <button className="btn small ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
