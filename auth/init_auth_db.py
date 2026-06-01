import sqlite3
from pathlib import Path

from auth_lib.config import ADMIN_KEY_FILE, KEYS_DIR, TOKENS_DB

SCHEMA = """
CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'watch',
    room TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    token_type TEXT NOT NULL DEFAULT 'full',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tokens_room_type ON tokens(room, type);
CREATE INDEX IF NOT EXISTS idx_tokens_active ON tokens(active);
"""


def main() -> None:
    db_path = Path(TOKENS_DB)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    KEYS_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.executescript(SCHEMA)
    for key_file in ADMIN_KEY_FILE.values():
        Path(key_file).parent.mkdir(parents=True, exist_ok=True)
        Path(key_file).touch(exist_ok=True)
    print(f"auth database ready: {db_path}")


if __name__ == "__main__":
    main()
