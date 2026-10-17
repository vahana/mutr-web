#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="${1:-imac.local}"
DEST="$HOME/mutr-web"
COREDEST="$HOME/mutr_core"
LABEL="com.vahan.mutr-web"
PLIST_SRC="$ROOT/deploy/$LABEL.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"

say() { printf "\033[0;36m==>\033[0m %s\n" "$1"; }
die() { printf "\033[0;31m  error\033[0m %s\n" "$1"; exit 1; }

say "building FE..."
(cd "$ROOT/web" && npm run build)

say "syncing mutr_core → $HOST:$COREDEST"
rsync -az --delete --exclude '.venv' --exclude '__pycache__' \
    "$ROOT/../mutr_core/" "$HOST:$COREDEST/"

say "syncing mutr-web → $HOST:$DEST"
rsync -az --delete \
    --exclude '.venv' --exclude '__pycache__' --exclude 'data' \
    --exclude 'logs' --exclude 'node_modules' --exclude 'nginx/logs' \
    "$ROOT/server/" "$HOST:$DEST/server/"
rsync -az --delete "$ROOT/web/dist/" "$HOST:$DEST/web/dist/"

say "installing server deps on $HOST..."
ssh "$HOST" "cd '$DEST/server' && uv sync"

say "installing LaunchAgent $LABEL on $HOST..."
ssh "$HOST" "cat > '$PLIST_DST'" < "$PLIST_SRC"

say "restarting on $HOST (launchd)..."
ssh "$HOST" bash -s <<REMOTE
set -euo pipefail
LABEL="$LABEL"
DOMAIN="gui/\$(id -u)"
PLIST="$PLIST_DST"

chmod +x "$DEST/server/mutr-web-server.sh"
screen -S mutr-web -X quit 2>/dev/null || true
launchctl bootout "\$DOMAIN/\$LABEL" 2>/dev/null || true
mv -f "$DEST/logs/uvicorn.log" "$DEST/logs/uvicorn.log.old" 2>/dev/null || true
mkdir -p "$DEST/logs"
if ! launchctl bootstrap "\$DOMAIN" "\$PLIST"; then
    launchctl bootout "\$DOMAIN/\$LABEL" 2>/dev/null || true
    launchctl bootstrap "\$DOMAIN" "\$PLIST"
fi
REMOTE

say "verify..."
for _ in $(seq 1 30); do
    if curl -sf --max-time 3 "http://$HOST:8000/api/health" >/dev/null 2>&1; then
        say "OK → http://$HOST:8000"
        exit 0
    fi
    sleep 1
done
die "not reachable — ssh $HOST launchctl print gui/\$(id -u)/$LABEL; tail $DEST/logs/uvicorn.log (is the iMac logged in at the GUI?)"
