"""
数据库工具模块 - SQLite操作封装
"""
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
import config

CST = timezone(timedelta(hours=8))


def init_db(env="live"):
    env_config = config.get_env_config(env)
    Path(env_config["db_comments"]).parent.mkdir(parents=True, exist_ok=True)
    Path(env_config["db_recordings"]).parent.mkdir(parents=True, exist_ok=True)
    Path(env_config["recordings_dir"]).mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(env_config["db_comments"]) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                session_id TEXT NOT NULL,
                parent_id INTEGER,
                is_admin INTEGER NOT NULL DEFAULT 0,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

    with sqlite3.connect(env_config["db_recordings"]) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS recordings (
                session_id TEXT PRIMARY KEY,
                title TEXT,
                filepath TEXT,
                filesize INTEGER DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'completed',
                start_time TIMESTAMP,
                end_time TIMESTAMP
            )
            """
        )

def to_cst_iso(utc_str):
    """将UTC时间字符串转换为带时区的ISO 8601格式（北京时间）"""
    if not utc_str:
        return utc_str
    try:
        dt = datetime.strptime(utc_str, '%Y-%m-%d %H:%M:%S')
        dt = dt.replace(tzinfo=timezone.utc).astimezone(CST)
        return dt.isoformat()  # 输出: 2026-02-21T15:33:07+08:00
    except:
        return utc_str

def get_comments(env='live', session_id=None):
    """
    获取评论列表
    
    Args:
        env: 'live' 或 'test'
        session_id: 可选的会话ID（用于获取回放评论）
    
    Returns:
        list: 评论列表
    """
    env_config = config.get_env_config(env)
    db_path = env_config['db_comments']
    
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    
    if session_id:
        c.execute("""SELECT id, content, is_admin, is_pinned, created_at, parent_id
                     FROM comments WHERE session_id=? ORDER BY is_pinned DESC, created_at DESC""", 
                  (session_id,))
    else:
        c.execute("""SELECT id, content, is_admin, is_pinned, created_at, parent_id
                     FROM comments ORDER BY is_pinned DESC, created_at DESC""")
    
    comments = [{
        'id': row[0],
        'content': row[1],
        'is_admin': row[2],
        'is_pinned': row[3],
        'time': to_cst_iso(row[4]),
        'parent_id': row[5]
    } for row in c.fetchall()]
    
    conn.close()
    return comments

def add_comment(content, session_id, parent_id=None, is_admin=False, is_pinned=False, env='live'):
    """
    添加评论
    
    Args:
        content: 评论内容
        session_id: 会话ID
        parent_id: 父评论ID（回复时使用）
        is_admin: 是否管理员评论
        is_pinned: 是否置顶
        env: 'live' 或 'test'
    
    Returns:
        bool: 是否成功
    """
    if not content:
        return False
    
    env_config = config.get_env_config(env)
    db_path = env_config['db_comments']
    
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("""INSERT INTO comments (content, session_id, parent_id, is_admin, is_pinned)
                     VALUES (?, ?, ?, ?, ?)""",
                  (content, session_id, parent_id, 1 if is_admin else 0, 1 if is_pinned else 0))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"添加评论失败: {e}")
        return False

def toggle_pin_comment(comment_id, pinned, env='live'):
    """
    切换评论置顶状态
    
    Args:
        comment_id: 评论ID
        pinned: 是否置顶
        env: 'live' 或 'test'
    
    Returns:
        bool: 是否成功
    """
    env_config = config.get_env_config(env)
    db_path = env_config['db_comments']
    
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("UPDATE comments SET is_pinned=? WHERE id=?", 
                  (1 if pinned else 0, comment_id))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"置顶评论失败: {e}")
        return False

def delete_comment(comment_id, env='live'):
    """
    删除评论
    
    Args:
        comment_id: 评论ID
        env: 'live' 或 'test'
    
    Returns:
        bool: 是否成功
    """
    env_config = config.get_env_config(env)
    db_path = env_config['db_comments']
    
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("DELETE FROM comments WHERE id=?", (comment_id,))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"删除评论失败: {e}")
        return False

def get_recordings(env='live'):
    """
    获取录制列表
    
    Args:
        env: 'live' 或 'test'
    
    Returns:
        list: 录制列表
    """
    env_config = config.get_env_config(env)
    db_path = env_config['db_recordings']
    
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("""SELECT session_id, title, filesize, start_time, end_time
                     FROM recordings WHERE status='completed' ORDER BY start_time DESC""")
        recordings = [{
            'session_id': row[0],
            'title': row[1],
            'filesize': row[2],
            'start_time': row[3],
            'end_time': row[4]
        } for row in c.fetchall()]
        conn.close()
        return recordings
    except Exception as e:
        print(f"获取录制列表失败: {e}")
        return []

def get_recording_file(session_id, env='live'):
    """
    获取录制文件路径
    
    Args:
        session_id: 会话ID
        env: 'live' 或 'test'
    
    Returns:
        tuple: (filepath, title) 或 (None, None)
    """
    env_config = config.get_env_config(env)
    db_path = env_config['db_recordings']
    
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("SELECT filepath, title FROM recordings WHERE session_id=?", (session_id,))
        result = c.fetchone()
        conn.close()
        
        if result:
            return result[0], result[1]
        return None, None
    except Exception as e:
        print(f"获取录制文件失败: {e}")
        return None, None
