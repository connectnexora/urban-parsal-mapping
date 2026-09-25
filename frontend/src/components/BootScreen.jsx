import { useEffect, useRef, useState } from 'react';

const STAGES = [
  { key: 'imagery', label: 'Drone imagery', detail: 'Capturing aerial frames' },
  { key: 'ai', label: 'AI processing', detail: 'YOLO inference on survey frames' },
  { key: 'features', label: 'Feature extraction', detail: 'Buildings · roads · land cover' },
  { key: 'parcels', label: 'Parcel mapping', detail: 'Delineating parcel boundaries' },
  { key: 'cadastral', label: 'Digital cadastral map', detail: 'Rendering interactive map' },
];

const STAGE_MS = 1150;
const EXIT_MS = 450;

/**
 * Hackathon landing / loading experience: AI + Drone + GIS + Smart City.
 * Timed stage sequence with CSS-only visuals (grid, drone flight, scan,
 * coordinates). Never blocks: Skip is always available, dashboard mounts
 * underneath immediately, and reduced-motion shortens the sequence.
 */
export default function BootScreen({ onDone }) {
  const [stage, setStage] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [coords, setCoords] = useState({ lat: 12.9716, lng: 77.5946, alt: 118 });
  const done = useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    setLeaving(true);
    setTimeout(() => onDone?.(), EXIT_MS);
  };

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const per = reduced ? 350 : STAGE_MS;
    const t = setInterval(() => {
      setStage((s) => {
        if (s + 1 >= STAGES.length) {
          clearInterval(t);
          setTimeout(finish, reduced ? 150 : 650);
          return s;
        }
        return s + 1;
      });
    }, per);
    const c = setInterval(() => {
      setCoords((p) => ({
        lat: p.lat + (Math.random() - 0.5) * 0.0004,
        lng: p.lng + (Math.random() - 0.5) * 0.0004,
        alt: Math.max(90, Math.min(140, p.alt + (Math.random() - 0.5) * 2)),
      }));
    }, 140);
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(t);
      clearInterval(c);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = Math.round(((stage + 1) / STAGES.length) * 100);

  return (
    <div className={`boot${leaving ? ' boot-leaving' : ''}`} role="dialog" aria-label="Loading urban parcel mapping dashboard">
      <div className="boot-grid" aria-hidden="true" />
      <div className="boot-dots" aria-hidden="true" />
      <div className="boot-inner">
        <div className="boot-left">
          <p className="boot-eyebrow">AI + Drone + GIS + Smart City</p>
          <h1 className="boot-title">Urban Parcel Mapping</h1>
          <p className="boot-sub">Drone imagery → AI analysis → digital cadastral map</p>

          <ol className="boot-stages">
            {STAGES.map((s, i) => (
              <li
                key={s.key}
                className={i < stage ? 'done' : i === stage ? 'active' : ''}
                aria-current={i === stage ? 'step' : undefined}
              >
                <span className="boot-dot" aria-hidden="true" />
                <span className="boot-stage-label">{s.label}</span>
                <span className="boot-stage-detail">
                  {i < stage ? 'done' : i === stage ? s.detail + '…' : 'queued'}
                </span>
              </li>
            ))}
          </ol>

          <div className="boot-progress" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100" aria-label="Loading progress">
            <div className="boot-progress-fill" style={{ width: `${pct}%` }} />
          </div>

          <p className="mono boot-coords" aria-hidden="true">
            LAT {coords.lat.toFixed(4)} · LNG {coords.lng.toFixed(4)} · ALT {coords.alt.toFixed(0)} m · GRID BLR-14
          </p>

          <div className="boot-actions">
            <button className="btn small" onClick={finish}>Enter dashboard →</button>
            <button className="btn small ghost" onClick={finish}>Skip</button>
          </div>
        </div>

        <div className="boot-viewport" aria-hidden="true">
          <div className="boot-drone">✈</div>
          <svg className="boot-map" viewBox="0 0 300 220" preserveAspectRatio="xMidYMid meet">
            <g fill="none" strokeWidth="1.5">
              <polygon points="30,40 110,30 120,90 40,100" className="boot-poly p1" />
              <polygon points="130,30 220,40 215,100 125,95" className="boot-poly p2" />
              <polygon points="35,110 115,105 110,185 30,180" className="boot-poly p3" />
              <polygon points="125,105 210,108 225,180 115,190" className="boot-poly p4" />
              <polygon points="230,45 275,55 270,110 225,105" className="boot-poly p5" />
              <line x1="0" y1="102" x2="300" y2="102" className="boot-road" />
              <line x1="122" y1="0" x2="122" y2="220" className="boot-road" />
            </g>
          </svg>
          <div className="boot-scan" />
          <div className="boot-chips">
            <span>YOLO</span><span>SEG</span><span>GIS</span>
          </div>
        </div>
      </div>
    </div>
  );
}
