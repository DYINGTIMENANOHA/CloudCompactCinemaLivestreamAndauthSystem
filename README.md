# Cloud Compact Cinema Livestream And Auth System

This repository is a lightweight monorepo for three related but separable server projects:

- `auth`: shared token database, admin key files, and Python verification library.
- `cinema`: FastAPI cloud cinema app for upload, transcode, video library, watch room, chat, and admin UI.
- `livestream`: Flask live room app using SRS for RTMP ingest and HTTP-FLV/HLS playback.

The previous live `nginx` directory is not kept as a project. Nginx is deployment glue, so this repo keeps reverse proxy examples in `docs/nginx-examples.md`.

## Central Config

Edit `system.config` in the repository root before deployment. It is the top-level place for important paths and interfaces:

- public domain and public RTMP/HTTPS ports
- `auth` install path, token DB path, and key directory
- `cinema` internal host/port and runtime directories
- `livestream` internal host/port and runtime directories
- SRS RTMP, HTTP playback, and API ports
- nginx reference ports

The deploy scripts copy `system.config` into each installed project directory:

```text
/opt/auth/system.config
/opt/cinema/system.config
/opt/livestream/system.config
```

Services read this file at startup. After changing a deployed config, restart the affected service:

```bash
sudo systemctl restart cinema.service
sudo systemctl restart livestream.service
sudo systemctl restart srs-docker.service
```

Environment variables still have the highest priority, so advanced users can override any setting from systemd or a shell.

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

Override paths when needed, either by editing `system.config` or by passing environment variables:

```bash
APP_DIR=/srv/auth bash auth/deploy-linux.sh
APP_DIR=/srv/cinema AUTH_BASE=/srv/auth bash cinema/deploy-linux.sh
APP_DIR=/srv/livestream AUTH_BASE=/srv/auth bash livestream/deploy-linux.sh
```

Override service/media ports by editing `system.config` before deployment. Environment variables also work for one-off deployment:

```bash
CINEMA_HOST=127.0.0.1 CINEMA_PORT=8891 bash cinema/deploy-linux.sh
LIVESTREAM_PORT=8889 SRS_RTMP_PORT=1936 SRS_HTTP_PORT=8091 SRS_API_PORT=1986 bash livestream/deploy-linux.sh
```

For SRS, `livestream/run-srs.sh` generates `srs/srs.runtime.conf` from `system.config` each time `srs-docker.service` starts. This keeps SRS ports and livestream Python code aligned.

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
- `cinema.service` starts through `run-service.sh`, which reads `system.config`

`livestream/deploy-linux.sh`:

- installs Python, venv, pip, ffmpeg, sqlite3, rsync, and Docker
- copies source files to `APP_DIR`
- creates runtime directories: `data`, `logs`, `recordings/live`, `recordings/test`
- creates `.venv` and installs `requirements.txt`
- initializes comments/recordings SQLite tables
- writes and starts `livestream.service`
- writes and starts `srs-docker.service` using `ossrs/srs:5`
- both services start through wrapper scripts that read `system.config`

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

## Daily Service Management

Each project has its own management entry:

```bash
/opt/auth/manage.sh status
/opt/cinema/manage.sh status
/opt/livestream/system_control.sh status
```

Common commands:

```bash
/opt/cinema/manage.sh start
/opt/cinema/manage.sh stop
/opt/cinema/manage.sh restart
/opt/cinema/manage.sh logs

/opt/livestream/system_control.sh start
/opt/livestream/system_control.sh stop
/opt/livestream/system_control.sh restart
/opt/livestream/system_control.sh logs all
/opt/livestream/system_control.sh logs srs
```

`auth` has no long-running daemon. Its management script handles database/key status, initialization, token listing, and backups:

```bash
/opt/auth/manage.sh init
/opt/auth/manage.sh status
/opt/auth/manage.sh list
/opt/auth/manage.sh backup
```

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
