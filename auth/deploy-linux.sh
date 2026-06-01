#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_CONFIG="${SYSTEM_CONFIG:-$REPO_DIR/../system.config}"
if [ -f "$ROOT_CONFIG" ]; then
  set -a
  . "$ROOT_CONFIG"
  set +a
fi

APP_DIR="${APP_DIR:-${AUTH_BASE:-/opt/auth}}"

sudo apt-get update
sudo apt-get install -y python3 sqlite3 openssl rsync
sudo mkdir -p "$APP_DIR"
sudo rsync -a --delete --exclude data --exclude keys "$REPO_DIR/" "$APP_DIR/"
if [ -f "$ROOT_CONFIG" ]; then
  sudo cp "$ROOT_CONFIG" "$APP_DIR/system.config"
fi
sudo chown -R "${APP_USER:-www-data}:${APP_GROUP:-www-data}" "$APP_DIR"

cd "$APP_DIR"
AUTH_BASE="$APP_DIR" SYSTEM_CONFIG="$APP_DIR/system.config" python3 init_auth_db.py

echo "Installed auth to $APP_DIR"
echo "Create admin keys with: AUTH_BASE=$APP_DIR ./manage_token.sh rotate-admin cinema"
