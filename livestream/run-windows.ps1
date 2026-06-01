$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:LIVESTREAM_BASE_DIR = $Root
$env:LIVESTREAM_DATA_DIR = Join-Path $Root "data"
$env:LIVESTREAM_LOG_DIR = Join-Path $Root "logs"
$env:AUTH_BASE = Join-Path (Split-Path -Parent $Root) "auth"
if (-not $env:LIVESTREAM_HOST) { $env:LIVESTREAM_HOST = "127.0.0.1" }
if (-not $env:LIVESTREAM_PORT) { $env:LIVESTREAM_PORT = "8888" }

if (-not (Test-Path "$Root\.venv")) {
  python -m venv "$Root\.venv"
}
& "$Root\.venv\Scripts\python.exe" -m pip install --upgrade pip
& "$Root\.venv\Scripts\pip.exe" install -r "$Root\requirements.txt"
& "$Root\.venv\Scripts\python.exe" -c "from utils import database; database.init_db('live'); database.init_db('test')"
& "$Root\.venv\Scripts\python.exe" "$Root\app.py"
