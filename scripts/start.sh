#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

install_deps=false

for arg in "$@"; do
  case "$arg" in
    --install)
      install_deps=true
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: scripts/start.sh [--install]"
      exit 1
      ;;
  esac
done

if [[ "$install_deps" == true ]]; then
  echo "[start] Installing backend dependencies..."
  python3 -m pip install -r "$BACKEND_DIR/requirements.txt"

  echo "[start] Installing frontend dependencies..."
  (cd "$FRONTEND_DIR" && npm install)
fi

echo "[start] Starting backend on http://localhost:8000"
(
  cd "$BACKEND_DIR"
  uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
) &
BACKEND_PID=$!

echo "[start] Starting frontend on http://localhost:5173"
(
  cd "$FRONTEND_DIR"
  npm run dev -- --host 0.0.0.0 --port 5173
) &
FRONTEND_PID=$!

cleanup() {
  echo
  echo "[start] Shutting down services..."

  if kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi

  if kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi

  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

wait -n "$BACKEND_PID" "$FRONTEND_PID"

echo "[start] One service exited; stopping the other."
