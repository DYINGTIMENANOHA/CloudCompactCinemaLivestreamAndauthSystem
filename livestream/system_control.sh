#!/usr/bin/env bash
set -euo pipefail

APP_SERVICE="${APP_SERVICE:-livestream.service}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")" && pwd)}"
SYSTEM_CONFIG="${SYSTEM_CONFIG:-$APP_DIR/system.config}"

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
SRS_CONTAINER="${SRS_CONTAINER:-srs}"

case "${1:-help}" in
  start)
    sudo systemctl start srs-docker.service
    sudo systemctl start "$APP_SERVICE"
    ;;
  stop)
    sudo systemctl stop "$APP_SERVICE"
    sudo systemctl stop srs-docker.service
    ;;
  restart)
    sudo systemctl restart srs-docker.service
    sudo systemctl restart "$APP_SERVICE"
    ;;
  reload)
    sudo systemctl restart srs-docker.service
    sudo systemctl restart "$APP_SERVICE"
    ;;
  status)
    sudo systemctl status "$APP_SERVICE" --no-pager
    sudo systemctl status srs-docker.service --no-pager
    docker ps --filter "name=$SRS_CONTAINER" 2>/dev/null || true
    ;;
  log)
    sudo journalctl -u "$APP_SERVICE" -f --no-pager
    ;;
  logs)
    target="${2:-all}"
    case "$target" in
      app|flask|livestream)
        sudo journalctl -u "$APP_SERVICE" -f --no-pager
        ;;
      srs)
        sudo journalctl -u srs-docker.service -f --no-pager
        ;;
      all)
        sudo journalctl -u "$APP_SERVICE" -u srs-docker.service -f --no-pager
        ;;
      *)
        echo "Usage: $0 logs {all|app|srs}"
        exit 1
        ;;
    esac
    ;;
  config)
    if [ -f "$SYSTEM_CONFIG" ]; then
      cat "$SYSTEM_CONFIG"
    else
      echo "No system config found at $SYSTEM_CONFIG"
    fi
    ;;
  help|*)
    echo "Usage: $0 {start|stop|restart|reload|status|log|logs|config}"
    echo "       $0 logs {all|app|srs}"
    ;;
esac
