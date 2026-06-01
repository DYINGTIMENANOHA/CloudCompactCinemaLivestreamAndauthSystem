#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/livestream}"
APP_USER="${APP_USER:-www-data}"
APP_GROUP="${APP_GROUP:-www-data}"
SRS_IMAGE="${SRS_IMAGE:-ossrs/srs:5}"
SRS_CONTAINER="${SRS_CONTAINER:-srs}"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip ffmpeg sqlite3 rsync docker.io
sudo systemctl enable --now docker
sudo mkdir -p "$APP_DIR"
sudo rsync -a --delete --exclude .venv --exclude data --exclude logs --exclude recordings "$REPO_DIR/" "$APP_DIR/"
sudo mkdir -p "$APP_DIR/data" "$APP_DIR/logs" "$APP_DIR/recordings/live" "$APP_DIR/recordings/test"
sudo chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"

cd "$APP_DIR"
python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
python -c "from utils import database; database.init_db('live'); database.init_db('test')"

sudo tee /etc/systemd/system/livestream.service >/dev/null <<EOF
[Unit]
Description=Livestream Flask App
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$APP_DIR
Environment=AUTH_BASE=${AUTH_BASE:-/opt/auth}
Environment=LIVESTREAM_BASE_DIR=$APP_DIR
ExecStart=$APP_DIR/.venv/bin/gunicorn -w 2 -b 127.0.0.1:${LIVESTREAM_PORT:-8888} app:app
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/srs-docker.service >/dev/null <<EOF
[Unit]
Description=SRS Media Server
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=simple
Restart=always
RestartSec=5
ExecStartPre=-/usr/bin/docker rm -f $SRS_CONTAINER
ExecStart=/usr/bin/docker run --name $SRS_CONTAINER --network host -v $APP_DIR/srs/srs.conf:/usr/local/srs/conf/srs.conf:ro $SRS_IMAGE ./objs/srs -c conf/srs.conf
ExecStop=/usr/bin/docker stop $SRS_CONTAINER
ExecStopPost=-/usr/bin/docker rm -f $SRS_CONTAINER

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable livestream.service
sudo systemctl enable srs-docker.service
sudo systemctl restart srs-docker.service
sudo systemctl restart livestream.service
echo "Livestream installed to $APP_DIR"
echo "SRS installed as srs-docker.service using image $SRS_IMAGE"
