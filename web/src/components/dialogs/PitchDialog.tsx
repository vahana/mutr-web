import { useState } from 'react'

import { api, errMsg } from '../../api/client'
import { useJobsStore } from '../../store/useJobsStore'
import { useProjectStore } from '../../store/useProjectStore'
import { pushToast } from '../../store/useToastStore'
import { Modal } from './Modal'

interface Props {
  trackIndex: number
  trackName: string
  onClose: () => void
}

export function PitchDialog({ trackIndex, trackName, onClose }: Props) {
  const [semitones, setSemitones] = useState(0)
  const projectName = useProjectStore((s) => s.projectName)
  const track = useJobsStore((s) => s.track)

  const apply = async () => {
    if (!projectName || semitones === 0) return
    try {
      const res = await api.pitchTrack(projectName, trackIndex, semitones)
      track(res.job_id, 'pitch', projectName)
      onClose()
    } catch (e) {
      pushToast(errMsg(e), 'error')
    }
  }

  return (
    <Modal title={`Pitch Shift — ${trackName}`} onClose={onClose}>
      <div className="dialog-row center">
        <button className="speed-btn" onClick={() => setSemitones((s) => Math.max(-12, s - 1))}>
          ▼
        </button>
        <span className="pitch-val">{semitones === 0 ? '0 st' : `${semitones > 0 ? '+' : ''}${semitones} st`}</span>
        <button className="speed-btn" onClick={() => setSemitones((s) => Math.min(12, s + 1))}>
          ▲
        </button>
      </div>
      <div className="dialog-row right">
        <button className="text-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="text-btn primary" disabled={semitones === 0} onClick={() => void apply()}>
          Apply
        </button>
      </div>
    </Modal>
  )
}
