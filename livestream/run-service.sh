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
export LIVESTREAM_BASE_DIR="${LIVESTREAM_BASE_DIR:-$APP_DIR}"

exec "$APP_DIR/.venv/bin/gunicorn" \
  -w "${LIVESTREAM_WORKERS:-2}" \
  -b "${LIVESTREAM_HOST:-127.0.0.1}:${LIVESTREAM_PORT:-8888}" \
  app:app
