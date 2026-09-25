import StatCard from './StatCard.jsx'
import { formatArea, formatAreaFull, formatConf, polygonAreaM2 } from '../utils/geo.js'

export default function InfoPanel({
  parcelCount,
  buildingCount,
  totalAreaM2,
  confidence,
  phase,
  stageLabel,
  selected,
  onClearSelection
}) {
  const statusText = phase === 'processing' ? stageLabel : phase === 'done' ? 'Complete' : 'Idle'
  const pct = confidence == null ? 0 : Math.round(confidence * 100)

  return (
    <aside className="info-panel" aria-label="Detection summary">
      <section className="panel-section">
        <h2 className="panel-title">Detection Summary</h2>
        <div className="stat-grid">
          <StatCard label="Parcels" value={parcelCount} sub="polygons" accent="cyan" />
          <StatCard label="Buildings" value={buildingCount} sub="footprints" accent="amber" />
        </div>
        <div className="area-card">
          <p className="stat-label">Estimated total area</p>
          <p className="area-value">{formatArea(totalAreaM2)}</p>
          <p className="stat-sub">{formatAreaFull(totalAreaM2)}</p>
        </div>
      </section>

      <section className="panel-section">
        <h2 className="panel-title">Processing Status</h2>
        <div className={`phase-row phase-${phase}`}>
          <span className={`status-dot ${phase === 'processing' ? 'dot-busy' : phase === 'done' ? 'dot-ready' : 'dot-idle'}`} />
          <span className="phase-text">{statusText}</span>
        </div>
        <div className="conf-row">
          <span className="stat-label">AI confidence</span>
          <span className="conf-value">{formatConf(confidence)}</span>
        </div>
        <div className="conf-bar" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100" aria-label="AI confidence">
          <div className="conf-fill" style={{ width: `${pct}%` }} />
        </div>
      </section>

      <section className="panel-section">
        <h2 className="panel-title">Selected Parcel</h2>
        {selected ? (
          <div className="selected-card">
            <div className="selected-head">
              <strong>{selected.id}</strong>
              <button className="link-btn" onClick={onClearSelection}>Clear</button>
            </div>
            <dl className="selected-list">
              <div><dt>Land use</dt><dd>{selected.landUse}</dd></div>
              <div><dt>Area</dt><dd>{formatAreaFull(polygonAreaM2(selected.points))}</dd></div>
              <div><dt>Confidence</dt><dd>{formatConf(selected.confidence)}</dd></div>
            </dl>
          </div>
        ) : (
          <p className="muted">Click a parcel polygon on the map to inspect it.</p>
        )}
      </section>

      <section className="panel-section legend">
        <h2 className="panel-title">Legend</h2>
        <ul>
          <li><span className="swatch sw-parcel" /> Parcel boundary</li>
          <li><span className="swatch sw-building" /> Building footprint</li>
          <li><span className="swatch sw-road" /> Road centerline</li>
        </ul>
      </section>
    </aside>
  )
}
