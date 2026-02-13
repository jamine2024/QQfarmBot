#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8787}"
export DATA_DIR="${DATA_DIR:-$PWD/data/admin}"
export WEB_DIST_DIR="${WEB_DIST_DIR:-$PWD/apps/admin-web/dist}"

# 清理端口占用，避免重复启动时端口被历史进程占用
cleanup_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "${pids:-}" ]; then
      echo "[run] PORT=$port is in use, killing: $pids"
      kill -9 $pids 2>/dev/null || true
    fi
    return 0
  fi

  if command -v fuser >/dev/null 2>&1; then
    if fuser -n tcp "$port" >/dev/null 2>&1; then
      echo "[run] PORT=$port is in use, killing via fuser"
      fuser -k "${port}"/tcp >/dev/null 2>&1 || true
    fi
    return 0
  fi

  if command -v ss >/dev/null 2>&1; then
    local pids
    pids="$(ss -lptn "sport = :$port" 2>/dev/null | awk -F'pid=' 'NR>1{print $2}' | awk -F',' '{print $1}' | sort -u | tr '\n' ' ' || true)"
    if [ -n "${pids// /}" ]; then
      echo "[run] PORT=$port is in use, killing: $pids"
      kill -9 $pids 2>/dev/null || true
    fi
    return 0
  fi

  echo "[run] WARN: cannot check/kill PORT=$port (missing lsof/fuser/ss)"
}

cleanup_port "$PORT"
if [ ! -d "node_modules" ]; then
  npm install --omit=dev --no-audit --no-fund
fi
node apps/admin-server/dist/index.js
