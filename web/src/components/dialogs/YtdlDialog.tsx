import { useState } from 'react'

import { api, errMsg } from '../../api/client'
import { useJobsStore } from '../../store/useJobsStore'
import { useProjectStore } from '../../store/useProjectStore'
import { pushToast } from '../../store/useToastStore'
import { Modal } from './Modal'

interface Props {
  onClose: () => void
}

export function YtdlDialog({ onClose }: Props) {
  const [url, setUrl] = useState('')
  const [quality, setQuality] = useState(1080)
  const [audioOnly, setAudioOnly] = useState(false)
  const projectName = useProjectStore((s) => s.projectName)
  const track = useJobsStore((s) => s.track)

  const apply = async () => {
    if (!projectName || !url.trim()) return
    try {
      const res = await api.ytdlTrack(projectName, url.trim(), quality, audioOnly)
      track(res.job_id, 'ytdl', projectName)
      onClose()
    } catch (e) {
      pushToast(errMsg(e), 'error')
    }
  }

  return (
    <Modal title="Download from YouTube" onClose={onClose}>
      <div className="dialog-row">
        <input
          className="ytdl-url"
          placeholder="https://youtube.com/watch?v=…"
          value={url}
          autoFocus
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void apply()
          }}
        />
      </div>
      <div className="dialog-row">
        <label>Quality:</label>
        <select value={quality} onChange={(e) => setQuality(Number(e.target.value))}>
          {[144, 240, 360, 480, 720, 1080, 1440, 2160].map((q) => (
            <option key={q} value={q}>
              {q}p
            </option>
          ))}
        </select>
        <label className="check-label">
          <input type="checkbox" checked={audioOnly} onChange={(e) => setAudioOnly(e.target.checked)} />
          Audio only
        </label>
      </div>
      <div className="dialog-row right">
        <button className="text-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="text-btn primary" disabled={!url.trim()} onClick={() => void apply()}>
          Download
        </button>
      </div>
    </Modal>
  )
}
