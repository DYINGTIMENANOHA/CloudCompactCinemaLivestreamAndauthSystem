# Auth

`auth` is the shared permission project. Deploy it before `cinema` and `livestream`.

It provides:

- SQLite watch token storage in `data/tokens.db`
- admin/publish key files in `keys`
- `auth_lib` Python functions imported by other projects
- `manage_token.sh` for token and key management

## How Other Projects Use It

`cinema` and `livestream` import `auth/auth_lib` through the `AUTH_BASE` environment variable.

Default production layout:

```text
/opt/auth
/opt/cinema
/opt/livestream
```

With that layout, `AUTH_BASE=/opt/auth`.

## Linux Deploy

```bash
bash deploy-linux.sh
```

The script:

- installs `python3`, `sqlite3`, `openssl`, and `rsync`
- copies source files to `/opt/auth` by default
- preserves runtime `data` and `keys`
- initializes `data/tokens.db`
- creates empty admin key files

## Manage Tokens

```bash
cd /opt/auth

AUTH_BASE=/opt/auth ./manage_token.sh rotate-admin cinema
AUTH_BASE=/opt/auth ./manage_token.sh rotate-admin live
AUTH_BASE=/opt/auth ./manage_token.sh rotate-admin test

AUTH_BASE=/opt/auth ./manage_token.sh add-watch cinema full
AUTH_BASE=/opt/auth ./manage_token.sh add-watch live full
AUTH_BASE=/opt/auth ./manage_token.sh list
```

Token types:

- `full`: normal viewing
- `group`: grouped viewing behavior, if the frontend uses it
- `stealth`: hidden/quiet viewing behavior, if the frontend uses it

## Windows Local Init

```powershell
.\run-windows.ps1
```

Token management is a Bash script; use Git Bash or WSL on Windows.
