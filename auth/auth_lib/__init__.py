"""
统一 token 认证库
被 livestream 和 cinema 共用
"""
from auth_lib.verify import (
    verify_watch_token,
    verify_admin_token,
    verify_stream_token,
    VALID_ROOMS,
)
