"""
聊天室 WebSocket 路由

端点: /cinema/chat-ws?token=xxx
完全独立于观影 WebSocket (/cinema/ws)
"""
import asyncio
import uuid
import time

from fastapi import APIRouter, WebSocket, Query
from core.auth import verify_watch_token
from core import chat_state as cs

router = APIRouter()


async def _send(member: cs.ChatMember, msg: dict):
    """安全发送消息给一个成员。"""
    try:
        await member.ws.send_json(msg)
    except Exception:
        pass


async def _broadcast_to_room(room: cs.ChatRoom, msg: dict, exclude_sid: str = None):
    """广播消息给聊天室内所有成员。"""
    for sid, member in list(room.members.items()):
        if sid == exclude_sid:
            continue
        await _send(member, msg)


async def _broadcast_room_list():
    """给所有已连接但未加入聊天室的用户发送房间列表。"""
    rooms_data = [r.to_dict() for r in cs.chat_rooms.values()]
    msg = {"type": "chat_room_list", "rooms": rooms_data}
    for sid, member in list(cs.chat_sessions.items()):
        if sid not in cs.session_room:
            await _send(member, msg)


async def _send_room_list(member: cs.ChatMember):
    """给单个用户发送房间列表。"""
    rooms_data = [r.to_dict() for r in cs.chat_rooms.values()]
    await _send(member, {"type": "chat_room_list", "rooms": rooms_data})


async def _handle_create(member: cs.ChatMember):
    """创建新聊天室并自动加入。"""
    # 如果已在聊天室,先退出
    if member.sid in cs.session_room:
        await _handle_leave(member, broadcast=True)

    room_id = str(uuid.uuid4())[:8]
    room = cs.ChatRoom(id=room_id, creator_name=member.name)
    room.members[member.sid] = member
    cs.chat_rooms[room_id] = room
    cs.session_room[member.sid] = room_id

    await _send(member, {
        "type": "chat_room_joined",
        "room": room.to_dict(),
        "messages": [],
    })

    # 通知其他在线用户(大厅)更新房间列表
    await _broadcast_room_list()
    print(f"[chat] {member.name} created room {room_id}")


async def _handle_join(member: cs.ChatMember, room_id: str):
    """加入已有聊天室。"""
    room = cs.chat_rooms.get(room_id)
    if not room:
        await _send(member, {"type": "chat_error", "message": "聊天室不存在或已解散"})
        return

    # 如果已在其他聊天室,先退出
    if member.sid in cs.session_room:
        await _handle_leave(member, broadcast=True)

    room.members[member.sid] = member
    cs.session_room[member.sid] = room_id

    # 发加入成功(附带历史消息)
    await _send(member, {
        "type": "chat_room_joined",
        "room": room.to_dict(),
        "messages": room.messages[-100:],  # 最近 100 条
    })

    # 通知其他成员
    await _broadcast_to_room(room, {
        "type": "chat_member_joined",
        "name": member.name,
        "sid": member.sid,
        "room": room.to_dict(),
    }, exclude_sid=member.sid)

    # 更新大厅列表
    await _broadcast_room_list()
    print(f"[chat] {member.name} joined room {room_id}")


async def _handle_leave(member: cs.ChatMember, broadcast: bool = True):
    """退出聊天室。"""
    # 离开时关闭语音
    if member.is_voice:
        member.is_voice = False

    room_id = cs.session_room.pop(member.sid, None)
    if not room_id:
        return

    room = cs.chat_rooms.get(room_id)
    if not room:
        return

    room.members.pop(member.sid, None)

    if room.member_count == 0:
        # 最后一个人退出 → 解散
        del cs.chat_rooms[room_id]
        print(f"[chat] room {room_id} dissolved (empty)")
    elif broadcast:
        # 通知剩余成员
        await _broadcast_to_room(room, {
            "type": "chat_member_left",
            "name": member.name,
            "sid": member.sid,
            "room": room.to_dict(),
        })

    await _send(member, {"type": "chat_room_left"})

    # 更新大厅列表
    await _broadcast_room_list()


async def _handle_send(member: cs.ChatMember, text: str):
    """发送聊天消息。"""
    room_id = cs.session_room.get(member.sid)
    if not room_id:
        return

    room = cs.chat_rooms.get(room_id)
    if not room:
        return

    text = text.strip()
    if not text or len(text) > 1000:
        return

    msg_data = room.add_message(member.name, text)

    await _broadcast_to_room(room, {
        "type": "chat_msg",
        "sender": msg_data["sender"],
        "sender_sid": member.sid,
        "text": msg_data["text"],
        "time": msg_data["time"],
    })


async def _handle_voice_join(member: cs.ChatMember):
    """用户开启语音。"""
    member.is_voice = True
    room_id = cs.session_room.get(member.sid)
    if not room_id:
        return
    room = cs.chat_rooms.get(room_id)
    if not room:
        return
    # 广播语音状态更新
    participants = [{"sid": m.sid, "name": m.name}
                    for m in room.members.values() if m.is_voice]
    await _broadcast_to_room(room, {
        "type": "voice_state",
        "participants": participants,
    })
    print(f"[chat] {member.name} joined voice in room {room_id}")


async def _handle_voice_leave(member: cs.ChatMember):
    """用户关闭语音。"""
    member.is_voice = False
    room_id = cs.session_room.get(member.sid)
    if not room_id:
        return
    room = cs.chat_rooms.get(room_id)
    if not room:
        return
    participants = [{"sid": m.sid, "name": m.name}
                    for m in room.members.values() if m.is_voice]
    await _broadcast_to_room(room, {
        "type": "voice_state",
        "participants": participants,
    })
    print(f"[chat] {member.name} left voice in room {room_id}")


async def _handle_voice_signal(member: cs.ChatMember, data: dict):
    """转发 WebRTC 信令给目标用户。"""
    target_sid = data.get("target", "")
    target = cs.chat_sessions.get(target_sid)
    if not target:
        return
    # 确保两人在同一个聊天室
    my_room = cs.session_room.get(member.sid)
    target_room = cs.session_room.get(target_sid)
    if not my_room or my_room != target_room:
        return
    await _send(target, {
        "type": "voice_signal",
        "from_sid": member.sid,
        "from_name": member.name,
        "signal_type": data.get("signal_type", ""),
        "data": data.get("data", {}),
    })


@router.websocket("/cinema/chat-ws")
async def chat_websocket(ws: WebSocket, token: str = Query("")):
    """聊天室 WebSocket 端点。"""
    if not token or not verify_watch_token(token):
        await ws.close(code=4001, reason="invalid token")
        return

    await ws.accept()
    sid = str(uuid.uuid4())[:8]
    member: cs.ChatMember | None = None

    try:
        # 等待 hello
        hello = await asyncio.wait_for(ws.receive_json(), timeout=10)
        if hello.get("type") != "chat_hello":
            await ws.close(code=4002, reason="expected chat_hello")
            return

        name = hello.get("name", "").strip()
        if not name:
            await ws.close(code=4003, reason="name required")
            return

        member = cs.ChatMember(sid=sid, name=name, ws=ws)
        cs.chat_sessions[sid] = member

        await ws.send_json({"type": "chat_welcome", "sid": sid})

        # 发送当前活跃的聊天室列表
        await _send_room_list(member)

        print(f"[chat] {name} ({sid}) connected")

        # 消息循环
        while True:
            try:
                data = await asyncio.wait_for(ws.receive_json(), timeout=60)
            except asyncio.TimeoutError:
                # 发心跳探测
                try:
                    await ws.send_json({"type": "chat_ping"})
                except Exception:
                    break
                continue

            msg_type = data.get("type", "")

            if msg_type == "chat_create":
                await _handle_create(member)
            elif msg_type == "chat_join":
                await _handle_join(member, data.get("room_id", ""))
            elif msg_type == "chat_leave":
                await _handle_leave(member)
            elif msg_type == "chat_send":
                await _handle_send(member, data.get("text", ""))
            elif msg_type == "chat_list":
                await _send_room_list(member)
            elif msg_type == "chat_pong":
                pass  # 心跳回复
            elif msg_type == "voice_join":
                await _handle_voice_join(member)
            elif msg_type == "voice_leave":
                await _handle_voice_leave(member)
            elif msg_type == "voice_signal":
                await _handle_voice_signal(member, data)
            else:
                pass

    except Exception as e:
        if "1000" not in str(e) and "1001" not in str(e):
            print(f"[chat] {sid} error: {e}")
    finally:
        # 清理
        if member:
            await _handle_leave(member, broadcast=True)
            cs.chat_sessions.pop(sid, None)
            print(f"[chat] {member.name} ({sid}) disconnected")
