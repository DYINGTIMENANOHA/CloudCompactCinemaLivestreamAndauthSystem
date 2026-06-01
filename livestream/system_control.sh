#!/usr/bin/env bash
set -euo pipefail

APP_SERVICE="${APP_SERVICE:-livestream.service}"
SRS_CONTAINER="${SRS_CONTAINER:-srs}"

case "${1:-help}" in
  start)
    sudo systemctl start "$APP_SERVICE"
    sudo systemctl start srs-docker.service
    ;;
  stop)
    sudo systemctl stop "$APP_SERVICE"
    sudo systemctl stop srs-docker.service
    ;;
  restart)
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
  help|*)
    echo "Usage: $0 {start|stop|restart|status|log}"
    ;;
esac
