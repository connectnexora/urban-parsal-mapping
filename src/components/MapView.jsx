import { useMemo, useRef, useState } from 'react'
import { WORLD } from '../data/sampleData.js'
import { centroid, pointsToString } from '../utils/geo.js'

const ASPECT = WORLD.h / WORLD.w
const MIN_W = 220
const MAX_W = 1400

function clampView(v) {
  const w = Math.min(MAX_W, Math.max(MIN_W, v.w))
  return {
    w,
    x: Math.min(WORLD.w - 40, Math.max(-320, v.x)),
    y: Math.min(WORLD.h - 40, Math.max(-320, v.y))
  }
}

// Deterministic pseudo-random field patches for the synthetic basemap.
function useFieldPatches() {
  return useMemo(() => {
    let seed = 42
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    const palette = ['#22331f', '#2a3d24', '#31452a', '#3c3a26', '#4a4230', '#25382c', '#1d2c22']
    return Array.from({ length: 30 }, (_, i) => ({
      id: i,
      x: rnd() * WORLD.w,
      y: rnd() * WORLD.h,
      w: 90 + rnd() * 260,
      h: 60 + rnd() * 180,
      fill: palette[i % palette.length],
      opacity: 0.45 + rnd() * 0.35
    }))
  }, [])
}

function Basemap({ mode, patches, imageUrl, showImagery }) {
  if (mode === 'streets') {
    return (
      <g>
        <rect x={-400} y={-400} width={WORLD.w + 800} height={WORLD.h + 800} fill="#dde3e9" />
        <rect x={0} y={0} width={WORLD.w} height={WORLD.h} fill="#e9edf1" />
        <rect x={0} y={0} width={WORLD.w} height={WORLD.h} fill="url(#grid-light)" />
        {patches.slice(0, 12).map((p) => (
          <rect key={p.id} x={p.x} y={p.y} width={p.w} height={p.h} fill="#f7f9fb" stroke="#c3ccd4" strokeWidth={2} />
        ))}
      </g>
    )
  }
  if (mode === 'dark') {
    return (
      <g>
        <rect x={-400} y={-400} width={WORLD.w + 800} height={WORLD.h + 800} fill="#070d1a" />
        <rect x={0} y={0} width={WORLD.w} height={WORLD.h} fill="#0c1626" />
        <rect x={0} y={0} width={WORLD.w} height={WORLD.h} fill="url(#grid-dark)" />
      </g>
    )
  }
  // satellite (synthetic, fully local)
  return (
    <g>
      <rect x={-400} y={-400} width={WORLD.w + 800} height={WORLD.h + 800} fill="#141a12" />
      <rect x={0} y={0} width={WORLD.w} height={WORLD.h} fill="url(#sat-grad)" />
      {patches.map((p) => (
        <rect key={p.id} x={p.x} y={p.y} width={p.w} height={p.h} fill={p.fill} opacity={p.opacity} />
      ))}
      <rect x={0} y={0} width={WORLD.w} height={WORLD.h} fill="url(#dots)" />
      {imageUrl && showImagery && (
        <image href={imageUrl} x={0} y={0} width={WORLD.w} height={WORLD.h} preserveAspectRatio="xMidYMid slice" opacity={0.55} />
      )}
    </g>
  )
}

const BASEMAPS = [
  { key: 'satellite', label: 'Satellite' },
  { key: 'streets', label: 'Streets' },
  { key: 'dark', label: 'Dark' }
]

export default function MapView({
  parcels,
  buildings,
  roads,
  layers,
  basemap,
  onBasemapChange,
  selectedId,
  onSelect,
  imageUrl,
  showImagery,
  onToggleImagery,
  isProcessing,
  onUploadClick,
  onProcessClick
}) {
  const [view, setView] = useState({ x: 0, y: 0, w: WORLD.w })
  const [coords, setCoords] = useState(null)
  const svgRef = useRef(null)
  const dragRef = useRef(null)
  const patches = useFieldPatches()

  const h = view.w * ASPECT
  const showLabels = layers.labels && view.w < 950

  const toScene = (clientX, clientY) => {
    const rect = svgRef.current.getBoundingClientRect()
    return {
      x: view.x + ((clientX - rect.left) / rect.width) * view.w,
      y: view.y + ((clientY - rect.top) / rect.height) * h
    }
  }

  const zoomAt = (sx, sy, factor) => {
    setView((v) => {
      const w = Math.min(MAX_W, Math.max(MIN_W, v.w * factor))
      const s = w / v.w
      return clampView({ w, x: sx - (sx - v.x) * s, y: sy - (sy - v.y) * s })
    })
  }

  // Scale bar: pick a nice ground distance for ~120 scene units.
  const scaleBar = useMemo(() => {
    const targetUnits = 120
    const targetM = targetUnits * 0.5
    const pow = Math.pow(10, Math.floor(Math.log10(targetM)))
    const nice = [1, 2, 5, 10].map((m) => m * pow).find((m) => m >= targetM) || 10 * pow
    return { label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, units: nice / 0.5 }
  }, [])

  const empty = parcels.length === 0 && !isProcessing

  return (
    <section className="map-wrap" aria-label="Interactive parcel map">
      <svg
        ref={svgRef}
        className="map-svg"
        viewBox={`${view.x} ${view.y} ${view.w} ${h}`}
        onWheel={(e) => {
          const p = toScene(e.clientX, e.clientY)
          zoomAt(p.x, p.y, e.deltaY > 0 ? 1.15 : 1 / 1.15)
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          svgRef.current.setPointerCapture(e.pointerId)
          dragRef.current = { sx: e.clientX, sy: e.clientY, view, moved: false, pid: e.pointerId }
        }}
        onPointerMove={(e) => {
          const p = toScene(e.clientX, e.clientY)
          setCoords(p)
          const d = dragRef.current
          if (!d || e.pointerId !== d.pid) return
          const rect = svgRef.current.getBoundingClientRect()
          const dx = ((e.clientX - d.sx) / rect.width) * d.view.w
          const dy = ((e.clientY - d.sy) / rect.height) * (d.view.w * ASPECT)
          if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true
          setView(clampView({ ...d.view, x: d.view.x - dx, y: d.view.y - dy }))
        }}
        onPointerUp={(e) => {
          const d = dragRef.current
          dragRef.current = null
          if (d && !d.moved) {
            const parcelId = e.target?.dataset?.parcelId
            onSelect(parcelId || null)
          }
        }}
        onPointerLeave={() => {
          dragRef.current = null
          setCoords(null)
        }}
      >
        <defs>
          <linearGradient id="sat-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#202b1c" />
            <stop offset="0.55" stopColor="#1a2418" />
            <stop offset="1" stopColor="#242019" />
          </linearGradient>
          <pattern id="grid-dark" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="#1e3a5f" strokeWidth="1" opacity="0.5" />
          </pattern>
          <pattern id="grid-light" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="#b9c3cd" strokeWidth="1" opacity="0.7" />
          </pattern>
          <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">
            <circle cx="3" cy="5" r="1.1" fill="#000" opacity="0.25" />
            <circle cx="17" cy="18" r="1.1" fill="#fff" opacity="0.06" />
          </pattern>
        </defs>

        <Basemap mode={basemap} patches={patches} imageUrl={imageUrl} showImagery={showImagery} />

        {/* Roads under parcels */}
        {layers.roads &&
          roads.map((r) => (
            <g key={r.id}>
              <polyline points={pointsToString(r.points)} fill="none" stroke="#0f172a" strokeWidth={r.width + 6} strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
              <polyline points={pointsToString(r.points)} fill="none" stroke="#94a3b8" strokeWidth={r.width} strokeLinecap="round" strokeLinejoin="round" />
              <polyline points={pointsToString(r.points)} fill="none" stroke="#f1f5f9" strokeWidth={2.5} strokeLinecap="round" strokeDasharray="12 10" opacity="0.9" />
            </g>
          ))}

        {/* Parcel boundaries */}
        {layers.parcels &&
          parcels.map((p, i) => (
            <polygon
              key={p.id}
              data-parcel-id={p.id}
              points={pointsToString(p.points)}
              className={`parcel ${selectedId === p.id ? 'selected' : ''}`}
              style={{ animationDelay: `${Math.min(i * 60, 600)}ms` }}
            />
          ))}

        {/* Buildings */}
        {layers.buildings &&
          buildings.map((b) => (
            <polygon key={b.id} points={pointsToString(b.points)} className="building">
              <title>{`${b.id} · parcel ${b.parcelId}`}</title>
            </polygon>
          ))}

        {/* Labels */}
        {showLabels &&
          layers.parcels &&
          parcels.map((p) => {
            const [cx, cy] = centroid(p.points)
            return (
              <text key={`lbl-${p.id}`} x={cx} y={cy} textAnchor="middle" dominantBaseline="central" className="parcel-label">
                {p.id}
              </text>
            )
          })}

        {/* Survey extent frame */}
        <rect x={0} y={0} width={WORLD.w} height={WORLD.h} fill="none" stroke="#38bdf8" strokeWidth={2} strokeDasharray="14 8" opacity="0.55" vectorEffect="non-scaling-stroke" />
      </svg>

      {/* Zoom controls */}
      <div className="map-controls" role="toolbar" aria-label="Map zoom controls">
        <button onClick={() => zoomAt(view.x + view.w / 2, view.y + h / 2, 1 / 1.3)} aria-label="Zoom in">+</button>
        <button onClick={() => zoomAt(view.x + view.w / 2, view.y + h / 2, 1.3)} aria-label="Zoom out">−</button>
        <button onClick={() => setView({ x: 0, y: 0, w: WORLD.w })} aria-label="Reset view" className="reset-btn">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d="M4 10a8 8 0 111 6M4 10V4m0 6h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Basemap switcher */}
      <div className="basemap-switch" role="toolbar" aria-label="Basemap style">
        {BASEMAPS.map((b) => (
          <button key={b.key} className={basemap === b.key ? 'active' : ''} onClick={() => onBasemapChange(b.key)}>
            {b.label}
          </button>
        ))}
      </div>

      {/* Processing badge */}
      {isProcessing && <div className="map-badge scanning">Scanning…</div>}

      {/* Imagery toggle */}
      {imageUrl && (
        <button className={`map-badge imagery-toggle ${showImagery ? 'on' : ''}`} onClick={onToggleImagery}>
          Drone imagery · {showImagery ? 'on' : 'off'}
        </button>
      )}

      {/* Coords + scale bar */}
      <div className="map-footer">
        <span className="coords">
          {coords ? `E ${(coords.x * 0.5).toFixed(1)} m · N ${((WORLD.h - coords.y) * 0.5).toFixed(1)} m` : '—'}
        </span>
        <span className="scale-bar">
          <span className="scale-line" style={{ width: `${Math.max(30, Math.min(160, (scaleBar.units / view.w) * 220))}px` }} />
          {scaleBar.label}
        </span>
      </div>

      {/* Empty state */}
      {empty && (
        <div className="map-empty">
          <div className="map-empty-card">
            <h2>No detections yet</h2>
            <p>Upload drone imagery, then run the detection pipeline. The map, stats and logs update live — no model connection required for the demo.</p>
            <div className="map-empty-actions">
              <button className="btn primary" onClick={onUploadClick}>Upload Drone Image</button>
              <button className="btn ghost" onClick={onProcessClick}>Run on Sample Grid</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
