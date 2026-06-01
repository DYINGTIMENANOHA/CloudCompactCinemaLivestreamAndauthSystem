"""Cinema token adapter backed by the shared auth library."""

import sys

from core import config


auth_base = str(config.AUTH_BASE)
if auth_base not in sys.path:
    sys.path.insert(0, auth_base)

from auth_lib import verify_admin_token as _verify_admin  # noqa: E402
from auth_lib import verify_watch_token as _verify_watch  # noqa: E402


def verify_watch_token(token: str) -> bool:
    """Verify a cinema watch token. Admin tokens are accepted as full access."""
    if not token:
        return False
    ok, _, _type = _verify_watch(token, env="cinema")
    return ok


def verify_admin_token(token: str) -> bool:
    """Verify a cinema admin token."""
    if not token:
        return False
    ok, _ = _verify_admin(token, env="cinema")
    return ok


def get_token_type(token: str) -> str:
    """Return token type: full, group, or stealth."""
    if not token:
        return "full"
    ok, _, token_type = _verify_watch(token, env="cinema")
    if ok:
        return token_type
    return "full"
