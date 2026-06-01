"""
观看页面路由 - 生产和测试环境共用
"""
from flask import Blueprint, request, render_template
import config
from utils import auth

watch_blueprint = Blueprint('watch', __name__)

def get_watch_title(env='live'):
    """获取直播间标题"""
    env_config = config.get_env_config(env)
    try:
        with open(env_config['title_file'], 'r', encoding='utf-8') as f:
            title = f.read().strip()
            return title if title else env_config['default_title']
    except:
        return env_config['default_title']

@watch_blueprint.route('/watch')
def watch_live():
    """生产环境观看页面"""
    return render_watch_page('live')

@watch_blueprint.route('/test-watch')
def watch_test():
    """测试环境观看页面"""
    return render_watch_page('test')

def render_watch_page(env):
    """
    渲染观看页面（通用函数）

    Args:
        env: 'live' 或 'test'
    """
    token = request.args.get('token', '')
    replay_session = request.args.get('replay', '')

    # Token验证（必须是该房间的watch token）
    valid, message, _ = auth.verify_watch_token(token, env)
    if not valid:
        return render_template('error.html', message=message), 403

    # 获取配置
    env_config = config.get_env_config(env)
    title = get_watch_title(env)

    if replay_session:
        title = f"{title} - 回放"

    # 渲染模板
    return render_template('watch.html',
                         token=token,
                         title=title,
                         replay_mode=bool(replay_session),
                         replay_session=replay_session,
                         api_prefix=f'/api/{env}',
                         stream_url=env_config['stream_url'],
                         hls_url=env_config['hls_url'],
                         watch_url=f'/{env}-watch' if env == 'test' else '/watch',
                         download_url=f'/api/{env}/download/',
                         app_name=env_config['app_name'],
                         show_replay_button=(env == 'live'))
