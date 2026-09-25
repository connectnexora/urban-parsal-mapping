import { MapContainer, TileLayer, Marker, Popup, Polygon, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { useEffect, useMemo } from 'react';

// Fix default marker icons under Vite (Leaflet images aren't bundled by default).
import marker2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: marker2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Default view: Bengaluru, India. Judges can pan/zoom anywhere.
const CENTER = [12.9716, 77.5946];

const PALETTE = ['#38bdf8', '#34d399', '#a78bfa', '#fbbf24', '#f87171', '#22d3ee'];

/**
 * Parcel polygons arrive in IMAGE-PIXEL coordinates, not geo coordinates.
 * They are rendered as a clearly-labelled SCHEMATIC overlay fitted around
 * the map centre (aspect preserved) so judges can inspect shapes/areas.
 * The annotated image (true pixel geometry) is shown in ParcelResults.
 */
function parcelsToLatLngs(parcelResult) {
  const parcels = parcelResult?.parcels || [];
  if (!parcels.length || !parcelResult?.image_width || !parcelResult?.image_height) {
    return [];
  }
  const W = parcelResult.image_width;
  const H = parcelResult.image_height;
  // Schematic extent ~0.02 deg; preserves image aspect ratio.
  const extent = 0.02;
  return parcels.map((p, i) => {
    const positions = (p.polygon || []).map(([x, y]) => [
      CENTER[0] + (0.5 - y / H) * extent,
      CENTER[1] + ((x / W) - 0.5) * extent,
    ]);
    return {
      parcel: p,
      color: PALETTE[i % PALETTE.length],
      positions,
    };
  }).filter((r) => r.positions.length >= 3);
}

export default function MapView({ parcelResult }) {
  useEffect(() => {
    // Ensure the Leaflet map sizes correctly after first paint.
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
    return () => clearTimeout(t);
  }, []);

  const overlays = useMemo(() => parcelsToLatLngs(parcelResult), [parcelResult]);
  const hasParcels = overlays.length > 0;

  return (
    <section className="card map-wrap">
      <div className="map-head">
        <h2>2 · Interactive Map</h2>
        <p className="sub">
          {hasParcels
            ? `Showing ${overlays.length} AI-estimated parcel polygon(s) — schematic overlay, NOT legal cadastre. Click a polygon for details.`
            : 'Parcel polygons will overlay here after Extract Parcels runs.'}
        </p>
      </div>
      <MapContainer center={CENTER} zoom={hasParcels ? 15 : 14} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {!hasParcels && (
          <Marker position={CENTER}>
            <Popup>Demo anchor — Bengaluru. Run Extract Parcels to see AI-estimated polygons.</Popup>
          </Marker>
        )}
        {overlays.map(({ parcel, color, positions }) => (
          <Polygon
            key={parcel.parcel_id}
            positions={positions}
            pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.25 }}
          >
            <Tooltip sticky>
              {parcel.parcel_id} · ~{parcel.area} m² (est.)
            </Tooltip>
            <Popup>
              <b>{parcel.parcel_id}</b> (AI-estimated, approximate)
              <br />Area: ~{parcel.area} m² · Perimeter: ~{parcel.perimeter} m
              <br />Confidence: {parcel.confidence} (heuristic)
              <br />Vertices: {parcel.num_vertices} · {parcel.method}
            </Popup>
          </Polygon>
        ))}
      </MapContainer>
      <p className="map-note">
        {hasParcels
          ? '⚠️ Schematic overlay: image-pixel polygons fitted around the centre for inspection — NOT georeferenced survey data. True geometry is in the annotated image + GeoJSON below.'
          : '⚠️ No AI overlays yet — run Detect Buildings or Extract Parcels. Parcel boundaries are always AI-estimated/approximate.'}
      </p>
    </section>
  );
}
