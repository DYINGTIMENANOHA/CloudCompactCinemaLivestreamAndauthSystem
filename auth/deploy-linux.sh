#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_CONFIG="${SYSTEM_CONFIG:-$REPO_DIR/../system.config}"

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

load_system_config "$ROOT_CONFIG"

APP_DIR="${APP_DIR:-${AUTH_BASE:-/opt/auth}}"

sudo apt-get update
sudo apt-get install -y python3 sqlite3 openssl rsync
sudo mkdir -p "$APP_DIR"
sudo rsync -a --delete --exclude data --exclude keys "$REPO_DIR/" "$APP_DIR/"
if [ -f "$ROOT_CONFIG" ]; then
  sudo cp "$ROOT_CONFIG" "$APP_DIR/system.config"
fi
sudo chown -R "${APP_USER:-www-data}:${APP_GROUP:-www-data}" "$APP_DIR"
sudo chmod +x "$APP_DIR/manage.sh" "$APP_DIR/manage_token.sh" "$APP_DIR/deploy-linux.sh" 2>/dev/null || true

cd "$APP_DIR"
AUTH_BASE="$APP_DIR" SYSTEM_CONFIG="$APP_DIR/system.config" python3 init_auth_db.py

echo "Installed auth to $APP_DIR"
echo "Create admin keys with: AUTH_BASE=$APP_DIR ./manage_token.sh rotate-admin cinema"
