"""
上传空间管理 v3 - 分块上传系统

空间计算:
- cinema_in_use = videos 实际大小 + 活跃任务的"未写入磁盘"部分
  未写入磁盘 = original_size_bytes - received_bytes
  (received_bytes 已经反映在 disk_free 的减少里,不重复计算)
- dynamic_cap = videos实际 + disk_free - SYSTEM_BUFFER
- effective_limit = min(user_limit, dynamic_cap)

重传识别:
- upload_init 时通过 file_hash + file_size 查找已有任务
- 已有任务(paused/uploading) → 返回已有 task_id + received_bytes,不重新检查空间
"""
import os
import sqlite3
import shutil
from pathlib import Path
from threading import Lock
from core import config, db, state

CHUNK_SIZE = 10 * 1024 * 1024                     # 10 MB
SAFETY_MARGIN_BYTES = 200 * 1024 * 1024            # 200 MB
SINGLE_FILE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024   # 5 GB
SYSTEM_BUFFER_BYTES = 2 * 1024 * 1024 * 1024        # 2 GB

VIDEOS_DIR = config.VIDEOS_DIR
UPLOADS_DIR = config.UPLOADS_DIR

_lock = Lock()


def _get_videos_total_bytes() -> int:
    """videos 目录的实际占用。"""
    videos = db.get_all_videos()
    return sum(int(v.get("size_bytes") or 0) for v in videos)


def _get_active_tasks() -> list[dict]:
    """读取所有活跃的上传任务(uploading/paused/processing)。"""
    conn = sqlite3.connect(db.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(
            "SELECT id, original_filename, original_size_bytes, received_bytes, "
            "status, file_hash, temp_path "
            "FROM upload_tasks "
            "WHERE status IN ('uploading', 'paused', 'processing')"
        )
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


def _get_disk_free_bytes() -> int:
    try:
        VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
        usage = shutil.disk_usage(str(VIDEOS_DIR))
        return usage.free
    except OSError:
        return 0


def _get_user_limit_bytes() -> int:
    raw = state.config_cache.get("storage_limit_gb", "9")
    try:
        gb = int(raw)
    except (ValueError, TypeError):
        gb = 9
    return gb * 1024 * 1024 * 1024


def _set_user_limit_gb(gb: int):
    db.set_config("storage_limit_gb", str(gb))
    state.config_cache["storage_limit_gb"] = str(gb)


def _compute_caps() -> dict:
    """
    计算空间使用情况。

    关键修复: cinema_in_use 不双重计算正在上传的文件。
    - videos_bytes: videos 表里已完成的视频
    - reserved_not_on_disk: 活跃任务声明的大小 - 已写入磁盘的部分
      (已写入磁盘的部分已经反映在 disk_free 的减少里)
    - cinema_in_use = videos_bytes + reserved_not_on_disk
    """
    videos_bytes = _get_videos_total_bytes()
    active_tasks = _get_active_tasks()
    disk_free = _get_disk_free_bytes()

    # 活跃任务: 预留但还没写到磁盘的部分
    reserved_not_on_disk = 0
    total_reserved = 0
    total_received = 0
    for t in active_tasks:
        orig = int(t.get("original_size_bytes") or 0)
        recv = int(t.get("received_bytes") or 0)
        total_reserved += orig
        total_received += recv
        reserved_not_on_disk += max(0, orig - recv)

    cinema_in_use = videos_bytes + reserved_not_on_disk
    dynamic_cap = videos_bytes + disk_free - SYSTEM_BUFFER_BYTES
    if dynamic_cap < 0:
        dynamic_cap = 0

    user_limit = _get_user_limit_bytes()
    effective_limit = min(user_limit, dynamic_cap)

    raw_avail = effective_limit - cinema_in_use - SAFETY_MARGIN_BYTES
    single_max = raw_avail // 2 if raw_avail > 0 else 0
    remaining = max(0, effective_limit - cinema_in_use)

    return {
        "videos_bytes": videos_bytes,
        "active_tasks": active_tasks,
        "total_reserved": total_reserved,
        "total_received": total_received,
        "reserved_not_on_disk": reserved_not_on_disk,
        "used_bytes": cinema_in_use,
        "disk_free_bytes": disk_free,
        "dynamic_cap_bytes": dynamic_cap,
        "user_limit_bytes": user_limit,
        "limit_bytes": effective_limit,
        "single_max_bytes": single_max,
        "remaining_bytes": remaining,
        "available_bytes": single_max,
    }


def get_usage_summary() -> dict:
    """返回空间用量摘要(供 API 使用)。"""
    with _lock:
        return _compute_caps()


def check_space_for_new_upload(file_size: int) -> tuple[bool, str]:
    """
    检查新上传是否有足够空间。
    只在 upload_init 创建新任务时调用(重传不调用)。
    """
    if file_size <= 0:
        return False, "文件大小无效"
    if file_size > SINGLE_FILE_LIMIT_BYTES:
        gb = file_size / 1024 / 1024 / 1024
        return False, f"单文件超过 5 GB 上限(实际 {gb:.2f} GB)"

    with _lock:
        caps = _compute_caps()
        single_max = caps["single_max_bytes"]

        if file_size > single_max:
            need_gb = file_size / 1024 / 1024 / 1024
            avail_gb = single_max / 1024 / 1024 / 1024
            return False, (
                f"存储空间不足。需要 {need_gb:.2f} GB,"
                f"当前可上传单个视频最大 {avail_gb:.2f} GB。"
            )
        return True, ""


def find_existing_task(file_hash: str, file_size: int) -> dict | None:
    """通过 file_hash + file_size 查找可恢复的任务。"""
    conn = sqlite3.connect(db.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(
            "SELECT id, original_filename, original_size_bytes, received_bytes, "
            "status, file_hash, temp_path "
            "FROM upload_tasks "
            "WHERE file_hash = ? AND original_size_bytes = ? "
            "AND status IN ('uploading', 'paused') "
            "ORDER BY created_at DESC LIMIT 1",
            (file_hash, file_size)
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_task(task_id: str, filename: str, file_size: int,
                file_hash: str, temp_path: str) -> None:
    """创建新的上传任务记录。"""
    conn = sqlite3.connect(db.DB_PATH)
    try:
        conn.execute(
            "INSERT INTO upload_tasks "
            "(id, original_filename, original_size_bytes, status, file_hash, "
            "received_bytes, temp_path) "
            "VALUES (?, ?, ?, 'uploading', ?, 0, ?)",
            (task_id, filename, file_size, file_hash, temp_path)
        )
        conn.commit()
    finally:
        conn.close()


def update_task_received(task_id: str, received_bytes: int):
    """更新任务的已接收字节数。"""
    conn = sqlite3.connect(db.DB_PATH)
    try:
        conn.execute(
            "UPDATE upload_tasks SET received_bytes = ?, status = 'uploading' WHERE id = ?",
            (received_bytes, task_id)
        )
        conn.commit()
    finally:
        conn.close()


def pause_task(task_id: str) -> bool:
    """暂停上传任务。"""
    conn = sqlite3.connect(db.DB_PATH)
    try:
        cursor = conn.execute(
            "UPDATE upload_tasks SET status = 'paused' "
            "WHERE id = ? AND status = 'uploading'",
            (task_id,)
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def resume_task(task_id: str) -> dict | None:
    """恢复上传任务,返回任务信息。"""
    conn = sqlite3.connect(db.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(
            "SELECT id, original_filename, original_size_bytes, received_bytes, "
            "file_hash, temp_path "
            "FROM upload_tasks WHERE id = ? AND status = 'paused'",
            (task_id,)
        )
        row = cursor.fetchone()
        if not row:
            return None
        conn.execute(
            "UPDATE upload_tasks SET status = 'uploading' WHERE id = ?",
            (task_id,)
        )
        conn.commit()
        return dict(row)
    finally:
        conn.close()


def cancel_task(task_id: str) -> tuple[bool, str]:
    """取消上传任务: 删除临时文件,标记 failed。"""
    conn = sqlite3.connect(db.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(
            "SELECT id, temp_path, status FROM upload_tasks WHERE id = ?",
            (task_id,)
        )
        row = cursor.fetchone()
        if not row:
            return False, "任务不存在"
        if row["status"] not in ("uploading", "paused"):
            return False, f"任务状态为 {row['status']},无法取消"

        # 删除临时文件
        temp_path = row["temp_path"]
        file_deleted = False
        if temp_path:
            try:
                Path(temp_path).unlink(missing_ok=True)
                file_deleted = True
            except OSError:
                pass

        # 确认文件已删除后才标记 failed
        if temp_path and Path(temp_path).exists():
            return False, "临时文件删除失败,请重试"

        import time
        conn.execute(
            "UPDATE upload_tasks SET status = 'failed', "
            "error_message = '用户取消,已清理临时文件', "
            "completed_at = ? WHERE id = ?",
            (time.strftime("%Y-%m-%d %H:%M:%S"), task_id)
        )
        conn.commit()
        return True, ""
    finally:
        conn.close()


def cancel_all_paused() -> int:
    """取消所有暂停中的任务,返回取消数量。"""
    conn = sqlite3.connect(db.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(
            "SELECT id, temp_path FROM upload_tasks WHERE status = 'paused'"
        )
        rows = cursor.fetchall()
        count = 0
        import time
        for row in rows:
            if row["temp_path"]:
                try:
                    Path(row["temp_path"]).unlink(missing_ok=True)
                except OSError:
                    pass
            conn.execute(
                "UPDATE upload_tasks SET status = 'failed', "
                "error_message = '批量取消,已清理临时文件', "
                "completed_at = ? WHERE id = ?",
                (time.strftime("%Y-%m-%d %H:%M:%S"), row["id"])
            )
            count += 1
        conn.commit()
        return count
    finally:
        conn.close()


def get_uploads_dir_info() -> dict:
    """返回 uploads 目录的文件数量和总大小。"""
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    files = list(UPLOADS_DIR.iterdir())
    file_count = sum(1 for f in files if f.is_file())
    total_size = sum(f.stat().st_size for f in files if f.is_file())
    return {"file_count": file_count, "total_size_bytes": total_size}


def clean_uploads_dir() -> int:
    """清理 uploads 目录里没有对应活跃任务的孤儿文件。返回删除数量。"""
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    active = _get_active_tasks()
    active_paths = set()
    for t in active:
        if t.get("temp_path"):
            active_paths.add(t["temp_path"])

    deleted = 0
    for f in UPLOADS_DIR.iterdir():
        if f.is_file() and str(f) not in active_paths:
            try:
                f.unlink()
                deleted += 1
            except OSError:
                pass
    return deleted


def mark_task_processing(task_id: str):
    """标记任务为转码中。"""
    conn = sqlite3.connect(db.DB_PATH)
    try:
        conn.execute(
            "UPDATE upload_tasks SET status = 'processing' WHERE id = ?",
            (task_id,)
        )
        conn.commit()
    finally:
        conn.close()


def set_user_storage_limit_gb(gb: int) -> tuple[bool, str]:
    if gb < 1:
        return False, "上限不能小于 1 GB"
    with _lock:
        caps = _compute_caps()
        max_gb = round(caps["dynamic_cap_bytes"] / (1024 * 1024 * 1024), 1)
        if gb > max_gb:
            return False, f"超过物理可用上限 {max_gb} GB(磁盘剩余不足)"
        _set_user_limit_gb(gb)
        return True, ""


def is_upload_slot_free() -> bool:
    """检查当前是否没有 uploading 状态的任务(可以开始新上传)。"""
    conn = sqlite3.connect(db.DB_PATH)
    try:
        cursor = conn.execute(
            "SELECT COUNT(*) FROM upload_tasks WHERE status = 'uploading'"
        )
        return cursor.fetchone()[0] == 0
    finally:
        conn.close()


# 兼容旧代码(transcoder.py 可能调用)
def reserve_space(file_size, reservation_id):
    return check_space_for_new_upload(file_size)

def release_reservation(reservation_id):
    pass

def update_reservation(reservation_id, new_bytes):
    pass
