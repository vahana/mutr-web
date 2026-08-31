import { useJobsStore } from '../store/useJobsStore'

const KIND_LABEL: Record<string, string> = {
  pitch: 'Pitch shift',
  stems: 'Stem split',
  ytdl: 'YouTube download',
}

export function JobDock() {
  const jobs = useJobsStore((s) => s.jobs)
  const order = useJobsStore((s) => s.order)
  const cancel = useJobsStore((s) => s.cancel)
  const dismiss = useJobsStore((s) => s.dismiss)

  const active = order.map((id) => jobs[id]).filter(Boolean)
  if (active.length === 0) return null

  return (
    <div className="job-dock">
      {active.map((job) => (
        <div key={job.id} className={`job-row ${job.status}`}>
          <div className="job-head">
            <span className="job-kind">{KIND_LABEL[job.kind] ?? job.kind}</span>
            <span className="job-message">{job.message}</span>
            {job.status === 'running' || job.status === 'queued' ? (
              <button className="mini-btn" title="Cancel" onClick={() => void cancel(job.id)}>
                ✕
              </button>
            ) : (
              <button className="mini-btn" title="Dismiss" onClick={() => dismiss(job.id)}>
                ✕
              </button>
            )}
          </div>
          <div className="job-progress">
            {job.progress !== null && job.progress !== undefined ? (
              <div className="job-bar">
                <div className="job-bar-fill" style={{ width: `${job.progress}%` }} />
              </div>
            ) : job.status === 'running' ? (
              <div className="job-bar indeterminate">
                <div className="job-bar-fill" />
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
