import { create } from 'zustand'

import { api, ApiError, errMsg } from '../api/client'
import type { Job, JobKind } from '../api/types'
import { useProjectStore } from './useProjectStore'
import { pushToast } from './useToastStore'

interface JobsStore {
  jobs: Record<string, Job>
  order: string[]
  sources: Record<string, EventSource>
  track: (jobId: string, kind: JobKind, project: string) => void
  dismiss: (jobId: string) => void
  cancel: (jobId: string) => Promise<void>
  closeSource: (jobId: string) => void
}

interface Conn {
  ended: boolean
  healthTimer: number | null
}

const TERMINAL = new Set(['done', 'error', 'cancelled'])
const MAX_RECONNECT_ERRORS = 10
const HEALTH_POLL_MS = 5000

const conns = new Map<string, Conn>()

export const useJobsStore = create<JobsStore>((set, get) => ({
  jobs: {},
  order: [],
  sources: {},

  track: (jobId, kind, project) => {
    const stub: Job = {
      id: jobId,
      kind,
      project,
      track_index: -1,
      track_filename: '',
      status: 'queued',
      progress: null,
      message: '',
      error: '',
      added_tracks: [],
      created_at: Date.now() / 1000,
    }
    set((s) => ({
      jobs: { ...s.jobs, [jobId]: stub },
      order: s.order.includes(jobId) ? s.order : [jobId, ...s.order],
    }))
    const conn: Conn = { ended: false, healthTimer: null }
    conns.set(jobId, conn)
    let lastId = 0
    let errCount = 0

    const patch = (p: Partial<Job>) =>
      set((s) => {
        const job = s.jobs[jobId]
        if (!job) return s
        return { jobs: { ...s.jobs, [jobId]: { ...job, ...p } } }
      })

    const stop = () => {
      conn.ended = true
      if (conn.healthTimer !== null) {
        clearTimeout(conn.healthTimer)
        conn.healthTimer = null
      }
      get().closeSource(jobId)
    }

    const markLost = () => {
      stop()
      patch({ status: 'error', error: 'server restarted — job state unknown' })
      pushToast(`${kindLabel(kind)} lost: server restarted while it was running`, 'error')
    }

    const open = () => {
      if (conn.ended) return
      const q = lastId > 0 ? `?last_id=${lastId}` : ''
      const source = new EventSource(`/api/jobs/${jobId}/events${q}`)
      set((s) => ({ sources: { ...s.sources, [jobId]: source } }))
      attach(source)
    }

    const checkJobLost = async () => {
      try {
        await api.getJob(jobId)
        open()
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) markLost()
        else pollUntilHealthy()
      }
    }

    const pollUntilHealthy = () => {
      if (conn.ended || conn.healthTimer !== null) return
      conn.healthTimer = window.setTimeout(() => {
        conn.healthTimer = null
        void api.health().then(() => {
          errCount = 0
          open()
        }).catch(() => {
          pollUntilHealthy()
        })
      }, HEALTH_POLL_MS)
    }

    const attach = (source: EventSource) => {
      source.addEventListener('waiting', (e) => {
        const data = JSON.parse((e as MessageEvent).data) as { message?: string }
        patch({ message: data.message ?? '' })
      })
      source.addEventListener('progress', (e) => {
        lastId = Number((e as MessageEvent).lastEventId) || lastId
        const data = JSON.parse((e as MessageEvent).data) as { progress?: number | null; message?: string }
        patch({ status: 'running', progress: data.progress ?? null, message: data.message ?? '' })
      })
      source.addEventListener('done', (e) => {
        lastId = Number((e as MessageEvent).lastEventId) || lastId
        const data = JSON.parse((e as MessageEvent).data) as { added_tracks?: Job['added_tracks'] }
        patch({ status: 'done', added_tracks: data.added_tracks ?? [] })
        pushToast(`${kindLabel(kind)} finished`)
        const { projectName } = useProjectStore.getState()
        if (projectName === project) {
          void useProjectStore.getState().openProject(projectName)
        }
        stop()
        scheduleDismiss(jobId)
      })
      source.addEventListener('error', (e) => {
        lastId = Number((e as MessageEvent).lastEventId) || lastId
        const data = JSON.parse((e as MessageEvent).data) as { message?: string }
        const message = data.message ?? 'unknown error'
        patch({ status: 'error', error: message })
        console.error(`[job ${jobId}] ${kind} failed:`, message)
        pushToast(`${kindLabel(kind)} failed: ${message}`, 'error')
        stop()
      })
      source.addEventListener('cancelled', () => {
        patch({ status: 'cancelled' })
        pushToast(`${kindLabel(kind)} cancelled`)
        stop()
        scheduleDismiss(jobId)
      })
      source.onerror = () => {
        if (conn.ended) return
        const job = get().jobs[jobId]
        if (job && TERMINAL.has(job.status)) return
        errCount++
        if (source.readyState === EventSource.CLOSED) {
          void checkJobLost()
        } else if (errCount >= MAX_RECONNECT_ERRORS) {
          patch({ message: 'server unreachable — retrying…' })
          get().closeSource(jobId)
          pollUntilHealthy()
        } else if (errCount === 1) {
          patch({ message: 'connection lost — reconnecting…' })
        }
      }
    }

    open()
  },

  dismiss: (jobId) => {
    const conn = conns.get(jobId)
    if (conn) {
      conn.ended = true
      if (conn.healthTimer !== null) clearTimeout(conn.healthTimer)
      conns.delete(jobId)
    }
    get().closeSource(jobId)
    set((s) => ({
      jobs: Object.fromEntries(Object.entries(s.jobs).filter(([k]) => k !== jobId)),
      order: s.order.filter((k) => k !== jobId),
    }))
  },

  cancel: async (jobId) => {
    try {
      await api.cancelJob(jobId)
    } catch (e) {
      pushToast(errMsg(e), 'error')
    }
  },

  closeSource: (jobId) => {
    const source = get().sources[jobId]
    if (source) source.close()
    set((s) => ({
      sources: Object.fromEntries(Object.entries(s.sources).filter(([k]) => k !== jobId)),
    }))
  },
}))

function scheduleDismiss(jobId: string) {
  setTimeout(() => {
    useJobsStore.getState().dismiss(jobId)
  }, 6000)
}

function kindLabel(kind: JobKind): string {
  if (kind === 'pitch') return 'Pitch shift'
  if (kind === 'stems') return 'Stem split'
  if (kind === 'merge') return 'Merge tracks'
  return 'YouTube download'
}
