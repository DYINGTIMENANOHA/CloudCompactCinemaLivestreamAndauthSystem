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

APP_DIR="${APP_DIR:-${CINEMA_BASE_DIR:-/opt/cinema}}"
APP_USER="${APP_USER:-www-data}"
APP_GROUP="${APP_GROUP:-www-data}"

sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip ffmpeg sqlite3 rsync
sudo mkdir -p "$APP_DIR"
sudo rsync -a --delete --exclude .venv --exclude data --exclude logs --exclude uploads --exclude videos --exclude videos_covers "$REPO_DIR/" "$APP_DIR/"
if [ -f "$ROOT_CONFIG" ]; then
  sudo cp "$ROOT_CONFIG" "$APP_DIR/system.config"
fi
sudo mkdir -p "$APP_DIR/data" "$APP_DIR/logs" "$APP_DIR/uploads" "$APP_DIR/videos" "$APP_DIR/videos_covers"
sudo chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
sudo chmod +x "$APP_DIR/manage.sh" "$APP_DIR/run-service.sh" "$APP_DIR/deploy-linux.sh" 2>/dev/null || true

cd "$APP_DIR"
python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
CINEMA_BASE_DIR="$APP_DIR" SYSTEM_CONFIG="$APP_DIR/system.config" python -c "from core import db; db.init_db()"

sudo tee /etc/systemd/system/cinema.service >/dev/null <<EOF
[Unit]
Description=Cloud Cinema
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$APP_DIR
Environment=AUTH_BASE=${AUTH_BASE:-/opt/auth}
Environment=CINEMA_BASE_DIR=$APP_DIR
Environment=SYSTEM_CONFIG=$APP_DIR/system.config
ExecStart=/bin/bash $APP_DIR/run-service.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable cinema.service
sudo systemctl restart cinema.service
echo "Cinema installed to $APP_DIR"
