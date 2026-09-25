import { resolveAssetUrl } from '../services/api.js';

/**
 * Shows approximate parcel extraction results: annotated image, counts,
 * areas, and the per-parcel table. Everything comes from the live
 * POST /detect/parcels response — nothing hardcoded. Always discloses
 * that boundaries are AI-estimated/approximate, not legal cadastre.
 */
export default function ParcelResults({ parcelResult, error, originalPreview, isExtracting }) {
  if (isExtracting) {
    return (
      <section className="card detect-section">
        <h2>5 · AI Parcel Boundaries (approximate)</h2>
        <p className="sub">Preprocessing → segmentation → boundary extraction → polygons…</p>
        <div className="progress-bar"><div className="progress-fill anim" /></div>
      </section>
    );
  }

  if (error && !parcelResult) {
    return (
      <section className="card detect-section">
        <h2>5 · AI Parcel Boundaries (approximate)</h2>
        <p className="warn-box">{error}</p>
      </section>
    );
  }

  if (!parcelResult) return null;

  const annotatedUrl = resolveAssetUrl(parcelResult.annotated_image);
  const geojsonUrl = resolveAssetUrl(parcelResult.geojson_file);
  const parcels = parcelResult.parcels || [];

  return (
    <section className="card detect-section">
      <div className="detect-head">
        <div>
          <h2>5 · AI Parcel Boundaries — approximate, NOT legal cadastre</h2>
          <p className="sub">
            Method <b>{parcelResult.method}</b> · {parcelResult.parcel_count} parcel(s) ·{' '}
            total ~{parcelResult.total_area_estimated_m2} m² · avg conf {Number(parcelResult.average_confidence ?? 0).toFixed(2)} ·{' '}
            GSD {parcelResult.gsd_m_per_px} m/px · {parcelResult.image_width}×{parcelResult.image_height}px
          </p>
        </div>
        <div className="detect-badges">
          <span className="badge">🧭 {parcelResult.parcel_count} parcels</span>
          <span className="badge">📐 ~{parcelResult.total_area_estimated_m2} m² total</span>
        </div>
      </div>

      <p className="warn-box">{parcelResult.disclaimer}</p>
      {parcelResult.notes && <p className="mono">{parcelResult.notes}</p>}

      <div className="detect-grid">
        <figure>
          <figcaption>Original image</figcaption>
          {originalPreview
            ? <img src={originalPreview} alt="Original uploaded drone view" />
            : <p className="mono">Original preview not available (re-select the file).</p>}
        </figure>
        <figure>
          <figcaption>AI-estimated parcel polygons (outputs/)</figcaption>
          {annotatedUrl
            ? <img src={annotatedUrl} alt="Annotated image with estimated parcel polygons" />
            : <p className="mono">Annotated image URL missing.</p>}
          {parcelResult.annotated_image && <p className="mono">{parcelResult.annotated_image}</p>}
        </figure>
      </div>

      <div className="parcel-actions">
        {geojsonUrl && (
          <a className="btn small link-btn" href={geojsonUrl} download>
            Download GeoJSON (image-pixel polygons)
          </a>
        )}
        {annotatedUrl && (
          <a className="btn small ghost link-btn" href={annotatedUrl} download>
            Download annotated image
          </a>
        )}
      </div>

      {parcels.length > 0 ? (
        <div className="table-wrap">
          <table className="det-table">
            <thead>
              <tr><th>Parcel</th><th>Area (m² est.)</th><th>Perimeter (m est.)</th><th>Conf. (heur.)</th><th>Vertices</th></tr>
            </thead>
            <tbody>
              {parcels.map((p) => (
                <tr key={p.parcel_id}>
                  <td><b>{p.parcel_id}</b></td>
                  <td>{p.area}</td>
                  <td>{p.perimeter}</td>
                  <td>{Number(p.confidence).toFixed(3)}</td>
                  <td>{p.num_vertices}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mono">No parcel polygons survived filtering. Try a lower-confidence run or a different image.</p>
      )}
    </section>
  );
}
