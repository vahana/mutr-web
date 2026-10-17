#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p ../logs

UV="$(command -v uv || true)"
if [ -z "$UV" ]; then
    echo "uv not found on PATH — check plist EnvironmentVariables" >&2
    exit 1
fi

exec /usr/bin/caffeinate -s -- "$UV" run uvicorn app.main:app --host 0.0.0.0 --port 8000
