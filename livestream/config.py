import os
import re
from pathlib import Path

def _read_system_config():
    candidates = [
        os.getenv("SYSTEM_CONFIG"),
        Path(__file__).resolve().parent / "system.config",
        Path(__file__).resolve().parent.parent / "system.config",
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


BASE_DIR = _cfg("LIVESTREAM_BASE_DIR", str(Path(__file__).resolve().parent))
DATA_DIR = _cfg("LIVESTREAM_DATA_DIR", os.path.join(BASE_DIR, "data"))


def _read_srs_ports():
    conf_path = Path(BASE_DIR) / "srs" / "srs.conf"
    defaults = {"rtmp": "1935", "http": "8090", "api": "1985"}
    try:
        text = conf_path.read_text(encoding="utf-8")
    except OSError:
        return defaults

    rtmp_match = re.search(r"(?m)^listen\s+(\d+)\s*;", text)
    if rtmp_match:
        defaults["rtmp"] = rtmp_match.group(1)

    for key, block_name in (("http", "http_server"), ("api", "http_api")):
        block = re.search(rf"{block_name}\s*\{{(.*?)\}}", text, re.S)
        if block:
            port = re.search(r"listen\s+(\d+)\s*;", block.group(1))
            if port:
                defaults[key] = port.group(1)
    return defaults


_SRS_CONF_PORTS = _read_srs_ports()

SECRET_KEY = _cfg("LIVESTREAM_SECRET_KEY", "change-this-in-production")
FLASK_HOST = _cfg("LIVESTREAM_HOST", "0.0.0.0")
FLASK_PORT = int(_cfg("LIVESTREAM_PORT", "8888"))

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
MAX_STORAGE_GB = int(_cfg("LIVESTREAM_MAX_STORAGE_GB", "5"))
MAX_STORAGE_BYTES = MAX_STORAGE_GB * 1024 * 1024 * 1024

STREAM_KEY_FILE = {
    "live": os.path.join(DATA_DIR, "stream_key.txt"),
    "test": os.path.join(DATA_DIR, "test_stream_key.txt"),
}

TITLE_FILE = {
    "live": os.path.join(BASE_DIR, "title.txt"),
    "test": os.path.join(BASE_DIR, "test_title.txt"),
}

BACKGROUND_IMAGE = _cfg("LIVESTREAM_BACKGROUND_IMAGE", os.path.join(BASE_DIR, "static", "background.jpg"))

SRS_HOST = _cfg("SRS_HOST", "127.0.0.1")
SRS_RTMP_PORT = int(_cfg("SRS_RTMP_PORT", _SRS_CONF_PORTS["rtmp"]))
SRS_HTTP_PORT = int(_cfg("SRS_HTTP_PORT", _cfg("SRS_HTTP_FLV_PORT", _SRS_CONF_PORTS["http"])))
SRS_API_PORT = int(_cfg("SRS_API_PORT", _SRS_CONF_PORTS["api"]))
SRS_API_BASE = _cfg("SRS_API_BASE", f"http://{SRS_HOST}:{SRS_API_PORT}/api/v1")
SRS_HTTP_FLV_PORT = SRS_HTTP_PORT
SRS_RTMP_INPUT_URL = _cfg("SRS_RTMP_INPUT_URL", f"rtmp://{SRS_HOST}:{SRS_RTMP_PORT}/live/stream")
SRS_RTMP_SMOOTH_URL = _cfg("SRS_RTMP_SMOOTH_URL", f"rtmp://{SRS_HOST}:{SRS_RTMP_PORT}/live/stream_smooth")

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

LOG_DIR = _cfg("LIVESTREAM_LOG_DIR", os.path.join(BASE_DIR, "logs"))
os.makedirs(LOG_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

CORS_ORIGINS = _cfg("LIVESTREAM_CORS_ORIGINS", "*")
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
