import { api } from '../api/client'
import type { Track } from '../api/types'
import { getSegmentBounds } from '../lib/segments'

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm'])

type Listener = () => void

function extOf(file: string): string {
  return `.${file.split('.').pop()?.toLowerCase() ?? ''}`
}

export class AudioEngine {
  private container: HTMLDivElement | null = null
  private elements: HTMLMediaElement[] = []
  private tracks: Track[] = []
  private projectName = ''
  private master: HTMLMediaElement | null = null
  private _playing = false
  private _positionMs = 0
  private _durationMs = 0
  private _speed = 100
  private _masterVolume = 80
  private soloIdx = -1
  private markers: number[] = []
  private activeSegment = -1
  private loopEnabled = false
  private listeners = new Set<Listener>()
  private raf = 0
  private lastRafPos = 0
  private lastDriftCheck = 0
  private pendingSeek: number | null = null
  private pendingSeeks: (number | null)[] = []

  attach(container: HTMLDivElement) {
    this.container = container
  }

  get mediaContainer(): HTMLDivElement | null {
    return this.container
  }

  load(projectName: string, tracks: Track[], positionMs: number, speed: number, masterVolume: number) {
    this.teardown()
    this.projectName = projectName
    this.tracks = tracks
    this._positionMs = positionMs
    this._speed = speed
    this._masterVolume = masterVolume
    this.pendingSeek = positionMs > 0 ? positionMs : null
    if (!this.container || tracks.length === 0) {
      this.emit()
      return
    }
    for (const t of tracks) {
      const isVideo = VIDEO_EXTS.has(extOf(t.file))
      const el = document.createElement(isVideo ? 'video' : 'audio')
      el.className = isVideo ? 'media-el video' : 'media-el'
      el.preload = 'auto'
      if (isVideo) el.setAttribute('playsinline', '')
      const idx = this.elements.length
      if (idx === 0 || !t.muted) {
        el.src = api.mediaUrl(projectName, t.file)
      }
      this.container.appendChild(el)
      this.elements.push(el)
    }
    this.pendingSeeks = this.elements.map(() => (positionMs > 0 ? positionMs / 1000 : null))
    this.master = this.elements[0] ?? null
    if (this.master) {
      this.master.addEventListener('timeupdate', this.onTimeupdate)
      this.master.addEventListener('ended', this.onEnded)
      this.master.addEventListener('loadedmetadata', this.onLoadedMetadata)
    }
    this.elements.forEach((el, i) => {
      el.addEventListener('loadedmetadata', () => this.applyPendingSeek(i))
      el.addEventListener('canplay', () => this.applyPendingSeek(i))
    })
    this.applyTrackStates()
    this.applySpeed()
    this.raf = requestAnimationFrame(this.loop)
    this.emit()
  }

  clear() {
    this.teardown()
    this.tracks = []
    this._positionMs = 0
    this.emit()
  }

  private teardown() {
    cancelAnimationFrame(this.raf)
    if (this.master) {
      this.master.removeEventListener('timeupdate', this.onTimeupdate)
      this.master.removeEventListener('ended', this.onEnded)
      this.master.removeEventListener('loadedmetadata', this.onLoadedMetadata)
    }
    for (const el of this.elements) {
      el.pause()
      el.removeAttribute('src')
      el.load()
      el.remove()
    }
    this.elements = []
    this.master = null
    this._playing = false
    this._durationMs = 0
  }

  private emit() {
    for (const l of this.listeners) l()
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  get isPlaying() {
    return this._playing
  }

  getPositionMs() {
    return this._positionMs
  }

  getDurationMs() {
    return this._durationMs
  }

  getElement(idx: number): HTMLMediaElement | null {
    return this.elements[idx] ?? null
  }

  async play() {
    if (!this.master || this._playing || this.elements.length === 0) return
    const pos = this._positionMs / 1000
    this.elements.forEach((el, i) => this.trySeek(el, i, pos))
    this._playing = true
    this.emit()
    const results = await Promise.allSettled(this.elements.map((el) => el.play()))
    if (results[0]?.status === 'rejected') {
      this._playing = false
      for (const el of this.elements) el.pause()
    }
    this.emit()
  }

  pause() {
    if (!this._playing) return
    for (const el of this.elements) el.pause()
    this._playing = false
    this.syncPosition()
    this.emit()
  }

  stop() {
    for (const el of this.elements) el.pause()
    this._playing = false
    this.seekAll(0)
    this.emit()
  }

  seekAll(ms: number) {
    if (!this.master) {
      this.pendingSeek = ms
      return
    }
    const max = this._durationMs > 0 ? this._durationMs : Number.MAX_SAFE_INTEGER
    const clamped = Math.max(0, Math.min(ms, max))
    this._positionMs = clamped
    const t = clamped / 1000
    this.elements.forEach((el, i) => this.trySeek(el, i, t))
    this.emit()
  }

  private trySeek(el: HTMLMediaElement, i: number, t: number) {
    try {
      if (el.readyState >= 1) {
        el.currentTime = t
        this.pendingSeeks[i] = null
      } else {
        this.pendingSeeks[i] = t
      }
    } catch {
      this.pendingSeeks[i] = t
    }
  }

  private applyPendingSeek(i: number) {
    const el = this.elements[i]
    const t = this.pendingSeeks[i]
    if (!el || t === null || t === undefined) return
    try {
      if (el.readyState >= 1) {
        el.currentTime = t
        this.pendingSeeks[i] = null
      }
    } catch {
      /* retry on next canplay */
    }
  }

  seekRatio(ratio: number, fallbackMs?: number) {
    const dur = this._durationMs > 0 ? this._durationMs : (fallbackMs ?? 0)
    if (dur <= 0) return
    this.seekAll(ratio * dur)
  }

  setSpeed(v: number) {
    this._speed = v
    this.applySpeed()
    this.emit()
  }

  setMasterVolume(v: number) {
    this._masterVolume = v
    this.applyTrackStates()
  }

  setTrackStates(tracks: Track[], soloIdx: number) {
    this.tracks = tracks
    this.soloIdx = soloIdx
    this.applyTrackStates()
    this.syncStreaming()
  }

  private syncStreaming() {
    const anySolo = this.soloIdx >= 0
    for (let i = 1; i < this.elements.length; i++) {
      const el = this.elements[i]
      const t = this.tracks[i]
      if (!t) continue
      const isVideoEl = el instanceof HTMLVideoElement
      const want = isVideoEl ? true : anySolo ? i === this.soloIdx : !t.muted
      const has = !!el.src
      if (want && !has) {
        el.src = api.mediaUrl(this.projectName, t.file)
        this.pendingSeeks[i] = this._positionMs / 1000
        if (this._playing) void el.play().catch(() => {})
      } else if (!want && has) {
        el.removeAttribute('src')
        el.load()
      }
    }
  }

  setLoop(markers: number[], activeSegment: number, loopEnabled: boolean) {
    this.markers = markers
    this.activeSegment = activeSegment
    this.loopEnabled = loopEnabled
  }

  private syncPosition() {
    if (this.master && this.master.readyState >= 1) {
      this._positionMs = this.master.currentTime * 1000
    }
  }

  private applySpeed() {
    const rate = this._speed / 100
    for (const el of this.elements) el.playbackRate = rate
  }

  private applyTrackStates() {
    const anySolo = this.soloIdx >= 0
    this.elements.forEach((el, i) => {
      const t = this.tracks[i]
      if (!t) return
      el.muted = anySolo ? i !== this.soloIdx : t.muted
      el.volume = Math.min(1, t.volume * (this._masterVolume / 100))
    })
  }

  private onTimeupdate = () => {
    this.syncPosition()
    if (this.master && isFinite(this.master.duration) && this.master.duration > 0) {
      this._durationMs = this.master.duration * 1000
    }
    this.emit()
  }

  private onLoadedMetadata = () => {
    const master = this.master
    if (!master) return
    if (isFinite(master.duration) && master.duration > 0) {
      this._durationMs = master.duration * 1000
    }
    if (this.pendingSeek !== null && this.pendingSeek > 0) {
      const ms = this.pendingSeek
      this.pendingSeek = null
      this.seekAll(ms)
    }
    this.emit()
  }

  private onEnded = () => {
    if (this.loopEnabled && this._durationMs > 0) {
      const bounds = getSegmentBounds(this.markers, this._durationMs, this.activeSegment)
      this.seekAll(bounds ? bounds[0] : 0)
      void this.master?.play()
    } else {
      this.stop()
    }
  }

  private isBufferedAt(el: HTMLMediaElement, t: number): boolean {
    try {
      for (let i = 0; i < el.buffered.length; i++) {
        if (el.buffered.start(i) <= t && t <= el.buffered.end(i)) return true
      }
    } catch {
      return false
    }
    return false
  }

  private snapDrift() {
    if (!this.master || !this._playing || this.master.readyState < 1) return
    const masterT = this.master.currentTime
    for (let i = 1; i < this.elements.length; i++) {
      const el = this.elements[i]
      if (el.readyState < 1 || el.ended || el.paused) continue
      if (Math.abs(el.currentTime - masterT) > 0.35 && this.isBufferedAt(el, masterT)) {
        el.currentTime = masterT
      }
    }
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    if (!this.master) return
    const now = performance.now()
    if (now - this.lastRafPos >= 40) {
      this.lastRafPos = now
      this.syncPosition()
    }
    if (this.loopEnabled && this._playing && this._durationMs > 0) {
      const bounds = getSegmentBounds(this.markers, this._durationMs, this.activeSegment)
      if (bounds && this._positionMs >= bounds[1]) {
        this.seekAll(bounds[0])
      }
    }
    if (now - this.lastDriftCheck >= 1000) {
      this.lastDriftCheck = now
      this.snapDrift()
    }
  }
}

export const engine = new AudioEngine()

declare global {
  interface Window {
    __engine: AudioEngine
  }
}

if (typeof window !== 'undefined') {
  window.__engine = engine
}
