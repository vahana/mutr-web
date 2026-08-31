# mutr-web

Web version of [mutr](https://github.com/../mutr), the music practice app for learning and transcribing songs by ear.

- **BE**: FastAPI + shared [mutr_core](../mutr_core) library. Stores projects in `server/data/projects/<name>/` using the exact desktop `.mutrproj` schema — projects are interchangeable with the desktop app.
- **FE**: React 18 + Vite + TypeScript. All desktop functionality: multi-track synced playback, waveforms, loop markers/segments, solo/mute/volume/speed, pitch shift, stem split, video, YouTube downloads.

## Requirements

- Python 3.13+ with [uv](https://docs.astral.sh/uv/)
- Node 20+
- ffmpeg, rubberband (pitch shift), yt-dlp (YouTube downloads)
- demucs runs on demand via `uv run --with demucs` (first run downloads the model)

```bash
brew install ffmpeg rubberband yt-dlp
```

## Run

```bash
./run.sh          # prod: backend + nginx → http://localhost:8001
./run.sh dev      # dev: backend --reload + vite HMR → http://localhost:5173
./run.sh stop     # stop everything
```

First time only: `./install.sh` (uv sync + npm install + build).

## Development (manual)

```bash
# terminal 1 — backend on :8000
cd server
uv run uvicorn app.main:app --port 8000 --reload

# terminal 2 — frontend on :5173 (proxies /api + /media to :8000)
cd web
npm run dev
```

Open http://localhost:5173.

## Production (single origin)

```bash
cd web && npm run build
cd ../server && uv run uvicorn app.main:app --port 8000
```

Open http://localhost:8000 — the BE serves the built frontend.

## Production with nginx (recommended for media)

nginx serves media straight from disk with `sendfile` + native Range support — Python never touches media bytes.

```bash
brew install nginx
nginx -c "$(pwd)/nginx/nginx.conf" -p "$(pwd)/nginx/"
```

- nginx on **:8001**: FE static (`web/dist`), `/media/*` from `server/data/projects/` (native Range), `/api/*` proxied to uvicorn on :8000
- `nginx/nginx.conf` contains absolute paths — adjust if the repo moves
- Stop: `nginx -c ... -p ... -s stop`

## Tests

```bash
cd server && uv run pytest          # BE (includes ffmpeg-dependent integration tests)
cd ../mutr_core && uv run pytest    # shared library
```

## Desktop compatibility

The web BE stores projects in the desktop `.mutrproj` format:

- **Web → desktop**: `Export` downloads a zip of the project folder; unzip into `~/.mutr/projects/` and open in the desktop app.
- **Desktop → web**: copy a project folder from `~/.mutr/projects/` into `server/data/projects/`; it appears in the web welcome screen.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| Space | Play / Pause |
| L | Toggle loop |
| ← → | Seek ±1s |
| ↑ ↓ | Jump between loop segments |
| D | Delete nearest marker |
| V | Toggle video (first video track) |
| C | Collapse controls panel |
| Cmd+S | Save |
| Double-click waveform | (rename track) |
| Click waveform | Seek |
| Double-click loop bar | Add marker (snaps to second) |
| Drag marker | Move marker |
| Double-click marker | Remove marker |

## Known limitations

- iOS Safari ignores `playbackRate` below ~0.5 (speed 10–50% won't slow down there).
- Safari cannot play `.mkv/.avi/.flac/.ogg` — tracks show a ⚠ warning.
- Server restart loses in-flight job state (jobs run locally, progress UI shows an error on reconnect).
