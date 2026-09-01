import { useState } from 'react'

import { api, errMsg } from '../api/client'
import { useJobsStore } from '../store/useJobsStore'
import { useProjectStore } from '../store/useProjectStore'
import { pushToast } from '../store/useToastStore'
import { ConfirmDialog } from './dialogs/ConfirmDialog'
import { LooperRow } from './LooperRow'
import { TrackRow } from './TrackRow'

export function TrackList() {
  const tracks = useProjectStore((s) => s.project?.tracks ?? [])
  const projectName = useProjectStore((s) => s.projectName)
  const selection = useProjectStore((s) => s.selection)
  const clearSelection = useProjectStore((s) => s.clearSelection)
  const openProject = useProjectStore((s) => s.openProject)
  const trackJob = useJobsStore((s) => s.track)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const doMerge = async () => {
    if (!projectName || selection.length < 2) return
    try {
      const res = await api.mergeTracks(projectName, selection)
      trackJob(res.job_id, 'merge', projectName)
      clearSelection()
    } catch (e) {
      pushToast(errMsg(e), 'error')
    }
  }

  const doDelete = async (deleteFiles: boolean) => {
    if (!projectName) return
    setDeleteOpen(false)
    try {
      await api.deleteTracks(projectName, selection, deleteFiles)
      clearSelection()
      await openProject(projectName)
    } catch (e) {
      pushToast(errMsg(e), 'error')
    }
  }

  return (
    <div className={`track-list ${tracks.length === 0 ? 'empty' : ''}`}>
      {selection.length > 0 && (
        <div className="selection-bar">
          <span className="selection-count">{selection.length} selected</span>
          <button className="text-btn" disabled={selection.length < 2} onClick={() => void doMerge()}>
            Merge
          </button>
          <button className="text-btn danger" onClick={() => setDeleteOpen(true)}>
            Delete
          </button>
          <button className="text-btn" onClick={clearSelection}>
            ✕
          </button>
        </div>
      )}
      <LooperRow />
      {tracks.length === 0 ? (
        <div className="track-list-hint">
          <p>No tracks yet.</p>
          <p>Drag &amp; drop audio or video files here to add them.</p>
        </div>
      ) : (
        tracks.map((t, i) => <TrackRow key={`${i}-${t.file}`} index={i} track={t} />)
      )}
      {deleteOpen && (
        <ConfirmDialog
          title="Delete Tracks"
          message={`Delete ${selection.length} selected tracks? Delete only the tracks, or also delete their files from disk?`}
          confirmLabel="Delete Tracks Only"
          secondLabel="Delete Tracks && Files"
          onConfirm={() => void doDelete(false)}
          onSecond={() => void doDelete(true)}
          onCancel={() => setDeleteOpen(false)}
        />
      )}
    </div>
  )
}
