import { useProjectStore } from '../store/useProjectStore'
import { LoopBar } from './LoopBar'

export function LooperRow() {
  const loopEnabled = useProjectStore((s) => s.project?.loop_enabled ?? false)
  const setProject = useProjectStore((s) => s.setProject)
  const save = useProjectStore((s) => s.save)

  return (
    <div className="track-row looper-row">
      <div className="track-left">
        <div className="track-controls looper-controls">
          <span className="swatch looper-swatch" />
          <span className="track-name">Looper</span>
          <LoopBar />
        </div>
      </div>
      <div className="track-panel">
        <button
          className={`mini-btn ${loopEnabled ? 'on-loop' : ''}`}
          title="Loop (L)"
          onClick={() => {
            setProject((p) => ({ ...p, loop_enabled: !p.loop_enabled }))
            void save()
          }}
        >
          🔁
        </button>
      </div>
    </div>
  )
}
