"""
封面管理 API

- POST   /cinema/api/video/{video_id}/cover    上传视频封面
- DELETE /cinema/api/video/{video_id}/cover    删除视频封面
- POST   /cinema/api/default_cover             上传默认封面(视频列表 fallback)
- POST   /cinema/api/bg/{name}                 上传背景图(name=library|watch)

封面按约定命名存在磁盘,不进数据库:
  /opt/cinema/videos_covers/{video_id}.jpg     视频专属封面
  /opt/cinema/static/img/default_cover.jpg     默认视频封面
  /opt/cinema/static/img/bg_library.jpg        library 背景
  /opt/cinema/static/img/bg_watch.jpg          watch 背景
"""
from pathlib import Path
import aiofiles
from fastapi import APIRouter, Request, UploadFile, File
from fastapi.responses import JSONResponse

from core.auth import verify_admin_token
from core import config, db

router = APIRouter()

ADMIN_TOKEN_COOKIE = "cinema_admin_token"
COVERS_DIR = config.COVERS_DIR
STATIC_IMG_DIR = config.STATIC_DIR / "img"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB(裁剪后通常 <1MB,余量给背景原图)


def _check_admin(request: Request) -> bool:
    token = request.cookies.get(ADMIN_TOKEN_COOKIE, "")
    return bool(token) and verify_admin_token(token)


async def _save_upload(file: UploadFile, dest: Path) -> tuple[bool, str]:
    """保存上传文件到 dest(覆盖)。返回 (ok, error)。"""
    dest.parent.mkdir(parents=True, exist_ok=True)
    bytes_written = 0
    try:
        async with aiofiles.open(str(dest), "wb") as f:
            while True:
                chunk = await file.read(1024 * 256)
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > MAX_UPLOAD_BYTES:
                    await f.close()
                    try:
                        dest.unlink(missing_ok=True)
                    except OSError:
                        pass
                    return False, f"文件过大(超过 {MAX_UPLOAD_BYTES // 1024 // 1024} MB)"
                await f.write(chunk)
    except Exception as e:
        try:
            dest.unlink(missing_ok=True)
        except OSError:
            pass
        return False, f"保存失败: {type(e).__name__}: {e}"
    return True, ""


@router.post("/cinema/api/video/{video_id}/cover")
async def api_upload_video_cover(request: Request, video_id: str, file: UploadFile = File(...)):
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    video = db.get_video(video_id)
    if not video:
        return JSONResponse({"error": "视频不存在"}, status_code=404)
    dest = COVERS_DIR / f"{video_id}.jpg"
    ok, err = await _save_upload(file, dest)
    if not ok:
        return JSONResponse({"error": err}, status_code=400)
    return {"ok": True, "cover_url": f"/cinema/covers/{video_id}.jpg"}


@router.delete("/cinema/api/video/{video_id}/cover")
async def api_delete_video_cover(request: Request, video_id: str):
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    dest = COVERS_DIR / f"{video_id}.jpg"
    try:
        dest.unlink(missing_ok=True)
    except OSError as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    return {"ok": True}


@router.post("/cinema/api/default_cover")
async def api_upload_default_cover(request: Request, file: UploadFile = File(...)):
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    dest = STATIC_IMG_DIR / "default_cover.jpg"
    ok, err = await _save_upload(file, dest)
    if not ok:
        return JSONResponse({"error": err}, status_code=400)
    return {"ok": True}


@router.post("/cinema/api/bg/{name}")
async def api_upload_bg(request: Request, name: str, file: UploadFile = File(...)):
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    if name not in ("library", "watch"):
        return JSONResponse({"error": "未知的背景名称"}, status_code=400)
    dest = STATIC_IMG_DIR / f"bg_{name}.jpg"
    ok, err = await _save_upload(file, dest)
    if not ok:
        return JSONResponse({"error": err}, status_code=400)
    return {"ok": True}
