"""
聊天室内存状态管理

聊天室和观影房间完全独立。
最后一个人退出就解散,消息不持久化。
"""
import time
from dataclasses import dataclass, field
from fastapi import WebSocket


@dataclass
class ChatMember:
    sid: str
    name: str
    ws: WebSocket
    is_voice: bool = False


@dataclass
class ChatRoom:
    id: str
    creator_name: str
    members: dict = field(default_factory=dict)   # sid -> ChatMember
    messages: list = field(default_factory=list)   # [{sender, text, time}]
    created_at: float = field(default_factory=time.time)

    @property
    def name(self):
        return f"{self.creator_name} 的聊天室"

    @property
    def member_count(self):
        return len(self.members)

    def add_message(self, sender: str, text: str):
        msg = {
            "sender": sender,
            "text": text,
            "time": time.strftime("%H:%M:%S"),
        }
        self.messages.append(msg)
        # 最多保留 500 条,防止内存膨胀
        if len(self.messages) > 500:
            self.messages = self.messages[-500:]
        return msg

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "creator_name": self.creator_name,
            "member_count": self.member_count,
            "members": [{"sid": m.sid, "name": m.name, "is_voice": m.is_voice}
                        for m in self.members.values()],
        }


# 全局状态
chat_rooms: dict[str, ChatRoom] = {}         # room_id -> ChatRoom
chat_sessions: dict[str, ChatMember] = {}    # sid -> ChatMember
session_room: dict[str, str] = {}            # sid -> room_id (每人只能在一个聊天室)
