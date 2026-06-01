$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $Root
$SystemConfig = Join-Path $RepoRoot "system.config"

function Get-SystemConfigValue($Path, $Name) {
  if (-not (Test-Path $Path)) { return $null }
  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) { continue }
    $parts = $trimmed.Split("=", 2)
    if ($parts[0].Trim() -eq $Name) {
      return $parts[1].Trim().Trim('"').Trim("'")
    }
  }
  return $null
}

$env:CINEMA_BASE_DIR = $Root
$env:CINEMA_DATA_DIR = Join-Path $Root "data"
$env:CINEMA_DB_PATH = Join-Path $Root "data\cinema.db"
$env:CINEMA_LOG_DIR = Join-Path $Root "logs"
$env:CINEMA_UPLOADS_DIR = Join-Path $Root "uploads"
$env:CINEMA_VIDEOS_DIR = Join-Path $Root "videos"
$env:CINEMA_COVERS_DIR = Join-Path $Root "videos_covers"
$env:CINEMA_STATIC_DIR = Join-Path $Root "static"
$env:CINEMA_TEMPLATES_DIR = Join-Path $Root "templates"
$env:AUTH_BASE = Join-Path (Split-Path -Parent $Root) "auth"
if (-not $env:SYSTEM_CONFIG -and (Test-Path $SystemConfig)) { $env:SYSTEM_CONFIG = $SystemConfig }
if (-not $env:CINEMA_HOST) {
  $env:CINEMA_HOST = (Get-SystemConfigValue $SystemConfig "CINEMA_HOST")
  if (-not $env:CINEMA_HOST) { $env:CINEMA_HOST = "127.0.0.1" }
}
if (-not $env:CINEMA_PORT) {
  $env:CINEMA_PORT = (Get-SystemConfigValue $SystemConfig "CINEMA_PORT")
  if (-not $env:CINEMA_PORT) { $env:CINEMA_PORT = "8890" }
}

if (-not (Test-Path "$Root\.venv")) {
  python -m venv "$Root\.venv"
}
& "$Root\.venv\Scripts\python.exe" -m pip install --upgrade pip
& "$Root\.venv\Scripts\pip.exe" install -r "$Root\requirements.txt"
& "$Root\.venv\Scripts\python.exe" -c "from core import db; db.init_db()"
& "$Root\.venv\Scripts\uvicorn.exe" app:app --host $env:CINEMA_HOST --port $env:CINEMA_PORT
