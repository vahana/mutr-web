# Looper Mock — Full Spec

Interactive UI prototype for mutr v2. Single HTML file: `design/looper-mock-v2.html` (test harness: `design/wave-test.html`).
Real audio via Web Audio API, no build step, works in any modern browser (desktop + iOS Safari/Brave).

## Purpose

Validate the v2 UX before touching mutr-web / mutr_core:

- One track, one strip. No multi-track lanes, no waveform-centric editing.
- Wheel (jog) is the primary navigation + fine-tuning instrument.
- Looper segments are the core feature; markers define segment boundaries.
- Track interactions position playback only.

## Layout (top → bottom)

1. **Header** — title, filename + duration, Video on/off toggle.
2. **Video panel** — 16:9 placeholder, show/hide toggle. In v2 this hosts the YouTube-imported video.
3. **Load audio** — styled button with an invisible file-input overlay covering it (native picker opens on tap/click everywhere). Desktop also accepts drag-drop anywhere on page.
4. **Transport panel**
   - Readout: `m:ss.t / total` in JetBrains Mono.
   - **Wheel**: jog control. Ring + rotating dot + center play/pause button.
   - Controls: Mark, Loop toggle, Clear marks.
   - Rate: 0.5× / 0.75× / 1× playback speed, pitch preserved.
5. **Strip** — the looper track: waveform + segment blocks + marker lines + playhead. Full width, ~56px tall.

Dark scheme throughout. Single column, responsive: works on desktop and iPhone (safe-area padding, touch-action none on wheel/strip, no user-select).

## Audio engine

- File → `file.arrayBuffer()` → `ctx.decodeAudioData` → `AudioBuffer`.
- **Critical**: `decodeAudioData` detaches its input ArrayBuffer. Any copy needed later (IndexedDB persistence) must be made (`ab.slice(0)`) before decode.
- Playback = one `AudioBufferSourceNode`, restarted at new offset on every seek (start/stop model).
- `preservesPitch = true` — rate change slows down without pitch drop.
- `currentT()` = `srcOffset + (ctx.currentTime - srcStartCtx) * rate`.
- `audition(x)` — one-shot 0.25s slice with 0.18s decay envelope, used for tune feedback while paused.
- `frame()` — rAF loop: advances playhead, loop wrap, readout + playhead rendering. Errors caught, never kills the loop.

### Waveform

- Peaks precomputed on load: 1000 buckets, max-abs across all channels, full-bucket scan (every sample read once).
- Drawn once per resize on a canvas under the strip layer.
- Scaled: `h = min(H-6, max(1.5, peak * (H-6) * 1.4))` — linear, 1.4× headroom.
- Bars drawn at integer device-pixel positions (`Math.floor` x/y, `Math.ceil` width/height) — fractional fillRect coordinates cause browser-specific rasterization artifacts (dropped bars / false gaps in Firefox).
- Color token `--wave`: `#fde047`.

### Persistence

- Audio file stored in IndexedDB (`looperMock` / store `files` / key `lastAudio`) on load.
- Store the pre-decode copy of the ArrayBuffer (see detach caveat above).
- Auto-restored on page open — no picker needed. Markers are NOT persisted (known gap).
- Restore accepts raw ArrayBuffer, Blob, or wrapped shapes; failures are surfaced in the UI status line.

## Core state

| State | Meaning |
|---|---|
| `t` | Playhead position (s) |
| `playing` | Playback running |
| `rate` | Playback speed (0.5 / 0.75 / 1) |
| `loopOn` | Looper active |
| `markers` | Array of boundary times (s) |
| `activeSeg` | Region index containing playhead (auto) |
| `mode` | `nav` (free) / `seg` (latched to segment) / `edge` (wheel push-through tune) / `latch` (marker armed from strip) |
| `SONG` | Audio duration (s) |
| `latchIdx` | Armed marker index while in latch mode (else -1) |

**Segments** = contiguous regions between `[0, ...sorted markers, SONG]`.
N markers → N+1 regions. Moving a boundary resizes both neighbors live.

**Auto-activation** — the segment containing the playhead is the active one. No explicit activation gesture. Green block + wheel latch follow the playhead.

## Interactions

### Playback

- Wheel center tap or `Space` — play/pause toggle.
- Rate buttons — change `playbackRate`; while playing, source restarts at current position.
- Loop wrap: at active region end → restart at region start (guard: region ≥ 0.05s; smaller regions fall through into the next). Loop OFF → stop at song end.

### Wheel

Context-dependent. **Grab while playing → playback pauses; release → resumes if it was playing.** Grab while paused → stays paused.
Wheel motion never changes playback state on its own — only the grab/resume rule above.

| Context | Behavior |
|---|---|
| Loop OFF (or no markers) | Free scrub, 1.5s per revolution. Velocity boost: `min(1 + v·0.18, 6)` — fast spin jumps farther. |
| Loop ON, inside segment | Scrub clamped to segment bounds. **Hitting a wall** (start/end marker): whole wheel flashes red (`wheelhit` + radial wash, retriggers per push), dot turns red. |
| Wall hold > 350ms | Push-through into **edge tune**: dot violet, 0.75s/rev, moves the boundary, audible audition every 0.04s of movement. Spinning back inward resumes scrubbing. |
| No markers at boundary (0 / SONG) | Wall flashes but no tune mode. |
| Latch mode (marker armed) | Violet wheel + dot (latch signal). Wheel motion moves the armed marker, 0.75s/rev, audition every 0.04s of movement. On wheel release — if the marker moved — playback jumps to the armed marker's position. |

Wheel modes:
- `nav` — loop OFF or no markers. Free scrub with velocity boost.
- `seg` — loop ON with markers. Clamped scrub, wall detection, push-through to `edge`.
- `edge` — transient, lives only during a grab. Exits on inward spin, release, or Escape.
- `latch` — persistent across grabs; entered from the strip, exits only via track click, Escape, loop OFF, clear, or file load.

### Strip (track)

- **Tap** — jump playback to that position. Playback state untouched: playing continues from new spot, paused just moves.
- **Drag** — scrub: position follows pointer, thresholded source restarts (0.06s), silent when paused.
- **Marker hover** (loop ON, desktop) — pointer within ~10px of a marker line turns into a resize (slider) cursor.
- **Marker click** (loop ON) — clicking on or within ~10px of a marker line enters **latch mode**: that marker is armed, wheel turns violet as latch signal.
- **Latch exit** — clicking anywhere on the track (away from the armed marker) or `Escape` turns off fine tune mode.
- Otherwise that is all. No marker creation or marker dragging on the strip.

### Markers & segments

- **Mark** button / `M` — insert marker at current playhead (min distance from existing: 0.1s).
- **Clear marks** — with a latched marker (loop ON): deletes only that marker. Otherwise: confirmation warning first, then removes all markers.
- Marker lines render as vertical 2px lines (violet when being tuned — edge tune or latch).
- Blocks (loop ON only): one per region, hue cycles `(i·47 + 200)°`, active region green inset border.
- Loop OFF: blocks and activation visuals hidden; only waveform + marker lines + playhead remain.

### Keyboard

| Key | Action |
|---|---|
| `Space` | Play/pause |
| `M` | Mark at playhead |
| `←` / `→` | Nudge 0.1s (forced jump) |
| `Shift` + arrows | Nudge 1s |
| `Escape` | Exit edge tune / latch mode |

## Seek rules

`seek(x, audible, force)`:

- `force` (tap, arrows, latch-release jump) — always jumps; bypasses segment clamp and throttle.
- Non-force (wheel, drag) — jumps only when ≥ 0.06s from previous jump (anti-restart-storm).
- While playing: jump = source restart (playback continues). While paused: silent move (`audible=false`) or one-shot audition (`audible=true`).
- Segment clamp applies in `seg` mode for non-forced seeks.

## Tunable constants

| Constant | Value | Where |
|---|---|---|
| Nav wheel range | 1.5 s/rev | wheel nav |
| Boost | `min(1 + v·0.18, 6)` | velocity sensitivity |
| Edge tune range | 0.75 s/rev | wall push-through |
| Latch wheel range | 0.75 s/rev | marker latch from strip |
| Marker hit zone | 10 px | marker hover / click on strip |
| Wall hold to tune | 350 ms | `clampHold` |
| Jump throttle | 0.06 s | `seek` |
| Tune audition throttle | 0.04 s | wheel edge / latch |
| Marker min distance | 0.1 s | `insertMarker` |
| Marker neighbor clamp | 0.05 s | `moveMarker` |
| Wave buckets | 1000 | `PEAKS_N` |
| Wave scale | `peak · 1.4` | `drawWave` |
| Loop min region | 0.05 s | `frame` |

## Visual language

- Background near-black with subtle radial gradient; panels with 1px borders, rounded corners.
- Accent green (`#34d399`) = active segment / loop ON state.
- Violet (`#a78bfa`) = fine-tune modes (edge tune + latch): wheel ring, dot, tuned marker line.
- Red (`#f87171`) = wall hit: ring border, radial wash flash, dot.
- Yellow (`#fde047`) = waveform.
- JetBrains Mono readout.
- Marker lines 2px `#8b96ad`; playhead 2px white (dimmed gray when paused).

## Mobile / iOS

- File picker: overlay input pattern (native input covers the button, opacity 0) — `display:none` inputs and label-forwarding both fail on iOS Safari.
- Audio must be plain files in the Files app (Music app songs are DRM-locked).
- AudioContext unlocked on first pointerdown; wheel/strip use pointer events with capture.
- `touch-action: none` on wheel and strip; safe-area insets respected.

## Known gaps (deliberate, for v2 planning)

- Markers not persisted (only audio file).
- No beat detection / snapping — fine-tuning is manual via wheel.
- No stems / separation / mixer yet.
- Video panel is a placeholder; real video playback + hide/mute/solo pending.
- No multi-file project concept, no sharing.
- Restart-based playback has small discontinuities on seek (acceptable for mock; v2 should evaluate scheduling-based playback).
- Drag-drop is desktop only.

## Serving

```bash
cd design && python3 serve.py   # python http.server with Cache-Control: no-store
```

- Desktop: http://localhost:8123/looper-mock-v2.html
- Phone (same Wi-Fi): http://<mac-lan-ip>:8123/looper-mock-v2.html
- Waveform test harness: http://localhost:8123/wave-test.html

Requires proper viewport + `<!DOCTYPE html>` (present) for mobile rendering.
