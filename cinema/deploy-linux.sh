#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/cinema}"
APP_USER="${APP_USER:-www-data}"
APP_GROUP="${APP_GROUP:-www-data}"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip ffmpeg sqlite3 rsync
sudo mkdir -p "$APP_DIR"
sudo rsync -a --delete --exclude .venv --exclude data --exclude logs --exclude uploads --exclude videos --exclude videos_covers "$REPO_DIR/" "$APP_DIR/"
sudo mkdir -p "$APP_DIR/data" "$APP_DIR/logs" "$APP_DIR/uploads" "$APP_DIR/videos" "$APP_DIR/videos_covers"
sudo chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"

cd "$APP_DIR"
python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
CINEMA_BASE_DIR="$APP_DIR" python -c "from core import db; db.init_db()"

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
ExecStart=$APP_DIR/.venv/bin/uvicorn app:app --host 127.0.0.1 --port ${CINEMA_PORT:-8890} --workers 1
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable cinema.service
sudo systemctl restart cinema.service
echo "Cinema installed to $APP_DIR"
