import { useEffect, useRef } from 'react'

import type { Waveform } from '../api/types'

interface Props {
  waveform: Waveform | null
  color: string
  getPlayhead?: () => number | null
  onSeek?: (ratio: number) => void
}

export function WaveformCanvas({ waveform, color, getPlayhead, onSeek }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let layer: HTMLCanvasElement | null = null
    let w = 0
    let h = 0

    const redrawPeaks = () => {
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
      ctx.fillStyle = '#121212'
      ctx.fillRect(0, 0, w, h)
      const peaks = waveform?.peaks
      if (!peaks || peaks.length === 0) {
        ctx.fillStyle = '#3c3c3c'
        ctx.font = '12px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('···', w / 2, h / 2 + 4)
      } else {
        const mid = h / 2
        ctx.fillStyle = color
        const n = peaks.length
        const barW = w / n
        for (let i = 0; i < n; i++) {
          const half = Math.max(1, peaks[i] * mid * 0.92)
          const x = i * barW
          ctx.fillRect(x, mid - half, Math.max(1, barW - 1), half * 2)
        }
      }
    }

    let raf = 0
    let bufW = 0
    let bufH = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (canvas.clientWidth !== w || canvas.clientHeight !== h || !layer) {
        redrawPeaks()
      }
      const ctx = canvas.getContext('2d')
      if (!ctx || !layer || w === 0 || h === 0) return
      const dpr = window.devicePixelRatio || 1
      const pxW = Math.round(w * dpr)
      const pxH = Math.round(h * dpr)
      if (bufW !== pxW || bufH !== pxH) {
        bufW = pxW
        bufH = pxH
        canvas.width = pxW
        canvas.height = pxH
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(layer, 0, 0)
      const ratio = getPlayhead?.() ?? null
      if (ratio !== null) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.fillStyle = '#ff3c3c'
        ctx.fillRect(Math.round(ratio * w), 0, 1, h)
      }
    }
    raf = requestAnimationFrame(draw)
    const ro = new ResizeObserver(redrawPeaks)
    ro.observe(canvas)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [waveform, color, getPlayhead])

  return (
    <canvas
      ref={canvasRef}
      className="waveform"
      onMouseDown={(e) => {
        if (!onSeek || !canvasRef.current) return
        const rect = canvasRef.current.getBoundingClientRect()
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        onSeek(ratio)
      }}
    />
  )
}
