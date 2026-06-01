$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:AUTH_BASE = $Root
python "$Root\init_auth_db.py"
Write-Host "Auth initialized at $Root"
Write-Host "Use Git Bash/WSL for manage_token.sh, or edit SQLite/key files under auth\data and auth\keys for local tests."
