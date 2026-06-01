# Livestream

`livestream` is a Flask live room app. It serves watch/admin/monitor pages and uses SRS for RTMP ingest plus HTTP-FLV/HLS playback.

## Dependency On Auth

Production use requires `auth`.

`livestream` verifies:

- watch tokens through `auth.verify_watch_token(token, env="live"|"test")`
- SRS publish/admin tokens through `auth.verify_stream_token(token, env="live"|"test")`

Set:

```bash
AUTH_BASE=/opt/auth
```

Before pushing streams, create auth keys:

```bash
cd /opt/auth
AUTH_BASE=/opt/auth ./manage_token.sh rotate-admin live
AUTH_BASE=/opt/auth ./manage_token.sh rotate-admin test
AUTH_BASE=/opt/auth ./manage_token.sh add-watch live full
AUTH_BASE=/opt/auth ./manage_token.sh add-watch test full
```

The generated admin key is the publish key used by OBS/RTMP clients.

## Runtime Layout

Default production layout:

```text
/opt/livestream
  app.py
  routes/
  static/
  templates/
  utils/
  srs/srs.conf
  data/
  logs/
  recordings/live/
  recordings/test/
```

## Linux Deploy

```bash
bash deploy-linux.sh
```

The script:

- installs Python, venv, pip, ffmpeg, sqlite3, rsync, and Docker
- enables Docker
- copies source files to `/opt/livestream` by default
- preserves runtime `data`, `logs`, and `recordings`
- creates runtime directories
- creates `.venv`
- installs `requirements.txt`
- initializes comments/recordings SQLite tables
- writes `/etc/systemd/system/livestream.service`
- writes `/etc/systemd/system/srs-docker.service`
- starts SRS with Docker image `ossrs/srs:5`
- enables and restarts both services

Override paths or SRS image:

```bash
APP_DIR=/srv/livestream AUTH_BASE=/srv/auth SRS_IMAGE=ossrs/srs:5 bash deploy-linux.sh
```

## SRS Ports

With the default Docker host-network setup:

- RTMP ingest: `1935`
- SRS API: `1985`
- HTTP-FLV/HLS: `8090`

SRS publish hook:

```text
http://127.0.0.1:8888/api/auth/publish
```

## Push URL Example

If your domain is `YOUR_DOMAIN` and your live admin key is `ADMIN_KEY`:

```text
rtmp://YOUR_DOMAIN:1935/live/stream?key=ADMIN_KEY
```

For test:

```text
rtmp://YOUR_DOMAIN:1935/test/stream?key=ADMIN_KEY
```

## Windows Local Run

```powershell
.\run-windows.ps1
```

The Windows script starts only the Flask app for route/template checks. Test full media flow with SRS on Linux/Docker.

## Nginx

See `../docs/nginx-examples.md` for reverse proxy examples.
