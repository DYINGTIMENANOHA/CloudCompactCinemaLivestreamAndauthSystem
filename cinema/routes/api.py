"""
JSON API 路由 v2 - 分块上传系统

观众 API(需要 watch cookie):
  GET  /cinema/api/videos
  GET  /cinema/api/video/{video_id}

管理 API(需要 admin cookie):
  POST   /cinema/api/upload_init      初始化/恢复上传
  POST   /cinema/api/upload_chunk     上传一个分块
  POST   /cinema/api/upload_complete  上传完成,进入转码
  POST   /cinema/api/upload_pause     暂停上传
  POST   /cinema/api/upload_resume    恢复上传(返回 offset)
  POST   /cinema/api/upload_cancel    取消单个任务
  POST   /cinema/api/upload_cancel_all 取消所有暂停任务
  GET    /cinema/api/upload_tasks     列出上传任务
  GET    /cinema/api/uploads_dir_info uploads 目录信息
  POST   /cinema/api/uploads_dir_clean 清理孤儿文件
  DELETE /cinema/api/video/{video_id}
  GET    /cinema/api/usage
  GET    /cinema/api/storage_limit
  POST   /cinema/api/storage_limit
  GET    /cinema/api/config
  POST   /cinema/api/config
"""
import os
import sqlite3
import time
import uuid
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Request, Form, Query
from fastapi.responses import JSONResponse

from core.auth import verify_watch_token, verify_admin_token
from core import config, db, uploader, transcoder, state

router = APIRouter()

WATCH_TOKEN_COOKIE = "cinema_watch_token"
ADMIN_TOKEN_COOKIE = "cinema_admin_token"

UPLOADS_DIR = config.UPLOADS_DIR
VIDEOS_DIR = config.VIDEOS_DIR


def _check_watch(request: Request) -> bool:
    token = request.cookies.get(WATCH_TOKEN_COOKIE, "")
    return bool(token) and verify_watch_token(token)


def _check_admin(request: Request) -> bool:
    token = request.cookies.get(ADMIN_TOKEN_COOKIE, "")
    return bool(token) and verify_admin_token(token)


# ============================================
# 观众 API
# ============================================

@router.get("/cinema/api/videos")
async def api_videos(request: Request):
    if not (_check_watch(request) or _check_admin(request)):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    videos = db.get_all_videos()
    covers_dir = config.COVERS_DIR
    for v in videos:
        vid = v.get("id", "")
        cover_file = covers_dir / f"{vid}.jpg"
        if cover_file.exists():
            v["cover_url"] = f"/cinema/covers/{vid}.jpg"
        else:
            v["cover_url"] = None
    return {"videos": videos}


@router.get("/cinema/api/video/{video_id}")
async def api_video_one(request: Request, video_id: str):
    if not _check_watch(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    video = db.get_video(video_id)
    if not video:
        return JSONResponse({"error": "视频不存在"}, status_code=404)
    return video


# ============================================
# 分块上传 API
# ============================================

@router.post("/cinema/api/upload_init")
async def api_upload_init(
    request: Request,
    filename: str = Query(""),
    file_size: int = Query(0),
    file_hash: str = Query(""),
):
    """
    初始化上传或恢复已有任务。

    前端发送: POST /cinema/api/upload_init?filename=X&file_size=Y&file_hash=Z

    返回:
      - 新任务: {task_id, received_bytes: 0, resumed: false}
      - 恢复任务: {task_id, received_bytes: N, resumed: true}
    """
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)

    if file_size <= 0:
        return JSONResponse({"error": "文件大小无效"}, status_code=400)
    if not filename:
        return JSONResponse({"error": "文件名不能为空"}, status_code=400)
    if not file_hash:
        return JSONResponse({"error": "文件 hash 不能为空"}, status_code=400)

    # 1. 检查是否有可恢复的任务(重传识别)
    existing = uploader.find_existing_task(file_hash, file_size)
    if existing:
        task_id = existing["id"]
        received = int(existing.get("received_bytes") or 0)
        temp_path = existing.get("temp_path", "")

        # 验证临时文件实际大小和 received_bytes 一致
        if temp_path and Path(temp_path).exists():
            actual_size = Path(temp_path).stat().st_size
            if actual_size != received:
                # 以实际文件大小为准
                received = actual_size
                uploader.update_task_received(task_id, received)

        # 恢复为 uploading 状态
        if existing["status"] == "paused":
            uploader.resume_task(task_id)

        print(f"[upload] resumed task {task_id}, received={received}")
        return {
            "task_id": task_id,
            "received_bytes": received,
            "resumed": True,
            "original_filename": existing["original_filename"],
        }

    # 2. 新任务: 检查是否有其他 uploading 任务(需要排队)
    if not uploader.is_upload_slot_free():
        return JSONResponse({
            "error": "queued",
            "message": "排队中,等待其他用户上传完成",
            "queued": True,
        }, status_code=409)

    # 3. 检查空间
    ok, err = uploader.check_space_for_new_upload(file_size)
    if not ok:
        return JSONResponse({"error": err}, status_code=413)

    # 4. 创建任务
    task_id = str(uuid.uuid4())
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    ext = Path(filename).suffix or ".bin"
    temp_path = str(UPLOADS_DIR / f"{task_id}{ext}")

    uploader.create_task(task_id, filename, file_size, file_hash, temp_path)

    print(f"[upload] new task {task_id}: {filename} ({file_size} bytes)")
    return {
        "task_id": task_id,
        "received_bytes": 0,
        "resumed": False,
        "original_filename": filename,
    }


@router.post("/cinema/api/upload_chunk")
async def api_upload_chunk(
    request: Request,
    task_id: str = Query(""),
    offset: int = Query(0),
):
    """
    接收一个分块。

    前端发送: POST /cinema/api/upload_chunk?task_id=X&offset=Y
    Content-Type: application/octet-stream
    body: chunk 数据(最大 2MB)
    """
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)

    if not task_id:
        return JSONResponse({"error": "task_id 不能为空"}, status_code=400)

    # 查任务
    conn = sqlite3.connect(db.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(
            "SELECT id, temp_path, original_size_bytes, received_bytes, status "
            "FROM upload_tasks WHERE id = ?",
            (task_id,)
        )
        row = cursor.fetchone()
    finally:
        conn.close()

    if not row:
        return JSONResponse({"error": "任务不存在"}, status_code=404)
    if row["status"] not in ("uploading",):
        return JSONResponse({"error": f"任务状态为 {row['status']},无法上传"}, status_code=400)

    temp_path = row["temp_path"]
    if not temp_path:
        return JSONResponse({"error": "临时文件路径缺失"}, status_code=500)

    # 读取 chunk body
    body = await request.body()
    if not body:
        return JSONResponse({"error": "空的 chunk"}, status_code=400)

    chunk_size = len(body)

    # 写入文件的指定 offset
    try:
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(temp_path, "r+b" if Path(temp_path).exists() else "wb") as f:
            await f.seek(offset)
            await f.write(body)
    except Exception as e:
        return JSONResponse({"error": f"写入失败: {e}"}, status_code=500)

    new_received = offset + chunk_size
    uploader.update_task_received(task_id, new_received)

    return {
        "ok": True,
        "received_bytes": new_received,
        "total_bytes": row["original_size_bytes"],
    }


@router.post("/cinema/api/upload_complete")
async def api_upload_complete(
    request: Request,
    task_id: str = Query(""),
):
    """
    上传完成,进入转码队列。

    前端发送: POST /cinema/api/upload_complete?task_id=X
    """
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)

    if not task_id:
        return JSONResponse({"error": "task_id 不能为空"}, status_code=400)

    conn = sqlite3.connect(db.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(
            "SELECT id, temp_path, original_filename, original_size_bytes, "
            "received_bytes, status "
            "FROM upload_tasks WHERE id = ?",
            (task_id,)
        )
        row = cursor.fetchone()
    finally:
        conn.close()

    if not row:
        return JSONResponse({"error": "任务不存在"}, status_code=404)
    if row["status"] != "uploading":
        return JSONResponse({"error": f"任务状态为 {row['status']}"}, status_code=400)

    temp_path = row["temp_path"]
    expected_size = row["original_size_bytes"]
    received = row["received_bytes"]

    # 验证文件完整性
    if not Path(temp_path).exists():
        return JSONResponse({"error": "临时文件不存在"}, status_code=500)

    actual_size = Path(temp_path).stat().st_size
    # 允许少量偏差(最后一个 chunk 可能不足 2MB)
    if actual_size < expected_size * 0.99:
        return JSONResponse({
            "error": f"文件不完整: 期望 {expected_size} 字节,实际 {actual_size} 字节"
        }, status_code=400)

    # 标记为 processing
    uploader.mark_task_processing(task_id)

    # 放进转码队列
    await transcoder.enqueue_task(
        task_id=task_id,
        temp_path=temp_path,
        original_filename=row["original_filename"],
        original_size=expected_size,
        reservation_id=task_id,
    )

    print(f"[upload] task {task_id} complete, queued for transcoding")
    return {"ok": True, "status": "processing"}


@router.post("/cinema/api/upload_pause")
async def api_upload_pause(request: Request, task_id: str = Query("")):
    """暂停上传任务。"""
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    if not task_id:
        return JSONResponse({"error": "task_id 不能为空"}, status_code=400)
    ok = uploader.pause_task(task_id)
    if not ok:
        return JSONResponse({"error": "无法暂停(任务不存在或状态不对)"}, status_code=400)
    return {"ok": True}


@router.post("/cinema/api/upload_resume")
async def api_upload_resume(request: Request, task_id: str = Query("")):
    """恢复上传任务,返回当前 offset。"""
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    if not task_id:
        return JSONResponse({"error": "task_id 不能为空"}, status_code=400)
    task = uploader.resume_task(task_id)
    if not task:
        return JSONResponse({"error": "无法恢复(任务不存在或状态不对)"}, status_code=400)
    return {
        "ok": True,
        "task_id": task["id"],
        "received_bytes": task["received_bytes"],
        "original_size_bytes": task["original_size_bytes"],
        "file_hash": task["file_hash"],
        "original_filename": task["original_filename"],
    }


@router.post("/cinema/api/upload_cancel")
async def api_upload_cancel(request: Request, task_id: str = Query("")):
    """取消上传任务。"""
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    if not task_id:
        return JSONResponse({"error": "task_id 不能为空"}, status_code=400)
    ok, err = uploader.cancel_task(task_id)
    if not ok:
        return JSONResponse({"error": err}, status_code=400)
    return {"ok": True}


@router.post("/cinema/api/upload_cancel_all")
async def api_upload_cancel_all(request: Request):
    """取消所有暂停中的任务。"""
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    count = uploader.cancel_all_paused()
    return {"ok": True, "cancelled": count}


@router.get("/cinema/api/upload_tasks")
async def api_upload_tasks(request: Request):
    """返回所有上传任务。"""
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)

    conn = sqlite3.connect(db.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(
            "SELECT id, original_filename, original_size_bytes, received_bytes, "
            "status, error_message, original_deleted, created_at, completed_at, "
            "resulting_video_id, file_hash, temp_path "
            "FROM upload_tasks "
            "ORDER BY created_at DESC "
            "LIMIT 10"
        )
        tasks = [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()
    return {"tasks": tasks}


@router.get("/cinema/api/uploads_dir_info")
async def api_uploads_dir_info(request: Request):
    """返回 uploads 目录的文件数量和总大小。"""
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    info = uploader.get_uploads_dir_info()
    return info


@router.post("/cinema/api/uploads_dir_clean")
async def api_uploads_dir_clean(request: Request):
    """清理 uploads 目录里的孤儿文件。"""
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    deleted = uploader.clean_uploads_dir()
    return {"ok": True, "deleted": deleted}


@router.get("/cinema/api/upload_lock_status")
async def api_upload_lock_status(request: Request):
    """查询当前是否有人在上传。"""
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    conn = sqlite3.connect(db.DB_PATH)
    try:
        cursor = conn.execute(
            "SELECT COUNT(*) FROM upload_tasks "
            "WHERE status IN ('uploading', 'processing')"
        )
        count = cursor.fetchone()[0]
    finally:
        conn.close()
    return {"locked": count > 0, "count": count}


# ============================================
# 视频管理 API
# ============================================

@router.delete("/cinema/api/video/{video_id}")
async def api_delete_video(request: Request, video_id: str):
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)

    conn = sqlite3.connect(db.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute("SELECT filename FROM videos WHERE id = ?", (video_id,))
        row = cursor.fetchone()
        if not row:
            return JSONResponse({"error": "视频不存在"}, status_code=404)
        filename = row["filename"]
        conn.execute("DELETE FROM videos WHERE id = ?", (video_id,))
        conn.commit()
    finally:
        conn.close()

    try:
        (VIDEOS_DIR / filename).unlink(missing_ok=True)
    except OSError as e:
        print(f"[api] failed to delete file {filename}: {e}")
    try:
        (config.COVERS_DIR / f"{video_id}.jpg").unlink(missing_ok=True)
    except OSError:
        pass
    return {"ok": True}


# ============================================
# 空间 / 配置 API
# ============================================

@router.get("/cinema/api/usage")
async def api_usage(request: Request):
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    return uploader.get_usage_summary()


@router.get("/cinema/api/storage_limit")
async def api_get_storage_limit(request: Request):
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    summary = uploader.get_usage_summary()
    dynamic_cap_gb = round(summary["dynamic_cap_bytes"] / 1024 / 1024 / 1024, 1)
    return {
        "user_limit_gb": int(summary["user_limit_bytes"] // (1024 * 1024 * 1024)),
        "dynamic_cap_gb": dynamic_cap_gb,
        "effective_limit_gb": int(summary["limit_bytes"] // (1024 * 1024 * 1024)),
        "disk_free_gb": round(summary["disk_free_bytes"] / 1024 / 1024 / 1024, 2),
    }


@router.post("/cinema/api/storage_limit")
async def api_set_storage_limit(request: Request, limit_gb: int = Form(...)):
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    ok, err = uploader.set_user_storage_limit_gb(limit_gb)
    if not ok:
        return JSONResponse({"error": err}, status_code=400)
    return {"ok": True}


@router.get("/cinema/api/config")
async def api_get_config(request: Request):
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    return {
        "veto_enabled": state.config_cache.get("veto_enabled", "1") == "1",
        "veto_delay_seconds": int(state.config_cache.get("veto_delay_seconds", "3")),
    }


@router.post("/cinema/api/config")
async def api_set_config(
    request: Request,
    veto_enabled: bool = Form(...),
    veto_delay_seconds: int = Form(...),
):
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    if veto_delay_seconds < 0 or veto_delay_seconds > 60:
        return JSONResponse(
            {"error": "延迟秒数必须在 0 到 60 之间"},
            status_code=400,
        )
    veto_enabled_str = "1" if veto_enabled else "0"
    db.set_config("veto_enabled", veto_enabled_str)
    db.set_config("veto_delay_seconds", str(veto_delay_seconds))
    state.config_cache["veto_enabled"] = veto_enabled_str
    state.config_cache["veto_delay_seconds"] = str(veto_delay_seconds)
    return {"ok": True}
