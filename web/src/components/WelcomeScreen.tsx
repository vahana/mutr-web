import { useEffect } from 'react'

import { useProjectStore } from '../store/useProjectStore'

export function WelcomeScreen() {
  const recents = useProjectStore((s) => s.recents)
  const loading = useProjectStore((s) => s.loading)
  const refreshRecents = useProjectStore((s) => s.refreshRecents)
  const createProject = useProjectStore((s) => s.createProject)
  const openProject = useProjectStore((s) => s.openProject)
  const removeProject = useProjectStore((s) => s.removeProject)

  useEffect(() => {
    void refreshRecents()
  }, [refreshRecents])

  return (
    <div className="welcome">
      <h1 className="welcome-title">mutr</h1>
      <div className="welcome-grid">
        {recents.map((p) => (
          <button
            key={p.name}
            className="welcome-btn"
            onClick={() => void openProject(p.name)}
            onContextMenu={(e) => {
              e.preventDefault()
              if (window.confirm(`Delete project "${p.name}"?`)) void removeProject(p.name)
            }}
            title={`${p.track_count} track${p.track_count === 1 ? '' : 's'} — right-click to delete`}
          >
            <span className="welcome-btn-name">{p.name}</span>
            <span className="welcome-btn-meta">{p.track_count} tracks</span>
          </button>
        ))}
        <button className="welcome-btn new" disabled={loading} onClick={() => void createProject()}>
          + New Project
        </button>
      </div>
      {loading && <p className="welcome-loading">Loading…</p>}
    </div>
  )
}
