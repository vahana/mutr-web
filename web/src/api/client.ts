import type { Job, Project, ProjectInfo, Track, Waveform } from './types'

const BASE = '/api'
const DEFAULT_TIMEOUT = 15_000
const UPLOAD_TIMEOUT = 300_000

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return String(e)
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      if (body.detail) detail = body.detail
    } catch {
      /* not json */
    }
    console.error(`[api] ${res.status} ${res.url} — ${detail}`)
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    let res: Response
    try {
      res = await fetch(`${BASE}${path}`, { ...init, signal: ctrl.signal })
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw new ApiError(0, 'request timed out')
      throw new ApiError(0, 'cannot reach server')
    }
    return await handle<T>(res)
  } finally {
    clearTimeout(timer)
  }
}

async function requestRaw(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(`${BASE}${path}`, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

export const api = {
  health: () => request<Record<string, unknown>>('/health', {}, 3000),

  listProjects: () => request<ProjectInfo[]>('/projects'),

  createProject: (name?: string) =>
    request<{ name: string; project: Project }>('/projects', json('POST', { name: name ?? null })),

  getProject: (name: string) =>
    request<Project>(`/projects/${encodeURIComponent(name)}`),

  updateProject: (name: string, project: Project) =>
    request<{ saved: boolean; project: Project }>(
      `/projects/${encodeURIComponent(name)}`,
      json('PUT', project),
    ),

  deleteProject: (name: string, deleteFiles = true) =>
    request<void>(
      `/projects/${encodeURIComponent(name)}?delete_files=${deleteFiles}`,
      { method: 'DELETE' },
    ),

  renameProject: (name: string, newName: string) =>
    request<{ name: string }>(
      `/projects/${encodeURIComponent(name)}/rename`,
      json('POST', { new_name: newName }),
    ),

  exportProject: (name: string) =>
    requestRaw(`/projects/${encodeURIComponent(name)}/export`),

  uploadTracks: (name: string, files: File[]) => {
    const fd = new FormData()
    for (const f of files) fd.append('files', f, f.name)
    return request<{ tracks: Track[]; waveforms: Record<string, Waveform> }>(
      `/projects/${encodeURIComponent(name)}/tracks/upload`,
      { method: 'POST', body: fd },
      UPLOAD_TIMEOUT,
    )
  },

  patchTrack: (name: string, idx: number, patch: Partial<Track>) =>
    request<Track>(`/projects/${encodeURIComponent(name)}/tracks/${idx}`, json('PATCH', patch)),

  deleteTrack: (name: string, idx: number, deleteFile: boolean) =>
    request<void>(
      `/projects/${encodeURIComponent(name)}/tracks/${idx}`,
      json('DELETE', { delete_file: deleteFile }),
    ),

  pitchTrack: (name: string, idx: number, semitones: number) =>
    request<{ job_id: string }>(
      `/projects/${encodeURIComponent(name)}/tracks/${idx}/pitch`,
      json('POST', { semitones }),
    ),

  stemsTrack: (name: string, idx: number, model: string, shifts: number) =>
    request<{ job_id: string }>(
      `/projects/${encodeURIComponent(name)}/tracks/${idx}/stems`,
      json('POST', { model, shifts }),
    ),

  ytdlTrack: (name: string, url: string, quality: number, audioOnly: boolean) =>
    request<{ job_id: string }>(
      `/projects/${encodeURIComponent(name)}/tracks/ytdl`,
      json('POST', { url, quality, audio_only: audioOnly }),
    ),

  getWaveform: (name: string, idx: number) =>
    request<Waveform>(`/projects/${encodeURIComponent(name)}/waveforms/${idx}`),

  mergeTracks: (name: string, indices: number[]) =>
    request<{ job_id: string }>(
      `/projects/${encodeURIComponent(name)}/tracks/merge`,
      json('POST', { indices }),
    ),

  deleteTracks: (name: string, indices: number[], deleteFiles: boolean) =>
    request<void>(
      `/projects/${encodeURIComponent(name)}/tracks/delete`,
      json('POST', { indices, delete_files: deleteFiles }),
    ),

  reorderTracks: (name: string, fromIndex: number, toIndex: number) =>
    request<void>(
      `/projects/${encodeURIComponent(name)}/tracks/reorder`,
      json('POST', { from_index: fromIndex, to_index: toIndex }),
    ),

  getJob: (jobId: string) => request<Job>(`/jobs/${jobId}`),

  cancelJob: (jobId: string) =>
    request<void>(`/jobs/${jobId}/cancel`, { method: 'POST' }),

  mediaUrl: (name: string, filename: string) =>
    `/media/${encodeURIComponent(name)}/${encodeURIComponent(filename)}`,

  exportUrl: (name: string) => `${BASE}/projects/${encodeURIComponent(name)}/export`,
}
