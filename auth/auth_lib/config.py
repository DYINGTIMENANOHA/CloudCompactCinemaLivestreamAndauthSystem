import os
from pathlib import Path

AUTH_BASE = Path(os.getenv("AUTH_BASE", Path(__file__).resolve().parents[1]))
TOKENS_DB = os.getenv("AUTH_TOKENS_DB", str(AUTH_BASE / "data" / "tokens.db"))
KEYS_DIR = Path(os.getenv("AUTH_KEYS_DIR", str(AUTH_BASE / "keys")))

ADMIN_KEY_FILE = {
    "live": str(KEYS_DIR / "live_admin.key"),
    "test": str(KEYS_DIR / "test_admin.key"),
    "chutianshu": str(KEYS_DIR / "chutianshu_admin.key"),
    "cinema": str(KEYS_DIR / "cinema_admin.key"),
}

VALID_ROOMS = tuple(
    room.strip()
    for room in os.getenv("AUTH_VALID_ROOMS", "live,test,chutianshu,cinema").split(",")
    if room.strip()
)
