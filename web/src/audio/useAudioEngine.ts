import { useEffect, type RefObject } from 'react'

import { api } from '../api/client'
import type { Project } from '../api/types'
import { getSegmentBounds, nearestMarker } from '../lib/segments'
import { useProjectStore } from '../store/useProjectStore'
import { engine } from './engine'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

export function useAudioEngine(containerRef: RefObject<HTMLDivElement>) {
  const project = useProjectStore((s) => s.project)
  const projectName = useProjectStore((s) => s.projectName)
  const soloIdx = useProjectStore((s) => s.soloIdx)

  useEffect(() => {
    if (containerRef.current) engine.attach(containerRef.current)
  }, [containerRef])

  const filesKey = project?.tracks.map((t) => t.file).join('|') ?? ''
  useEffect(() => {
    if (!project || !projectName) {
      engine.clear()
      return
    }
    engine.load(
      projectName,
      project.tracks,
      project.position_ms,
      project.speed,
      project.master_volume,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey, projectName])

  useEffect(() => {
    if (!project) return
    engine.setLoop(project.markers, project.active_segment, project.loop_enabled)
  }, [project?.markers, project?.active_segment, project?.loop_enabled])

  useEffect(() => {
    engine.setSpeed(project?.speed ?? 100)
  }, [project?.speed])

  useEffect(() => {
    engine.setMasterVolume(project?.master_volume ?? 80)
  }, [project?.master_volume])

  useEffect(() => {
    engine.setTrackStates(project?.tracks ?? [], soloIdx)
  }, [project?.tracks, soloIdx])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsub = engine.subscribe(() => {
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        const { project: p, projectName: pn } = useProjectStore.getState()
        if (!p || !pn) return
        void api.updateProject(pn, { ...p, position_ms: engine.getPositionMs() })
      }, 2000)
    })
    return unsub
  }, [])

  useEffect(() => {
    const flush = () => {
      const { project: p, projectName: pn } = useProjectStore.getState()
      if (!p || !pn) return
      void fetch(`/api/projects/${encodeURIComponent(pn)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...p, position_ms: engine.getPositionMs() }),
        keepalive: true,
      })
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      const { project: p, projectName: pn, setProject, save } = useProjectStore.getState()
      if (!p || !pn) return
      switch (e.key) {
        case ' ':
          e.preventDefault()
          if (engine.isPlaying) engine.pause()
          else void engine.play()
          break
        case 'ArrowLeft':
          e.preventDefault()
          engine.seekAll(engine.getPositionMs() - 1000)
          break
        case 'ArrowRight':
          e.preventDefault()
          engine.seekAll(engine.getPositionMs() + 1000)
          break
        case 'ArrowUp':
          e.preventDefault()
          segmentStep(p, -1)
          break
        case 'ArrowDown':
          e.preventDefault()
          segmentStep(p, 1)
          break
        case 'l':
        case 'L':
          setProject((proj) => ({ ...proj, loop_enabled: !proj.loop_enabled }))
          void save()
          break
        case 'd':
        case 'D':
          if (p.markers.length === 0) break
          {
            const pos = engine.getPositionMs()
            const dur = engine.getDurationMs()
            const idx = nearestMarker(p.markers, pos, dur > 0 ? dur : Infinity)
            if (idx !== null) {
              const markers = p.markers.filter((_, i) => i !== idx)
              setProject((proj) => ({
                ...proj,
                markers,
                active_segment: Math.min(proj.active_segment, markers.length),
              }))
              void save()
            }
          }
          break
        case 'v':
        case 'V':
          toggleVideo(p)
          break
        case 'c':
        case 'C':
          useProjectStore.getState().toggleControls()
          break
        case 's':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            void save()
          }
          break
      }
    }

    function toggleVideo(p: Project) {
      const { setProject, save } = useProjectStore.getState()
      if (p.expanded_video_track >= 0) {
        setProject((proj) => ({ ...proj, expanded_video_track: -1 }))
        void save()
        return
      }
      const idx = p.tracks.findIndex((t) => {
        const ext = `.${t.file.split('.').pop()?.toLowerCase() ?? ''}`
        return ['.mp4', '.mkv', '.mov', '.avi', '.webm'].includes(ext)
      })
      if (idx >= 0) {
        setProject((proj) => ({ ...proj, expanded_video_track: idx }))
        void save()
      }
    }

    function segmentStep(p: Project, delta: number) {
      const total = engine.getDurationMs()
      if (total <= 0 || p.markers.length === 0) return
      const nSegs = p.markers.length + 1
      let cur = Math.max(0, p.active_segment)
      if (delta < 0) {
        const pos = engine.getPositionMs()
        const all = [0, ...p.markers, total]
        cur = Math.max(0, all.length - 2)
        for (let i = 0; i < all.length - 1; i++) {
          if (all[i] <= pos && pos < all[i + 1]) {
            cur = i
            break
          }
        }
        cur = pos - all[cur] > 1000 ? cur : Math.max(0, cur - 1)
      } else {
        cur = Math.max(0, Math.min(nSegs - 1, cur + 1))
        if (cur === p.active_segment) return
      }
      const bounds = getSegmentBounds(p.markers, total, cur)
      if (!bounds) return
      useProjectStore.getState().setProject((proj) => ({ ...proj, active_segment: cur }))
      void useProjectStore.getState().save()
      engine.seekAll(bounds[0])
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
