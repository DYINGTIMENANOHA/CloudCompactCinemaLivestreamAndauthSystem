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

if [ "${PUBLIC_HTTPS_PORT:-443}" = "443" ]; then
  DEFAULT_BASE_URL="https://${PUBLIC_DOMAIN:-YOUR_DOMAIN}"
else
  DEFAULT_BASE_URL="https://${PUBLIC_DOMAIN:-YOUR_DOMAIN}:${PUBLIC_HTTPS_PORT:-443}"
fi
BASE_URL="${BASE_URL:-$DEFAULT_BASE_URL}"
RTMP_HOST="${RTMP_HOST:-rtmp://${PUBLIC_DOMAIN:-YOUR_DOMAIN}:${PUBLIC_RTMP_PORT:-${SRS_RTMP_PORT:-1935}}}"
TOKENS_DB="${AUTH_TOKENS_DB:-$AUTH_BASE/data/tokens.db}"
KEYS_DIR="${AUTH_KEYS_DIR:-$AUTH_BASE/keys}"

usage() {
  cat <<'EOF'
Usage:
  ./manage_token.sh init
  ./manage_token.sh add-watch <room> [full|group|stealth]
  ./manage_token.sh list [room]
  ./manage_token.sh disable <token>
  ./manage_token.sh enable <token>
  ./manage_token.sh delete <token>
  ./manage_token.sh rotate-admin <room>
  ./manage_token.sh show-admin <room>

Environment:
  BASE_URL       Public https base URL, for generated watch/admin links.
  RTMP_HOST      Public RTMP host, for generated push URLs.
  AUTH_BASE      Auth project directory. Defaults to this script directory.
  AUTH_TOKENS_DB SQLite token database path.
  AUTH_KEYS_DIR  Admin key directory.
EOF
}

ensure_db() {
  mkdir -p "$(dirname "$TOKENS_DB")" "$KEYS_DIR"
  AUTH_BASE="$AUTH_BASE" AUTH_TOKENS_DB="$TOKENS_DB" AUTH_KEYS_DIR="$KEYS_DIR" \
    python3 "$AUTH_BASE/init_auth_db.py" >/dev/null
}

rand_hex() {
  openssl rand -hex 16
}

case "${1:-help}" in
  init)
    ensure_db
    echo "Auth database initialized: $TOKENS_DB"
    ;;
  add-watch)
    ensure_db
    room="${2:-}"
    token_type="${3:-full}"
    if [ -z "$room" ]; then echo "room is required"; exit 1; fi
    if [[ ! "$token_type" =~ ^(full|group|stealth)$ ]]; then echo "invalid token type"; exit 1; fi
    token="$(rand_hex)"
    sqlite3 "$TOKENS_DB" \
      "INSERT INTO tokens (token, type, room, active, token_type) VALUES ('$token', 'watch', '$room', 1, '$token_type');"
    echo "Token: $token"
    echo "Watch URL: $BASE_URL/$room?token=$token"
    ;;
  list)
    ensure_db
    room="${2:-}"
    if [ -n "$room" ]; then
      sqlite3 -header -column "$TOKENS_DB" \
        "SELECT token, room, active, token_type, created_at FROM tokens WHERE room='$room' ORDER BY created_at DESC;"
    else
      sqlite3 -header -column "$TOKENS_DB" \
        "SELECT token, room, active, token_type, created_at FROM tokens ORDER BY created_at DESC;"
    fi
    ;;
  disable|enable)
    ensure_db
    token="${2:-}"
    if [ -z "$token" ]; then echo "token is required"; exit 1; fi
    active=0
    [ "$1" = "enable" ] && active=1
    sqlite3 "$TOKENS_DB" "UPDATE tokens SET active=$active WHERE token='$token';"
    echo "Updated token: $token"
    ;;
  delete)
    ensure_db
    token="${2:-}"
    if [ -z "$token" ]; then echo "token is required"; exit 1; fi
    sqlite3 "$TOKENS_DB" "DELETE FROM tokens WHERE token='$token';"
    echo "Deleted token: $token"
    ;;
  rotate-admin)
    ensure_db
    room="${2:-}"
    if [ -z "$room" ]; then echo "room is required"; exit 1; fi
    key="$(rand_hex)"
    echo "$key" > "$KEYS_DIR/${room}_admin.key"
    chmod 600 "$KEYS_DIR/${room}_admin.key" 2>/dev/null || true
    echo "Admin token: $key"
    echo "Admin URL: $BASE_URL/$room/admin?token=$key"
    echo "RTMP push: $RTMP_HOST/$room"
    ;;
  show-admin)
    room="${2:-}"
    if [ -z "$room" ]; then echo "room is required"; exit 1; fi
    key_file="$KEYS_DIR/${room}_admin.key"
    if [ ! -f "$key_file" ]; then echo "No key file: $key_file"; exit 1; fi
    key="$(cat "$key_file")"
    echo "Admin token: $key"
    echo "Admin URL: $BASE_URL/$room/admin?token=$key"
    echo "RTMP push: $RTMP_HOST/$room"
    ;;
  help|*)
    usage
    ;;
esac
