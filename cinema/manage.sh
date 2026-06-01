#!/usr/bin/env bash
set -euo pipefail

SERVICE="${SERVICE:-cinema.service}"
CINEMA_BASE_DIR="${CINEMA_BASE_DIR:-$(cd "$(dirname "$0")" && pwd)}"
DB_PATH="${CINEMA_DB_PATH:-$CINEMA_BASE_DIR/data/cinema.db}"

case "${1:-help}" in
  start) sudo systemctl start "$SERVICE" ;;
  stop) sudo systemctl stop "$SERVICE" ;;
  restart) sudo systemctl restart "$SERVICE" ;;
  status)
    sudo systemctl status "$SERVICE" --no-pager
    ;;
  log)
    sudo journalctl -u "$SERVICE" -f --no-pager
    ;;
  init-db)
    CINEMA_BASE_DIR="$CINEMA_BASE_DIR" CINEMA_DB_PATH="$DB_PATH" python3 -c "from core import db; db.init_db()"
    ;;
  usage)
    du -sh "$CINEMA_BASE_DIR"/data "$CINEMA_BASE_DIR"/uploads "$CINEMA_BASE_DIR"/videos "$CINEMA_BASE_DIR"/videos_covers 2>/dev/null || true
    sqlite3 "$DB_PATH" "SELECT COUNT(*) AS videos FROM videos;" 2>/dev/null || true
    ;;
  help|*)
    echo "Usage: $0 {start|stop|restart|status|log|init-db|usage}"
    ;;
esac
