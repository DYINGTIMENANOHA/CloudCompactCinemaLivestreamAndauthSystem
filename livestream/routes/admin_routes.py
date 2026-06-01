"""
管理后台路由 - 生产和测试环境共用
"""
from flask import Blueprint, request, render_template
import config
from utils import auth

admin_blueprint = Blueprint('admin', __name__)

@admin_blueprint.route('/admin')
def admin_live():
    """生产环境管理后台"""
    return render_admin_page('live')

@admin_blueprint.route('/test-admin')
def admin_test():
    """测试环境管理后台"""
    return render_admin_page('test')

def render_admin_page(env):
    """
    渲染管理后台（通用函数）
    
    Args:
        env: 'live' 或 'test'
    """
    token = request.args.get('token', '')
    
    # 验证管理员Token
    valid, message = auth.verify_stream_token(token, env)
    if not valid:
        return f"⛔ 访问被拒绝: {message}", 403
    
    # 渲染管理页面
    room_type = '生产环境' if env == 'live' else '测试环境'
    
    return render_template('admin.html',
                         token=token,
                         api_prefix=f'/api/{env}',
                         room_type=room_type)
