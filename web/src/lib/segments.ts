export function getSegmentBounds(
  markers: number[],
  totalMs: number,
  idx: number,
): [number, number] | null {
  if (idx < 0) return null
  const all = [0, ...markers, totalMs]
  if (idx >= all.length - 1) return null
  return [all[idx], all[idx + 1]]
}

export function snapToSecond(ms: number): number {
  return Math.round(ms / 1000) * 1000
}

export function nearestMarker(markers: number[], ms: number, radiusMs: number): number | null {
  if (markers.length === 0) return null
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < markers.length; i++) {
    const d = Math.abs(markers[i] - ms)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return bestDist <= radiusMs ? best : null
}

export function segmentAt(markers: number[], totalMs: number, ms: number): number {
  const all = [0, ...markers, totalMs]
  for (let i = 0; i < all.length - 1; i++) {
    if (all[i] <= ms && ms < all[i + 1]) return i
  }
  return Math.max(0, all.length - 2)
}
