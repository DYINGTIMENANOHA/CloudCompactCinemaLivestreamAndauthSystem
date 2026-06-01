#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SYSTEM_CONFIG="${SYSTEM_CONFIG:-$APP_DIR/system.config}"

load_system_config() {
  local config_file="$1"
  local raw_line line key value
  [ -f "$config_file" ] || return 0
  while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    line="${raw_line#"${raw_line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac
    case "$line" in
      *=*)
        key="${line%%=*}"
        value="${line#*=}"
        key="${key#"${key%%[![:space:]]*}"}"
        key="${key%"${key##*[![:space:]]}"}"
        value="${value#"${value%%[![:space:]]*}"}"
        value="${value%"${value##*[![:space:]]}"}"
        value="${value%\"}"; value="${value#\"}"
        value="${value%\'}"; value="${value#\'}"
        if [ -z "${!key+x}" ]; then
          export "$key=$value"
        fi
        ;;
    esac
  done < "$config_file"
}

load_system_config "$SYSTEM_CONFIG"

export SYSTEM_CONFIG
export AUTH_BASE="${AUTH_BASE:-/opt/auth}"
export LIVESTREAM_BASE_DIR="${LIVESTREAM_BASE_DIR:-$APP_DIR}"

exec "$APP_DIR/.venv/bin/gunicorn" \
  -w "${LIVESTREAM_WORKERS:-2}" \
  -b "${LIVESTREAM_HOST:-127.0.0.1}:${LIVESTREAM_PORT:-8888}" \
  app:app
