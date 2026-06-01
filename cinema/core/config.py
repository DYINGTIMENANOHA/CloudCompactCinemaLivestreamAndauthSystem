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


BASE_DIR = Path(_cfg("CINEMA_BASE_DIR", Path(__file__).resolve().parents[1]))
DATA_DIR = Path(_cfg("CINEMA_DATA_DIR", BASE_DIR / "data"))
LOG_DIR = Path(_cfg("CINEMA_LOG_DIR", BASE_DIR / "logs"))
UPLOADS_DIR = Path(_cfg("CINEMA_UPLOADS_DIR", BASE_DIR / "uploads"))
VIDEOS_DIR = Path(_cfg("CINEMA_VIDEOS_DIR", BASE_DIR / "videos"))
COVERS_DIR = Path(_cfg("CINEMA_COVERS_DIR", BASE_DIR / "videos_covers"))
STATIC_DIR = Path(_cfg("CINEMA_STATIC_DIR", BASE_DIR / "static"))
TEMPLATES_DIR = Path(_cfg("CINEMA_TEMPLATES_DIR", BASE_DIR / "templates"))

DB_PATH = _cfg("CINEMA_DB_PATH", str(DATA_DIR / "cinema.db"))
AUTH_BASE = Path(_cfg("AUTH_BASE", BASE_DIR.parent / "auth"))
FFMPEG_BIN = _cfg("FFMPEG_BIN", "ffmpeg")
FFPROBE_BIN = _cfg("FFPROBE_BIN", "ffprobe")

HOST = _cfg("CINEMA_HOST", "127.0.0.1")
PORT = int(_cfg("CINEMA_PORT", "8890"))
