"""
视频列表页路由

/cinema/library    视频列表页(需要 watch cookie + 昵称 cookie)
"""
from urllib.parse import unquote
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from core import config
from core.auth import verify_watch_token

router = APIRouter()
templates = Jinja2Templates(directory=str(config.TEMPLATES_DIR))

WATCH_TOKEN_COOKIE = "cinema_watch_token"
NAME_COOKIE = "cinema_name"


@router.get("/cinema/library", response_class=HTMLResponse)
async def library(request: Request):
    """
    视频列表页。

    要求:
    - watch token cookie 存在且有效
    - 昵称 cookie 存在(URL 编码,需要解码)
    """
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

    return templates.TemplateResponse(
        "library.html",
        {"request": request, "name": name, "watch_token": cookie_token},
    )
