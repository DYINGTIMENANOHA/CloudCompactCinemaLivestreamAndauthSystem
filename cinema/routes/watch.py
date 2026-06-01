"""
观看页路由

/cinema/watch?v={video_id}
"""
from urllib.parse import unquote
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from core.auth import verify_watch_token
from core import config, db

router = APIRouter()
templates = Jinja2Templates(directory=str(config.TEMPLATES_DIR))

WATCH_TOKEN_COOKIE = "cinema_watch_token"
NAME_COOKIE = "cinema_name"


@router.get("/cinema/watch", response_class=HTMLResponse)
async def watch_page(request: Request):
    """观看页。需要 watch cookie + 昵称 cookie + 有效的 video id。"""
    cookie_token = request.cookies.get(WATCH_TOKEN_COOKIE, "")
    if not cookie_token or not verify_watch_token(cookie_token):
        return templates.TemplateResponse(
            "error.html",
            {"request": request, "message": "请通过有效的访问链接进入"},
            status_code=403,
        )

    raw_name = request.cookies.get(NAME_COOKIE, "")
    name = unquote(raw_name).strip() if raw_name else ""
    if not name:
        return RedirectResponse(url="/cinema/", status_code=302)

    video_id = request.query_params.get("v", "").strip()
    if not video_id:
        return RedirectResponse(url="/cinema/library", status_code=302)

    video = db.get_video(video_id)
    if not video:
        return templates.TemplateResponse(
            "error.html",
            {"request": request, "message": "视频不存在或已被删除"},
            status_code=404,
        )

    return templates.TemplateResponse(
        "watch.html",
        {"request": request, "name": name, "video": video, "watch_token": cookie_token},
    )
