import { buildingCoverage } from '../utils/mapGeo.js';

/**
 * Selected-parcel sidebar: Parcel ID, estimated area, perimeter,
 * building coverage (honest pixel heuristic) and AI confidence.
 * All values are AI-estimated/approximate — never legal cadastre.
 */
export default function ParcelDetail({ parcelResult, detection, featureResult, selectedParcelId, onClose }) {
  if (!parcelResult || !selectedParcelId) return null;
  const parcel = (parcelResult.parcels || []).find((p) => p.parcel_id === selectedParcelId);
  if (!parcel) return null;

  const buildings = featureResult?.features?.buildings?.length
    ? featureResult.features.buildings
    : (detection?.detections || []);
  const cov = buildingCoverage([parcel], buildings)[parcel.parcel_id] || { count: 0, coveragePct: 0 };

  return (
    <aside className="card parcel-detail">
      <div className="parcel-detail-head">
        <div>
          <h2>{parcel.parcel_id}</h2>
          <p className="sub">AI-estimated parcel — approximate, NOT legal cadastre</p>
        </div>
        <button className="btn small ghost" onClick={onClose} aria-label="Close parcel details">
          ✕
        </button>
      </div>
      <div className="parcel-grid">
        <div className="stat"><div className="v">~{parcel.area} m²</div><div className="l">Estimated area</div></div>
        <div className="stat"><div className="v">~{parcel.perimeter} m</div><div className="l">Perimeter</div></div>
        <div className="stat"><div className="v">{cov.count}</div><div className="l">Buildings inside</div></div>
        <div className="stat"><div className="v">~{cov.coveragePct}%</div><div className="l">Building coverage</div></div>
        <div className="stat"><div className="v">{Number(parcel.confidence).toFixed(2)}</div><div className="l">AI confidence (heur.)</div></div>
        <div className="stat"><div className="v">{parcel.num_vertices}</div><div className="l">Vertices</div></div>
      </div>
      <p className="mono">Method: {parcel.method} · GSD {parcelResult.gsd_m_per_px} m/px</p>
      <p className="warn-box">
        Approximate boundary for visualisation only — not a survey-grade or legally valid cadastral boundary.
      </p>
    </aside>
  );
}
