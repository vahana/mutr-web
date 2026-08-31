import { useEffect, useRef, useState } from 'react'

import { engine } from '../audio/engine'
import { getSegmentBounds, nearestMarker, segmentAt, snapToSecond } from '../lib/segments'
import { useProjectStore } from '../store/useProjectStore'

const BAR_H = 20
const LABEL_H = 16
const TOTAL_H = BAR_H + LABEL_H

const SEG_COLORS: [string, string][] = [
  ['rgb(35,70,110)', 'rgb(60,110,170)'],
  ['rgb(70,40,100)', 'rgb(110,70,155)'],
  ['rgb(35,90,65)', 'rgb(60,140,100)'],
  ['rgb(100,65,25)', 'rgb(155,105,45)'],
]

function msToStr(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function LoopBar() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const project = useProjectStore((s) => s.project)
  const setProject = useProjectStore((s) => s.setProject)
  const save = useProjectStore((s) => s.save)
  const [, setTick] = useState(0)
  const dragging = useRef<number | null>(null)
  const dragMoved = useRef(false)

  const markers = project?.markers ?? []
  const activeSegment = project?.active_segment ?? -1
  const loopEnabled = project?.loop_enabled ?? false

  useEffect(() => engine.subscribe(() => setTick((t) => t + 1)), [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let layer: HTMLCanvasElement | null = null
    let w = 0
    let h = 0

    const redraw = () => {
      w = canvas.clientWidth
      h = canvas.clientHeight
      if (w === 0 || h === 0) return
      const dpr = window.devicePixelRatio || 1
      if (!layer) layer = document.createElement('canvas')
      layer.width = Math.round(w * dpr)
      layer.height = Math.round(h * dpr)
      const ctx = layer.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = 'rgb(28,28,28)'
      ctx.fillRect(0, 0, w, h)
      const total = engine.getDurationMs()
      if (total <= 0) return
      const all = [0, ...markers, total]
      const x = (ms: number) => (ms / total) * w
      for (let i = 0; i < all.length - 1; i++) {
        const [inactive, active] = SEG_COLORS[i % SEG_COLORS.length]
        const x0 = x(all[i])
        const x1 = x(all[i + 1])
        ctx.fillStyle = i === activeSegment ? active : inactive
        ctx.fillRect(x0 + 1, 1, x1 - x0 - 1, BAR_H - 2)
      }
      if (!loopEnabled) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)'
        ctx.fillRect(0, 1, w, BAR_H - 2)
      }
      ctx.strokeStyle = 'rgba(200,200,200,0.8)'
      ctx.lineWidth = 1
      for (const m of markers) {
        const mx = x(m)
        ctx.beginPath()
        ctx.moveTo(mx, 0)
        ctx.lineTo(mx, BAR_H)
        ctx.stroke()
      }
      ctx.fillStyle = 'rgb(22,22,22)'
      ctx.fillRect(0, BAR_H, w, LABEL_H)
      ctx.fillStyle = 'rgb(170,170,170)'
      ctx.font = '9px sans-serif'
      ctx.textAlign = 'center'
      for (const m of markers) {
        ctx.fillText(msToStr(m), x(m), BAR_H + 11)
      }
    }

    let raf = 0
    let lastTotal = -1
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const total = engine.getDurationMs()
      if (total !== lastTotal) {
        lastTotal = total
        redraw()
      }
      if (!layer || canvas.clientWidth !== w || canvas.clientHeight !== h) {
        redraw()
      }
      const ctx = canvas.getContext('2d')
      if (!ctx || !layer || w === 0 || h === 0) return
      const dpr = window.devicePixelRatio || 1
      const pxW = Math.round(w * dpr)
      const pxH = Math.round(h * dpr)
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW
        canvas.height = pxH
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(layer, 0, 0)
      if (total > 0) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.fillStyle = 'rgb(255,60,60)'
        ctx.fillRect(Math.round((engine.getPositionMs() / total) * w), 0, 1, BAR_H)
      }
    }
    raf = requestAnimationFrame(draw)
    const ro = new ResizeObserver(redraw)
    ro.observe(canvas)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [markers, activeSegment, loopEnabled, setProject, save])

  const xToMs = (clientX: number) => {
    const canvas = canvasRef.current
    if (!canvas) return 0
    const total = engine.getDurationMs()
    if (total <= 0) return 0
    const rect = canvas.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return ratio * total
  }

  const markerAt = (clientX: number): number | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const total = engine.getDurationMs()
    if (total <= 0) return null
    const radiusMs = (12 / Math.max(1, canvas.clientWidth)) * total
    return nearestMarker(markers, xToMs(clientX), radiusMs)
  }

  const updateMarkers = (next: number[]) => {
    setProject((p) => ({ ...p, markers: next, active_segment: Math.min(p.active_segment, next.length) }))
    void save()
  }

  const onMouseDown = (e: React.MouseEvent) => {
    const total = engine.getDurationMs()
    if (total <= 0) return
    const i = markerAt(e.clientX)
    if (i !== null) {
      dragging.current = i
      dragMoved.current = false
      return
    }
    const seg = segmentAt(markers, total, xToMs(e.clientX))
    setProject((p) => ({ ...p, active_segment: seg }))
    void save()
    const bounds = getSegmentBounds(markers, total, seg)
    if (bounds) engine.seekAll(bounds[0])
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const total = engine.getDurationMs()
    if (total <= 0) return
    const i = markerAt(e.clientX)
    if (i !== null) {
      updateMarkers(markers.filter((_, idx) => idx !== i))
      return
    }
    const ms = snapToSecond(xToMs(e.clientX))
    if (ms === 0 || ms >= total || markers.includes(ms)) return
    updateMarkers([...markers, ms].sort((a, b) => a - b))
  }

  const moveDrag = (clientX: number) => {
    const i = dragging.current
    if (i === null) return
    const total = engine.getDurationMs()
    if (total <= 0) return
    const lo = i > 0 ? markers[i - 1] : 0
    const hi = i < markers.length - 1 ? markers[i + 1] : total
    let ms = snapToSecond(xToMs(clientX))
    ms = Math.max(lo + 1000, Math.min(hi - 1000, ms))
    if (ms === markers[i]) return
    dragMoved.current = true
    const next = markers.map((m, idx) => (idx === i ? ms : m))
    setProject((p) => ({ ...p, markers: next }))
  }

  const endDrag = () => {
    dragging.current = null
    if (dragMoved.current) {
      dragMoved.current = false
      void save()
    }
  }

  useEffect(() => {
    if (dragging.current === null) return
    const onMove = (e: MouseEvent) => moveDrag(e.clientX)
    const onUp = () => endDrag()
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, setProject, save])

  return (
    <canvas
      ref={canvasRef}
      className="loop-bar"
      style={{ height: TOTAL_H }}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onTouchStart={(e) => {
        const t = e.touches[0]
        if (!t) return
        const i = markerAt(t.clientX)
        if (i !== null) {
          dragging.current = i
          dragMoved.current = false
        }
      }}
      onTouchMove={(e) => {
        const t = e.touches[0]
        if (!t) return
        moveDrag(t.clientX)
      }}
      onTouchEnd={endDrag}
      onTouchCancel={endDrag}
    />
  )
}
