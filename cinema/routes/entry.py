"""
入口和登录路由

/cinema/?token=xxx   入口页(URL 上保留 token,可收藏)
/cinema/login        提交昵称的 POST 端点
"""
from urllib.parse import quote
from fastapi import APIRouter, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from core import config
from core.auth import verify_watch_token

router = APIRouter()
templates = Jinja2Templates(directory=str(config.TEMPLATES_DIR))

WATCH_TOKEN_COOKIE = "cinema_watch_token"
NAME_COOKIE = "cinema_name"


@router.get("/cinema/", response_class=HTMLResponse)
async def entry(request: Request):
    """
    入口页。

    流程:
    1. URL 有 token: 校验 -> 有效则 set cookie + 渲染昵称页(URL 保留 token,可收藏)
       如果 cookie 已有昵称且 cookie 里 token 也有效 -> 跳 library
    2. URL 无 token, cookie 有有效 token: 检查昵称 -> 有则跳 library, 无则显示昵称页
    3. URL 无 token, cookie 也无 -> 错误页
    """
    url_token = request.query_params.get("token", "").strip()

    # 情况 1: URL 带了 token
    if url_token:
        if not verify_watch_token(url_token):
            return templates.TemplateResponse(
                "error.html",
                {"request": request, "message": "无效的访问令牌"},
                status_code=403,
            )
        # token 有效,检查是否已有昵称
        existing_name = request.cookies.get(NAME_COOKIE, "").strip()
        if existing_name:
            # 已有昵称,直接跳 library(同时确保 cookie 里 token 是新的)
            response = RedirectResponse(url="/cinema/library", status_code=302)
            response.set_cookie(
                key=WATCH_TOKEN_COOKIE,
                value=url_token,
                path="/cinema/",
                httponly=True,
                samesite="lax",
            )
            return response
        # 没有昵称,渲染昵称页(URL 保留 token)
        response = templates.TemplateResponse("entry.html", {"request": request})
        response.set_cookie(
            key=WATCH_TOKEN_COOKIE,
            value=url_token,
            path="/cinema/",
            httponly=True,
            samesite="lax",
        )
        return response

    # 情况 2: URL 无 token,检查 cookie
    cookie_token = request.cookies.get(WATCH_TOKEN_COOKIE, "")
    if cookie_token and verify_watch_token(cookie_token):
        name = request.cookies.get(NAME_COOKIE, "").strip()
        if name:
            return RedirectResponse(url="/cinema/library", status_code=302)
        return templates.TemplateResponse("entry.html", {"request": request})

    # 情况 3: 都没有
    response = templates.TemplateResponse(
        "error.html",
        {"request": request, "message": "请通过有效的访问链接进入"},
        status_code=403,
    )
    response.delete_cookie(WATCH_TOKEN_COOKIE, path="/cinema/")
    response.delete_cookie(NAME_COOKIE, path="/cinema/")
    return response


@router.post("/cinema/login")
async def login(request: Request, name: str = Form(...)):
    """提交昵称,设 cookie,跳转到视频列表页。"""
    cookie_token = request.cookies.get(WATCH_TOKEN_COOKIE, "")
    if not cookie_token or not verify_watch_token(cookie_token):
        return templates.TemplateResponse(
            "error.html",
            {"request": request, "message": "会话已失效,请重新通过有效链接进入"},
            status_code=403,
        )

    name = name.strip()
    if not name:
        return templates.TemplateResponse(
            "entry.html",
            {"request": request, "error": "昵称不能为空"},
            status_code=400,
        )
    if len(name) > 30:
        return templates.TemplateResponse(
            "entry.html",
            {"request": request, "error": "昵称最长 30 个字符"},
            status_code=400,
        )

    encoded_name = quote(name, safe="")
    response = RedirectResponse(url="/cinema/library", status_code=302)
    response.set_cookie(
        key=NAME_COOKIE,
        value=encoded_name,
        path="/cinema/",
        httponly=False,
        samesite="lax",
    )
    return response
