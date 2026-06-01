"""
Token 校验模块 - cinema 版

委托给独立的 /opt/auth/auth_lib 系统:
- watch token: 必须归属 'cinema' 房间
- admin token: /opt/auth/keys/cinema_admin.key 的内容

返回 bool (保持原有接口签名,不影响调用方)
"""
import sys
from core import config

# 把 /opt/auth 加到 import 路径
auth_base = str(config.AUTH_BASE)
if auth_base not in sys.path:
    sys.path.insert(0, auth_base)

from auth_lib import verify_watch_token as _verify_watch
from auth_lib import verify_admin_token as _verify_admin


def verify_watch_token(token: str) -> bool:
    """校验 cinema 观看 token,管理员 token 也算有效。"""
    if not token:
        return False
    ok, _, _type = _verify_watch(token, env='cinema')
    return ok


def verify_admin_token(token: str) -> bool:
    """校验 cinema 管理员 token。"""
    if not token:
        return False
    ok, _ = _verify_admin(token, env='cinema')
    return ok


def get_token_type(token: str) -> str:
    """获取 token 类型: 'full' / 'group' / 'stealth'，默认 'full'。"""
    if not token:
        return "full"
    ok, _, token_type = _verify_watch(token, env='cinema')
    if ok:
        return token_type
    return "full"
