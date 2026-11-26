#!/usr/bin/env bash
# ============================================
# 云端放映室 管理脚本
# 用法: ./manage.sh [命令]
# 路径可通过环境变量覆盖 (与 core/config.py 一致)
# ============================================
set -euo pipefail

SERVICE="${SERVICE:-cinema.service}"
CINEMA_BASE_DIR="${CINEMA_BASE_DIR:-$(cd "$(dirname "$0")" && pwd)}"
DATA_DIR="${CINEMA_DATA_DIR:-$CINEMA_BASE_DIR/data}"
DB_PATH="${CINEMA_DB_PATH:-$DATA_DIR/cinema.db}"
VIDEOS_DIR="${CINEMA_VIDEOS_DIR:-$CINEMA_BASE_DIR/videos}"
UPLOADS_DIR="${CINEMA_UPLOADS_DIR:-$CINEMA_BASE_DIR/uploads}"
COVERS_DIR="${CINEMA_COVERS_DIR:-$CINEMA_BASE_DIR/videos_covers}"
BACKUP_DIR="${CINEMA_BACKUP_DIR:-$CINEMA_BASE_DIR/backups}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# root 下直接执行, 否则用 sudo
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi

check_active() {
    if $SUDO systemctl is-active --quiet "$SERVICE"; then
        echo -e "${GREEN}✓ $1${NC}"
    else
        echo -e "${RED}✗ $2${NC}"
    fi
}

clear_pycache() {
    rm -rf "$CINEMA_BASE_DIR/routes/__pycache__" "$CINEMA_BASE_DIR/core/__pycache__"
}

case "${1:-help}" in
    start)
        echo -e "${GREEN}启动放映室...${NC}"
        $SUDO systemctl start "$SERVICE"
        sleep 1
        check_active "已启动" "启动失败"
        ;;

    stop)
        echo -e "${YELLOW}停止放映室...${NC}"
        $SUDO systemctl stop "$SERVICE"
        echo -e "${GREEN}✓ 已停止${NC}"
        ;;

    restart|reload)
        echo -e "${YELLOW}重启放映室...${NC}"
        clear_pycache
        $SUDO systemctl restart "$SERVICE"
        sleep 1
        check_active "已重启" "重启失败"
        ;;

    status)
        echo -e "${CYAN}=== 放映室状态 ===${NC}"
        $SUDO systemctl status "$SERVICE" --no-pager | head -10 || true
        echo ""
        echo -e "${CYAN}=== 磁盘使用 ===${NC}"
        VIDEOS_SIZE=$(du -sh "$VIDEOS_DIR" 2>/dev/null | cut -f1 || echo "?")
        UPLOADS_SIZE=$(du -sh "$UPLOADS_DIR" 2>/dev/null | cut -f1 || echo "?")
        DB_SIZE=$(du -sh "$DB_PATH" 2>/dev/null | cut -f1 || echo "?")
        VIDEO_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM videos;" 2>/dev/null || echo "?")
        echo "  视频文件: $VIDEOS_SIZE ($VIDEO_COUNT 个)"
        echo "  上传临时: $UPLOADS_SIZE"
        echo "  数据库:   $DB_SIZE"
        echo ""
        echo -e "${CYAN}=== 存储配置 ===${NC}"
        LIMIT=$(sqlite3 "$DB_PATH" "SELECT value FROM config WHERE key='storage_limit_gb';" 2>/dev/null || echo "?")
        echo "  存储上限: ${LIMIT} GB"
        df -h "$VIDEOS_DIR" 2>/dev/null | tail -1 | awk '{print "  磁盘总量: "$2"  已用: "$3"  可用: "$4"  使用率: "$5}' || true
        ;;

    usage)
        du -sh "$DATA_DIR" "$UPLOADS_DIR" "$VIDEOS_DIR" "$COVERS_DIR" 2>/dev/null || true
        sqlite3 "$DB_PATH" "SELECT COUNT(*) AS videos FROM videos;" 2>/dev/null || true
        ;;

    log|logs)
        echo -e "${CYAN}实时日志 (Ctrl+C 退出)${NC}"
        $SUDO journalctl -u "$SERVICE" -f --no-pager
        ;;

    backup)
        mkdir -p "$BACKUP_DIR"
        TIMESTAMP=$(date +%Y%m%d_%H%M%S)
        BACKUP_FILE="$BACKUP_DIR/cinema_backup_${TIMESTAMP}.tar.gz"
        echo -e "${CYAN}备份中...${NC}"
        if tar -czf "$BACKUP_FILE" \
            -C "$CINEMA_BASE_DIR" \
            "$(realpath --relative-to="$CINEMA_BASE_DIR" "$DB_PATH")" \
            "$(realpath --relative-to="$CINEMA_BASE_DIR" "$COVERS_DIR")/" \
            static/img/ \
            2>/dev/null; then
            SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
            echo -e "${GREEN}✓ 备份完成: $BACKUP_FILE ($SIZE)${NC}"
            echo "  包含: 数据库 + 视频封面 + 背景图"
            echo "  注意: 视频文件未包含(太大),请单独备份"
        else
            echo -e "${RED}✗ 备份失败${NC}"
            exit 1
        fi
        ;;

    clean-tasks)
        echo -e "${YELLOW}清理 24 小时前的上传任务记录...${NC}"
        COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM upload_tasks WHERE created_at < datetime('now', '-24 hours');" 2>/dev/null || echo 0)
        sqlite3 "$DB_PATH" "DELETE FROM upload_tasks WHERE created_at < datetime('now', '-24 hours');" 2>/dev/null || true
        echo -e "${GREEN}✓ 已清理 ${COUNT} 条旧记录${NC}"
        ;;

    config)
        SYSTEM_CONFIG="${SYSTEM_CONFIG:-$CINEMA_BASE_DIR/system.config}"
        if [ -f "$SYSTEM_CONFIG" ]; then
            cat "$SYSTEM_CONFIG"
        else
            echo "未找到系统配置: $SYSTEM_CONFIG"
        fi
        ;;

    init-db)
        (cd "$CINEMA_BASE_DIR" && CINEMA_BASE_DIR="$CINEMA_BASE_DIR" CINEMA_DB_PATH="$DB_PATH" python3 -c "from core import db; db.init_db()")
        ;;

    help|*)
        echo -e "${CYAN}云端放映室 管理脚本${NC}"
        echo ""
        echo "用法: $0 <命令>"
        echo ""
        echo "命令:"
        echo "  start        启动放映室"
        echo "  stop         停止放映室"
        echo "  restart      重启放映室(自动清除缓存), 别名 reload"
        echo "  status       查看运行状态和磁盘使用"
        echo "  usage        简要列出各目录占用"
        echo "  log          查看实时日志, 别名 logs"
        echo "  backup       备份数据库和资源文件"
        echo "  clean-tasks  清理旧的上传任务记录"
        echo "  config       显示 system.config"
        echo "  init-db      初始化数据库"
        echo ""
        ;;
esac
