"""
认证工具模块 - Token验证

委托给独立的 /opt/auth/auth_lib 系统
保持原有函数签名,直播现有代码无需改动
"""
import os
import sys
from pathlib import Path

# 把 /opt/auth 加到 import 路径
AUTH_BASE = os.getenv("AUTH_BASE", str(Path(__file__).resolve().parents[2] / "auth"))
if AUTH_BASE not in sys.path:
    sys.path.insert(0, AUTH_BASE)

from auth_lib import (
    verify_watch_token as _verify_watch,
    verify_stream_token as _verify_stream,
    VALID_ROOMS as _VALID,
)

# 直播原版 VALID_ROOMS 不包括 cinema,但有 cinema 也无所谓(不影响直播逻辑)
VALID_ROOMS = ('live', 'test')


def verify_watch_token(token, env=None):
    """
    验证观看Token (保持原签名)

    Args:
        token: Token字符串
        env: 'live' / 'test' / None
    Returns:
        tuple: (是否有效, 消息)
    """
    return _verify_watch(token, env=env)


def verify_stream_token(token, env='live'):
    """
    验证推流Token (保持原签名)

    Args:
        token: Token字符串
        env: 'live' / 'test'
    Returns:
        tuple: (是否有效, 消息)
    """
    return _verify_stream(token, env=env)
