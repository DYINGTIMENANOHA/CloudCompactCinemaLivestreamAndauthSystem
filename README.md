# Live Stream Cinema And Auth System

This repository is a lightweight monorepo for three server projects:

- `auth`: shared token verification library and token/key management.
- `cinema`: FastAPI cloud cinema app for upload, transcode, library, watch room, chat, and admin UI.
- `livestream`: Flask live room app using SRS for RTMP/HTTP-FLV/HLS.

The old `nginx` directory was intentionally removed. Nginx is deployment glue, not a standalone project here. Reverse proxy examples are documented in `docs/nginx-examples.md` and project READMEs.

## Repository Rules

Runtime state is not committed: databases, logs, virtual environments, uploaded videos, recordings, keys, generated covers, and backups are ignored.

Each project can run independently. `cinema` and `livestream` only connect to `auth` when `AUTH_BASE` points to an installed auth directory.

## Quick Start On Windows

```powershell
.\auth\run-windows.ps1
.\cinema\run-windows.ps1
.\livestream\run-windows.ps1
```

Run them in separate terminals when testing multiple services.

## Quick Deploy On Ubuntu/Debian

```bash
cd auth && bash deploy-linux.sh
cd ../cinema && bash deploy-linux.sh
cd ../livestream && bash deploy-linux.sh
```

Override install paths with environment variables:

```bash
APP_DIR=/srv/cinema AUTH_BASE=/srv/auth bash cinema/deploy-linux.sh
```

## Notes

Copy `.env.example` files when you need a checklist of required environment variables. Do not commit real `.env`, SQLite databases, token keys, logs, videos, or recordings.
