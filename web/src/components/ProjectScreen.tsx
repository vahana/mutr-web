import { useRef, useState } from 'react'

import { useAudioEngine } from '../audio/useAudioEngine'
import { useProjectStore } from '../store/useProjectStore'
import { ConfirmDialog } from './dialogs/ConfirmDialog'
import { PromptDialog } from './dialogs/PromptDialog'
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
  const saveAs = useProjectStore((s) => s.saveAs)
  const namePromptOpen = useProjectStore((s) => s.namePromptOpen)
  const openNamePrompt = useProjectStore((s) => s.openNamePrompt)
  const closeNamePrompt = useProjectStore((s) => s.closeNamePrompt)
  const close = useProjectStore((s) => s.close)
  const removeProject = useProjectStore((s) => s.removeProject)
  const controlsCollapsed = useProjectStore((s) => s.controlsCollapsed)
  const toggleControls = useProjectStore((s) => s.toggleControls)
  const mediaContainerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addFiles = useProjectStore((s) => s.addFiles)
  const [ytdlOpen, setYtdlOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  useAudioEngine(mediaContainerRef)

  if (!projectName || !project) return null

  return (
    <div className={`project ${controlsCollapsed ? 'controls-collapsed' : ''}`}>
      <div className="topbar">
        <button className="icon-btn" title="Save (Cmd+S)" onClick={openNamePrompt}>
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
        <button
          className="icon-btn"
          title="Add Track"
          onClick={() => fileInputRef.current?.click()}
        >
          📁
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          accept=".mp4,.mkv,.mov,.avi,.webm,.mp3,.wav,.flac,.aac,.m4a,.ogg"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) void addFiles(files)
            e.target.value = ''
          }}
        />
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
      {namePromptOpen && (
        <PromptDialog
          title="Save Project"
          initial={projectName}
          confirmLabel="Save"
          onConfirm={(name) => {
            closeNamePrompt()
            if (name === projectName) void save()
            else void saveAs(name)
          }}
          onCancel={closeNamePrompt}
        />
      )}
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
