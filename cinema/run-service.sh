#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SYSTEM_CONFIG="${SYSTEM_CONFIG:-$APP_DIR/system.config}"
if [ -f "$SYSTEM_CONFIG" ]; then
  set -a
  . "$SYSTEM_CONFIG"
  set +a
fi

export SYSTEM_CONFIG
export AUTH_BASE="${AUTH_BASE:-/opt/auth}"
export CINEMA_BASE_DIR="${CINEMA_BASE_DIR:-$APP_DIR}"

exec "$APP_DIR/.venv/bin/uvicorn" app:app \
  --host "${CINEMA_HOST:-127.0.0.1}" \
  --port "${CINEMA_PORT:-8890}" \
  --workers "${CINEMA_WORKERS:-1}"
