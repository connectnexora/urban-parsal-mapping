import { useMemo, useRef, useState } from 'react';
import { resolveAssetUrl } from '../services/api.js';

/**
 * Before/after visual comparison: LEFT = original drone image,
 * RIGHT = AI processed image (parcel boundaries, building detections,
 * roads, labels + confidence burned in by the backend annotators).
 * A drag slider wipes between the two. Layer tabs switch which AI output
 * is shown on the right. Everything comes from live backend responses.
 */
export default function CompareView({ detection, features, parcelResult, originalPreview }) {
  const [pos, setPos] = useState(50);
  const trackRef = useRef(null);

  const options = useMemo(() => {
    const out = [];
    if (parcelResult?.annotated_image) {
      out.push({
        key: 'parcels',
        label: 'Parcels',
        url: resolveAssetUrl(parcelResult.annotated_image),
        file: parcelResult.annotated_image,
        stats: [
          `${parcelResult.parcel_count ?? (parcelResult.parcels || []).length} parcels`,
          `~${parcelResult.total_area_estimated_m2 ?? '—'} m² total`,
          `${Number(parcelResult.average_confidence ?? 0).toFixed(2)} avg conf`,
        ],
        legend: [
          ['Parcel boundaries', '#38bdf8'],
          ['Parcel labels (ID + area)', '#fbbf24'],
        ],
        note: `Boundaries + labels via ${parcelResult.method}.`,
      });
    }
    if (detection?.annotated_image) {
      out.push({
        key: 'buildings',
        label: 'Buildings',
        url: resolveAssetUrl(detection.annotated_image),
        file: detection.annotated_image,
        stats: [
          `${detection.building_count ?? (detection.detections || []).length} buildings`,
          `${Number(detection.average_confidence ?? 0).toFixed(2)} avg conf`,
          `${detection.model?.name || ''}`,
        ],
        legend: [
          ['Building boxes + labels', '#2ecc71'],
          ['Confidence per box', '#9aa7c2'],
        ],
        note: 'YOLO boxes with class + confidence labels.',
      });
    }
    if (features?.annotated_image) {
      const c = features.counts || {};
      out.push({
        key: 'features',
        label: 'Roads + Features',
        url: resolveAssetUrl(features.annotated_image),
        file: features.annotated_image,
        stats: [
          `${c.roads ?? 0} roads`,
          `${c.buildings ?? 0} buildings`,
          `${c.vegetation ?? 0} vegetation · ${c.water ?? 0} water · ${c.other ?? 0} other`,
        ],
        legend: [
          ['Buildings', '#22c55e'],
          ['Roads', '#f97316'],
          ['Vegetation', '#16a34a'],
          ['Water', '#3b82f6'],
          ['Other', '#a855f7'],
        ],
        note: 'Per-class boxes + count banner burned in by the pipeline.',
      });
    }
    return out;
  }, [parcelResult, detection, features]);

  const [layerKey, setLayerKey] = useState(null);
  const active = options.find((o) => o.key === (layerKey || options[0]?.key)) || options[0] || null;

  const setFromClientX = (clientX) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pct = ((clientX - r.left) / Math.max(1, r.width)) * 100;
    setPos(Math.min(98, Math.max(2, Math.round(pct))));
  };

  if (!options.length) return null;

  return (
    <section className="card detect-section">
      <div className="detect-head">
        <div>
          <h2>7 · Visual Comparison — Original vs AI Processed</h2>
          <p className="sub">
            Drag the slider to wipe between the original frame (LEFT) and the AI output (RIGHT).
            The processed side carries parcel boundaries, building/road detections, labels and confidence.
          </p>
        </div>
        <div className="detect-badges" role="tablist" aria-label="Comparison layer">
          {options.map((o) => (
            <button
              key={o.key}
              role="tab"
              aria-selected={active?.key === o.key}
              className={`badge badge-tab${active?.key === o.key ? ' active' : ''}`}
              onClick={() => setLayerKey(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {active && (
        <>
          <div className="compare-badges">
            {active.stats.filter(Boolean).map((s, i) => (
              <span key={i} className="badge">{s}</span>
            ))}
          </div>

          {!originalPreview ? (
            <div>
              <p className="warn-box">
                Original preview unavailable (e.g. GeoTIFF browsers can&apos;t render).
                Showing the AI processed image only.
              </p>
              <figure className="compare-single">
                <img src={active.url} alt={`AI processed ${active.label} output`} />
                <figcaption className="mono">{active.file}</figcaption>
              </figure>
            </div>
          ) : (
            <div
              className="compare-track"
              ref={trackRef}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture?.(e.pointerId);
                setFromClientX(e.clientX);
                const move = (ev) => setFromClientX(ev.clientX);
                const up = () => {
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', up);
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up);
              }}
            >
              <img
                className="compare-img compare-right"
                src={active.url}
                alt={`AI processed ${active.label} output with boundaries and labels`}
                draggable={false}
              />
              <div
                className="compare-left-wrap"
                style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
              >
                <img
                  className="compare-img"
                  src={originalPreview}
                  alt="Original uploaded drone view"
                  draggable={false}
                />
              </div>
              <div className="compare-divider" style={{ left: `${pos}%` }}>
                <span className="compare-handle" aria-hidden="true">⇔</span>
              </div>
              <span className="compare-tag compare-tag-left">LEFT · Original</span>
              <span className="compare-tag compare-tag-right">RIGHT · AI processed ({active.label})</span>
            </div>
          )}

          {originalPreview && (
            <input
              className="compare-range"
              type="range"
              min="2"
              max="98"
              value={pos}
              onChange={(e) => setPos(Number(e.target.value))}
              aria-label="Comparison slider: original versus AI processed"
            />
          )}

          <div className="compare-legend">
            {active.legend.map(([label, color]) => (
              <span key={label} className="compare-legend-item">
                <span className="legend-dot" style={{ background: color }} />
                {label}
              </span>
            ))}
            <span className="mono">{active.note} {active.file}</span>
          </div>
        </>
      )}
    </section>
  );
}
