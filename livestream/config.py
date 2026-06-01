import os
from pathlib import Path

BASE_DIR = os.getenv("LIVESTREAM_BASE_DIR", str(Path(__file__).resolve().parent))
DATA_DIR = os.getenv("LIVESTREAM_DATA_DIR", os.path.join(BASE_DIR, "data"))

SECRET_KEY = os.getenv("LIVESTREAM_SECRET_KEY", "change-this-in-production")
FLASK_HOST = os.getenv("LIVESTREAM_HOST", "0.0.0.0")
FLASK_PORT = int(os.getenv("LIVESTREAM_PORT", "8888"))

DB_PATH = {
    "tokens": os.path.join(DATA_DIR, "tokens.db"),
    "comments_live": os.path.join(DATA_DIR, "comments.db"),
    "comments_test": os.path.join(DATA_DIR, "test_comments.db"),
    "recordings_live": os.path.join(DATA_DIR, "recordings.db"),
    "recordings_test": os.path.join(DATA_DIR, "test_recordings.db"),
}

RECORDINGS_DIR = {
    "live": os.path.join(BASE_DIR, "recordings", "live"),
    "test": os.path.join(BASE_DIR, "recordings", "test"),
}
MAX_STORAGE_GB = int(os.getenv("LIVESTREAM_MAX_STORAGE_GB", "5"))
MAX_STORAGE_BYTES = MAX_STORAGE_GB * 1024 * 1024 * 1024

STREAM_KEY_FILE = {
    "live": os.path.join(DATA_DIR, "stream_key.txt"),
    "test": os.path.join(DATA_DIR, "test_stream_key.txt"),
}

TITLE_FILE = {
    "live": os.path.join(BASE_DIR, "title.txt"),
    "test": os.path.join(BASE_DIR, "test_title.txt"),
}

BACKGROUND_IMAGE = os.getenv("LIVESTREAM_BACKGROUND_IMAGE", os.path.join(BASE_DIR, "static", "background.jpg"))

SRS_API_BASE = os.getenv("SRS_API_BASE", "http://127.0.0.1:1985/api/v1")
SRS_HTTP_FLV_PORT = int(os.getenv("SRS_HTTP_FLV_PORT", "8090"))

HLS_URL = {
    "live": "/live/stream.m3u8",
    "test": "/test/stream.m3u8",
}

STREAM_URL = {
    "live": "/live/stream.flv",
    "test": "/test/stream.flv",
}

APP_NAME = {
    "live": "live",
    "test": "test",
}

DEFAULT_TITLE = {
    "live": "Live Room",
    "test": "Test Live Room",
}

LOG_DIR = os.getenv("LIVESTREAM_LOG_DIR", os.path.join(BASE_DIR, "logs"))
os.makedirs(LOG_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

CORS_ORIGINS = os.getenv("LIVESTREAM_CORS_ORIGINS", "*")
CORS_HEADERS = "Content-Type"
CORS_METHODS = "GET,POST,DELETE"

ENV_CONFIG = {
    "live": {
        "db_comments": DB_PATH["comments_live"],
        "db_recordings": DB_PATH["recordings_live"],
        "recordings_dir": RECORDINGS_DIR["live"],
        "stream_key_file": STREAM_KEY_FILE["live"],
        "title_file": TITLE_FILE["live"],
        "stream_url": STREAM_URL["live"],
        "hls_url": HLS_URL["live"],
        "app_name": APP_NAME["live"],
        "default_title": DEFAULT_TITLE["live"],
    },
    "test": {
        "db_comments": DB_PATH["comments_test"],
        "db_recordings": DB_PATH["recordings_test"],
        "recordings_dir": RECORDINGS_DIR["test"],
        "stream_key_file": STREAM_KEY_FILE["test"],
        "title_file": TITLE_FILE["test"],
        "stream_url": STREAM_URL["test"],
        "hls_url": HLS_URL["test"],
        "app_name": APP_NAME["test"],
        "default_title": DEFAULT_TITLE["test"],
    },
}


def get_env_config(env="live"):
    if env not in ENV_CONFIG:
        raise ValueError(f"Invalid environment: {env}. Must be 'live' or 'test'")
    return ENV_CONFIG[env]


QUALITY_DB = os.path.join(DATA_DIR, "quality.db")
