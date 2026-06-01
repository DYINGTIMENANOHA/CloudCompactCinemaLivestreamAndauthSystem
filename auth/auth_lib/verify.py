"""
Token 验证核心逻辑

verify_watch_token(token, env=None):
  - env 指定房间(如 'cinema'): 必须是该房间的 watch token
  - env 不传: 任意房间的 watch token 都放行(用于 monitor 等无关接口)
  - admin token 在任何房间都视为有效 watch

verify_admin_token(token, env): 校验某个房间的 admin token (推流密钥)
verify_stream_token(token, env): 同 verify_admin_token (向后兼容直播命名)
"""
import sqlite3
from pathlib import Path
from auth_lib.config import TOKENS_DB, ADMIN_KEY_FILE, VALID_ROOMS


def verify_watch_token(token, env=None):
    """
    验证观看 token

    Returns:
        tuple(bool, msg, token_type)
        - token_type: 'full' / 'group' / 'stealth'，失败时返回 'full'（无意义占位）
    """
    if not token:
        return False, "未提供Token", "full"

    try:
        conn = sqlite3.connect(TOKENS_DB)
        c = conn.cursor()

        if env is None:
            c.execute(
                "SELECT active, token_type FROM tokens WHERE token=? AND type='watch'",
                (token,)
            )
        else:
            if env not in VALID_ROOMS:
                conn.close()
                return False, f"非法房间: {env}", "full"
            c.execute(
                "SELECT active, token_type FROM tokens WHERE token=? AND type='watch' AND room=?",
                (token, env)
            )

        result = c.fetchone()
        conn.close()

        if result and result[0] == 1:
            token_type = result[1] if result[1] in ("full", "group", "stealth") else "full"
            return True, "验证成功", token_type

        # 管理员 token 也算有效 watch (任何房间),固定 full 类型
        for room in VALID_ROOMS:
            ok, _ = verify_admin_token(token, room)
            if ok:
                return True, "管理员验证成功", "full"

        return False, "Token无效或已禁用", "full"

    except Exception as e:
        return False, f"验证错误: {str(e)}", "full"


def verify_admin_token(token, env):
    """
    验证管理员 token (推流密钥)

    Args:
        token: token 字符串
        env: 'live' / 'test' / 'chutianshu' / 'cinema'
    """
    if not token:
        return False, "未提供Token"
    if env not in ADMIN_KEY_FILE:
        return False, f"未知房间: {env}"

    try:
        key_path = Path(ADMIN_KEY_FILE[env])
        if not key_path.exists():
            return False, f"密钥文件不存在: {key_path}"
        valid_key = key_path.read_text().strip()
        if token == valid_key and len(valid_key) > 0:
            return True, "验证成功"
        return False, "推流密钥错误"
    except Exception as e:
        return False, f"验证错误: {str(e)}"


# 别名: livestream 现有代码用这个名字
verify_stream_token = verify_admin_token
