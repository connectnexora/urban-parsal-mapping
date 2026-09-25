import { computeSummary } from '../utils/mapGeo.js';

/**
 * Summary statistics for the parcel information panel. Every number derives
 * from live AI results (parcel polygons + building detections) — nothing
 * hardcoded. Areas carry their source: georeferenced vs estimated
 * image-based (NOT real-world cadastral area).
 */
export default function SummaryStats({ parcelResult, detection, featureResult }) {
  if (!parcelResult) return null;

  const buildings = featureResult?.features?.buildings?.length
    ? featureResult.features.buildings
    : (detection?.detections || []);
  const s = computeSummary(parcelResult, buildings);
  const geo = s.areaSource === 'georeferenced';
  const backendSummary = parcelResult.summary || {};

  return (
    <section className="card detect-section">
      <div className="detect-head">
        <div>
          <h2>6 · Parcel Summary Statistics</h2>
          <p className="sub">
            {geo
              ? 'Georeferenced areas — from the image\u2019s embedded spatial tags.'
              : 'Estimated image-based areas — plain image without geographic coordinates, NOT real-world cadastral area.'}
          </p>
        </div>
        <div className="detect-badges">
          <span className={`badge ${geo ? 'badge-geo' : 'badge-est'}`}>
            {geo ? '🛰️ Georeferenced' : '📐 Estimated image-based'}
          </span>
        </div>
      </div>

      {parcelResult.area_label && <p className="mono">{parcelResult.area_label}</p>}

      <div className="stats stats-3">
        <div className="stat"><div className="v">{s.totalParcels}</div><div className="l">Total parcels</div></div>
        <div className="stat">
          <div className="v">~{s.totalAreaM2.toLocaleString()} m²</div>
          <div className="l">Total estimated area ({s.totalAreaHa.toLocaleString()} ha)</div>
        </div>
        <div className="stat">
          <div className="v">~{s.averageAreaM2.toLocaleString()} m²</div>
          <div className="l">Average parcel area ({s.averageAreaHa.toLocaleString()} ha)</div>
        </div>
        <div className="stat">
          <div className="v">{s.largestParcel ? s.largestParcel.parcel_id : '—'}</div>
          <div className="l">
            Largest parcel{s.largestParcel ? ` (~${s.largestParcel.area_m2 ?? s.largestParcel.area} m²)` : ''}
          </div>
        </div>
        <div className="stat"><div className="v">{s.totalBuildings}</div><div className="l">Total detected buildings</div></div>
        <div className="stat"><div className="v">~{s.averageCoveragePct}%</div><div className="l">Average building coverage</div></div>
      </div>

      {backendSummary && backendSummary.total_parcels != null && (
        <p className="mono" style={{ marginTop: 10 }}>
          Server summary: {backendSummary.total_parcels} parcels ·{' '}
          {backendSummary.total_area_m2} m² ({backendSummary.total_area_ha} ha) ·{' '}
          avg {backendSummary.average_area_m2} m² · largest {backendSummary.largest_parcel?.parcel_id} ·{' '}
          source: {backendSummary.area_source}
        </p>
      )}

      <p className="warn-box" style={{ marginTop: 10 }}>
        {geo
          ? 'Areas use the file\u2019s embedded pixel scale — still approximate (segmentation-dependent), not survey-grade.'
          : 'JPG/PNG without geographic coordinates: areas assume the GSD slider value. Set it to your sensor/altitude GSD for better estimates.'}
      </p>
    </section>
  );
}
