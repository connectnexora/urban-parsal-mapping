import { formatArea, formatAreaFull, formatConf, polygonAreaM2 } from '../utils/geo.js'

export default function ReportsModal({
  open,
  onClose,
  parcels,
  buildingCount,
  totalAreaM2,
  confidence,
  onExportCSV,
  onExportGeoJSON
}) {
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Detection report" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Detection Report</h2>
            <p className="muted">Generated locally · {new Date().toLocaleString('en-GB')}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close report">✕</button>
        </div>

        <div className="report-summary">
          <div><strong>{parcels.length}</strong><span>parcels</span></div>
          <div><strong>{buildingCount}</strong><span>buildings</span></div>
          <div><strong>{formatArea(totalAreaM2)}</strong><span>total area</span></div>
          <div><strong>{formatConf(confidence)}</strong><span>avg confidence</span></div>
        </div>

        <div className="table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Parcel</th>
                <th>Land use</th>
                <th>Area</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {parcels.length === 0 && (
                <tr><td colSpan="4" className="muted">No detections yet — run the pipeline first.</td></tr>
              )}
              {parcels.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.landUse}</td>
                  <td>{formatAreaFull(polygonAreaM2(p.points))}</td>
                  <td>{formatConf(p.confidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={() => window.print()}>Print</button>
          <button className="btn ghost" onClick={onExportCSV} disabled={!parcels.length}>Download CSV</button>
          <button className="btn primary" onClick={onExportGeoJSON} disabled={!parcels.length}>Download GeoJSON</button>
        </div>
      </div>
    </div>
  )
}
