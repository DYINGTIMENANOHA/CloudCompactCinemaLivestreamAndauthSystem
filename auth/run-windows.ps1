$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $Root
$SystemConfig = Join-Path $RepoRoot "system.config"

$env:AUTH_BASE = $Root
$env:AUTH_TOKENS_DB = Join-Path $Root "data\tokens.db"
$env:AUTH_KEYS_DIR = Join-Path $Root "keys"
if (-not $env:SYSTEM_CONFIG -and (Test-Path $SystemConfig)) {
  $env:SYSTEM_CONFIG = $SystemConfig
}

python "$Root\init_auth_db.py"
Write-Host "Auth initialized at $Root"
Write-Host "Use Git Bash/WSL for manage_token.sh, or edit SQLite/key files under auth\data and auth\keys for local tests."
