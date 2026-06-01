"""
会话管理模块 - 管理当前直播会话ID
用于评论系统关联到当前直播
"""

# 全局会话ID存储
_sessions = {
    'live': None,
    'test': None
}

def get_current_session(env='live'):
    """
    获取当前会话ID
    
    Args:
        env: 'live' 或 'test'
    
    Returns:
        str: 会话ID或None
    """
    return _sessions.get(env)

def set_current_session(session_id, env='live'):
    """
    设置当前会话ID
    
    Args:
        session_id: 会话ID
        env: 'live' 或 'test'
    """
    _sessions[env] = session_id
    print(f"[{env.upper()}] 当前会话: {session_id}")

def clear_current_session(env='live'):
    """
    清除当前会话ID
    
    Args:
        env: 'live' 或 'test'
    """
    session_id = _sessions[env]
    _sessions[env] = None
    print(f"[{env.upper()}] 会话结束: {session_id}")
