# Production setup — Linux server

Current production host: this Linux box (Ubuntu 26.04, x86_64, 16 cores, 61 GB RAM).
nginx listens on http://localhost:8000; uvicorn runs on a Unix socket. One TCP port.

```
localhost:8000 ──> nginx
                        ├── /            → web/dist (static)
                        ├── /media/      → server/data/projects/ (sendfile + Range)
                        └── /api/        → server/mutr.sock (uvicorn)
```

## Layout

| Path | Purpose |
|------|---------|
| `~/src/mutr-web` | app repo |
| `~/src/mutr_core` | shared core library, editable dep (`../../mutr_core` in `server/pyproject.toml`) |
| `server/data/projects/` | project media (multi-GB; never committed) |
| `server/mutr.sock` | uvicorn Unix socket (prod only) |
| `logs/` | uvicorn.log, vite.log, nginx.log |
| `nginx/logs/` | nginx access.log, error.log, nginx.pid |
| `~/.local/opt/rubberband` | user-local conda env: rubberband + ffmpeg/ffprobe |
| `~/.local/opt/mamba` | micromamba root prefix |

## Prerequisites

System packages (apt):

```bash
sudo apt-get update
sudo apt-get install -y nginx
```

- Node 20+, `uv`, `yt-dlp` must be on PATH.
- `rubberband` and `ffmpeg` are **not** installed system-wide; see below.
- Do **not** rely on `/snap/bin/ffmpeg`: its private `/tmp` hides job temp files from
  Python/rubberband, which breaks pitch-shift and stem jobs.

## User-local audio tools (no sudo)

Rubber Band and a usable ffmpeg live in a dedicated conda env, shadowing the snap ffmpeg
via PATH (`~/.local/bin` must come before `/snap/bin`; it does in the default shell).

```bash
# one-time: micromamba
curl -Ls https://micro.mamba.pm/api/micromamba/linux-64/latest -o /tmp/micromamba.tar.bz2
tar -xjf /tmp/micromamba.tar.bz2 -C ~/.local bin/micromamba

# one-time: env
export MAMBA_ROOT_PREFIX="$HOME/.local/opt/mamba"
~/.local/bin/micromamba create -y -p "$HOME/.local/opt/rubberband" \
    -c conda-forge rubberband ffmpeg

# symlinks into PATH
ln -sf "$HOME/.local/opt/rubberband/bin/rubberband" "$HOME/.local/bin/rubberband"
ln -sf "$HOME/.local/opt/rubberband/bin/ffmpeg"     "$HOME/.local/bin/ffmpeg"
ln -sf "$HOME/.local/opt/rubberband/bin/ffprobe"    "$HOME/.local/bin/ffprobe"

# verify
rubberband --version   # 4.0.0
ffmpeg -version        # 9.0.2, no "unable to open display" error
```

## Install / update

```bash
# first time
cd ~/src/mutr-web
./install.sh              # uv sync + npm install + production build

# after pulling
cd server && uv sync
cd ../web && npm install && npm run build
cd .. && ./run.sh stop && ./run.sh
```

## Run

```bash
./run.sh            # prod: nginx 127.0.0.1:8000 + uvicorn on server/mutr.sock
./run.sh dev        # dev: uvicorn :8000 --reload + vite :5173
./run.sh direct     # no nginx; uvicorn serves app + media on :8000
./run.sh stop       # stop all
```

Prod exposes one port, `127.0.0.1:8000` (nginx); uvicorn listens on `server/mutr.sock`.
The app is reachable only from this host.

## nginx

Config: `nginx/nginx.conf`, run with prefix `nginx/` (relative paths for pid/logs).

Relevant settings:

- `worker_processes auto`, `worker_connections 2048`
- `sendfile on`, `sendfile_max_chunk 256k` — media from disk in the kernel, fair across streams
- `open_file_cache` — avoids repeated stat/open for Range requests
- `location /media/` aliases `server/data/projects/`, nginx answers Range (206) directly
- `/api/` proxies to uvicorn's Unix socket with `proxy_buffering off` (SSE jobs stream correctly)
- On a different host, update the absolute `root` and `alias` paths.

Validate before starting:

```bash
nginx -t -c "$PWD/nginx/nginx.conf" -p "$PWD/nginx/"
```

## Verify

```bash
curl -s http://localhost:8000/api/health
# {"ok":true,"ffmpeg":true,"rubberband":true,"demucs":true,"ytdlp":true,...}

curl -sI -r 0-1023 "http://localhost:8000/media/<project>/<file>.wav" | grep -i content-range
# HTTP/1.1 206 Partial Content ... Content-Range: bytes 0-1023/<size>

ss -ltnp | grep ':8000'
# nginx on 127.0.0.1:8000 (uvicorn is on server/mutr.sock, not a port)
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `rubberband:false` in health | `~/.local/bin/rubberband` missing, or server PATH lacks `~/.local/bin` |
| Pitch/stem jobs fail with missing temp files | `/snap/bin/ffmpeg` is being used; re-check `which ffmpeg` → `~/.local/bin/ffmpeg` |
| `nginx: [emerg] open() /var/log/nginx/access.log` | config missing `access_log logs/access.log` or wrong `-p` prefix |
| `nginx -t` duplicate extension warning | extra `types` entries already present in `/etc/nginx/mime.types` |
| `:8000` unreachable from LAN | expected — loopback only; use http://localhost:8000 on this host |
| Stutter over the network | if LAN access is re-enabled, the server's 2.4 GHz WiFi (`wlo1`, AirGo2.4g) is the bottleneck; use Ethernet (`enp44s0`/`enp46s0`) or 5 GHz |

## Notes

- `deploy/` and `deploy.sh` still target the old macOS iMac (launchd, `/Users/vahan`,
  Homebrew). They are unused on this host.
- The apt `nginx` service on port 80 is the distro default and is unused; the app's nginx
  is a separate instance started by `run.sh`.
- No boot persistence yet. To survive reboots, add a systemd unit running `./run.sh`
  (and have `run.sh stop` invoked on shutdown).
- Media is stored as WAV (~40–48 MB per stem). Serving is fast, but the LAN link is the
  bottleneck on WiFi.
