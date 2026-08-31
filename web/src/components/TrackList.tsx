import { useProjectStore } from '../store/useProjectStore'
import { LooperRow } from './LooperRow'
import { TrackRow } from './TrackRow'

export function TrackList() {
  const tracks = useProjectStore((s) => s.project?.tracks ?? [])

  return (
    <div className={`track-list ${tracks.length === 0 ? 'empty' : ''}`}>
      <LooperRow />
      {tracks.length === 0 ? (
        <div className="track-list-hint">
          <p>No tracks yet.</p>
          <p>Drag &amp; drop audio or video files here to add them.</p>
        </div>
      ) : (
        tracks.map((t, i) => <TrackRow key={`${i}-${t.file}`} index={i} track={t} />)
      )}
    </div>
  )
}
