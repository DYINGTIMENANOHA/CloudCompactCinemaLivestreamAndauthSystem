"""Core token verification logic shared by cinema and livestream."""

import sqlite3
from pathlib import Path

from auth_lib.config import ADMIN_KEY_FILE, TOKENS_DB, VALID_ROOMS


def verify_watch_token(token, env=None):
    """Verify a watch token.

    Returns:
        tuple(bool, message, token_type)

    When env is provided, the watch token must belong to that room.
    Admin tokens are also accepted as watch tokens and are treated as "full".
    """
    if not token:
        return False, "missing token", "full"

    try:
        conn = sqlite3.connect(TOKENS_DB)
        c = conn.cursor()

        if env is None:
            c.execute(
                "SELECT active, token_type FROM tokens WHERE token=? AND type='watch'",
                (token,),
            )
        else:
            if env not in VALID_ROOMS:
                conn.close()
                return False, f"invalid room: {env}", "full"
            c.execute(
                "SELECT active, token_type FROM tokens WHERE token=? AND type='watch' AND room=?",
                (token, env),
            )

        result = c.fetchone()
        conn.close()

        if result and result[0] == 1:
            token_type = result[1] if result[1] in ("full", "group", "stealth") else "full"
            return True, "ok", token_type

        for room in VALID_ROOMS:
            ok, _ = verify_admin_token(token, room)
            if ok:
                return True, "admin token ok", "full"

        return False, "token is invalid or disabled", "full"

    except Exception as exc:
        return False, f"verification error: {exc}", "full"


def verify_admin_token(token, env):
    """Verify an admin token for one room.

    Livestream uses the same admin token as the SRS publish key.
    """
    if not token:
        return False, "missing token"
    if env not in ADMIN_KEY_FILE:
        return False, f"unknown room: {env}"

    try:
        key_path = Path(ADMIN_KEY_FILE[env])
        if not key_path.exists():
            return False, f"key file does not exist: {key_path}"
        valid_key = key_path.read_text().strip()
        if token == valid_key and len(valid_key) > 0:
            return True, "ok"
        return False, "admin token mismatch"
    except Exception as exc:
        return False, f"verification error: {exc}"


verify_stream_token = verify_admin_token
