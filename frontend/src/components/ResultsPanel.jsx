export default function ResultsPanel({ backendStatus, healthData }) {
  const dot = backendStatus === 'ok' ? 'dot ok' : backendStatus === 'down' ? 'dot bad' : 'dot';
  const label =
    backendStatus === 'ok' ? 'Backend: connected' : backendStatus === 'down' ? 'Backend: offline' : 'Backend: not tested';

  return (
    <section className="card">
      <h2>3 · Results</h2>
      <p className="sub">Live values appear here once the AI module (Step 2) runs.</p>

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
        <div className="stat"><div className="v">—</div><div className="l">Buildings</div></div>
        <div className="stat"><div className="v">—</div><div className="l">Roads</div></div>
        <div className="stat"><div className="v">—</div><div className="l">Parcels</div></div>
        <div className="stat"><div className="v">—</div><div className="l">Area (m²)</div></div>
      </div>

      <p className="mono" style={{ marginTop: 12 }}>
        No fake AI results are shown. Counters stay blank until real inference is wired up.
      </p>
    </section>
  );
}
