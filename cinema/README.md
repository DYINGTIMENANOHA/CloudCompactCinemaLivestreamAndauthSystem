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

Override paths:

```bash
APP_DIR=/srv/cinema AUTH_BASE=/srv/auth bash deploy-linux.sh
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
