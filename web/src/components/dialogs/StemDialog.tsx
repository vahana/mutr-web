import { useState } from 'react'

import { api, errMsg } from '../../api/client'
import { useJobsStore } from '../../store/useJobsStore'
import { useProjectStore } from '../../store/useProjectStore'
import { pushToast } from '../../store/useToastStore'
import { Modal } from './Modal'

const MODELS: [string, string][] = [
  ['htdemucs', 'Demucs (4 stems, default)'],
  ['htdemucs_ft', 'Demucs Fine-Tuned (4 stems, higher quality)'],
  ['htdemucs_6s', 'Demucs 6-Stem (vocals, drums, bass, guitar, piano, other)'],
  ['mdx_extra_q', 'MDX Extra (best vocal separation)'],
]

interface Props {
  trackIndex: number
  trackName: string
  onClose: () => void
}

export function StemDialog({ trackIndex, trackName, onClose }: Props) {
  const [model, setModel] = useState('htdemucs_6s')
  const [shifts, setShifts] = useState(10)
  const projectName = useProjectStore((s) => s.projectName)
  const track = useJobsStore((s) => s.track)

  const apply = async () => {
    if (!projectName) return
    try {
      const res = await api.stemsTrack(projectName, trackIndex, model, shifts)
      track(res.job_id, 'stems', projectName)
      onClose()
    } catch (e) {
      pushToast(errMsg(e), 'error')
    }
  }

  return (
    <Modal title={`Split Stems — ${trackName}`} onClose={onClose}>
      <div className="dialog-row">
        <label>Model:</label>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {MODELS.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="dialog-row">
        <label>Quality:</label>
        <input
          type="number"
          min={0}
          max={20}
          value={shifts}
          title="Higher = better separation quality but slower"
          onChange={(e) => setShifts(Number(e.target.value))}
        />
      </div>
      <div className="dialog-row right">
        <button className="text-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="text-btn primary" onClick={() => void apply()}>
          Apply
        </button>
      </div>
    </Modal>
  )
}
