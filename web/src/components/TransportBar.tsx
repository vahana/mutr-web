import { useEffect, useState } from 'react'

import { engine } from '../audio/engine'
import { debounce } from '../lib/debounce'
import { useProjectStore } from '../store/useProjectStore'

function msToStr(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function TransportBar() {
  const project = useProjectStore((s) => s.project)
  const setProject = useProjectStore((s) => s.setProject)
  const save = useProjectStore((s) => s.save)
  const [, setTick] = useState(0)

  useEffect(() => engine.subscribe(() => setTick((t) => t + 1)), [])

  if (!project) return null

  const playing = engine.isPlaying
  const pos = engine.getPositionMs()
  const dur = engine.getDurationMs()
  const speed = project.speed
  const masterVolume = project.master_volume

  const saveDebounced = debounce(() => void save(), 400)

  const setSpeed = (v: number) => {
    const clamped = Math.max(10, Math.min(100, v))
    setProject((p) => ({ ...p, speed: clamped }))
    saveDebounced()
  }

  const setMasterVolume = (v: number) => {
    const clamped = Math.max(0, Math.min(100, v))
    setProject((p) => ({ ...p, master_volume: clamped }))
    saveDebounced()
  }

  return (
    <div className="transport">
      <span className="transport-label">Speed</span>
      <button className="speed-btn" onClick={() => setSpeed(speed - 10)} title="Slower">
        −
      </button>
      <span className="speed-val">{(speed / 100).toFixed(2)}×</span>
      <button className="speed-btn" onClick={() => setSpeed(speed + 10)} title="Faster">
        +
      </button>
      <button className="speed-btn" onClick={() => setSpeed(100)} title="Reset to 100%">
        ⏩
      </button>

      <span className="spacer" />

      <button
        className="play-btn"
        title="Space"
        onClick={() => {
          if (playing) engine.pause()
          else void engine.play()
        }}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <button className="stop-btn" title="Stop" onClick={() => engine.stop()}>
        ■
      </button>
      <span className="time-label">
        {msToStr(pos)} / {msToStr(dur)}
      </span>

      <span className="spacer" />

      <span className="transport-label">Vol</span>
      <input
        type="range"
        min={0}
        max={100}
        value={masterVolume}
        onChange={(e) => setMasterVolume(Number(e.target.value))}
      />
      <span className="vol-label">{masterVolume}%</span>
    </div>
  )
}
