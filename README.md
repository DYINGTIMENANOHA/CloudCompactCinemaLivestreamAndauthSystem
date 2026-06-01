# Cloud Compact Cinema Livestream And Auth System

This repository is a lightweight monorepo for three related but separable server projects:

- `auth`: shared token database, admin key files, and Python verification library.
- `cinema`: FastAPI cloud cinema app for upload, transcode, video library, watch room, chat, and admin UI.
- `livestream`: Flask live room app using SRS for RTMP ingest and HTTP-FLV/HLS playback.

The previous live `nginx` directory is not kept as a project. Nginx is deployment glue, so this repo keeps reverse proxy examples in `docs/nginx-examples.md`.

## Important Dependency

For real use, deploy `auth` first.

`cinema` and `livestream` both depend on `auth` for permission checks:

- `cinema` uses `auth` for watch tokens and admin tokens.
- `livestream` uses `auth` for watch tokens and SRS publish/admin tokens.
- `AUTH_BASE` tells `cinema` and `livestream` where the `auth` project is installed.

Without `auth`, the apps may start, but protected watch/admin/publish routes will reject access or fail to import the auth library.

## Architecture

```text
viewer/admin/publisher
        |
        v
     nginx
        |
        +--> cinema FastAPI service :8890
        |       |
        |       +--> imports auth/auth_lib through AUTH_BASE
        |       +--> stores runtime data in cinema/data, uploads, videos, covers
        |
        +--> livestream Flask service :8888
        |       |
        |       +--> imports auth/auth_lib through AUTH_BASE
        |       +--> stores comments/recordings metadata in livestream/data
        |       +--> receives SRS on_publish callbacks at /api/auth/publish
        |
        +--> SRS media server
                |
                +--> RTMP :1935
                +--> HTTP-FLV/HLS :8090
                +--> API :1985

auth
  |
  +--> data/tokens.db
  +--> keys/*_admin.key
  +--> auth_lib verification functions
```

## Fresh Server Deployment

Ubuntu/Debian is the primary production target.

```bash
git clone https://github.com/DYINGTIMENANOHA/CloudCompactCinemaLivestreamAndauthSystem.git
cd CloudCompactCinemaLivestreamAndauthSystem

cd auth
bash deploy-linux.sh

cd ../cinema
bash deploy-linux.sh

cd ../livestream
bash deploy-linux.sh
```

Default install paths:

- `auth`: `/opt/auth`
- `cinema`: `/opt/cinema`
- `livestream`: `/opt/livestream`

Override paths when needed:

```bash
APP_DIR=/srv/auth bash auth/deploy-linux.sh
APP_DIR=/srv/cinema AUTH_BASE=/srv/auth bash cinema/deploy-linux.sh
APP_DIR=/srv/livestream AUTH_BASE=/srv/auth bash livestream/deploy-linux.sh
```

## What The Deploy Scripts Do

`auth/deploy-linux.sh`:

- installs `python3`, `sqlite3`, `openssl`, and `rsync`
- copies source files to `APP_DIR`
- keeps existing `data` and `keys`
- initializes `tokens.db`
- creates empty admin key files

`cinema/deploy-linux.sh`:

- installs Python, venv, pip, ffmpeg, sqlite3, and rsync
- copies source files to `APP_DIR`
- creates runtime directories: `data`, `logs`, `uploads`, `videos`, `videos_covers`
- creates `.venv` and installs `requirements.txt`
- initializes `cinema.db`
- writes and starts `cinema.service`

`livestream/deploy-linux.sh`:

- installs Python, venv, pip, ffmpeg, sqlite3, rsync, and Docker
- copies source files to `APP_DIR`
- creates runtime directories: `data`, `logs`, `recordings/live`, `recordings/test`
- creates `.venv` and installs `requirements.txt`
- initializes comments/recordings SQLite tables
- writes and starts `livestream.service`
- writes and starts `srs-docker.service` using `ossrs/srs:5`

## Create Tokens And Admin Keys

After deploying `auth`, create the keys/tokens the other projects need:

```bash
cd /opt/auth

AUTH_BASE=/opt/auth ./manage_token.sh rotate-admin cinema
AUTH_BASE=/opt/auth ./manage_token.sh rotate-admin live
AUTH_BASE=/opt/auth ./manage_token.sh rotate-admin test

AUTH_BASE=/opt/auth ./manage_token.sh add-watch cinema full
AUTH_BASE=/opt/auth ./manage_token.sh add-watch live full
AUTH_BASE=/opt/auth ./manage_token.sh add-watch test full
```

Use the generated watch URLs/admin tokens according to each project's README.

## Nginx

See `docs/nginx-examples.md`. The deployment scripts do not overwrite your nginx configuration because domain names, certificates, ports, and firewall layout vary by server.

## Windows Local Testing

Windows scripts are for local service testing, not production:

```powershell
.\auth\run-windows.ps1
.\cinema\run-windows.ps1
.\livestream\run-windows.ps1
```

Run each in a separate terminal. SRS is not automatically started on Windows; test full livestream media flow on Linux/Docker.

## Repository Rules

Runtime state is intentionally not committed:

- `.env`
- SQLite databases
- token/admin key files
- logs
- virtual environments
- uploaded videos
- livestream recordings
- generated covers
- backups

See `.gitignore` and `GitNote.md`.
