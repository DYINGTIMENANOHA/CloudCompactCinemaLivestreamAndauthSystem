"""
Cinema SQLite 数据库

存放视频元信息、上传任务、配置项。
"""
import sqlite3
from pathlib import Path
from core import config

DB_PATH = config.DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    display_name TEXT NOT NULL,
    duration_seconds REAL NOT NULL,
    size_bytes INTEGER NOT NULL,
    video_codec TEXT DEFAULT '',
    audio_codec TEXT DEFAULT '',
    added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS upload_tasks (
    id TEXT PRIMARY KEY,
    original_filename TEXT NOT NULL,
    original_size_bytes INTEGER NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    original_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    resulting_video_id TEXT,
    file_hash TEXT,
    received_bytes INTEGER DEFAULT 0,
    temp_path TEXT,
    FOREIGN KEY (resulting_video_id) REFERENCES videos(id)
);

CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

DEFAULT_CONFIG = {
    "veto_enabled": "1",
    "veto_delay_seconds": "3",
}


def init_db():
    """初始化数据库,确保表存在,写入默认配置(如果还没有)。"""
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.executescript(SCHEMA)
        for key, value in DEFAULT_CONFIG.items():
            conn.execute(
                "INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)",
                (key, value)
            )
        conn.commit()
    finally:
        conn.close()
    print(f"[db] initialized at {DB_PATH}")


def get_config(key: str, default=None) -> str | None:
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.execute("SELECT value FROM config WHERE key = ?", (key,))
        row = cursor.fetchone()
        return row[0] if row else default
    finally:
        conn.close()


def set_config(key: str, value: str):
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            "INSERT INTO config (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value)
        )
        conn.commit()
    finally:
        conn.close()


def get_all_videos() -> list[dict]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(
            "SELECT id, filename, display_name, duration_seconds, size_bytes, "
            "video_codec, audio_codec, added_at "
            "FROM videos ORDER BY added_at DESC"
        )
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


def get_video(video_id: str) -> dict | None:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(
            "SELECT id, filename, display_name, duration_seconds, size_bytes, "
            "video_codec, audio_codec, added_at "
            "FROM videos WHERE id = ?",
            (video_id,)
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()
