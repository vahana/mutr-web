#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="${1:-imac.local}"
DEST="$HOME/mutr-web"
COREDEST="$HOME/mutr_core"

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
rsync -az "$ROOT/run.sh" "$HOST:$DEST/run.sh"
ssh "$HOST" "chmod +x $DEST/run.sh"

say "installing server deps on $HOST..."
ssh "$HOST" "cd $DEST/server && uv sync"

say "restarting on $HOST (direct mode, no nginx)..."
ssh "$HOST" "pkill -f 'uvicorn app.main' 2>/dev/null; sleep 1; $DEST/run.sh direct" \
    || die "run.sh failed — ssh $HOST tail $DEST/logs/uvicorn.log"

say "verify..."
sleep 1
if curl -sf "http://$HOST:8000/api/health" >/dev/null 2>&1; then
    say "OK → http://$HOST:8000"
else
    die "not reachable — ssh $HOST tail $DEST/logs/uvicorn.log"
fi
