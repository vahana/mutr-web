import { useEffect, useState } from 'react'

import { useJobsStore } from '../store/useJobsStore'
import { useProjectStore } from '../store/useProjectStore'

const KIND_LABEL: Record<string, string> = {
  pitch: 'Pitch shift',
  stems: 'Stem split',
  ytdl: 'YouTube download',
  merge: 'Merge tracks',
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function JobDock() {
  const jobs = useJobsStore((s) => s.jobs)
  const order = useJobsStore((s) => s.order)
  const cancel = useJobsStore((s) => s.cancel)
  const dismiss = useJobsStore((s) => s.dismiss)
  const project = useProjectStore((s) => s.project)
  const now = useNow(order.length > 0)

  const active = order.map((id) => jobs[id]).filter(Boolean)
  if (active.length === 0) return null

  return (
    <div className="job-dock">
      {active.map((job) => {
        const track = project?.tracks.find((t) => t.file === job.track_filename)
        const running = job.status === 'running' || job.status === 'queued'
        const pct = job.progress
        return (
          <div key={job.id} className={`job-row ${job.status}`}>
            <div className="job-head">
              <span className="job-kind">
                {KIND_LABEL[job.kind] ?? job.kind}
                {track ? ` — ${track.name}` : ''}
              </span>
              <span className="job-status">{job.status}</span>
              <span className="job-elapsed">
                {job.created_at ? fmtElapsed(now - job.created_at * 1000) : ''}
              </span>
              {running ? (
                <button className="mini-btn" title="Cancel" onClick={() => void cancel(job.id)}>
                  ✕
                </button>
              ) : (
                <button className="mini-btn" title="Dismiss" onClick={() => dismiss(job.id)}>
                  ✕
                </button>
              )}
            </div>
            <div className="job-message">{job.message || (running ? 'Working…' : job.error || '')}</div>
            {running && (
              <div className="job-progress-row">
                {pct !== null && pct !== undefined ? (
                  <>
                    <div className="job-bar">
                      <div className="job-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="job-pct">{Math.round(pct)}%</span>
                  </>
                ) : (
                  <div className="job-bar indeterminate">
                    <div className="job-bar-fill" />
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
