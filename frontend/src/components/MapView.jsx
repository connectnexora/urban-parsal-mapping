import {
  MapContainer, TileLayer, Marker, Popup, ImageOverlay, Rectangle, Polygon,
  LayersControl, GeoJSON, ScaleControl, ZoomControl, useMap,
} from 'react-leaflet';
import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';

// Fix default marker icons under Vite (Leaflet images aren't bundled by default).
import marker2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

import {
  CENTER,
  imageFrame,
  pxToLatLng,
  buildingCoverage,
  parcelsToGeoJSON,
  detectionsToGeoJSON,
  featureItemsToGeoJSON,
  changesToGeoJSON,
} from '../utils/mapGeo.js';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: marker2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const PARCEL_PALETTE = ['#38bdf8', '#34d399', '#a78bfa', '#fbbf24', '#f87171', '#22d3ee'];

const FEATURE_COLORS = {
  buildings: '#22c55e',
  roads: '#f97316',
  vegetation: '#16a34a',
  water: '#3b82f6',
  other: '#a855f7',
  parcels: '#eab308',
};

const FEATURE_LAYER_DEFS = [
  { key: 'buildings', label: 'Buildings' },
  { key: 'roads', label: 'Roads' },
  { key: 'vegetation', label: 'Vegetation' },
  { key: 'water', label: 'Water' },
  { key: 'other', label: 'Other features' },
];

const CHANGE_STATUSES = ['NEW', 'REMOVED', 'CHANGED', 'UNCHANGED'];
const CHANGE_COLORS_DEFAULT = {
  NEW: '#2ecc71',
  REMOVED: '#f87171',
  CHANGED: '#fbbf24',
  UNCHANGED: '#a0a0a0',
};

const MAX_SHAPES_PER_LAYER = 150;

function FitToResults({ bounds, fitKey }) {
  const map = useMap();
  const key = bounds ? bounds.toBBoxString() + '|' + fitKey : 'off|' + fitKey;
  useEffect(() => {
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [28, 28] });
    }
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
          <Polygon
            key={i}
            positions={ring}
            pathOptions={{ color, weight: 2, fillOpacity: 0.1, dashArray: item.polygon ? null : '4 3' }}
          >
            <FeaturePopup item={item} />
          </Polygon>
        );
      })}
    </>
  );
}

export default function MapView({
  parcelResult,
  detection,
  featureResult,
  overlayUrl,
  selectedParcelId,
  onSelectParcel,
  changeResult,
}) {
  const [fitKey, setFitKey] = useState(0);
  // Mobile: collapse the layer list so it doesn't cover the map, move zoom
  // to the thumb corner, and don't hijack page scroll with wheel-zoom
  // (coarse pointers get tap/drag/pinch instead).
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 640px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 640px)');
    if (!mq) return undefined;
    const onChange = (e) => setIsNarrow(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  const isCoarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

  useEffect(() => {
    // Ensure the Leaflet map sizes correctly after first paint.
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
    return () => clearTimeout(t);
  }, []);

  const allParcels = parcelResult?.parcels || [];
  const allChanges = changeResult?.changes || [];
  const changeColors = { ...CHANGE_COLORS_DEFAULT, ...(changeResult?.change_colors || {}) };

  // Every result carries the pixel size of the image it was computed from.
  // They can differ (e.g. change detection on its own Image A while an
  // earlier parcel result is still loaded), so the shared schematic frame is
  // chosen ONCE and any layer whose source size doesn't match is not drawn —
  // previously it was stretched into the wrong frame, which put overlays in
  // the wrong place and made them overlap.
  const dimsOf = (r) => (r?.image_width && r?.image_height
    ? { w: r.image_width, h: r.image_height } : null);
  const changeDims = (r) => (r?.image_a?.width && r?.image_a?.height
    ? { w: r.image_a.width, h: r.image_a.height } : null);

  const parcelSource = { label: 'Parcels', dims: dimsOf(parcelResult) };
  const featureSource = { label: 'Features', dims: dimsOf(featureResult) };
  const buildingSource = { label: 'Buildings', dims: dimsOf(detection) };
  const changeSource = { label: 'Change detection', dims: changeDims(changeResult) };

  const dims = changeSource.dims || parcelSource.dims || featureSource.dims || buildingSource.dims || null;
  const fits = (src) => !src.dims || !dims || (src.dims.w === dims.w && src.dims.h === dims.h);
  const mismatched = [parcelSource, featureSource, buildingSource, changeSource]
    .filter((s) => s.dims && dims && (s.dims.w !== dims.w || s.dims.h !== dims.h));

  const showParcels = allParcels.length > 0 && fits(parcelSource);
  const showFeatures = fits(featureSource);
  const showBuildingsSrc = featureSource.dims && featureResult?.features?.buildings?.length
    ? featureSource : buildingSource;
  const showChanges = allChanges.length > 0 && fits(changeSource);
  const parcels = showParcels ? allParcels : [];
  const changes = showChanges ? allChanges : [];

  const frame = useMemo(() => (dims ? imageFrame(dims) : null), [dims]);

  // Buildings: prefer the feature pipeline's building list when present
  // (avoids double-drawing the same boxes twice), else YOLO detections.
  const buildingItems = useMemo(() => {
    if (featureResult?.features?.buildings?.length) return featureResult.features.buildings;
    return detection?.detections || [];
  }, [featureResult, detection]);
  const visibleBuildings = fits(showBuildingsSrc) ? buildingItems : [];

  const coverageById = useMemo(
    () => buildingCoverage(parcelResult?.parcels || [], buildingItems),
    [parcelResult, buildingItems],
  );

  const parcelsGeoJSON = useMemo(
    () => (parcels.length ? parcelsToGeoJSON(parcelResult, coverageById) : null),
    [parcelResult, parcels.length, coverageById],
  );
  const buildingsGeoJSON = useMemo(
    () => (visibleBuildings.length ? detectionsToGeoJSON(visibleBuildings, 'buildings') : null),
    [visibleBuildings],
  );
  const featureGeoJSON = useMemo(() => {
    const out = {};
    if (!showFeatures) return out;
    for (const { key } of FEATURE_LAYER_DEFS) {
      if (key === 'buildings') continue; // covered by the buildings layer
      const items = featureResult?.features?.[key] || [];
      if (items.length) out[key] = featureItemsToGeoJSON(items, key);
    }
    return out;
  }, [featureResult, showFeatures]);

  const toLatLng = useMemo(() => {
    if (!dims || !frame) return null;
    return (coords) => {
      const [x, y] = coords;
      const [lat, lng] = pxToLatLng(x, y, dims, frame);
      return L.latLng(lat, lng);
    };
  }, [dims, frame]);

  const changesGeoJSON = useMemo(
    () => (changes.length ? changesToGeoJSON(changes) : null),
    [changeResult],
  );

  // Combined bounds of everything detected (for fit-to-area).
  const resultsBounds = useMemo(() => {
    if (!dims || !frame) return null;
    const pts = [];
    for (const p of parcels) {
      for (const [x, y] of p.polygon || []) pts.push(pxToLatLng(x, y, dims, frame));
    }
    for (const b of visibleBuildings) {
      if (!b?.bbox) continue;
      const [x1, y1, x2, y2] = b.bbox;
      pts.push(pxToLatLng(x1, y1, dims, frame), pxToLatLng(x2, y2, dims, frame));
    }
    for (const c of changes) {
      if (!c?.bbox) continue;
      const [x1, y1, x2, y2] = c.bbox;
      pts.push(pxToLatLng(x1, y1, dims, frame), pxToLatLng(x2, y2, dims, frame));
    }
    if (showFeatures) {
      for (const { key } of FEATURE_LAYER_DEFS) {
        for (const it of featureResult?.features?.[key] || []) {
          if (it?.bbox) {
            const [x1, y1, x2, y2] = it.bbox;
            pts.push(pxToLatLng(x1, y1, dims, frame), pxToLatLng(x2, y2, dims, frame));
          }
        }
      }
    }
    if (!pts.length) return null;
    // pts are [lat, lng] pairs already.
    return L.latLngBounds(pts.map(([lat, lng]) => [lat, lng]));
  }, [dims, frame, parcels, visibleBuildings, changes, featureResult, showFeatures]);

  const onEachParcel = (feature, layer) => {
    const p = feature.properties || {};
    layer.bindTooltip(`${p.parcel_id} · ~${p.area_m2_estimated} m² (est.)`, { sticky: true });
    layer.bindPopup(
      `<b>${p.parcel_id}</b> (AI-estimated, approximate)` +
      `<br/>Area: ~${p.area_m2_estimated} m² (~${(Number(p.area_ha_estimated ?? p.area_m2_estimated / 10000)).toFixed(4)} ha)` +
      `<br/>Perimeter: ~${p.perimeter_m_estimated} m` +
      `<br/>Buildings: ${p.building_count} · Coverage: ~${p.building_coverage_pct}%` +
      `<br/>AI confidence: ${p.confidence_approx} (heuristic)`,
    );
    layer.on('click', () => onSelectParcel?.(p.parcel_id));
  };

  const parcelStyle = (feature) => {
    const idx = parcels.findIndex((p) => p.parcel_id === feature?.properties?.parcel_id);
    const color = idx < 0
      ? '#9aa7c2' // unknown id: neutral gray, never impersonates a parcel
      : PARCEL_PALETTE[idx % PARCEL_PALETTE.length];
    const selected = feature?.properties?.parcel_id === selectedParcelId;
    return {
      color,
      weight: selected ? 4 : 2,
      fillColor: color,
      fillOpacity: selected ? 0.45 : 0.25,
    };
  };

  const onEachBuilding = (feature, layer) => {
    const p = feature.properties || {};
    layer.bindTooltip(`${p.class} · ${Number(p.confidence).toFixed(2)}`, { sticky: true });
    layer.bindPopup(
      `<b>${p.class}</b><br/>conf: ${Number(p.confidence).toFixed(3)}<br/>bbox: [${(p.bbox || []).join(', ')}]`,
    );
  };

  const onEachChange = (feature, layer) => {
    const p = feature.properties || {};
    layer.bindTooltip(`${p.status} · ${p.changeKind}: ${p.label}`, { sticky: true });
    layer.bindPopup(
      `<b>${p.status}</b> — ${p.changeKind}<br/>${p.label}` +
      `<br/>conf: ${Number(p.confidence).toFixed(3)}` +
      `<br/>bbox: [${(p.bbox || []).join(', ')}]` +
      (p.method ? `<br/>method: ${p.method}` : ''),
    );
  };

  const changeStyle = (feature) => {
    const color = changeColors[feature?.properties?.status] || '#ffffff';
    return { color, weight: 2, fillColor: color, fillOpacity: 0.3 };
  };

  const onEachFeature = (feature, layer) => {
    const p = feature.properties || {};
    layer.bindTooltip(`${p.kind}: ${p.class} · ${Number(p.confidence).toFixed(2)}`, { sticky: true });
    layer.bindPopup(
      `<b>${p.class}</b> (${p.kind})<br/>conf: ${Number(p.confidence).toFixed(3)}` +
      `<br/>bbox: [${(p.bbox || []).join(', ')}]` +
      (p.method ? `<br/>method: ${p.method}` : ''),
    );
  };

  const feats = featureResult?.features || {};
  const counts = featureResult?.counts || {};
  const reasons = featureResult?.reasons || {};
  const colors = { ...FEATURE_COLORS, ...(featureResult?.feature_colors || {}) };

  const hasParcels = parcels.length > 0;
  const hasBuildings = visibleBuildings.length > 0;
  const hasFeatures = Object.keys(featureGeoJSON).length > 0;
  const hasChanges = changes.length > 0;
  const changeCounts = changeResult?.counts || {};
  // Feature layers need geometry + frame, NOT the browser preview: TIFFs
  // have no preview (overlayUrl null) but their vectors still render.
  const hasVectors = !!(frame && dims && (hasParcels || hasBuildings || hasFeatures || hasChanges));
  // The preview is only meaningful when a result for THIS image is drawn;
  // otherwise the photo and the vectors would not share a frame.
  const hasOverlay = !!(frame && overlayUrl && (hasParcels || hasBuildings || hasFeatures || hasChanges));
  const hasAnything = hasVectors || hasOverlay;

  const shownBits = [
    hasParcels ? `${parcels.length} parcel(s)` : null,
    hasBuildings ? `${visibleBuildings.length} building(s)` : null,
    hasFeatures ? `${Object.values(featureGeoJSON).reduce((n, g) => n + g.features.length, 0)} other feature(s)` : null,
    hasChanges ? `${changes.length} change(s)` : null,
  ].filter(Boolean);
  const sub = hasAnything
    ? `Showing ${shownBits.join(' + ')} — schematic overlays, NOT legal cadastre. Click a parcel for details.`
    : 'Parcel polygons, buildings, roads and other features overlay here after the AI runs.';

  return (
    <section className="card map-wrap">
      <div className="map-head map-head-row">
        <div>
          <h2>2 · Interactive Map</h2>
          <p className="sub">{sub}</p>
        </div>
        {resultsBounds && (
          <button className="btn small" onClick={() => setFitKey((k) => k + 1)}>
            Fit to detected area
          </button>
        )}
      </div>
      <MapContainer
        center={CENTER}
        zoom={hasAnything ? 15 : 14}
        scrollWheelZoom={!isCoarse}
        zoomControl={false}
      >
        <ZoomControl position={isNarrow ? 'bottomright' : 'topleft'} />
        <LayersControl position="topright" collapsed={isNarrow}>
          <LayersControl.BaseLayer checked name="Streets (OSM)">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satellite (Esri)">
            <TileLayer
              attribution='Imagery &copy; <a href="https://www.esri.com/">Esri</a> &amp; contributors'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControl.BaseLayer>

          {hasOverlay && (
            <LayersControl.Overlay checked name="Uploaded frame">
              <ImageOverlay url={overlayUrl} bounds={frame} opacity={0.55} zIndex={1} />
            </LayersControl.Overlay>
          )}

          {parcelsGeoJSON && toLatLng && (
            <LayersControl.Overlay checked name={`Parcels (approx) (${parcels.length})`}>
              <GeoJSON
                key={`parcels-${parcelResult.filename || 'nofile'}-${parcelResult.timestamp || ''}-${parcels.length}-${selectedParcelId || 'none'}`}
                data={parcelsGeoJSON}
                coordsToLatLng={toLatLng}
                style={parcelStyle}
                onEachFeature={onEachParcel}
              />
            </LayersControl.Overlay>
          )}

          {buildingsGeoJSON && toLatLng && (
            <LayersControl.Overlay checked name={`Buildings (${visibleBuildings.length})`}>
              <GeoJSON
                key={`bldg-${(detection || featureResult)?.filename || 'nofile'}-${(detection || featureResult)?.timestamp || ''}-${visibleBuildings.length}`}
                data={buildingsGeoJSON}
                coordsToLatLng={toLatLng}
                style={{ color: colors.buildings, weight: 2, fillOpacity: 0.15 }}
                onEachFeature={onEachBuilding}
              />
            </LayersControl.Overlay>
          )}

          {hasVectors && showFeatures && ['roads', 'vegetation', 'water', 'other'].map((key) => {
            const items = feats[key] || [];
            const n = counts[key] ?? items.length;
            return (
              <LayersControl.Overlay key={key} checked name={`${key[0].toUpperCase() + key.slice(1)} (${n})`}>
                <LayerShapes items={items} color={colors[key]} dims={dims} bounds={frame} />
              </LayersControl.Overlay>
            );
          })}

          {changesGeoJSON && toLatLng && CHANGE_STATUSES.map((st) => {
            const n = changeCounts[st] ?? changes.filter((c) => c.status === st).length;
            if (!n) return null;
            const data = {
              ...changesGeoJSON,
              features: changesGeoJSON.features.filter((f) => f.properties?.status === st),
            };
            return (
              <LayersControl.Overlay
                key={st}
                checked={st !== 'UNCHANGED'}
                name={`Changes: ${st} (${n})`}
              >
                <GeoJSON
                  key={`chg-${st}-${changeResult.file_a || 'a'}-${changeResult.file_b || 'b'}-${changeResult.timestamp || ''}-${n}`}
                  data={data}
                  coordsToLatLng={toLatLng}
                  style={changeStyle}
                  onEachFeature={onEachChange}
                />
              </LayersControl.Overlay>
            );
          })}
        </LayersControl>

        {!hasAnything && (
          <Marker position={CENTER}>
            <Popup>Demo anchor — Bengaluru. Run parcel extraction, building detection or feature extraction to see AI overlays.</Popup>
          </Marker>
        )}

        {resultsBounds && <FitToResults bounds={resultsBounds} fitKey={fitKey} />}
        <ScaleControl position="bottomleft" />
      </MapContainer>
      <div className="layer-caption">
        <div className="layer-row" title="AI-estimated parcel polygons">
          <span className="legend-dot" style={{ background: colors.parcels }} />
          <span className="layer-name">Parcels (approx)</span>
          <span className="mono">{hasParcels ? parcels.length : 0}</span>
        </div>
        <div className="layer-row" title="YOLO building detections">
          <span className="legend-dot" style={{ background: colors.buildings }} />
          <span className="layer-name">Buildings</span>
          <span className="mono">{visibleBuildings.length}</span>
        </div>
        {['roads', 'vegetation', 'water', 'other'].map((key) => {
          const n = showFeatures ? (counts[key] ?? (feats[key] || []).length) : 0;
          const note = !showFeatures
            ? 'hidden — computed on a different image size'
            : !featureResult
              ? 'run Process Image (AI Features)'
              : (n === 0 && reasons[key] ? reasons[key] : null);
          return (
            <div key={key} className="layer-row" title={note || `${n} ${key} shown`}>
              <span className="legend-dot" style={{ background: colors[key] }} />
              <span className="layer-name">{key[0].toUpperCase() + key.slice(1)}</span>
              <span className="mono">{n}</span>
            </div>
          );
        })}
        {hasChanges && CHANGE_STATUSES.map((st) => {
          const n = changeCounts[st] ?? changes.filter((c) => c.status === st).length;
          if (!n) return null;
          return (
            <div key={st} className="layer-row" title={`AI-estimated ${st.toLowerCase()} changes (verify by surveyor)`}>
              <span className="legend-dot" style={{ background: changeColors[st] }} />
              <span className="layer-name">Changes: {st}</span>
              <span className="mono">{n}</span>
            </div>
          );
        })}
        {mismatched.length > 0 && (
          <p className="warn-box">
            Hidden: {mismatched.map((s) => `${s.label} (${s.dims.w}×${s.dims.h})`).join(', ')}.
            {' '}Overlays are drawn in one shared frame, so results from a different
            image size would be misaligned and overlap — re-run the pipeline on the
            current image, or press Reset, to overlay them together.
          </p>
        )}
        <p className="map-note">
          {hasAnything
            ? '⚠️ Schematic overlays: image-pixel geometry fitted around the centre for inspection — NOT georeferenced survey data and NOT legal cadastre. True geometry is in the annotated images + GeoJSON below. Toggle Streets/Satellite (top-right) and layers as needed.'
            : '⚠️ No AI overlays yet — run Detect Buildings, Extract Parcels, or Process Image (AI Features). Parcel boundaries are always AI-estimated/approximate.'}
        </p>
        {['roads', 'vegetation', 'water', 'other'].some((key) => (feats[key] || []).length > 150) && (
          <p className="mono">Note: feature layers show the first 150 shapes per category — full lists are in the tables below.</p>
        )}
      </div>
    </section>
  );
}
