import { create } from 'zustand'

import { api, errMsg } from '../api/client'
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

const TERMINAL = new Set(['done', 'error', 'cancelled'])

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
      created_at: Date.now(),
    }
    set((s) => ({
      jobs: { ...s.jobs, [jobId]: stub },
      order: s.order.includes(jobId) ? s.order : [jobId, ...s.order],
    }))
    const source = new EventSource(`/api/jobs/${jobId}/events`)
    set((s) => ({ sources: { ...s.sources, [jobId]: source } }))

    const patch = (p: Partial<Job>) =>
      set((s) => ({
        jobs: { ...s.jobs, [jobId]: { ...(s.jobs[jobId] ?? stub), ...p } },
      }))

    source.addEventListener('progress', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { progress?: number | null; message?: string }
      patch({ status: 'running', progress: data.progress ?? null, message: data.message ?? '' })
    })
    source.addEventListener('done', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { added_tracks?: Job['added_tracks'] }
      patch({ status: 'done', added_tracks: data.added_tracks ?? [] })
      pushToast(`${kindLabel(kind)} finished`)
      const { projectName } = useProjectStore.getState()
      if (projectName === project) {
        void useProjectStore.getState().openProject(projectName)
      }
      scheduleDismiss(jobId)
    })
    source.addEventListener('error', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { message?: string }
      const message = data.message ?? 'unknown error'
      patch({ status: 'error', error: message })
      console.error(`[job ${jobId}] ${kind} failed:`, message)
      pushToast(`${kindLabel(kind)} failed: ${message}`, 'error')
    })
    source.addEventListener('cancelled', () => {
      patch({ status: 'cancelled' })
      pushToast(`${kindLabel(kind)} cancelled`)
      scheduleDismiss(jobId)
    })
    source.onerror = () => {
      const job = get().jobs[jobId]
      if (job && !TERMINAL.has(job.status)) {
        patch({ status: 'error', error: 'connection lost — job state unknown' })
        console.error(`[job ${jobId}] SSE connection lost`)
        pushToast(`Job ${jobId}: lost connection to server`, 'error')
      }
      get().closeSource(jobId)
    }
  },

  dismiss: (jobId) => {
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
  return 'YouTube download'
}
