# Cinema

FastAPI cloud cinema app. It manages uploads, transcodes browser-compatible MP4 files, serves a video library, and provides watch/admin/chat routes.

## Configure

Copy `.env.example` as a checklist. The main knobs are:

- `CINEMA_BASE_DIR`
- `CINEMA_DB_PATH`
- `CINEMA_UPLOADS_DIR`
- `CINEMA_VIDEOS_DIR`
- `CINEMA_COVERS_DIR`
- `AUTH_BASE`

## Linux Deploy

```bash
bash deploy-linux.sh
```

The script creates a virtualenv, installs requirements, initializes the SQLite DB, and installs `cinema.service`.

## Windows Local Run

```powershell
.\run-windows.ps1
```

Open `http://127.0.0.1:8890/cinema/` after the server starts.

## Nginx

Use `nginx_cinema.conf.example` inside your HTTPS server block. See `../docs/nginx-examples.md` for a combined reverse proxy example.
