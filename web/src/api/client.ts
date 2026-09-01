import type { Job, Project, ProjectInfo, Track, Waveform } from './types'

const BASE = '/api'

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

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

export const api = {
  listProjects: () => fetch(`${BASE}/projects`).then(handle<ProjectInfo[]>),

  createProject: (name?: string) =>
    fetch(`${BASE}/projects`, json('POST', { name: name ?? null })).then(
      handle<{ name: string; project: Project }>,
    ),

  getProject: (name: string) =>
    fetch(`${BASE}/projects/${encodeURIComponent(name)}`).then(handle<Project>),

  updateProject: (name: string, project: Project) =>
    fetch(`${BASE}/projects/${encodeURIComponent(name)}`, json('PUT', project)).then(
      handle<{ saved: boolean; project: Project }>,
    ),

  deleteProject: (name: string, deleteFiles = true) =>
    fetch(
      `${BASE}/projects/${encodeURIComponent(name)}?delete_files=${deleteFiles}`,
      { method: 'DELETE' },
    ).then(handle<void>),

  renameProject: (name: string, newName: string) =>
    fetch(`${BASE}/projects/${encodeURIComponent(name)}/rename`, json('POST', { new_name: newName })).then(
      handle<{ name: string }>,
    ),

  exportProject: (name: string) =>
    fetch(`${BASE}/projects/${encodeURIComponent(name)}/export`),

  uploadTracks: (name: string, files: File[]) => {
    const fd = new FormData()
    for (const f of files) fd.append('files', f, f.name)
    return fetch(`${BASE}/projects/${encodeURIComponent(name)}/tracks/upload`, {
      method: 'POST',
      body: fd,
    }).then(handle<{ tracks: Track[]; waveforms: Record<string, Waveform> }>)
  },

  patchTrack: (name: string, idx: number, patch: Partial<Track>) =>
    fetch(`${BASE}/projects/${encodeURIComponent(name)}/tracks/${idx}`, json('PATCH', patch)).then(
      handle<Track>,
    ),

  deleteTrack: (name: string, idx: number, deleteFile: boolean) =>
    fetch(
      `${BASE}/projects/${encodeURIComponent(name)}/tracks/${idx}`,
      json('DELETE', { delete_file: deleteFile }),
    ).then(handle<void>),

  pitchTrack: (name: string, idx: number, semitones: number) =>
    fetch(
      `${BASE}/projects/${encodeURIComponent(name)}/tracks/${idx}/pitch`,
      json('POST', { semitones }),
    ).then(handle<{ job_id: string }>),

  stemsTrack: (name: string, idx: number, model: string, shifts: number) =>
    fetch(
      `${BASE}/projects/${encodeURIComponent(name)}/tracks/${idx}/stems`,
      json('POST', { model, shifts }),
    ).then(handle<{ job_id: string }>),

  ytdlTrack: (name: string, url: string, quality: number, audioOnly: boolean) =>
    fetch(
      `${BASE}/projects/${encodeURIComponent(name)}/tracks/ytdl`,
      json('POST', { url, quality, audio_only: audioOnly }),
    ).then(handle<{ job_id: string }>),

  getWaveform: (name: string, idx: number) =>
    fetch(`${BASE}/projects/${encodeURIComponent(name)}/waveforms/${idx}`).then(handle<Waveform>),

  mergeTracks: (name: string, indices: number[]) =>
    fetch(
      `${BASE}/projects/${encodeURIComponent(name)}/tracks/merge`,
      json('POST', { indices }),
    ).then(handle<{ job_id: string }>),

  deleteTracks: (name: string, indices: number[], deleteFiles: boolean) =>
    fetch(
      `${BASE}/projects/${encodeURIComponent(name)}/tracks/delete`,
      json('POST', { indices, delete_files: deleteFiles }),
    ).then(handle<void>),

  reorderTracks: (name: string, fromIndex: number, toIndex: number) =>
    fetch(
      `${BASE}/projects/${encodeURIComponent(name)}/tracks/reorder`,
      json('POST', { from_index: fromIndex, to_index: toIndex }),
    ).then(handle<void>),

  getJob: (jobId: string) => fetch(`${BASE}/jobs/${jobId}`).then(handle<Job>),

  cancelJob: (jobId: string) =>
    fetch(`${BASE}/jobs/${jobId}/cancel`, { method: 'POST' }).then(handle<void>),

  mediaUrl: (name: string, filename: string) =>
    `/media/${encodeURIComponent(name)}/${encodeURIComponent(filename)}`,

  exportUrl: (name: string) => `${BASE}/projects/${encodeURIComponent(name)}/export`,
}
