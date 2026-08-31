#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

say() { printf "${CYAN}==>${NC} %s\n" "$1"; }
ok()  { printf "${GREEN}  ok${NC} %s\n" "$1"; }
die() { printf "${RED}  error${NC} %s\n" "$1"; exit 1; }

say "mutr-web installer"

command -v uv >/dev/null 2>&1 || die "uv not found — install: curl -LsSf https://astral.sh/uv/install.sh | sh"
command -v node >/dev/null 2>&1 || die "node not found — install: brew install node"
command -v ffmpeg >/dev/null 2>&1 || die "ffmpeg not found — install: brew install ffmpeg"
command -v rubberband >/dev/null 2>&1 || die "rubberband not found — install: brew install rubberband"
command -v yt-dlp >/dev/null 2>&1 || say "yt-dlp not found (YouTube downloads disabled) — install: brew install yt-dlp"

cd "$(dirname "$0")"

say "backend deps..."
(cd server && uv sync)
ok "backend deps"

say "frontend deps..."
(cd web && npm install)
ok "frontend deps"

say "production build..."
(cd web && npm run build)
ok "build"

echo ""
say "ready."
echo ""
echo "  dev:      cd server && uv run uvicorn app.main:app --port 8000 --reload"
echo "            cd web && npm run dev   → http://localhost:5173"
echo ""
echo "  prod:     cd server && uv run uvicorn app.main:app --port 8000"
echo "            → http://localhost:8000"
