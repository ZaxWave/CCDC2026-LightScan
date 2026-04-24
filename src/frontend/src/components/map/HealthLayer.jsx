import { useEffect, useRef } from 'react'

const GRID = 0.001
const TYPE_WEIGHT = { '坑槽': 12, '龟裂': 8, '纵向裂缝': 6, '横向裂缝': 5 }
const STATUS_MULT = { pending: 1.0, processing: 0.6, repaired: 0.15 }

function scoreColor(score) {
  if (score >= 80) return '#22c55e'
  if (score >= 60) return '#eab308'
  if (score >= 40) return '#f97316'
  return '#ef4444'
}

export function computeGrid(records) {
  const cells = {}
  for (const r of records) {
    if (!r.lat || !r.lng) continue
    const gLat = Math.round(r.lat / GRID) * GRID
    const gLng = Math.round(r.lng / GRID) * GRID
    const key = `${gLat.toFixed(4)},${gLng.toFixed(4)}`
    if (!cells[key]) cells[key] = { gLat, gLng, recs: [] }
    cells[key].recs.push(r)
  }

  return Object.values(cells).map(cell => {
    let deduction = 0
    for (const r of cell.recs) {
      const conf = r.confidence ?? 0.5
      let weight = 5
      for (const [k, w] of Object.entries(TYPE_WEIGHT)) {
        if ((r.label_cn || '').includes(k)) { weight = w; break }
      }
      deduction += conf * weight * (STATUS_MULT[r.status] ?? 1.0)
    }
    const score = Math.max(0, Math.round(100 - Math.min(100, deduction)))
    return {
      gLat: cell.gLat, gLng: cell.gLng,
      score, count: cell.recs.length,
      color: scoreColor(score),
      key: `${cell.gLat.toFixed(4)},${cell.gLng.toFixed(4)}`,
    }
  }).sort((a, b) => a.score - b.score)
}

export default function HealthLayer({ mapInstance, amap, records, visible }) {
  const polyRef = useRef([])

  useEffect(() => {
    // cleanup previous
    if (polyRef.current.length > 0) {
      mapInstance?.remove(polyRef.current)
      polyRef.current = []
    }

    if (!mapInstance || !visible || !amap?.Polygon) return

    const grid = computeGrid(records)
    if (grid.length === 0) return

    const half = GRID / 2
    const polygons = grid.map(cell => new amap.Polygon({
      path: [
        [cell.gLng - half, cell.gLat - half],
        [cell.gLng + half, cell.gLat - half],
        [cell.gLng + half, cell.gLat + half],
        [cell.gLng - half, cell.gLat + half],
      ],
      strokeColor: cell.color,
      strokeOpacity: 0.8,
      strokeWeight: 1,
      fillColor: cell.color,
      fillOpacity: 0.2,
      zIndex: 10,
      bubble: true,
    }))

    mapInstance.add(polygons)
    polyRef.current = polygons

    return () => {
      mapInstance?.remove(polygons)
      polyRef.current = []
    }
  }, [mapInstance, amap, records, visible])

  return null
}
