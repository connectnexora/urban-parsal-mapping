export default function ResultsPanel({ backendStatus, healthData, detection, features }) {
  const dot = backendStatus === 'ok' ? 'dot ok' : backendStatus === 'down' ? 'dot bad' : 'dot';
  const label =
    backendStatus === 'ok' ? 'Backend: connected' : backendStatus === 'down' ? 'Backend: offline' : 'Backend: not tested';

  const hasResult = detection != null;
  const hasFeatures = features != null;
  const buildings = hasResult ? (detection.building_count ?? detection.detections?.length ?? 0) : '—';
  const avgConf = hasResult ? (detection.average_confidence ?? 0).toFixed(2) : '—';
  const total = hasResult ? (detection.total_detections ?? detection.all_detections?.length ?? '—') : '—';
  const modelName = hasResult ? detection.model?.name || detection.model_name || '—' : '—';
  const counts = features?.counts || {};

  return (
    <section className="card">
      <h2>3 · Results</h2>
      <p className="sub">Live YOLO values appear here after POST /detect/buildings runs.</p>

      <div className="status-row">
        <span className={dot} />
        <span>{label}</span>
      </div>
      {healthData && (
        <p className="mono">
          {healthData.service} · v{healthData.version} · {healthData.timestamp}
        </p>
      )}

      <div className="stats">
        <div className="stat"><div className="v">{buildings}</div><div className="l">Buildings</div></div>
        <div className="stat"><div className="v">{avgConf}</div><div className="l">Avg confidence</div></div>
        <div className="stat"><div className="v">{total}</div><div className="l">Total detections</div></div>
        <div className="stat"><div className="v mono" style={{ fontSize: 12 }}>{modelName}</div><div className="l">Model</div></div>
      </div>

      {!hasResult ? (
        <p className="mono" style={{ marginTop: 12 }}>
          No fake AI results are shown. Counters stay blank until real inference is wired up.
        </p>
      ) : (
        <div style={{ marginTop: 12 }}>
          <p className="mono">
            Image: {detection.image_width}×{detection.image_height}px ·{' '}
            {detection.annotated_image}
          </p>
          {detection.warning && (
            <p className="warn-box">{detection.warning}</p>
          )}
        </div>
      )}

      {hasFeatures && (
        <div style={{ marginTop: 12 }}>
          <p className="sub">Feature pipeline (POST /detect/features)</p>
          <div className="stats">
            <div className="stat"><div className="v">{counts.buildings ?? 0}</div><div className="l">Buildings</div></div>
            <div className="stat"><div className="v">{counts.roads ?? 0}</div><div className="l">Roads</div></div>
            <div className="stat"><div className="v">{counts.vegetation ?? 0}</div><div className="l">Vegetation</div></div>
            <div className="stat"><div className="v">{counts.water ?? 0}</div><div className="l">Water</div></div>
            <div className="stat"><div className="v">{counts.other ?? 0}</div><div className="l">Other</div></div>
            <div className="stat"><div className="v">{counts.total ?? 0}</div><div className="l">Total</div></div>
          </div>
        </div>
      )}
    </section>
  );
}
