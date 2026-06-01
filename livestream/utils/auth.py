"""Token validation adapter for the shared auth library."""

import os
import sys
from pathlib import Path


AUTH_BASE = os.getenv("AUTH_BASE", str(Path(__file__).resolve().parents[2] / "auth"))
if AUTH_BASE not in sys.path:
    sys.path.insert(0, AUTH_BASE)

from auth_lib import (  # noqa: E402
    verify_watch_token as _verify_watch,
    verify_stream_token as _verify_stream,
)


# Livestream only exposes live/test rooms.
VALID_ROOMS = ("live", "test")


def verify_watch_token(token, env=None):
    """Verify a watch token and keep the legacy return signature."""
    return _verify_watch(token, env=env)


def verify_stream_token(token, env="live"):
    """Verify an SRS publish/admin token and keep the legacy return signature."""
    return _verify_stream(token, env=env)
