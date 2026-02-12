#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8787}"
export DATA_DIR="${DATA_DIR:-$PWD/data/admin}"
export WEB_DIST_DIR="${WEB_DIST_DIR:-$PWD/apps/admin-web/dist}"
if [ ! -d "node_modules" ]; then
  npm install --omit=dev --no-audit --no-fund
fi
node apps/admin-server/dist/index.js
