# Livestream

Flask live room app. It verifies watch/publish tokens through `auth`, serves watch/admin/monitor pages, and expects SRS to provide RTMP ingest plus HTTP-FLV/HLS playback.

## Configure

Copy `.env.example` as a checklist. The main knobs are:

- `LIVESTREAM_BASE_DIR`
- `LIVESTREAM_DATA_DIR`
- `LIVESTREAM_SECRET_KEY`
- `AUTH_BASE`
- `SRS_API_BASE`
- `SRS_HTTP_FLV_PORT`

## Linux Deploy

```bash
bash deploy-linux.sh
```

The script creates a virtualenv, installs requirements, initializes SQLite tables, installs Docker, and starts SRS as `srs-docker.service`.

## Windows Local Run

```powershell
.\run-windows.ps1
```

SRS itself is normally tested on Linux or Docker. The Windows script starts only the Flask app for route/template checks.

## SRS

The sample config is `srs/srs.conf`. Its publish hook points to the Flask app at `http://127.0.0.1:8888/api/auth/publish`. Linux deployment runs SRS with host networking, so ports `1935`, `1985`, and `8090` are exposed on the server.

Create publish/admin keys through auth:

```bash
AUTH_BASE=/opt/auth /opt/auth/manage_token.sh rotate-admin live
AUTH_BASE=/opt/auth /opt/auth/manage_token.sh rotate-admin test
```

## Nginx

See `../docs/nginx-examples.md` for reverse proxy examples.
