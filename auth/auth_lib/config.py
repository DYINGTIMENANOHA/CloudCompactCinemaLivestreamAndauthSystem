import os
from pathlib import Path

def _read_system_config():
    candidates = [
        os.getenv("SYSTEM_CONFIG"),
        Path(__file__).resolve().parents[1] / "system.config",
        Path(__file__).resolve().parents[2] / "system.config",
        Path.cwd() / "system.config",
    ]
    values = {}
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate)
        if not path.exists():
            continue
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("\"'")
        break
    return values


_SYSTEM_CONFIG = _read_system_config()


def _cfg(name, default):
    return os.getenv(name, _SYSTEM_CONFIG.get(name, default))


AUTH_BASE = Path(_cfg("AUTH_BASE", Path(__file__).resolve().parents[1]))
TOKENS_DB = _cfg("AUTH_TOKENS_DB", str(AUTH_BASE / "data" / "tokens.db"))
KEYS_DIR = Path(_cfg("AUTH_KEYS_DIR", str(AUTH_BASE / "keys")))

ADMIN_KEY_FILE = {
    "live": str(KEYS_DIR / "live_admin.key"),
    "test": str(KEYS_DIR / "test_admin.key"),
    "chutianshu": str(KEYS_DIR / "chutianshu_admin.key"),
    "cinema": str(KEYS_DIR / "cinema_admin.key"),
}

VALID_ROOMS = tuple(
    room.strip()
    for room in _cfg("AUTH_VALID_ROOMS", "live,test,chutianshu,cinema").split(",")
    if room.strip()
)
