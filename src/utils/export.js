import { polygonAreaM2 } from './geo'

// All exports are generated locally in the browser (Blob download).
// No network requests.

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function toGeoJSONPolygon(points) {
  const ring = points.map(([x, y]) => [x, y])
  ring.push([...ring[0]])
  return [ring]
}

export function exportGeoJSON(parcels, buildings, roads) {
  const features = [
    ...parcels.map((p) => ({
      type: 'Feature',
      properties: {
        kind: 'parcel',
        id: p.id,
        landUse: p.landUse,
        confidence: p.confidence,
        area_m2: Math.round(polygonAreaM2(p.points))
      },
      geometry: { type: 'Polygon', coordinates: toGeoJSONPolygon(p.points) }
    })),
    ...buildings.map((b) => ({
      type: 'Feature',
      properties: { kind: 'building', id: b.id, parcelId: b.parcelId, confidence: b.confidence },
      geometry: { type: 'Polygon', coordinates: toGeoJSONPolygon(b.points) }
    })),
    ...roads.map((r) => ({
      type: 'Feature',
      properties: { kind: 'road', id: r.id, name: r.name, confidence: r.confidence },
      geometry: { type: 'LineString', coordinates: r.points }
    }))
  ]
  const fc = { type: 'FeatureCollection', features }
  download('urban-parcels.geojson', JSON.stringify(fc, null, 2), 'application/geo+json')
}

export function exportCSV(parcels) {
  const rows = [
    ['parcel_id', 'land_use', 'area_m2', 'confidence'],
    ...parcels.map((p) => [p.id, p.landUse, Math.round(polygonAreaM2(p.points)), p.confidence.toFixed(3)])
  ]
  const csv = rows.map((r) => r.join(',')).join('\n')
  download('urban-parcels.csv', csv, 'text/csv')
}
