export default function Navbar({ backendStatus, demoMode, onEnterDemo, onExitDemo, busy }) {
  return (
    <header className="navbar">
      <div className="brand">
        <div className="brand-icon">🛰️</div>
        <div>
          <h1>AI Urban Parcel Mapping &amp; Cadastral Extraction</h1>
          <p>Drone Imagery → AI Analysis → Parcels → Map → Report</p>
        </div>
      </div>
      <div className="nav-pills">
        {demoMode === 'off' ? (
          <button className="pill pill-btn" onClick={onEnterDemo} disabled={busy} title="Load the prepared demo dataset (precomputed results, no live inference)">
            ▶ Demo Dataset
          </button>
        ) : (
          <>
            <span className="pill pill-demo" title="Precomputed demo results are shown; live AI pipeline untouched">
              {demoMode === 'loading' ? '▶ Loading demo…' : '▶ DEMO MODE — precomputed'}
            </span>
            <button className="pill pill-btn" onClick={onExitDemo} title="Clear demo data and return to live mode">
              Exit demo
            </button>
          </>
        )}
        <div className="pill">
          {backendStatus === 'ok' ? '🟢 Backend connected' : backendStatus === 'down' ? '🔴 Backend offline' : '🟡 Step 1 — Structure setup'}
        </div>
      </div>
    </header>
  );
}
