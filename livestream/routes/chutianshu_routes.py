"""
初天树直播间路由
"""
from flask import Blueprint, request, render_template, jsonify, send_file
import os
import config
from utils import auth, database, srs, session

chutianshu_blueprint = Blueprint('chutianshu', __name__)

ENV = 'chutianshu'


def get_title():
    env_config = config.get_env_config(ENV)
    try:
        with open(env_config['title_file'], 'r', encoding='utf-8') as f:
            title = f.read().strip()
            return title if title else env_config['default_title']
    except:
        return env_config['default_title']


@chutianshu_blueprint.route('/chutianshu-watch')
def chutianshu_watch():
    token = request.args.get('token', '')
    replay_session = request.args.get('replay', '')

    valid, message, _ = auth.verify_watch_token(token, ENV)
    if not valid:
        return render_template('error.html', message=message), 403

    env_config = config.get_env_config(ENV)
    title = get_title()
    if replay_session:
        title = f"{title} - 回放"

    return render_template('watch.html',
                           token=token,
                           title=title,
                           replay_mode=bool(replay_session),
                           replay_session=replay_session,
                           api_prefix=f'/api/{ENV}',
                           stream_url=env_config['stream_url'],
                           hls_url=env_config['hls_url'],
                           watch_url='/chutianshu-watch',
                           download_url=f'/api/{ENV}/download/',
                           app_name=env_config['app_name'],
                           show_replay_button=False)


@chutianshu_blueprint.route('/chutianshu-admin')
def chutianshu_admin():
    token = request.args.get('token', '')

    valid, message = auth.verify_stream_token(token, ENV)
    if not valid:
        return f"⛔ 访问被拒绝: {message}", 403

    return render_template('admin.html',
                           token=token,
                           api_prefix=f'/api/{ENV}',
                           room_type='chutianshu直播间')


@chutianshu_blueprint.route('/api/chutianshu/comments', methods=['GET'])
def chutianshu_get_comments():
    session_id = request.args.get('session_id', '')
    comments = database.get_comments(ENV, session_id)
    return jsonify(comments)


@chutianshu_blueprint.route('/api/chutianshu/comments', methods=['POST'])
def chutianshu_post_comment():
    data = request.get_json()
    content = data.get('content', '').strip()
    token = data.get('token', '')
    sess_id = data.get('session_id', '')
    parent_id = data.get('parent_id', None)

    if not content:
        return jsonify({'error': '评论内容不能为空'}), 400

    valid, _ = auth.verify_watch_token(token, ENV)
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    if not sess_id:
        sess_id = session.get_current_session(ENV)

    success = database.add_comment(content, sess_id, parent_id, False, False, ENV)
    return jsonify({'status': 'ok' if success else 'error'})


@chutianshu_blueprint.route('/api/chutianshu/admin/comment', methods=['POST'])
def chutianshu_admin_comment():
    data = request.get_json()
    token = data.get('token', '')
    content = data.get('content', '').strip()
    pinned = data.get('pinned', False)
    parent_id = data.get('parent_id', None)

    valid, _ = auth.verify_stream_token(token, ENV)
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    if not content:
        return jsonify({'error': '评论内容不能为空'}), 400

    sess_id = session.get_current_session(ENV)
    success = database.add_comment(content, sess_id, parent_id, True, pinned, ENV)
    return jsonify({'status': 'ok' if success else 'error'})


@chutianshu_blueprint.route('/api/chutianshu/admin/pin/<int:comment_id>', methods=['POST'])
def chutianshu_pin_comment(comment_id):
    data = request.get_json()
    token = data.get('token', '')
    pinned = data.get('pinned', True)

    valid, _ = auth.verify_stream_token(token, ENV)
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    success = database.toggle_pin_comment(comment_id, pinned, ENV)
    return jsonify({'status': 'ok' if success else 'error'})


@chutianshu_blueprint.route('/api/chutianshu/admin/delete/<int:comment_id>', methods=['DELETE'])
def chutianshu_delete_comment(comment_id):
    data = request.get_json()
    token = data.get('token', '')

    valid, _ = auth.verify_stream_token(token, ENV)
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    success = database.delete_comment(comment_id, ENV)
    return jsonify({'status': 'ok' if success else 'error'})


@chutianshu_blueprint.route('/api/chutianshu/recordings')
def chutianshu_recordings():
    recordings = database.get_recordings(ENV)
    return jsonify(recordings)


@chutianshu_blueprint.route('/api/chutianshu/replay/<session_id>')
def chutianshu_replay(session_id):
    filepath, _ = database.get_recording_file(session_id, ENV)
    if not filepath or not os.path.exists(filepath):
        return "录制不存在", 404
    return send_file(filepath, mimetype='video/x-flv')


@chutianshu_blueprint.route('/api/chutianshu/download/<session_id>')
def chutianshu_download(session_id):
    filepath, title = database.get_recording_file(session_id, ENV)
    if not filepath or not os.path.exists(filepath):
        return "录制不存在", 404
    filename = f"{title}_{session_id.replace('session_', '')}.flv"
    return send_file(filepath, as_attachment=True, download_name=filename, mimetype='video/x-flv')
