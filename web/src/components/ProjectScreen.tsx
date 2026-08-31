import { useRef, useState } from 'react'

import { useAudioEngine } from '../audio/useAudioEngine'
import { useProjectStore } from '../store/useProjectStore'
import { ConfirmDialog } from './dialogs/ConfirmDialog'
import { YtdlDialog } from './dialogs/YtdlDialog'
import { DropZone } from './DropZone'
import { JobDock } from './JobDock'
import { TrackList } from './TrackList'
import { TransportBar } from './TransportBar'
import { VideoPanel } from './VideoPanel'

export function ProjectScreen() {
  const projectName = useProjectStore((s) => s.projectName)
  const project = useProjectStore((s) => s.project)
  const save = useProjectStore((s) => s.save)
  const close = useProjectStore((s) => s.close)
  const removeProject = useProjectStore((s) => s.removeProject)
  const controlsCollapsed = useProjectStore((s) => s.controlsCollapsed)
  const toggleControls = useProjectStore((s) => s.toggleControls)
  const mediaContainerRef = useRef<HTMLDivElement>(null)
  const [ytdlOpen, setYtdlOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  useAudioEngine(mediaContainerRef)

  if (!projectName || !project) return null

  return (
    <div className={`project ${controlsCollapsed ? 'controls-collapsed' : ''}`}>
      <div className="topbar">
        <button className="icon-btn" title="Save (Cmd+S)" onClick={() => void save()}>
          💾
        </button>
        <a
          className="icon-btn"
          href={`/api/projects/${encodeURIComponent(projectName)}/export`}
          download={`${projectName}.zip`}
          title="Export project as zip"
        >
          ⬇
        </a>
        <button className="icon-btn" title="Download from YouTube" onClick={() => setYtdlOpen(true)}>
          📺
        </button>
        <span className="spacer" />
        <span className="project-name">{projectName}</span>
        <span className="spacer" />
        <button className="icon-btn" title="Collapse controls (C)" onClick={toggleControls}>
          {controlsCollapsed ? '◀' : '▶'}
        </button>
        <button className="icon-btn" title="Close project" onClick={close}>
          ✕
        </button>
        <button className="icon-btn danger" title="Delete project" onClick={() => setDeleteOpen(true)}>
          🗑
        </button>
      </div>
      <TrackList />
      <VideoPanel />
      <TransportBar />
      <JobDock />
      <DropZone />
      <div ref={mediaContainerRef} className="media-container" />
      {ytdlOpen && <YtdlDialog onClose={() => setYtdlOpen(false)} />}
      {deleteOpen && (
        <ConfirmDialog
          title="Delete Project"
          message={`Delete "${projectName}"? Delete only the project, or also delete all track files from disk?`}
          confirmLabel="Delete Project Only"
          secondLabel="Delete Project && Files"
          onConfirm={() => {
            setDeleteOpen(false)
            void removeProject(projectName, false)
          }}
          onSecond={() => {
            setDeleteOpen(false)
            void removeProject(projectName, true)
          }}
          onCancel={() => setDeleteOpen(false)}
        />
      )}
    </div>
  )
}
