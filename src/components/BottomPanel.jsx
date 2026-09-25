import { useEffect, useRef } from 'react'

export default function BottomPanel({
  progress,
  stageLabel,
  phase,
  logs,
  onClearLogs,
  onExportGeoJSON,
  onStop,
  hasResults
}) {
  const logRef = useRef(null)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs.length])

  const pct = Math.round(progress)

  return (
    <section className="bottom-panel" aria-label="Processing progress and logs">
      <div className="progress-block">
        <div className="progress-head">
          <h2 className="panel-title">Processing</h2>
          <span className="progress-stage">{phase === 'processing' ? stageLabel : phase === 'done' ? 'Complete' : 'Idle'}</span>
        </div>
        <div className="progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100" aria-label="Processing progress">
          <div className={`progress-fill ${phase === 'processing' ? 'animated' : ''}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="progress-foot">
          <span className="progress-pct">{pct}%</span>
          <div className="progress-actions">
            {phase === 'processing' && (
              <button className="btn small danger" onClick={onStop}>Stop</button>
            )}
            {hasResults && (
              <button className="btn small ghost" onClick={onExportGeoJSON}>Export GeoJSON</button>
            )}
          </div>
        </div>
      </div>

      <div className="log-block">
        <div className="log-head">
          <h2 className="panel-title">Detection Logs</h2>
          <button className="link-btn" onClick={onClearLogs} disabled={!logs.length}>Clear</button>
        </div>
        <div className="log-viewer" ref={logRef} aria-live="polite">
          {logs.length === 0 && <p className="log-empty">Logs will appear here once processing starts.</p>}
          {logs.map((l) => (
            <p key={l.id} className={`log-line log-${l.level}`}>
              <span className="log-time">{l.time}</span>
              <span className="log-msg">{l.msg}</span>
            </p>
          ))}
        </div>
      </div>
    </section>
  )
}
