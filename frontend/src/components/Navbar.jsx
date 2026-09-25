export default function Navbar({ backendStatus }) {
  return (
    <header className="navbar">
      <div className="brand">
        <div className="brand-icon">🛰️</div>
        <div>
          <h1>AI Urban Parcel Mapping &amp; Cadastral Extraction</h1>
          <p>Drone Imagery → AI Analysis → Parcels → Map → Report</p>
        </div>
      </div>
      <div className="pill">
        {backendStatus === 'ok' ? '🟢 Backend connected' : backendStatus === 'down' ? '🔴 Backend offline' : '🟡 Step 1 — Structure setup'}
      </div>
    </header>
  );
}
