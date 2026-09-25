import { resolveAssetUrl } from '../services/api.js';

/**
 * Shows the detection outcome: original vs AI-annotated image,
 * building count, average confidence, and the raw detection table.
 * Everything rendered here comes from the live POST /detect/buildings
 * response — nothing is hardcoded.
 */
export default function DetectionResults({ detection, error, originalPreview, isDetecting }) {
  if (isDetecting) {
    return (
      <section className="card detect-section">
        <h2>4 · AI Building Detection</h2>
        <p className="sub">Running YOLO inference on the backend…</p>
        <div className="progress-bar"><div className="progress-fill anim" /></div>
      </section>
    );
  }

  if (error && !detection) {
    return (
      <section className="card detect-section">
        <h2>4 · AI Building Detection</h2>
        <p className="warn-box">{error}</p>
        <p className="mono">
          Required: a building-trained YOLO weight in <b>models/</b> (e.g.
          models/building_yolov8n.pt trained on xView / DOTA-v2 / SpaceNet /
          OpenCities AI / INRIA). The generic COCO yolov8n.pt has no
          &lsquo;building&rsquo; class. See models/README.md.
        </p>
      </section>
    );
  }

  if (!detection) return null;

  const annotatedUrl = resolveAssetUrl(detection.annotated_image);
  const dets = detection.detections || [];
  const count = detection.building_count ?? dets.length;
  const avg = detection.average_confidence ?? 0;

  return (
    <section className="card detect-section">
      <div className="detect-head">
        <div>
          <h2>4 · AI Building Detection (YOLO)</h2>
          <p className="sub">
            Model <b>{detection.model?.name}</b> ({detection.model?.type}) ·{' '}
            {count} building(s) · avg confidence {Number(avg).toFixed(2)} ·{' '}
            {detection.image_width}×{detection.image_height}px
          </p>
        </div>
        <div className="detect-badges">
          <span className="badge">🏠 {count} buildings</span>
          <span className="badge">🎯 {Number(avg).toFixed(2)} avg conf</span>
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
          {annotatedUrl
            ? <img src={annotatedUrl} alt="Annotated detections with building boxes" />
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
                  <td>{d.class}</td>
                  <td>{Number(d.confidence).toFixed(3)}</td>
                  <td className="mono">[{d.bbox.join(', ')}]</td>
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
    </section>
  );
}
