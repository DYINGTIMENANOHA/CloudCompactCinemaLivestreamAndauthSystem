import os
from pathlib import Path

BASE_DIR = Path(os.getenv("CINEMA_BASE_DIR", Path(__file__).resolve().parents[1]))
DATA_DIR = Path(os.getenv("CINEMA_DATA_DIR", BASE_DIR / "data"))
LOG_DIR = Path(os.getenv("CINEMA_LOG_DIR", BASE_DIR / "logs"))
UPLOADS_DIR = Path(os.getenv("CINEMA_UPLOADS_DIR", BASE_DIR / "uploads"))
VIDEOS_DIR = Path(os.getenv("CINEMA_VIDEOS_DIR", BASE_DIR / "videos"))
COVERS_DIR = Path(os.getenv("CINEMA_COVERS_DIR", BASE_DIR / "videos_covers"))
STATIC_DIR = Path(os.getenv("CINEMA_STATIC_DIR", BASE_DIR / "static"))
TEMPLATES_DIR = Path(os.getenv("CINEMA_TEMPLATES_DIR", BASE_DIR / "templates"))

DB_PATH = os.getenv("CINEMA_DB_PATH", str(DATA_DIR / "cinema.db"))
AUTH_BASE = Path(os.getenv("AUTH_BASE", BASE_DIR.parent / "auth"))
FFMPEG_BIN = os.getenv("FFMPEG_BIN", "ffmpeg")
FFPROBE_BIN = os.getenv("FFPROBE_BIN", "ffprobe")

HOST = os.getenv("CINEMA_HOST", "127.0.0.1")
PORT = int(os.getenv("CINEMA_PORT", "8890"))
