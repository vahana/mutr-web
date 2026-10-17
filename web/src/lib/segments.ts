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

export const SNAP_MS = 500

export function snapToSecond(ms: number): number {
  return Math.round(ms / SNAP_MS) * SNAP_MS
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

export function skipEndAt(
  markers: number[],
  totalMs: number,
  skipped: number[],
  ms: number,
): number | null {
  if (skipped.length === 0 || totalMs <= 0) return null
  const all = [0, ...markers, totalMs]
  const set = new Set(skipped)
  let i = segmentAt(markers, totalMs, ms)
  if (!set.has(i)) return null
  while (i + 1 < all.length - 1 && set.has(i + 1)) i++
  return all[i + 1]
}

export function toggleSkip(skipped: number[], idx: number): number[] {
  return skipped.includes(idx)
    ? skipped.filter((s) => s !== idx)
    : [...skipped, idx].sort((a, b) => a - b)
}

export function remapSkipsOnAdd(skipped: number[], segIdx: number): number[] {
  const out: number[] = []
  for (const s of skipped) {
    if (s < segIdx) out.push(s)
    else if (s === segIdx) out.push(s, s + 1)
    else out.push(s + 1)
  }
  return out
}

export function remapSkipsOnRemove(skipped: number[], markerIdx: number): number[] {
  const set = new Set(skipped)
  const out: number[] = []
  for (const s of skipped) {
    if (s < markerIdx) out.push(s)
    else if (s > markerIdx + 1) out.push(s - 1)
    else if (s === markerIdx && set.has(markerIdx + 1)) out.push(s)
  }
  return out
}
