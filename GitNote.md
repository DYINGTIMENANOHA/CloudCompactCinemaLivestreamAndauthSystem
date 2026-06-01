# Git Preparation Notes

## What Was Removed

- Python virtual environments and bytecode caches.
- SQLite databases and token/key data.
- Logs, uploads, recordings, videos, generated covers, and backups.
- Historical backup files and the server nginx runtime directory.

## What Was Converted To Templates

- Auth token management now uses `AUTH_BASE`, `AUTH_TOKENS_DB`, `AUTH_KEYS_DIR`, `BASE_URL`, and `RTMP_HOST`.
- Cinema paths now come from `cinema/core/config.py`.
- Livestream paths now come from `livestream/config.py`.
- Nginx config is documented as examples instead of committed as a live server directory.

## Before Pushing

Run:

```bash
git status --short
git add .
git diff --cached --stat
```

Check that no real secrets, `.db` files, videos, logs, or `.env` files appear in the staged set.
