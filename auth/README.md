# Auth

Shared SQLite token verification and token/key management.

## Configure

See `.env.example`.

Important variables:

- `AUTH_BASE`: auth project directory.
- `AUTH_TOKENS_DB`: SQLite token DB path.
- `AUTH_KEYS_DIR`: admin key directory.
- `AUTH_VALID_ROOMS`: comma-separated rooms, default `live,test,chutianshu,cinema`.

## Linux Deploy

```bash
bash deploy-linux.sh
AUTH_BASE=/opt/auth ./manage_token.sh rotate-admin cinema
AUTH_BASE=/opt/auth ./manage_token.sh add-watch cinema full
```

## Windows Local Init

```powershell
.\run-windows.ps1
```

Token management is a Bash script; use Git Bash or WSL on Windows.
