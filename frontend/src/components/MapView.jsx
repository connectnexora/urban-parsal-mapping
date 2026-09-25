import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { useEffect } from 'react';

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

export default function MapView() {
  useEffect(() => {
    // Ensure the Leaflet map sizes correctly after first paint.
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <section className="card map-wrap">
      <div className="map-head">
        <h2>2 · Interactive Map</h2>
        <p className="sub">Parcel boundaries &amp; detections will overlay here in Step 2.</p>
      </div>
      <MapContainer center={CENTER} zoom={14} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={CENTER}>
          <Popup>Demo anchor — Bengaluru. AI parcel overlays coming in Step 2.</Popup>
        </Marker>
      </MapContainer>
      <p className="map-note">⚠️ No AI overlays yet — map shell only. Real building/road/parcel polygons arrive with Step 2.</p>
    </section>
  );
}
