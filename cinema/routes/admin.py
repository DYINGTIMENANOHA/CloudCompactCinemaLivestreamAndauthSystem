"""
管理员路由

/cinema/admin?token=xxx    管理页(URL 保留 token,可收藏)
"""
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from core import config
from core.auth import verify_admin_token

router = APIRouter()
templates = Jinja2Templates(directory=str(config.TEMPLATES_DIR))

ADMIN_TOKEN_COOKIE = "cinema_admin_token"


@router.get("/cinema/admin", response_class=HTMLResponse)
async def admin_page(request: Request):
    """
    管理页。

    流程:
    1. URL 带 token -> 校验 -> 有效则 set cookie + 渲染管理页(URL 保留 token)
    2. URL 无 token,cookie 有有效 admin token -> 渲染
    3. 否则 -> 错误页
    """
    url_token = request.query_params.get("token", "").strip()

    if url_token:
        if not verify_admin_token(url_token):
            return templates.TemplateResponse(
                "error.html",
                {"request": request, "message": "无效的管理员令牌"},
                status_code=403,
            )
        # 渲染管理页,URL 保留 token,同时 set cookie
        response = templates.TemplateResponse("admin.html", {"request": request})
        response.set_cookie(
            key=ADMIN_TOKEN_COOKIE,
            value=url_token,
            path="/cinema/",
            httponly=True,
            samesite="lax",
        )
        return response

    cookie_token = request.cookies.get(ADMIN_TOKEN_COOKIE, "")
    if cookie_token and verify_admin_token(cookie_token):
        return templates.TemplateResponse("admin.html", {"request": request})

    return templates.TemplateResponse(
        "error.html",
        {"request": request, "message": "请通过有效的管理员链接进入"},
        status_code=403,
    )
