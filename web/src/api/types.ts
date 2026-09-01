export interface Track {
  name: string
  file: string
  source_file: string
  volume: number
  muted: boolean
  pitch_baked: number
  color: [number, number, number]
}

export interface Project {
  version: number
  tracks: Track[]
  markers: number[]
  active_segment: number
  loop_enabled: boolean
  speed: number
  master_volume: number
  position_ms: number
  expanded_video_track: number
}

export interface ProjectInfo {
  name: string
  mtime: number
  track_count: number
}

export interface Waveform {
  peaks: number[]
  duration_ms: number | null
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'
export type JobKind = 'pitch' | 'stems' | 'ytdl' | 'merge'

export interface Job {
  id: string
  kind: JobKind
  project: string
  track_index: number
  track_filename: string
  status: JobStatus
  progress: number | null
  message: string
  error: string
  added_tracks: Track[]
  created_at: number
}

export interface JobEvent {
  id: number
  event: string
  data: Record<string, unknown>
}
