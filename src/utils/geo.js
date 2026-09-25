import { METERS_PER_UNIT } from '../data/sampleData'

const M2_PER_UNIT2 = METERS_PER_UNIT * METERS_PER_UNIT

// Shoelace formula — polygon area in scene units.
export function polygonAreaUnits(points) {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum / 2)
}

export function polygonAreaM2(points) {
  return polygonAreaUnits(points) * M2_PER_UNIT2
}

export function centroid(points) {
  let x = 0
  let y = 0
  for (const [px, py] of points) {
    x += px
    y += py
  }
  return [x / points.length, y / points.length]
}

export function formatArea(m2) {
  if (m2 >= 10000) return `${(m2 / 10000).toFixed(2)} ha`
  if (m2 >= 1000) return `${(m2 / 1000).toFixed(2)}k m²`
  return `${Math.round(m2)} m²`
}

export function formatAreaFull(m2) {
  return `${Math.round(m2).toLocaleString('en-US')} m² (${(m2 / 10000).toFixed(3)} ha)`
}

export function formatConf(c) {
  if (c == null) return '—'
  return `${(c * 100).toFixed(1)}%`
}

export function avgConfidence(items) {
  if (!items.length) return null
  return items.reduce((s, i) => s + i.confidence, 0) / items.length
}

export function pointsToString(points) {
  return points.map(([x, y]) => `${x},${y}`).join(' ')
}
