# mutr v2 — Product Spec

Draft product specification for mutr v2. Derived from the looper mock learnings (`looper-mock-spec.md`).
Status: working draft — open questions at the end.

## 1. Vision

mutr is a tool for working with music **by feel, not by waveform**. The wheel is the primary instrument:
navigation, fine-tuning, and editing happen through physical, continuous gestures rather than
pixel-precise waveform surgery. v2 extends the validated looper core into a full app: projects,
video, snapping, stems, and sharing.

Core bets:

1. **Wheel-first interaction** — every time-critical adjustment is reachable from the wheel. Mouse/keyboard/touch are secondary paths, never required.
2. **Looping is the unit of work** — the app is organized around segments, not waveforms. Markers define structure; everything else (playback, tuning, editing) hangs off that structure.
3. **One clear track at a time** — focus stays on a single track; complexity (stems, mixer, video) is layered without burying the primary flow.
4. **Persistence is invisible** — projects survive reloads, reloads survive devices. No save button.

## 2. Target users & use cases

- Musicians working out parts against a reference track (YouTube audio/video).
- Practitioners loop-slicing a song: intro/verse/chorus regions for rehearsal.
- Producers marking song structure and experimenting with arrangement.

Primary flows:

| Flow | Description |
|---|---|
| Load & loop | Import audio/video → drop markers at structural points → loop a segment, tune its boundaries by ear. |
| Practice against video | Import YouTube video → loop the section → video follows loop, audio stays in sync. |
| Sketch arrangement | Mark song structure → move markers (re-arrange) → export/share the result. |
| Mobile capture | Load a file on the phone → same wheel UX via touch. |

User stories (UX, implementation-independent): see [`user_stories.md`](user_stories.md).

## 3. Core concepts & mental model

- **Track** — one audio (or video) source with its own loop segments. v2 starts multi-track capable but the UI remains one-track-focused.
- **Markers** — named (optional) points on the timeline. They define segment boundaries.
- **Segments** — contiguous regions between `[0, ...markers, end]`. The active segment follows the playhead automatically; no explicit activation.
- **Wheel modes** — the wheel's behavior depends on context: free navigation, segment-latched scrub, boundary edge-tune, marker latch. Mode is visible through wheel color (red = wall hit, violet = tuning, default = nav).
- **Project** — a named collection of tracks + video + markers + settings. Auto-saved.

## 4. Functional areas

### 4.1 Project & file management

- Create / open / rename / delete projects.
- Import sources: local audio files, local video files, YouTube URLs.
- Multiple files per project: one active track + a video track; additional tracks listed, one active at a time.
- Project list with last-opened ordering and thumbnail.
- Export: project bundle (audio+markers+settings), marker data (JSON), mixed audio (stretch).
- Sharing: shareable link for a project (view/playback first; editing permissions later).

### 4.2 Audio engine

- Scheduling-based playback (no per-seek source restarts) — glitch-free, sample-accurate looping.
- Playback rates 0.5×/0.75×/1× (configurable set), pitch preserved.
- Master gain + per-track gain + mute/solo.
- Stems: upload separated stems per song (bass/drums/vocals/other); each stem mappable to a
  track lane with independent mute/solo/volume. Separation runs on the processing server
  (see §5 Architecture); the client downloads the results and caches them per source.
- Auditioning: one-shot short playback with decay envelope for tuning feedback (as in mock).

### 4.3 Video

- YouTube import: paste URL → song + video appear.
- Video panel: 16:9, toggleable.
- Video follows loop: when a segment loops, the video jumps with it, in sync.
- Video controls: show/hide, mute (independent of track audio when stems exist), fullscreen.
- Offline: imported video plays after first import.

### 4.4 Looper (markers & segments)

- Mark at playhead (min-distance rule), move markers via wheel (edge tune + latch), delete
  individually or clear all with confirmation.
- Marker persistence per project.
- Beat detection / snapping:
  - On import, the app learns the beat grid and keeps it per track.
  - Snap modes: off / snap to beats / snap to bars.
  - Marking and marker movement snap when enabled; manual wheel fine-tune overrides snap
    when snap is off (or via a snap toggle).
- Loop behavior: wrap inside active segment; min segment duration guard; fall-through for
  degenerate regions.
- Segment operations: nudge start/end, duplicate segment, set loop count (N× then advance),
  jump-to-segment.

### 4.5 Wheel & navigation

Preserved from the mock, extended:

| Context | Behavior |
|---|---|
| Free nav | 1.5 s/rev scrub + velocity boost |
| Segment latched | Clamp to segment; wall hit = red flash; hold 350 ms = edge tune |
| Edge tune | 0.75 s/rev boundary movement, audition ticks, spin-inward exits |
| Latch (marker armed) | Wheel moves armed marker; release jumps playback to marker |
| Zoomed waveform (new) | Wheel zooms/scales waveform when zoom mode active |

Grab semantics: grabbing pauses playback, releasing resumes if it was playing.

### 4.6 Strip & waveform

- Tap = jump (play state untouched). Drag = scrub.
- Marker hover = resize cursor; click = latch (wheel takes over).
- Waveform: peak-based rendering, light/dark themes, no pixel hunting required.
- Zoom levels: overview strip + optional zoomed detail view (wheel-driven zoom).
- No marker creation or dragging on the strip — markers are created at the playhead (Mark) and
  moved via the wheel only.

### 4.7 Keyboard & shortcuts

Mock set (Space, M, arrows, Shift+arrows, Esc) plus:
- `L` loop toggle, `1`/`2`/`3` rate presets, `[`/`]` prev/next segment, `S` snap toggle,
  `Z` undo (marker ops only), `?` shortcut overlay.

### 4.8 State & data model

- Project: id, name, createdAt, updatedAt, sources, tracks, markers per track, settings.
- Track: id, source, kind (audio/video/stem), gain, mute, solo, markers, beat grid.
- Marker: time, label?, segment metadata (color, name, loop count).
- Snap metadata: grid type (beat/bar), per-track offsets.
- All state auto-saved locally + synced when signed in.

### 4.9 Persistence & sync

- Local-first: everything saved automatically, survives restarts and reloads.
- All media files (audio, video, stems) live on the client device — the server holds no
  authoritative copies (see §5 Architecture).
- Optional account sync across devices.
- Conflict strategy: last-write-wins per project with a per-device change log (simple first).

### 4.10 Platforms

- Web app (desktop + mobile browsers), responsive single column.
- Native macOS + iOS apps (see §5 Architecture) — same core, platform shells.
- Touch parity: wheel gestures, strip tap/drag, platform-appropriate file pickers.

## 5. Architecture — client-first, server as processing sidecar

Principles:

- **Client owns the data.** All project files — audio, video, stems, markers, settings — live on
  the client device. The server never holds authoritative copies.
- **Server is stateless processing.** Used only for jobs the client can't (or shouldn't) do:
  YouTube download, stem separation, pitch shift, volume normalize/increase.
- **Offline by default.** Import, looping, markers, and playback work with no server at all.
  Server calls are optional enhancements.

Processing flows:

| Operation | Direction |
|---|---|
| Local file import | No server — decoded on client |
| YouTube import | URL → server downloads → client fetches audio+video → stored locally |
| Stem split | Source uploaded → server separates → client downloads stems |
| Pitch shift / volume | File → server processes → client downloads result |

Storage:

- Web: IndexedDB (+ OPFS for large media).
- Native (macOS/iOS): app sandbox document storage.

Code shape:

- One core (mutr_core) powers all targets. Web = thin shell; native = macOS/iOS SwiftUI shells.
- The client is fully functional without the server; server-only features degrade to
  "unavailable offline", not to a broken app.

## 6. UX principles

1. **One gesture deep** — every common action reachable within one grab/tap.
2. **Mode is visible** — wheel color/state communicates mode at all times.
3. **Never punish a pause** — grabbing always returns to the previous playback state.
4. **Structure over pixels** — encourage marker-based structure; discourage freehand waveform editing.
5. **Instant restore** — open the app and the last project plays, no picker.
6. **Discoverable by doing** — colors and sounds are the manual; no onboarding wall.

## 7. Non-functional requirements

- Audio latency: loop wrap glitch-free at all rates.
- Import performance: waveform + beat grid ready within ~2s of decode for 10-min tracks.
- Offline-capable: full app works without network after initial load/import.
- Accessibility: keyboard reachable for every action; visible focus states; readout legible.

## 8. Milestones

| Phase | Scope |
|---|---|
| M1 — Project shell | Project list, create/open, persistence, track import, glitch-free playback |
| M2 — Looper parity | Markers + segments + wheel modes from mock, marker persistence, beat grid + snapping |
| M3 — Video | YouTube import, video panel, loop-synced playback |
| M4 — Stems & mixer | Stem separation, per-stem lanes, mixer panel |
| M5 — Sharing & export | Share links, comments on markers, export bundles/JSON, polish |

## 9. Open questions

1. Backend choice — self-hosted vs cloud; YouTube import handling (user-provided URLs, ToS).
2. Stem separation: model choice, queue limits, cost budget.
3. Multi-track UI: how many simultaneous lanes before the one-track focus breaks?
4. Undo scope: markers only, or full history (time-travel)?
5. Accounts: required for sharing, or link-based anonymous sharing?
6. Export formats beyond JSON/mixdown (MIDI markers, stems zip)?
7. Video looping: loop video visually, or freeze frame while audio loops?
8. Zoom UX: is a zoomed waveform detail view needed, or does wheel fine-tune cover it?
