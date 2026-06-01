#!/usr/bin/env bash
set -euo pipefail

AUTH_BASE="${AUTH_BASE:-$(cd "$(dirname "$0")" && pwd)}"
SYSTEM_CONFIG="${SYSTEM_CONFIG:-$AUTH_BASE/system.config}"

load_system_config() {
  local config_file="$1"
  local raw_line line key value
  [ -f "$config_file" ] || return 0
  while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    line="${raw_line#"${raw_line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac
    case "$line" in
      *=*)
        key="${line%%=*}"
        value="${line#*=}"
        key="${key#"${key%%[![:space:]]*}"}"
        key="${key%"${key##*[![:space:]]}"}"
        value="${value#"${value%%[![:space:]]*}"}"
        value="${value%"${value##*[![:space:]]}"}"
        value="${value%\"}"; value="${value#\"}"
        value="${value%\'}"; value="${value#\'}"
        if [ -z "${!key+x}" ]; then
          export "$key=$value"
        fi
        ;;
    esac
  done < "$config_file"
}

load_system_config "$SYSTEM_CONFIG"

TOKENS_DB="${AUTH_TOKENS_DB:-$AUTH_BASE/data/tokens.db}"
KEYS_DIR="${AUTH_KEYS_DIR:-$AUTH_BASE/keys}"
BACKUP_DIR="${AUTH_BACKUP_DIR:-$AUTH_BASE/backups}"

case "${1:-help}" in
  init|reload)
    AUTH_BASE="$AUTH_BASE" AUTH_TOKENS_DB="$TOKENS_DB" AUTH_KEYS_DIR="$KEYS_DIR" \
      python3 "$AUTH_BASE/init_auth_db.py"
    ;;
  status)
    echo "Auth base:    $AUTH_BASE"
    echo "Token DB:     $TOKENS_DB"
    echo "Keys dir:     $KEYS_DIR"
    [ -f "$TOKENS_DB" ] && echo "DB status:    exists" || echo "DB status:    missing"
    if command -v sqlite3 >/dev/null 2>&1 && [ -f "$TOKENS_DB" ]; then
      echo "Watch tokens: $(sqlite3 "$TOKENS_DB" "SELECT COUNT(*) FROM tokens WHERE type='watch';" 2>/dev/null || echo '?')"
      echo "Active:       $(sqlite3 "$TOKENS_DB" "SELECT COUNT(*) FROM tokens WHERE type='watch' AND active=1;" 2>/dev/null || echo '?')"
    fi
    echo "Admin keys:"
    for room in live test chutianshu cinema; do
      key_file="$KEYS_DIR/${room}_admin.key"
      [ -s "$key_file" ] && echo "  $room: set" || echo "  $room: missing/empty"
    done
    ;;
  list)
    "$AUTH_BASE/manage_token.sh" list "${2:-}"
    ;;
  backup)
    mkdir -p "$BACKUP_DIR"
    stamp="$(date +%Y%m%d_%H%M%S)"
    out="$BACKUP_DIR/auth_backup_$stamp.tar.gz"
    tar -czf "$out" -C "$AUTH_BASE" data keys 2>/dev/null
    echo "Backup written: $out"
    ;;
  log|logs)
    echo "auth has no daemon log. Use cinema/livestream service logs for runtime auth failures."
    ;;
  start|stop|restart)
    echo "auth has no long-running service; nothing to $1."
    echo "Use '$0 init' to initialize/reload database/key files."
    ;;
  config)
    if [ -f "$SYSTEM_CONFIG" ]; then
      cat "$SYSTEM_CONFIG"
    else
      echo "No system config found at $SYSTEM_CONFIG"
    fi
    ;;
  help|*)
    cat <<'EOF'
Usage: ./manage.sh <command>

Commands:
  init       Initialize auth database and key files
  reload     Same as init; auth has no daemon to reload
  status     Show DB/key status
  list [room] List watch tokens
  backup     Backup data/ and keys/
  log        Explain auth logging
  start      No-op; auth has no daemon
  stop       No-op; auth has no daemon
  restart    No-op; auth has no daemon
  config     Print effective system.config file
EOF
    ;;
esac
