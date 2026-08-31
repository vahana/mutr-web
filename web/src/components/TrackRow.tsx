import { useEffect, useRef, useState } from 'react'

import { engine } from '../audio/engine'
import type { Track } from '../api/types'
import { useProjectStore } from '../store/useProjectStore'
import { ConfirmDialog } from './dialogs/ConfirmDialog'
import { PitchDialog } from './dialogs/PitchDialog'
import { StemDialog } from './dialogs/StemDialog'
import { WaveformCanvas } from './WaveformCanvas'

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm'])

interface Props {
  index: number
  track: Track
}

const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`

function isVideoFile(file: string): boolean {
  return VIDEO_EXTS.has(`.${file.split('.').pop()?.toLowerCase() ?? ''}`)
}

export function TrackRow({ index, track }: Props) {
  const waveform = useProjectStore((s) => s.waveforms[track.file])
  const patchTrack = useProjectStore((s) => s.patchTrack)
  const removeTrack = useProjectStore((s) => s.removeTrack)
  const soloIdx = useProjectStore((s) => s.soloIdx)
  const setSolo = useProjectStore((s) => s.setSolo)
  const setProject = useProjectStore((s) => s.setProject)
  const save = useProjectStore((s) => s.save)
  const expandedVideo = useProjectStore((s) => s.project?.expanded_video_track ?? -1)
  const [renaming, setRenaming] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuUp, setMenuUp] = useState(true)
  const [dialog, setDialog] = useState<'pitch' | 'stems' | 'remove' | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const isVideo = isVideoFile(track.file)
  const solo = soloIdx === index
  const safariBlockedExt = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    && /\.(mkv|avi|flac|ogg)$/i.test(track.file)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const finishRename = (value: string) => {
    setRenaming(false)
    const name = value.trim()
    if (name && name !== track.name) patchTrack(index, { name })
  }

  const toggleVideo = () => {
    setProject((p) => ({ ...p, expanded_video_track: expandedVideo === index ? -1 : index }))
    void save()
  }

  return (
    <div className="track-row">
      <div className="track-left">
        <div className="track-controls">
          <span className="swatch" style={{ background: rgb(track.color) }} />
          {renaming ? (
            <input
              className="track-name-input"
              autoFocus
              defaultValue={track.name}
              onBlur={(e) => finishRename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finishRename((e.target as HTMLInputElement).value)
                if (e.key === 'Escape') setRenaming(false)
              }}
            />
          ) : (
            <span
              className="track-name"
              onDoubleClick={() => setRenaming(true)}
              title="Double-click to rename"
            >
              {track.name}
            </span>
          )}
          <WaveformCanvas
            waveform={waveform}
            color={rgb(track.color)}
            getPlayhead={() => {
              const dur = engine.getDurationMs() || waveform?.duration_ms || 0
              if (dur <= 0) return null
              return Math.max(0, Math.min(1, engine.getPositionMs() / dur))
            }}
            onSeek={(ratio) => engine.seekRatio(ratio, waveform?.duration_ms ?? undefined)}
          />
        </div>
      </div>
      <div className="track-panel">
        {safariBlockedExt && (
          <span className="codec-warn" title="This format may not play in Safari (mkv/avi/flac/ogg)">
            ⚠
          </span>
        )}
        {isVideo && (
          <button
            className={`mini-btn ${expandedVideo === index ? 'on' : ''}`}
            title="Toggle video (V)"
            onClick={toggleVideo}
          >
            👁
          </button>
        )}
        <button
          className={`mini-btn ${solo ? 'on-solo' : ''}`}
          title="Solo"
          onClick={() => setSolo(index)}
        >
          S
        </button>
        <button
          className={`mini-btn ${track.muted ? 'on' : ''}`}
          title="Mute"
          onClick={() => patchTrack(index, { muted: !track.muted })}
        >
          M
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(track.volume * 100)}
          title="Volume"
          onChange={(e) => patchTrack(index, { volume: Number(e.target.value) / 100 })}
        />
        <span className="vol-label">{Math.round(track.volume * 100)}%</span>
        <div className="gear-wrap" ref={menuRef}>
          <button
            className="mini-btn"
            title="Track actions"
            onClick={(e) => {
              const btn = e.currentTarget
              if (!menuOpen) {
                const rect = btn.getBoundingClientRect()
                const list = btn.closest('.track-list')?.getBoundingClientRect()
                const spaceAbove = list ? rect.top - list.top : rect.top
                setMenuUp(spaceAbove > 140)
              }
              setMenuOpen(!menuOpen)
            }}
          >
            ⚙
          </button>
          {menuOpen && (
            <div className={`gear-menu ${menuUp ? 'up' : 'down'}`}>
              <button onClick={() => { setMenuOpen(false); setDialog('pitch') }}>
                Pitch Shift…
              </button>
              <button onClick={() => { setMenuOpen(false); setDialog('stems') }}>
                Split Stems…
              </button>
              <button className="danger-item" onClick={() => { setMenuOpen(false); setDialog('remove') }}>
                Remove Track
              </button>
            </div>
          )}
        </div>
      </div>
      {dialog === 'pitch' && (
        <PitchDialog trackIndex={index} trackName={track.name} onClose={() => setDialog(null)} />
      )}
      {dialog === 'stems' && (
        <StemDialog trackIndex={index} trackName={track.name} onClose={() => setDialog(null)} />
      )}
      {dialog === 'remove' && (
        <ConfirmDialog
          title="Remove Track"
          message={`Remove "${track.name}"? Remove only the track, or also delete the file from disk?`}
          confirmLabel="Remove Only"
          secondLabel="Remove && Delete File"
          onConfirm={() => {
            setDialog(null)
            void removeTrack(index, false)
          }}
          onSecond={() => {
            setDialog(null)
            void removeTrack(index, true)
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  )
}
