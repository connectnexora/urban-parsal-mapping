import { MapContainer, TileLayer, Marker, Popup, ImageOverlay, Rectangle, Polygon, LayersControl, useMap } from 'react-leaflet';
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

const DEFAULT_COLORS = {
  buildings: '#22c55e',
  roads: '#f97316',
  vegetation: '#16a34a',
  water: '#3b82f6',
  other: '#a855f7',
  parcels: '#eab308',
};

// Layer order + labels for the control. Parcels has no extractor yet —
// its toggle stays honest (empty layer + explanatory caption).
const LAYER_DEFS = [
  { key: 'buildings', label: 'Buildings' },
  { key: 'roads', label: 'Roads' },
  { key: 'parcels', label: 'Parcels' },
  { key: 'vegetation', label: 'Vegetation' },
  { key: 'water', label: 'Water' },
  { key: 'other', label: 'Other features' },
];

const MAX_SHAPES_PER_LAYER = 150;

/** Fake-but-local placement: drape the uploaded frame around the map centre. */
function overlayBounds(dims) {
  const dLat = 0.06;
  const dLng = dLat * (dims.w / dims.h);
  return [
    [CENTER[0] - dLat / 2, CENTER[1] - dLng / 2],
    [CENTER[0] + dLat / 2, CENTER[1] + dLng / 2],
  ];
}

/** Pixel [x, y] (origin top-left) -> [lat, lng] inside the overlay bounds. */
function pxToLatLng(x, y, dims, bounds) {
  const [[s, w], [n, e]] = bounds;
  return [n - (y / dims.h) * (n - s), w + (x / dims.w) * (e - w)];
}

function FitToOverlay({ bounds, active }) {
  const map = useMap();
  const key = active ? bounds.flat().join(',') : 'off';
  useEffect(() => {
    if (active) map.fitBounds(bounds, { padding: [24, 24] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function FeaturePopup({ item }) {
  return (
    <Popup>
      <b>{item.class}</b>
      <br />conf: {Number(item.confidence).toFixed(3)}
      <br />bbox: [{item.bbox.join(', ')}]
      {item.area_px != null && <><br />area: {item.area_px} px²</>}
      {item.method && <><br />method: {item.method}</>}
    </Popup>
  );
}

function LayerShapes({ items, color, dims, bounds }) {
  return (
    <>
      {items.slice(0, MAX_SHAPES_PER_LAYER).map((item, i) => {
        const poly = item.polygon;
        const isBox =
          !poly || (poly.length === 4 && poly[0][0] === poly[3][0] && poly[1][0] === poly[2][0]);
        if (isBox) {
          const [x1, y1, x2, y2] = item.bbox;
          const nw = pxToLatLng(x1, y1, dims, bounds);
          const se = pxToLatLng(x2, y2, dims, bounds);
          return (
            <Rectangle key={i} bounds={[[se[0], nw[1]], [nw[0], se[1]]]} pathOptions={{ color, weight: 2 }}>
              <FeaturePopup item={item} />
            </Rectangle>
          );
        }
        const ring = poly.map(([x, y]) => pxToLatLng(x, y, dims, bounds));
        return (
          <Polygon key={i} positions={ring} pathOptions={{ color, weight: 2, fillOpacity: 0.25 }}>
            <FeaturePopup item={item} />
          </Polygon>
        );
      })}
    </>
  );
}

export default function MapView({ featureResult, overlayUrl }) {
  useEffect(() => {
    // Ensure the Leaflet map sizes correctly after first paint.
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
    return () => clearTimeout(t);
  }, []);

  const overlay = useMemo(() => {
    if (!featureResult?.image_width || !featureResult?.image_height || !overlayUrl) return null;
    const dims = { w: featureResult.image_width, h: featureResult.image_height };
    return { dims, bounds: overlayBounds(dims) };
  }, [featureResult, overlayUrl]);

  const feats = featureResult?.features || {};
  const counts = featureResult?.counts || {};
  const reasons = featureResult?.reasons || {};
  const colors = { ...DEFAULT_COLORS, ...(featureResult?.feature_colors || {}) };
  const hasOverlay = overlay != null;

  return (
    <section className="card map-wrap">
      <div className="map-head">
        <h2>2 · Interactive Map</h2>
        <p className="sub">
          {hasOverlay
            ? 'Uploaded frame draped at the map centre — toggle feature layers (top-right).'
            : 'Feature layers appear here after POST /detect/features runs.'}
        </p>
      </div>
      <MapContainer center={CENTER} zoom={14} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {!hasOverlay && (
          <Marker position={CENTER}>
            <Popup>Demo anchor — Bengaluru. Run feature extraction to overlay AI layers.</Popup>
          </Marker>
        )}
        {hasOverlay && (
          <>
            <FitToOverlay bounds={overlay.bounds} active />
            <ImageOverlay url={overlayUrl} bounds={overlay.bounds} opacity={0.95} zIndex={1} />
            <LayersControl position="topright" collapsed={false}>
              {LAYER_DEFS.map(({ key, label }) => {
                const items = key === 'parcels' ? [] : feats[key] || [];
                const n = key === 'parcels' ? 0 : counts[key] ?? items.length;
                return (
                  <LayersControl.Overlay key={key} checked name={`${label} (${n})`}>
                    <LayerShapes items={items} color={colors[key]} dims={overlay.dims} bounds={overlay.bounds} />
                  </LayersControl.Overlay>
                );
              })}
            </LayersControl>
          </>
        )}
      </MapContainer>
      {hasOverlay ? (
        <div className="layer-caption">
          {LAYER_DEFS.map(({ key, label }) => {
            const n = key === 'parcels' ? 0 : counts[key] ?? (feats[key] || []).length;
            const note =
              key === 'parcels'
                ? 'parcel extractor not available yet'
                : n === 0 && reasons[key]
                  ? reasons[key]
                  : null;
            return (
              <div key={key} className="layer-row" title={note || `${n} ${label.toLowerCase()} shown`}>
                <span className="legend-dot" style={{ background: colors[key] }} />
                <span className="layer-name">{label}</span>
                <span className="mono">{n}</span>
              </div>
            );
          })}
          <p className="map-note">
            Frame placed at the demo centre (no georeferencing yet) — geometry is in uploaded-image pixels.
            Empty layers are honest: see Detection panel for reasons.
          </p>
        </div>
      ) : (
        <p className="map-note">No AI overlays yet — upload an image, then press “Process Image (AI Features)”.</p>
      )}
    </section>
  );
}
