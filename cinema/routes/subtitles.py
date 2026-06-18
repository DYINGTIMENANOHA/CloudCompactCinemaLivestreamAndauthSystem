"""
字幕管理 API

- GET    /cinema/api/subtitle/{video_id}         查询是否有云端字幕(观众/管理员)
- POST   /cinema/api/video/{video_id}/subtitle   上传字幕(管理员)
- DELETE /cinema/api/video/{video_id}/subtitle   删除字幕(管理员)

上传的字幕统一转换为 VTT 格式存储，通过
StaticFiles mount /cinema/subtitles/ 直接服务，无鉴权（同封面策略）。
"""
import re
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Request, UploadFile, File
from fastapi.responses import JSONResponse

from core.auth import verify_watch_token, verify_admin_token
from core import config, db

router = APIRouter()

ADMIN_TOKEN_COOKIE = "cinema_admin_token"
WATCH_TOKEN_COOKIE = "cinema_watch_token"
SUBTITLES_DIR = config.SUBTITLES_DIR
MAX_SUBTITLE_BYTES = 5 * 1024 * 1024  # 5 MB


def _check_admin(request: Request) -> bool:
    token = request.cookies.get(ADMIN_TOKEN_COOKIE, "")
    return bool(token) and verify_admin_token(token)


def _check_watch(request: Request) -> bool:
    token = request.cookies.get(WATCH_TOKEN_COOKIE, "")
    return bool(token) and verify_watch_token(token)


# ===== 字幕格式转换（服务端统一转为 VTT） =====

def _srt_to_vtt(text: str) -> str:
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    vtt = 'WEBVTT\n\n'
    for block in re.split(r'\n\n+', text.strip()):
        lines = block.strip().split('\n')
        time_idx = next((i for i, l in enumerate(lines) if '-->' in l), -1)
        if time_idx < 0:
            continue
        time_line = lines[time_idx].replace(',', '.')
        content = '\n'.join(lines[time_idx + 1:]).strip()
        if content:
            vtt += time_line + '\n' + content + '\n\n'
    return vtt


def _ass_time_to_vtt(t: str) -> str | None:
    m = re.match(r'(\d+):(\d+):(\d+)\.(\d+)', t.strip())
    if not m:
        return None
    h, mi, s, cs = m.groups()
    ms = cs.ljust(3, '0')[:3]
    return f'{int(h):02d}:{int(mi):02d}:{int(s):02d}.{ms}'


def _ass_to_vtt(text: str) -> str:
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    vtt = 'WEBVTT\n\n'
    in_events = False
    format_fields: list[str] = []
    text_idx = start_idx = end_idx = -1

    for line in text.split('\n'):
        trimmed = line.strip()
        if trimmed == '[Events]':
            in_events = True
            continue
        if trimmed.startswith('[') and trimmed != '[Events]':
            in_events = False
            continue
        if in_events and trimmed.startswith('Format:'):
            format_fields = [f.strip().lower() for f in trimmed[7:].split(',')]
            text_idx  = format_fields.index('text')  if 'text'  in format_fields else -1
            start_idx = format_fields.index('start') if 'start' in format_fields else -1
            end_idx   = format_fields.index('end')   if 'end'   in format_fields else -1
            continue
        if in_events and trimmed.startswith('Dialogue:'):
            if text_idx < 0 or start_idx < 0 or end_idx < 0:
                continue
            content = trimmed[trimmed.index(':') + 1:]
            parts = content.split(',')
            if len(parts) <= text_idx:
                continue
            raw_text = ','.join(parts[text_idx:]).strip()
            clean = re.sub(r'\{[^}]*\}', '', raw_text)
            clean = clean.replace('\\N', '\n').replace('\\n', '\n').replace('\\h', ' ').strip()
            if not clean:
                continue
            vtt_start = _ass_time_to_vtt(parts[start_idx])
            vtt_end   = _ass_time_to_vtt(parts[end_idx])
            if vtt_start and vtt_end:
                vtt += f'{vtt_start} --> {vtt_end}\n{clean}\n\n'
    return vtt


def _decode_subtitle(raw: bytes) -> str:
    """解码字幕字节，自动处理 UTF-8 / UTF-16 LE / UTF-16 BE BOM 及 GBK 回退。"""
    # UTF-16 BOM: FF FE (LE) 或 FE FF (BE)
    if raw[:2] in (b'\xff\xfe', b'\xfe\xff'):
        return raw.decode('utf-16')  # Python 的 utf-16 codec 会自动识别 BOM
    # UTF-8（含或不含 BOM）
    try:
        return raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        pass
    # GBK 回退（简体中文旧字幕常见）
    try:
        return raw.decode('gbk')
    except UnicodeDecodeError:
        return raw.decode('latin-1')  # 保底，不会失败


def _to_vtt(raw: bytes, ext: str) -> str:
    """解码并将任意支持格式转换为 VTT 字符串。"""
    text = _decode_subtitle(raw)
    if ext == 'vtt':
        return text if text.strip().startswith('WEBVTT') else _srt_to_vtt(text)
    if ext == 'srt':
        return _srt_to_vtt(text)
    if ext in ('ass', 'ssa'):
        return _ass_to_vtt(text)
    # fallback：按内容判断
    stripped = text.strip()
    if stripped.startswith('WEBVTT'):
        return text
    if '[Script Info]' in stripped or '[Events]' in stripped:
        return _ass_to_vtt(text)
    return _srt_to_vtt(text)


# ===== 文件查找（优先 .vtt，兼容旧格式） =====

def _find_subtitle(video_id: str) -> Path | None:
    for ext in ('.vtt', '.srt', '.ass', '.ssa'):
        p = SUBTITLES_DIR / f"{video_id}{ext}"
        if p.exists():
            return p
    return None


# ===== API 路由 =====

@router.get("/cinema/api/subtitle/{video_id}")
async def api_get_subtitle(request: Request, video_id: str):
    if not (_check_watch(request) or _check_admin(request)):
        return JSONResponse({"error": "unauthorized"}, status_code=403)

    path = _find_subtitle(video_id)
    if path is None:
        return {"url": None, "filename": None}

    return {
        "url": f"/cinema/subtitles/{path.name}",
        "filename": path.name,
    }


@router.post("/cinema/api/video/{video_id}/subtitle")
async def api_upload_subtitle(
    request: Request, video_id: str, file: UploadFile = File(...)
):
    """上传字幕，转换为 VTT 格式后存储，覆盖同视频已有字幕。"""
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)

    if not db.get_video(video_id):
        return JSONResponse({"error": "视频不存在"}, status_code=404)

    orig_name = file.filename or ""
    ext = Path(orig_name).suffix.lower().lstrip('.')
    if ext not in {'srt', 'ass', 'ssa', 'vtt'}:
        return JSONResponse(
            {"error": "不支持的格式，请上传 SRT / ASS / SSA / VTT 文件"},
            status_code=400,
        )

    raw = await file.read(MAX_SUBTITLE_BYTES + 1)
    if len(raw) > MAX_SUBTITLE_BYTES:
        return JSONResponse({"error": "字幕文件过大（最大 5 MB）"}, status_code=400)

    try:
        vtt_content = _to_vtt(raw, ext)
    except Exception as e:
        return JSONResponse({"error": f"字幕转换失败: {e}"}, status_code=400)

    # 删除已有字幕（可能是旧扩展名）
    existing = _find_subtitle(video_id)
    if existing:
        existing.unlink(missing_ok=True)

    SUBTITLES_DIR.mkdir(parents=True, exist_ok=True)
    dest = SUBTITLES_DIR / f"{video_id}.vtt"

    try:
        async with aiofiles.open(str(dest), "w", encoding="utf-8") as f:
            await f.write(vtt_content)
    except Exception as e:
        dest.unlink(missing_ok=True)
        return JSONResponse({"error": f"保存失败: {e}"}, status_code=500)

    return {
        "ok": True,
        "url": f"/cinema/subtitles/{dest.name}",
        "filename": dest.name,
    }


@router.delete("/cinema/api/video/{video_id}/subtitle")
async def api_delete_subtitle(request: Request, video_id: str):
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)

    path = _find_subtitle(video_id)
    if path is None:
        return JSONResponse({"error": "该视频没有云端字幕"}, status_code=404)

    try:
        path.unlink(missing_ok=True)
    except OSError as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    return {"ok": True}
