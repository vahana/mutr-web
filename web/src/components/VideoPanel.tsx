import { useEffect, useRef } from 'react'

import { engine } from '../audio/engine'
import { useProjectStore } from '../store/useProjectStore'

export function VideoPanel() {
  const expandedIdx = useProjectStore((s) => s.project?.expanded_video_track ?? -1)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const wanted = expandedIdx >= 0 ? engine.getElement(expandedIdx) : null
    for (const v of Array.from(panel.querySelectorAll('video'))) {
      if (v !== wanted) {
        engine.mediaContainer?.appendChild(v)
        v.className = 'media-el video'
        v.style.height = ''
      }
    }
    if (wanted && wanted.tagName === 'VIDEO') {
      panel.appendChild(wanted)
      wanted.className = 'media-el video video-visible'
      const saved = Math.max(100, Math.min(2000, Number(localStorage.getItem('mutr.video_height') ?? 480)))
      wanted.style.height = `${saved}px`
    }
  }, [expandedIdx])

  if (expandedIdx < 0) return null

  const startResize = (startClientY: number) => {
    const video = panelRef.current?.querySelector('video')
    if (!video) return
    const startH = video.clientHeight
    const onMove = (ev: Event) => {
      const y = ev instanceof TouchEvent
        ? (ev.touches[0]?.clientY ?? startClientY)
        : (ev as MouseEvent).clientY
      const h = Math.max(100, Math.min(2000, startH + (y - startClientY)))
      video.style.height = `${h}px`
      localStorage.setItem('mutr.video_height', String(h))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
      window.removeEventListener('touchcancel', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove)
    window.addEventListener('touchend', onUp)
    window.addEventListener('touchcancel', onUp)
  }

  return (
    <div className="video-panel" ref={panelRef}>
      <div
        className="resize-handle"
        onMouseDown={(e) => startResize(e.clientY)}
        onTouchStart={(e) => {
          const t = e.touches[0]
          if (t) startResize(t.clientY)
        }}
      />
    </div>
  )
}
