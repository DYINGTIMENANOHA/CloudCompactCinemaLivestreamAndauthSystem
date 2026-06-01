"""
Cloud Cinema 主入口
"""
import asyncio
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

from core import config, db, state, transcoder
from routes import entry, library, api, admin, watch, ws, covers, chat


def cleanup_orphans():
    """启动时清理卡住的上传任务(不删暂停任务的临时文件)。"""
    import sqlite3
    from pathlib import Path

    # 只把 uploading 和 processing 状态的任务标记为失败
    # paused 任务保留(用户可能要恢复)
    conn = sqlite3.connect(db.DB_PATH)
    try:
        # uploading → 标记失败,但保留临时文件(用户可能重传恢复)
        cursor = conn.execute(
            "UPDATE upload_tasks SET status='paused', "
            "error_message='服务重启时中断,可恢复上传' "
            "WHERE status = 'uploading'"
        )
        if cursor.rowcount > 0:
            print(f"[startup] paused {cursor.rowcount} interrupted upload(s)")

        # processing → 标记失败,删除临时文件(转码不可恢复)
        cursor2 = conn.execute(
            "SELECT id, temp_path FROM upload_tasks WHERE status = 'processing'"
        )
        processing_tasks = cursor2.fetchall()
        for task_id, temp_path in processing_tasks:
            if temp_path:
                try:
                    Path(temp_path).unlink(missing_ok=True)
                except OSError:
                    pass
            conn.execute(
                "UPDATE upload_tasks SET status='failed', "
                "error_message='转码被服务重启中断,已清理', "
                "completed_at=datetime('now') WHERE id=?",
                (task_id,)
            )
        if processing_tasks:
            print(f"[startup] failed {len(processing_tasks)} interrupted processing task(s)")

        conn.commit()
    finally:
        conn.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[app] starting cloud cinema...")
    db.init_db()

    cleanup_orphans()

    state.config_cache["veto_enabled"] = db.get_config("veto_enabled", "1")
    state.config_cache["veto_delay_seconds"] = db.get_config("veto_delay_seconds", "3")
    state.config_cache["storage_limit_gb"] = db.get_config("storage_limit_gb", "9")
    print(f"[app] config loaded: {state.config_cache}")

    # 启动后台转码 worker
    transcoder_task = asyncio.create_task(transcoder.transcoder_loop())

    print(f"[app] ready, listening on port {config.PORT}")
    yield

    print("[app] shutting down...")
    transcoder_task.cancel()
    try:
        await transcoder_task
    except asyncio.CancelledError:
        pass


app = FastAPI(lifespan=lifespan)

app.mount("/cinema/static", StaticFiles(directory=str(config.STATIC_DIR)), name="static")
app.mount("/cinema/covers", StaticFiles(directory=str(config.COVERS_DIR)), name="covers")

app.include_router(entry.router)
app.include_router(library.router)
app.include_router(api.router)
app.include_router(admin.router)
app.include_router(watch.router)
app.include_router(ws.router)
app.include_router(covers.router)
app.include_router(chat.router)
