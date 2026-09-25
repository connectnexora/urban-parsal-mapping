import { useEffect, useState } from 'react'

function LogoMark() {
  return (
    <svg className="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="2" width="28" height="28" rx="7" fill="#0ea5e9" opacity="0.18" />
      <path d="M8 20 L14 10 L20 16 L24 12" fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 23.5 H25" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="3 3" />
      <circle cx="14" cy="10" r="2.2" fill="#fbbf24" />
    </svg>
  )
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now.toLocaleTimeString('en-GB', { hour12: false })
}

const AI_META = {
  idle: { dot: 'dot-idle', label: 'AI · Standby' },
  processing: { dot: 'dot-busy', label: 'AI · Processing' },
  done: { dot: 'dot-ready', label: 'AI · Ready' }
}

export default function Header({ aiState, systemOk, onMenu }) {
  const clock = useClock()
  const meta = AI_META[aiState] || AI_META.idle
  return (
    <header className="app-header">
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Toggle navigation">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <div className="brand">
        <LogoMark />
        <div className="brand-text">
          <h1>Urban Parcel Mapping</h1>
          <p>GIS · AI Parcel Intelligence</p>
        </div>
      </div>
      <div className="header-status">
        <span className="clock" title="Local time">{clock}</span>
        <span className={`status-pill ai-pill state-${aiState}`}>
          <span className={`status-dot ${meta.dot}`} />
          {meta.label}
        </span>
        <span className={`status-pill ${systemOk ? 'ok' : 'down'}`}>
          <span className={`status-dot ${systemOk ? 'dot-ready' : 'dot-down'}`} />
          {systemOk ? 'System · Online' : 'System · Offline'}
        </span>
      </div>
    </header>
  )
}
