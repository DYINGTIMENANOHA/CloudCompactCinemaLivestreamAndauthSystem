# Cinema

`cinema` is a FastAPI cloud cinema app. It manages uploads, transcodes browser-compatible MP4 files, serves a video library, and provides watch/admin/chat routes.

## Dependency On Auth

Production use requires `auth`.

`cinema` verifies:

- watch tokens through `auth.verify_watch_token(token, env="cinema")`
- admin tokens through `auth.verify_admin_token(token, env="cinema")`

Set:

```bash
AUTH_BASE=/opt/auth
```

Before using the app, create auth data:

```bash
cd /opt/auth
AUTH_BASE=/opt/auth ./manage_token.sh rotate-admin cinema
AUTH_BASE=/opt/auth ./manage_token.sh add-watch cinema full
```

## Runtime Layout

Default production layout:

```text
/opt/cinema
  app.py
  core/
  routes/
  static/
  templates/
  data/cinema.db
  logs/
  uploads/
  videos/
  videos_covers/
```

Only source/config examples are committed. Runtime directories are created by the deploy script.

## Central Config

Primary settings come from the repository root `system.config`. During deployment it is copied to:

```text
/opt/cinema/system.config
```

Important cinema settings:

- `CINEMA_HOST`: internal bind host for FastAPI
- `CINEMA_PORT`: internal FastAPI port for nginx proxying
- `CINEMA_DATA_DIR`, `CINEMA_DB_PATH`
- `CINEMA_UPLOADS_DIR`, `CINEMA_VIDEOS_DIR`, `CINEMA_COVERS_DIR`
- `AUTH_BASE`: where cinema imports the auth library from

After changing `/opt/cinema/system.config`, restart:

```bash
sudo systemctl restart cinema.service
```

## Linux Deploy

```bash
bash deploy-linux.sh
```

The script:

- installs Python, venv, pip, ffmpeg, sqlite3, and rsync
- copies source files to `/opt/cinema` by default
- preserves runtime `data`, `logs`, `uploads`, `videos`, and `videos_covers`
- creates runtime directories
- creates `.venv`
- installs `requirements.txt`
- initializes `data/cinema.db`
- writes `/etc/systemd/system/cinema.service`
- enables and restarts `cinema.service`

Override paths by editing root `system.config`, or for one-off deploys:

```bash
APP_DIR=/srv/cinema AUTH_BASE=/srv/auth bash deploy-linux.sh
```

Override host/port by editing `system.config`, or for one-off deploys:

```bash
CINEMA_HOST=127.0.0.1 CINEMA_PORT=8891 bash deploy-linux.sh
```

## Daily Management

```bash
cd /opt/cinema
./manage.sh start
./manage.sh stop
./manage.sh restart
./manage.sh reload
./manage.sh status
./manage.sh logs
./manage.sh usage
./manage.sh config
```

## Windows Local Run

```powershell
.\run-windows.ps1
```

Open:

```text
http://127.0.0.1:8890/cinema/
```

For protected routes, initialize `auth` locally first with `..\auth\run-windows.ps1`.

## Nginx

Use `nginx_cinema.conf.example` inside your HTTPS server block. See `../docs/nginx-examples.md` for a combined reverse proxy example.
