"""
WebSocket 端点 - 含同步机制 + 加入房间自动追上
"""
import asyncio
import uuid
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from core.auth import verify_watch_token, get_token_type
from core import state, db

router = APIRouter()

HEARTBEAT_TIMEOUT = 45


async def _broadcast_room_update():
    dead_sids = []
    for sid, sess in list(state.sessions.items()):
        snapshot = _build_room_snapshot(sess)
        message = {"type": "room_update", "rooms": snapshot}
        try:
            await sess.ws.send_json(message)
        except Exception:
            dead_sids.append(sid)
    for sid in dead_sids:
        state.sessions.pop(sid, None)


def _build_room_snapshot(viewer: state.Session):
    by_video: dict[str, list[state.Session]] = {}
    for sess in state.sessions.values():
        # 跳过 WAITING 状态(切换跟随中)
        if isinstance(sess.host_sid, str) and sess.host_sid.startswith("WAITING:"):
            continue
        # 隐身用户不出现在任何人的列表里
        if not state.is_visible_to(sess, viewer):
            continue
        vid = sess.video_id or "_none"
        by_video.setdefault(vid, []).append(sess)

    result = []
    for video_id, viewers in by_video.items():
        video_name = video_id
        if video_id != "_none":
            video = db.get_video(video_id)
            if video:
                video_name = video.get("display_name", video_id)

        viewer_list = []
        for v in viewers:
            viewer_list.append({
                "sid": v.sid,
                "name": v.name,
                "is_host": v.host_sid == v.sid,
                "host_sid": v.host_sid,
                "video_id": v.video_id,
                "token_type": v.token_type,
            })

        result.append({
            "video_id": video_id,
            "video_name": video_name,
            "viewers": viewer_list,
        })
    return result


async def _send(sid: str, msg: dict):
    sess = state.sessions.get(sid)
    if sess:
        try:
            await sess.ws.send_json(msg)
        except Exception:
            pass


async def _send_toast(sid: str, message: str):
    await _send(sid, {"type": "toast", "message": message})


def _get_veto_config():
    enabled = state.config_cache.get("veto_enabled", "1")
    delay = state.config_cache.get("veto_delay_seconds", "3")
    try:
        delay_sec = int(delay)
    except ValueError:
        delay_sec = 3
    is_enabled = enabled == "1" and delay_sec > 0
    return is_enabled, delay_sec


def _dissolve_room(host_sid: str):
    members_to_notify = []
    for s in list(state.sessions.values()):
        if s.host_sid == host_sid and s.sid != host_sid:
            s.host_sid = s.sid
            members_to_notify.append(s)
    return members_to_notify


async def _ask_position(target_session: state.Session, request_id: str) -> float:
    """问某个用户的当前播放位置,最多等 3 秒。只返回位置。"""
    pos, _ = await _ask_position_full(target_session, request_id)
    return pos


async def _ask_position_full(target_session: state.Session, request_id: str) -> tuple[float, bool]:
    """问某个用户的当前播放位置和播放状态,返回 (position, paused)。"""
    await _send(target_session.sid, {
        "type": "report_position_request",
        "request_id": request_id,
    })
    target_session._pending_report_id = request_id
    target_session._pending_report_future = asyncio.get_event_loop().create_future()
    try:
        result = await asyncio.wait_for(target_session._pending_report_future, timeout=3.0)
        if isinstance(result, dict):
            return float(result.get("position", 0)), bool(result.get("paused", False))
        return float(result), False
    except (asyncio.TimeoutError, asyncio.CancelledError):
        return 0.0, False
    finally:
        target_session._pending_report_id = None
        target_session._pending_report_future = None


async def _handle_join_room(session: state.Session, data: dict):
    target_sid = data.get("target_sid", "").strip()
    if not target_sid or target_sid == session.sid:
        return

    target = state.sessions.get(target_sid)
    if not target:
        await _send_toast(session.sid, "该用户已离线")
        return

    # 不能加入没在看视频的人
    actual_host_sid = target.host_sid
    actual_host = state.sessions.get(actual_host_sid)
    if not actual_host:
        await _send_toast(session.sid, "该房间已不存在")
        return

    # token 可见性校验: 加入者必须能看到房主
    if not state.is_visible_to(actual_host, session):
        await _send_toast(session.sid, "该用户已离线")
        return

    if not actual_host.video_id:
        await _send_toast(session.sid, "对方当前没有在观看视频")
        return

    if session.host_sid == actual_host_sid:
        return

    # 问房主当前位置和播放状态
    req_id = "join_" + str(uuid.uuid4())[:6]
    host_position, host_paused = await _ask_position_full(actual_host, req_id)

    # 如果自己是房主且有成员,先解散
    if session.host_sid == session.sid:
        members = _dissolve_room(session.sid)
        for m in members:
            await _send_toast(m.sid, f"房主 {session.name} 离开了,房间已解散")
            await _send(m.sid, {"type": "room_dissolved", "reason": "host_left"})

    session.host_sid = actual_host_sid
    session.video_id = actual_host.video_id

    video_info = None
    if actual_host.video_id:
        video_info = db.get_video(actual_host.video_id)

    await session.ws.send_json({
        "type": "joined_room",
        "host_sid": actual_host_sid,
        "host_name": actual_host.name,
        "video_id": actual_host.video_id or "",
        "video_name": video_info.get("display_name", "") if video_info else "",
        "filename": video_info.get("filename", "") if video_info else "",
        "current_time": host_position,
        "paused": host_paused,
        "auto_play": not host_paused,
    })

    await _send_toast(actual_host_sid, f"{session.name} 加入了你的房间")
    for m in state.get_room_members(actual_host_sid):
        if m.sid != session.sid and m.sid != actual_host_sid:
            await _send_toast(m.sid, f"{session.name} 加入了房间")

    await _broadcast_room_update()
    print(f"[ws] {session.sid} ({session.name}) joined room of {actual_host_sid}, host_pos={host_position:.1f}")


async def _handle_leave_room(session: state.Session):
    if session.host_sid == session.sid:
        return

    old_host_sid = session.host_sid
    session.host_sid = session.sid

    old_host = state.sessions.get(old_host_sid)
    if old_host:
        await _send_toast(old_host_sid, f"{session.name} 离开了房间")
    for m in state.get_room_members(old_host_sid):
        if m.sid != session.sid:
            await _send_toast(m.sid, f"{session.name} 离开了房间")

    await _send_toast(session.sid, "你已离开房间,当前独立观看")
    await _broadcast_room_update()
    print(f"[ws] {session.sid} ({session.name}) left room of {old_host_sid}")


async def _trigger_sync_opportunity(initiator: state.Session, room_id: str):
    """房主连续操作,触发 3 秒同步机会广播给成员。"""
    DELAY = 3
    state.opportunity_locks[room_id] = time.time() + DELAY

    members = state.get_room_members(room_id)
    for m in members:
        if m.sid == initiator.sid:
            continue
        await _send(m.sid, {
            "type": "sync_opportunity",
            "host_name": initiator.name,
            "delay_seconds": DELAY,
        })
    print(f"[sync] opportunity triggered in room {room_id} by host {initiator.name}")


async def _handle_sync_action(session: state.Session, data: dict):
    room_id = session.host_sid
    action = data.get("action", "")
    params = data.get("params", {})

    if action not in ("seek", "play", "pause"):
        return

    members = state.get_room_members(room_id)
    if len(members) <= 1:
        return

    # 检查 opportunity 锁(房主连续操作后的静默期,所有房主 action 都被忽略)
    lock_until = state.opportunity_locks.get(room_id, 0)
    if time.time() < lock_until:
        if session.sid == room_id:
            return  # 房主在锁定期内的操作直接忽略

    existing = state.pending_actions.get(room_id)
    if existing:
        if existing.initiator_sid == session.sid:
            # 发起者覆盖自己的 pending
            is_host = (session.sid == room_id)
            existing.timer_task.cancel()
            del state.pending_actions[room_id]

            if is_host:
                # 房主自覆盖 → 触发 sync_opportunity,不继续创建新 pending
                await _trigger_sync_opportunity(session, room_id)
                return
            # 成员自覆盖 → 保持原行为,继续创建新 pending
        else:
            await _send_toast(session.sid, "有一个同步操作正在进行,请稍候")
            return

    veto_enabled, veto_delay = _get_veto_config()

    if not veto_enabled or veto_delay <= 0:
        await _apply_sync(session, room_id, action, params)
        return

    request_id = str(uuid.uuid4())[:8]

    for m in members:
        if m.sid == session.sid:
            continue
        await _send(m.sid, {
            "type": "sync_pending",
            "request_id": request_id,
            "initiator_name": session.name,
            "action": action,
            "params": params,
            "delay_seconds": veto_delay,
        })

    async def timer_callback():
        try:
            await asyncio.sleep(veto_delay)
        except asyncio.CancelledError:
            return

        pending = state.pending_actions.get(room_id)
        if not pending or pending.request_id != request_id:
            return
        del state.pending_actions[room_id]

        initiator = state.sessions.get(session.sid)
        if not initiator:
            return

        if action == "seek":
            try:
                reported = await _ask_position(initiator, request_id + "_pos")
                params["time"] = reported
            except Exception:
                pass

        await _apply_sync(session, room_id, action, params)

    timer_task = asyncio.create_task(timer_callback())

    state.pending_actions[room_id] = state.PendingAction(
        request_id=request_id,
        initiator_sid=session.sid,
        action=action,
        params=params,
        deadline=time.time() + veto_delay,
        timer_task=timer_task,
    )
    print(f"[sync] pending {action} by {session.name} in room {room_id}")


async def _apply_sync(initiator: state.Session, room_id: str, action: str, params: dict):
    members = state.get_room_members(room_id)
    for m in members:
        if m.sid == initiator.sid:
            continue
        await _send(m.sid, {
            "type": "sync_apply",
            "action": action,
            "params": params,
            "initiator_name": initiator.name,
        })
    print(f"[sync] applied {action} by {initiator.name} in room {room_id}")


async def _handle_sync_veto(session: state.Session, data: dict):
    room_id = session.host_sid
    request_id = data.get("request_id", "")

    pending = state.pending_actions.get(room_id)
    if not pending or pending.request_id != request_id:
        return

    pending.timer_task.cancel()
    del state.pending_actions[room_id]

    members = state.get_room_members(room_id)
    for m in members:
        await _send(m.sid, {
            "type": "sync_vetoed",
            "request_id": request_id,
            "veto_by": session.name,
        })
    print(f"[sync] vetoed by {session.name} in room {room_id}")


async def _handle_report_position(session: state.Session, data: dict):
    request_id = data.get("request_id", "")
    # 支持新格式(带 paused)和旧格式(只有 position)
    if "paused" in data:
        result = {"position": data.get("position", 0), "paused": data.get("paused", False)}
    else:
        result = data.get("position", 0)
    if hasattr(session, '_pending_report_id') and session._pending_report_id == request_id:
        if hasattr(session, '_pending_report_future') and session._pending_report_future:
            if not session._pending_report_future.done():
                session._pending_report_future.set_result(result)


async def _handle_catch_up(session: state.Session):
    if session.host_sid == session.sid:
        return
    host = state.sessions.get(session.host_sid)
    if not host:
        return
    try:
        # 问房主位置和播放状态
        req_id = "catchup_" + session.sid
        await _send(host.sid, {
            "type": "report_position_request",
            "request_id": req_id,
        })
        host._pending_report_id = req_id
        host._pending_report_future = asyncio.get_event_loop().create_future()
        try:
            result = await asyncio.wait_for(host._pending_report_future, timeout=3.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            await _send_toast(session.sid, "无法获取房主位置")
            return
        finally:
            host._pending_report_id = None
            host._pending_report_future = None

        if isinstance(result, dict):
            position = float(result.get("position", 0))
            paused = bool(result.get("paused", False))
        else:
            position = float(result)
            paused = False

        await _send(session.sid, {
            "type": "catch_up_result",
            "position": position,
            "paused": paused,
        })
    except Exception as e:
        print(f"[ws] catch_up error: {e}")
        await _send_toast(session.sid, "无法获取房主位置")


async def _handle_host_switch_video(session: state.Session, data: dict):
    """房主请求切换视频 — 房主立刻跳转,成员自行决定是否跟随。"""
    if session.host_sid != session.sid:
        await _send_toast(session.sid, "只有房主能切换视频")
        return

    new_video_id = data.get("new_video_id", "").strip()
    if not new_video_id:
        return

    new_video = db.get_video(new_video_id)
    if not new_video:
        await _send_toast(session.sid, "视频不存在")
        return

    members = state.get_room_members(session.sid)
    other_members = [m for m in members if m.sid != session.sid]

    # 先把所有成员设为独立
    for m in other_members:
        m.host_sid = m.sid

    # 通知成员: 房主切换了视频,你可以选择跟随或留下
    for m in other_members:
        await _send(m.sid, {
            "type": "host_switched_video",
            "host_name": session.name,
            "host_sid": session.sid,
            "new_video_id": new_video_id,
            "new_video_name": new_video.get("display_name", ""),
        })

    # 广播房间更新(成员已变独立)
    await _broadcast_room_update()

    # 房主立刻跳转
    await _send(session.sid, {
        "type": "host_switch_go",
        "new_video_id": new_video_id,
        "filename": new_video.get("filename", ""),
    })

    print(f"[switch] host {session.name} switching immediately to {new_video_id}, notified {len(other_members)} member(s)")


async def _handle_follow_host_switch(session: state.Session):
    """已废弃: 成员现在自行跳转,不再通过服务端 follow 机制。"""
    pass


async def _handle_cancel_follow(session: state.Session):
    """已废弃: 成员现在自行决定,不再通过服务端 cancel 机制。"""
    pass


@router.websocket("/cinema/ws")
async def websocket_endpoint(ws: WebSocket, token: str = Query("")):
    if not token or not verify_watch_token(token):
        await ws.close(code=4001, reason="invalid token")
        return

    await ws.accept()
    sid = str(uuid.uuid4())[:8]
    session: state.Session | None = None
    token_type = get_token_type(token)

    try:
        hello = await asyncio.wait_for(ws.receive_json(), timeout=10)
        if hello.get("type") != "hello":
            await ws.close(code=4002, reason="expected hello")
            return

        name = hello.get("name", "").strip()
        video_id = hello.get("video_id", "").strip()
        if not name:
            await ws.close(code=4003, reason="name required")
            return

        session = state.Session(
            sid=sid, name=name, ws=ws,
            video_id=video_id if video_id else None,
            host_sid=sid,
            token=token,
            token_type=token_type,
        )
        state.sessions[sid] = session
        print(f"[ws] connected: {sid} ({name}), video={video_id}, token_type={token_type}")

        await ws.send_json({"type": "welcome", "sid": sid})

        # 重连恢复: 检查 previous_host_sid 是否还在线
        previous_host_sid = hello.get("previous_host_sid", "").strip()
        if previous_host_sid and previous_host_sid != sid:
            prev_host = state.sessions.get(previous_host_sid)
            if prev_host and prev_host.video_id and state.is_visible_to(prev_host, session):
                req_id = "reconnect_" + str(uuid.uuid4())[:6]
                try:
                    host_position, host_paused = await _ask_position_full(prev_host, req_id)
                except Exception:
                    host_position, host_paused = 0.0, True

                session.host_sid = previous_host_sid
                session.video_id = prev_host.video_id

                video_info = db.get_video(prev_host.video_id) if prev_host.video_id else None
                await _send(sid, {
                    "type": "joined_room",
                    "host_sid": previous_host_sid,
                    "host_name": prev_host.name,
                    "video_id": prev_host.video_id or "",
                    "video_name": video_info.get("display_name", "") if video_info else "",
                    "filename": video_info.get("filename", "") if video_info else "",
                    "current_time": host_position,
                    "paused": host_paused,
                    "auto_play": not host_paused,
                })
                await _send_toast(previous_host_sid, f"{name} 已重新连接")
                print(f"[ws] {sid} ({name}) reconnected to room of {previous_host_sid}")
            else:
                await _send(sid, {
                    "type": "room_lost",
                    "host_name": "之前的房主",
                })
                print(f"[ws] {sid} ({name}) tried to reconnect to {previous_host_sid} but host is gone")

        # 切换过来的房主: 清理 switch_from 参数
        switch_from = hello.get("switch_from", "").strip()
        if switch_from:
            old_record = state.pending_switches.pop(switch_from, None)
            if old_record:
                try:
                    old_record.get("timer_task", None) and old_record["timer_task"].cancel()
                except Exception:
                    pass
            print(f"[switch] host {name} ({sid}) arrived at new video from switch")

        await _broadcast_room_update()

        while True:
            try:
                data = await asyncio.wait_for(ws.receive_json(), timeout=HEARTBEAT_TIMEOUT)
            except asyncio.TimeoutError:
                print(f"[ws] heartbeat timeout for {sid}, entering rescue period...")
                rescued = False
                rescue_data = None
                for attempt in range(7):
                    try:
                        await ws.send_json({"type": "server_ping"})
                        reply = await asyncio.wait_for(ws.receive_json(), timeout=2)
                        rescued = True
                        rescue_data = reply
                        print(f"[ws] {sid} rescued on attempt {attempt + 1}")
                        break
                    except asyncio.TimeoutError:
                        continue
                    except Exception:
                        break
                if not rescued:
                    print(f"[ws] {sid} not rescued after 7 attempts, disconnecting")
                    break
                data = rescue_data
                if session:
                    session.last_heartbeat = time.time()

            msg_type = data.get("type", "")

            if msg_type == "heartbeat":
                session.last_heartbeat = time.time()
                await ws.send_json({"type": "heartbeat_ack"})
            elif msg_type == "server_pong":
                session.last_heartbeat = time.time()
            elif msg_type == "refresh_rooms":
                now = time.time()
                dead = [s for s in state.sessions.values()
                        if now - s.last_heartbeat > HEARTBEAT_TIMEOUT and s.sid != sid]
                for d in dead:
                    members = _dissolve_room(d.sid)
                    state.sessions.pop(d.sid, None)
                    try:
                        await d.ws.close(code=4004, reason="timeout")
                    except Exception:
                        pass
                    for m in members:
                        await _send_toast(m.sid, f"房主 {d.name} 已离线,房间已解散")
                        await _send(m.sid, {"type": "room_dissolved", "reason": "host_left"})
                await _broadcast_room_update()
            elif msg_type == "join_room":
                await _handle_join_room(session, data)
            elif msg_type == "leave_room":
                await _handle_leave_room(session)
            elif msg_type == "sync_action":
                await _handle_sync_action(session, data)
            elif msg_type == "sync_veto":
                await _handle_sync_veto(session, data)
            elif msg_type == "report_position":
                await _handle_report_position(session, data)
            elif msg_type == "catch_up":
                await _handle_catch_up(session)
            elif msg_type == "host_switch_video":
                await _handle_host_switch_video(session, data)
            elif msg_type == "follow_host_switch":
                await _handle_follow_host_switch(session)
            elif msg_type == "cancel_follow":
                await _handle_cancel_follow(session)
            else:
                pass

    except WebSocketDisconnect:
        print(f"[ws] disconnected: {sid}")
    except Exception as e:
        print(f"[ws] error for {sid}: {e}")
    finally:
        if session and sid in state.sessions:
            del state.sessions[sid]
            pending = state.pending_actions.get(sid)
            if pending:
                pending.timer_task.cancel()
                del state.pending_actions[sid]

            members = _dissolve_room(sid)
            for m in members:
                await _send_toast(m.sid, f"房主 {session.name} 已离线,房间已解散")
                await _send(m.sid, {"type": "room_dissolved", "reason": "host_left"})
            try:
                await _broadcast_room_update()
            except Exception:
                pass
