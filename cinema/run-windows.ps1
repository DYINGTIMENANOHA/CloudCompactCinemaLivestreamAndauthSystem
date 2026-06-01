$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:CINEMA_BASE_DIR = $Root
$env:AUTH_BASE = Join-Path (Split-Path -Parent $Root) "auth"
$env:CINEMA_HOST = "127.0.0.1"
$env:CINEMA_PORT = "8890"

if (-not (Test-Path "$Root\.venv")) {
  python -m venv "$Root\.venv"
}
& "$Root\.venv\Scripts\python.exe" -m pip install --upgrade pip
& "$Root\.venv\Scripts\pip.exe" install -r "$Root\requirements.txt"
& "$Root\.venv\Scripts\python.exe" -c "from core import db; db.init_db()"
& "$Root\.venv\Scripts\uvicorn.exe" app:app --host 127.0.0.1 --port 8890
