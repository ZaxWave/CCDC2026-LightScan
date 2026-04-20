export function haversineM(p1, p2) {
  const R = 6371000
  const lat1 = (p1.lat * Math.PI) / 180
  const lat2 = (p2.lat * Math.PI) / 180
  const dlat = ((p2.lat - p1.lat) * Math.PI) / 180
  const dlng = ((p2.lng - p1.lng) * Math.PI) / 180
  const a =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function computeTotalDist(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += haversineM(points[i - 1], points[i])
  }
  return total
}

export function fmtTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0')
  const s = (secs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}
