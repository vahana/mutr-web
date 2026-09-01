import { create } from 'zustand'

import { api, errMsg } from '../api/client'
import type { Project, ProjectInfo, Track, Waveform } from '../api/types'
import { pushToast } from './useToastStore'

export const ALLOWED_EXTS = new Set([
  '.mp4', '.mkv', '.mov', '.avi', '.webm',
  '.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg',
])

interface ProjectStore {
  project: Project | null
  projectName: string | null
  recents: ProjectInfo[]
  waveforms: Record<string, Waveform>
  loading: boolean
  refreshRecents: () => Promise<void>
  createProject: (name?: string) => Promise<void>
  openProject: (name: string) => Promise<void>
  save: () => Promise<void>
  saveAs: (name: string) => Promise<void>
  close: () => void
  removeProject: (name: string, deleteFiles?: boolean) => Promise<void>
  patchTrack: (idx: number, patch: { volume?: number; muted?: boolean; name?: string }) => Promise<void>
  addFiles: (files: File[]) => Promise<void>
  removeTrack: (idx: number, deleteFile: boolean) => Promise<void>
  setProject: (mutator: (p: Project) => Project) => void
  fetchWaveform: (idx: number) => Promise<void>
  soloIdx: number
  setSolo: (idx: number) => void
  controlsCollapsed: boolean
  toggleControls: () => void
  selection: number[]
  toggleSelect: (idx: number) => void
  clearSelection: () => void
  reorder: (from: number, to: number) => Promise<void>
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  projectName: null,
  recents: [],
  waveforms: {},
  loading: false,

  refreshRecents: async () => {
    try {
      set({ recents: await api.listProjects() })
    } catch (e) {
      pushToast(errMsg(e), 'error')
    }
  },

  createProject: async (name) => {
    set({ loading: true })
    try {
      const res = await api.createProject(name)
      set({ projectName: res.name, project: res.project, waveforms: {} })
      await get().refreshRecents()
    } catch (e) {
      pushToast(errMsg(e), 'error')
    } finally {
      set({ loading: false })
    }
  },

  openProject: async (name) => {
    set({ loading: true })
    try {
      const project = await api.getProject(name)
      set({ projectName: name, project, waveforms: {}, selection: [] })
      const fetchWaveform = get().fetchWaveform
      await Promise.all(project.tracks.map((_, i) => fetchWaveform(i).catch(() => {})))
    } catch (e) {
      pushToast(errMsg(e), 'error')
    } finally {
      set({ loading: false })
    }
  },

  save: async () => {
    const { project, projectName } = get()
    if (!project || !projectName) return
    try {
      const res = await api.updateProject(projectName, project)
      set({ project: res.project })
    } catch (e) {
      pushToast(errMsg(e), 'error')
    }
  },

  saveAs: async (name) => {
    const { projectName } = get()
    if (!projectName) return
    try {
      const res = await api.renameProject(projectName, name)
      set({ projectName: res.name })
      await get().save()
      await get().refreshRecents()
    } catch (e) {
      pushToast(errMsg(e), 'error')
    }
  },

  close: () => set({ project: null, projectName: null, waveforms: {}, selection: [] }),

  removeProject: async (name, deleteFiles = true) => {
    try {
      await api.deleteProject(name, deleteFiles)
      if (get().projectName === name) {
        set({ project: null, projectName: null, waveforms: {} })
      }
      await get().refreshRecents()
    } catch (e) {
      pushToast(errMsg(e), 'error')
    }
  },

  patchTrack: async (idx, patch) => {
    const { project, projectName } = get()
    if (!project || !projectName) return
    const prev = project
    const tracks = project.tracks.map((t, i) => (i === idx ? { ...t, ...patch } : t))
    set({ project: { ...project, tracks } })
    try {
      const updated = await api.patchTrack(projectName, idx, patch)
      set((s) => {
        if (!s.project) return {}
        const tracks2 = s.project.tracks.map((t, i) => (i === idx ? updated : t))
        return { project: { ...s.project, tracks: tracks2 } }
      })
      await get().save()
      if (patch.name) await get().fetchWaveform(idx)
    } catch (e) {
      set({ project: prev })
      pushToast(errMsg(e), 'error')
    }
  },

  addFiles: async (files) => {
    const { project, projectName } = get()
    if (!project || !projectName) return
    try {
      const res = await api.uploadTracks(projectName, files)
      set((s) => ({
        project: s.project ? { ...s.project, tracks: [...s.project.tracks, ...res.tracks] } : null,
        waveforms: { ...s.waveforms, ...res.waveforms },
      }))
      await get().save()
      await get().refreshRecents()
    } catch (e) {
      pushToast(errMsg(e), 'error')
    }
  },

  removeTrack: async (idx, deleteFile) => {
    const { project, projectName } = get()
    if (!project || !projectName) return
    try {
      await api.deleteTrack(projectName, idx, deleteFile)
      set((s) => ({
        project: s.project
          ? { ...s.project, tracks: s.project.tracks.filter((_, i) => i !== idx) }
          : null,
      }))
      await get().save()
    } catch (e) {
      pushToast(errMsg(e), 'error')
    }
  },

  setProject: (mutator) => {
    const { project } = get()
    if (!project) return
    set({ project: mutator(project) })
  },

  fetchWaveform: async (idx) => {
    const { project, projectName } = get()
    if (!project || !projectName || idx >= project.tracks.length) return
    const file = project.tracks[idx].file
    try {
      const w = await api.getWaveform(projectName, idx)
      set((s) => ({ waveforms: { ...s.waveforms, [file]: w } }))
    } catch {
      /* track file may not exist yet */
    }
  },

  soloIdx: -1,
  setSolo: (idx) => {
    const { soloIdx } = get()
    set({ soloIdx: soloIdx === idx ? -1 : idx })
  },

  controlsCollapsed: localStorage.getItem('mutr.controls_collapsed') === '1',
  toggleControls: () => {
    const next = !get().controlsCollapsed
    localStorage.setItem('mutr.controls_collapsed', next ? '1' : '0')
    set({ controlsCollapsed: next })
  },

  selection: [],
  toggleSelect: (idx) => {
    const { selection } = get()
    const next = selection.includes(idx)
      ? selection.filter((i) => i !== idx)
      : [...selection, idx].sort((a, b) => a - b)
    set({ selection: next })
  },
  clearSelection: () => set({ selection: [] }),

  reorder: async (from, to) => {
    const { project, projectName, selection } = get()
    if (!project || !projectName || from === to) return
    const tracks = [...project.tracks]
    const [t] = tracks.splice(from, 1)
    tracks.splice(to, 0, t)
    const remap = (i: number) => {
      if (i === from) return to
      if (from < to && i > from && i <= to) return i - 1
      if (from > to && i >= to && i < from) return i + 1
      return i
    }
    set({
      project: {
        ...project,
        tracks,
        expanded_video_track:
          project.expanded_video_track >= 0 ? remap(project.expanded_video_track) : -1,
      },
      selection: selection.map(remap),
    })
    try {
      await api.reorderTracks(projectName, from, to)
    } catch (e) {
      pushToast(errMsg(e), 'error')
      await get().openProject(projectName)
    }
  },
}))

export function trackLabel(t: Track): string {
  return t.name
}
