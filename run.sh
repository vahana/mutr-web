#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOGS="$ROOT/logs"
SOCK="$ROOT/server/mutr.sock"
MODE="${1:-prod}"

say() { printf "\033[0;36m==>\033[0m %s\n" "$1"; }
die() { printf "\033[0;31m  error\033[0m %s\n" "$1"; exit 1; }

stop_all() {
    pkill -f "uvicorn app.main:app" 2>/dev/null || true
    pkill -f "mutr-web/web/node_modules" 2>/dev/null || true
    sleep 0.5
    pkill -9 -f "uvicorn app.main:app" 2>/dev/null || true
    pkill -9 -f "mutr-web/web/node_modules" 2>/dev/null || true
    nginx -c "$ROOT/nginx/nginx.conf" -p "$ROOT/nginx/" -s stop 2>/dev/null || true
    rm -f "$SOCK"
}

start_uvicorn() {
    local host="${1:-0.0.0.0}"
    local extra="${2:-}"
    if curl -sf http://localhost:8000/api/health >/dev/null 2>&1; then
        say "backend already running on :8000"
        return
    fi
    mkdir -p "$LOGS"
    local keep_awake=()
    command -v caffeinate >/dev/null 2>&1 && keep_awake=(caffeinate -s)
    (cd "$ROOT/server" && exec nohup "${keep_awake[@]}" uv run uvicorn app.main:app --host "$host" --port 8000 $extra </dev/null >> "$LOGS/uvicorn.log" 2>&1) &
    disown
    for _ in $(seq 1 30); do
        curl -sf http://localhost:8000/api/health >/dev/null 2>&1 && {
            say "backend up: http://localhost:8000  (log: logs/uvicorn.log)"
            return
        }
        sleep 0.5
    done
    die "backend did not come up — check $LOGS/uvicorn.log"
}

start_backend_uds() {
    if [ -S "$SOCK" ] && curl -sf --unix-socket "$SOCK" http://localhost/api/health >/dev/null 2>&1; then
        say "backend already running on $SOCK"
        return
    fi
    mkdir -p "$LOGS"
    rm -f "$SOCK"
    local keep_awake=()
    command -v caffeinate >/dev/null 2>&1 && keep_awake=(caffeinate -s)
    (cd "$ROOT/server" && exec nohup "${keep_awake[@]}" uv run uvicorn app.main:app --uds "$SOCK" </dev/null >> "$LOGS/uvicorn.log" 2>&1) &
    disown
    for _ in $(seq 1 30); do
        curl -sf --unix-socket "$SOCK" http://localhost/api/health >/dev/null 2>&1 && {
            say "backend up on $SOCK"
            return
        }
        sleep 0.5
    done
    die "backend did not come up — check $LOGS/uvicorn.log"
}

start_vite() {
    if curl -sf http://localhost:5173/ >/dev/null 2>&1; then
        say "vite already running on :5173"
        return
    fi
    mkdir -p "$LOGS"
    (cd "$ROOT/web" && exec nohup npm run dev -- --host </dev/null >> "$LOGS/vite.log" 2>&1) &
    disown
    say "vite up: http://localhost:5173  (log: logs/vite.log)"
}

lan_ip() {
    if command -v ipconfig >/dev/null 2>&1; then
        ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "0.0.0.0"
    else
        hostname -I 2>/dev/null | awk '{print $1}'
    fi
}

start_nginx() {
    if curl -sf http://localhost:8000/api/health >/dev/null 2>&1; then
        say "nginx already running on :8000"
        return
    fi
    command -v nginx >/dev/null 2>&1 || die "nginx not installed"
    mkdir -p "$LOGS" "$ROOT/nginx/logs"
    nginx -c "$ROOT/nginx/nginx.conf" -p "$ROOT/nginx/" </dev/null >> "$LOGS/nginx.log" 2>&1 || die "nginx failed to start"
    say "nginx up: http://localhost:8000"
}

case "$MODE" in
    stop)
        stop_all
        say "stopped."
        ;;
    dev)
        start_uvicorn 0.0.0.0 --reload
        start_vite
        echo ""
        say "dev mode → http://localhost:5173"
        say "LAN      → http://$(lan_ip):5173"
        ;;
    direct)
        start_uvicorn
        echo ""
        say "direct mode → http://localhost:8000"
        say "LAN        → http://$(lan_ip):8000  (no nginx — BE serves app + media)"
        ;;
    prod | *)
        start_backend_uds
        start_nginx
        echo ""
        say "prod mode → http://localhost:8000  (loopback only, unix socket backend)"
        ;;
esac
