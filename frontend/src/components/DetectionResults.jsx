import { resolveAssetUrl } from '../services/api.js';

const FEATURE_ORDER = ['buildings', 'roads', 'vegetation', 'water', 'other'];
const ROW_CAP = 15;

/**
 * Shows detection outcomes. Everything rendered here comes from live
 * backend responses (POST /detect/buildings, POST /detect/features) —
 * nothing is hardcoded. Empty categories show backend reasons, never
 * invented geometry.
 */
export default function DetectionResults({
  detection, error, originalPreview, isDetecting,
  features, featuresError, isExtracting, extractKind,
}) {
  if (isDetecting || (isExtracting && extractKind === 'features')) {
    return (
      <section className="card detect-section">
        <h2>4 · AI Detection</h2>
        <p className="sub">
          {isExtracting ? 'Running feature-extraction pipeline on the backend…' : 'Running YOLO inference on the backend…'}
        </p>
        <div className="progress-bar"><div className="progress-fill anim" /></div>
      </section>
    );
  }

  if ((error || featuresError) && !detection && !features) {
    return (
      <section className="card detect-section">
        <h2>4 · AI Detection</h2>
        <p className="warn-box">{error || featuresError}</p>
        <p className="mono">
          Required: a building-trained YOLO weight in <b>models/</b> (e.g.
          models/building_yolov8n.pt trained on xView / DOTA-v2 / SpaceNet /
          OpenCities AI / INRIA). The generic COCO yolov8n.pt has no
          &lsquo;building&rsquo; class. See models/README.md.
        </p>
      </section>
    );
  }

  if (!detection && !features) return null;

  const detUrl = resolveAssetUrl(detection?.annotated_image);
  const featUrl = resolveAssetUrl(features?.annotated_image);
  const dets = detection?.detections || [];
  const count = detection?.building_count ?? dets.length;
  const avg = detection?.average_confidence ?? 0;
  const fcounts = features?.counts || {};
  const freasons = features?.reasons || {};
  const fmap = features?.features || {};

  return (
    <section className="card detect-section">
      {detection && (
        <>
          <div className="detect-head">
            <div>
              <h2>4 · AI Building Detection (YOLO)</h2>
              <p className="sub">
                Model <b>{detection.model?.name ?? 'unknown model'}</b> ({detection.model?.type ?? 'unknown type'}) ·{' '}
                {count} building(s) · avg confidence {Number(avg ?? 0).toFixed(2)} ·{' '}
                {detection.image_width ?? '—'}×{detection.image_height ?? '—'}px
              </p>
            </div>
            <div className="detect-badges">
              <span className="badge">{count} buildings</span>
              <span className="badge">{Number(avg).toFixed(2)} avg conf</span>
            </div>
          </div>

          {detection.warning && <p className="warn-box">{detection.warning}</p>}

          <div className="detect-grid">
            <figure>
              <figcaption>Original image</figcaption>
              {originalPreview
                ? <img src={originalPreview} alt="Original uploaded drone view" />
                : <p className="mono">Original preview not available (re-select the file).</p>}
            </figure>
            <figure>
              <figcaption>AI-detected image (outputs/)</figcaption>
              {detUrl
                ? <img src={detUrl} alt="Annotated detections with building boxes" />
                : <p className="mono">Annotated image URL missing.</p>}
              {detection.annotated_image && (
                <p className="mono">{detection.annotated_image}</p>
              )}
            </figure>
          </div>

          {dets.length > 0 ? (
            <div className="table-wrap">
              <table className="det-table">
                <thead>
                  <tr><th>#</th><th>Class</th><th>Confidence</th><th>BBox [x1, y1, x2, y2]</th></tr>
                </thead>
                <tbody>
                  {dets.map((d, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{d.class ?? '—'}</td>
                      <td>{Number(d.confidence ?? 0).toFixed(3)}</td>
                      <td className="mono">[{Array.isArray(d.bbox) ? d.bbox.join(', ') : '—'}]</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mono">
              No building-class boxes above threshold. Raw YOLO output
              ({detection.total_detections ?? 0} total) is preserved in the response
              as <b>all_detections</b> with real class names.
            </p>
          )}
        </>
      )}

      {features && (
        <div className="features-block">
          <div className="detect-head">
            <div>
              <h2>{detection ? '5' : '4'} · Feature Extraction Pipeline</h2>
              <p className="sub">
                POST /detect/features · {features.image_width}×{features.image_height}px ·
                model {features.model?.loaded ? `${features.model.name} (${features.model.type})` : 'unavailable (classical segmentation only)'}
              </p>
            </div>
            <div className="detect-badges">
              {FEATURE_ORDER.map((k) => (
                <span key={k} className="badge">{k}: {fcounts[k] ?? 0}</span>
              ))}
            </div>
          </div>

          {(features.warnings || []).map((w, i) => (
            <p key={i} className="warn-box">{w}</p>
          ))}

          <div className="detect-grid">
            <figure>
              <figcaption>Original image</figcaption>
              {originalPreview
                ? <img src={originalPreview} alt="Original uploaded drone view" />
                : <p className="mono">Original preview not available (re-select the file).</p>}
            </figure>
            <figure>
              <figcaption>Feature-annotated image (outputs/)</figcaption>
              {featUrl
                ? <img src={featUrl} alt="Feature-annotated image with per-class boxes" />
                : <p className="mono">Annotated image URL missing.</p>}
              {features.annotated_image && <p className="mono">{features.annotated_image}</p>}
            </figure>
          </div>

          {FEATURE_ORDER.map((k) => {
            const items = fmap[k] || [];
            if (items.length === 0) {
              return freasons[k] ? <p key={k} className="mono">{k}: 0 — {freasons[k]}</p> : null;
            }
            const shown = items.slice(0, ROW_CAP);
            return (
              <div key={k}>
                <h3 className="feat-type">{k} ({items.length})</h3>
                <div className="table-wrap">
                  <table className="det-table">
                    <thead>
                      <tr><th>#</th><th>Class</th><th>Confidence</th><th>BBox [x1, y1, x2, y2]</th><th>Method</th></tr>
                    </thead>
                    <tbody>
                      {shown.map((d, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>{d.class ?? '—'}</td>
                          <td>{Number(d.confidence ?? 0).toFixed(3)}</td>
                          <td className="mono">[{Array.isArray(d.bbox) ? d.bbox.join(', ') : '—'}]</td>
                          <td className="mono">{d.method ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {items.length > ROW_CAP && (
                  <p className="mono">…and {items.length - ROW_CAP} more {k} regions — see the map layers.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
