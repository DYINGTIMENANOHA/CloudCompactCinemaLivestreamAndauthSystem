"""
全局运行时状态

会话、房间(隐式)、pending 操作、配置缓存。
所有数据都在内存里,进程重启会清空。
"""
from dataclasses import dataclass, field
from typing import Optional, Any
import time


@dataclass
class Session:
    """一个 WebSocket 会话。"""
    sid: str
    name: str
    ws: Any  # 实际是 fastapi.WebSocket,不强类型
    video_id: Optional[str] = None
    host_sid: Optional[str] = None  # 自己当房主时 = sid;加入别人时 = 那人的 sid
    last_heartbeat: float = field(default_factory=time.time)
    joined_at: float = field(default_factory=time.time)
    token: str = ""
    token_type: str = "full"  # 'full' / 'group' / 'stealth'


@dataclass
class PendingAction:
    """同步操作的待决状态。"""
    request_id: str
    initiator_sid: str
    action: str  # seek / play / pause
    params: dict
    deadline: float
    timer_task: Any  # asyncio.Task


# 在线会话: sid -> Session
sessions: dict[str, Session] = {}

# 待决操作: room_id (= host_sid) -> PendingAction
pending_actions: dict[str, PendingAction] = {}

# 配置缓存,启动时从 SQLite 加载,改动时同步写回
config_cache: dict[str, str] = {}


def get_room_members(host_sid: str) -> list[Session]:
    """返回房间所有成员的 Session 列表。"""
    return [s for s in sessions.values() if s.host_sid == host_sid]


def get_all_rooms() -> dict[str, list[Session]]:
    """返回所有房间的快照,key 是 host_sid,value 是成员列表。"""
    rooms: dict[str, list[Session]] = {}
    for sess in sessions.values():
        if sess.host_sid is None:
            continue
        rooms.setdefault(sess.host_sid, []).append(sess)
    return rooms


async def broadcast_to_room(host_sid: str, message: dict, exclude: Optional[str] = None):
    """对房间所有成员发消息,exclude 是要跳过的 sid。"""
    members = get_room_members(host_sid)
    for sess in members:
        if sess.sid == exclude:
            continue
        try:
            await sess.ws.send_json(message)
        except Exception as e:
            print(f"[broadcast] failed to send to {sess.sid}: {e}")


# 房主连续操作触发的锁定期 room_id -> 过期时间戳
opportunity_locks: dict = {}


# 房主切换视频的待定状态: old_host_sid -> {
#     "new_video_id": str,
#     "followers": set[sid],
#     "expire_at": float,
#     "host_name": str,
#     "timer_task": asyncio.Task,
# }
pending_switches: dict = {}


# 房主断线宽限期: (token, name) -> {
#     "old_host_sid": str,
#     "video_id": Optional[str],
#     "expire_at": float,
#     "timer_task": asyncio.Task,
# }
pending_reconnects: dict = {}


def is_visible_to(target: Session, viewer: Session) -> bool:
    """
    判断 target 对 viewer 是否可见。
    规则:
    - stealth: 对任何人不可见
    - full: 对 full/stealth 可见，对 group 不可见
    - group: 对 full/stealth 可见，对同 token 的 group 可见
    """
    if target.token_type == "stealth":
        return False
    if target.token_type == "full":
        return viewer.token_type in ("full", "stealth")
    # target 是 group
    if viewer.token_type in ("full", "stealth"):
        return True
    return target.token == viewer.token
