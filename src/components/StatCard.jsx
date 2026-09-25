export default function StatCard({ label, value, sub, accent = 'cyan' }) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {sub && <p className="stat-sub">{sub}</p>}
    </div>
  )
}
