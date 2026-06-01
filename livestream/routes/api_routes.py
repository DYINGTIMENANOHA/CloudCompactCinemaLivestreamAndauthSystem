"""
API路由 - 评论、录制、流状态等
"""
from flask import Blueprint, request, jsonify, send_file
import os
import config
from utils import auth, database, srs, session

api_blueprint = Blueprint('api', __name__)

# ===== 流状态检查 =====
@api_blueprint.route('/stream-status/<app_name>')
def stream_status(app_name):
    """检查直播流状态"""
    status = srs.check_stream_status(app_name)
    return jsonify(status)

# ===== 生产环境API =====
@api_blueprint.route('/live/recordings')
def live_recordings():
    """获取生产环境录制列表"""
    recordings = database.get_recordings('live')
    return jsonify(recordings)

@api_blueprint.route('/live/replay/<session_id>')
def live_replay(session_id):
    """播放生产环境回放"""
    filepath, _ = database.get_recording_file(session_id, 'live')
    if not filepath or not os.path.exists(filepath):
        return "录制不存在", 404
    return send_file(filepath, mimetype='video/x-flv')

@api_blueprint.route('/live/download/<session_id>')
def live_download(session_id):
    """下载生产环境录制"""
    filepath, title = database.get_recording_file(session_id, 'live')
    if not filepath or not os.path.exists(filepath):
        return "录制不存在", 404
    filename = f"{title}_{session_id.replace('session_', '')}.flv"
    return send_file(filepath, as_attachment=True, download_name=filename, mimetype='video/x-flv')

@api_blueprint.route('/live/comments', methods=['GET'])
def live_get_comments():
    """获取生产环境评论"""
    session_id = request.args.get('session_id', '')
    comments = database.get_comments('live', session_id)
    return jsonify(comments)

@api_blueprint.route('/live/comments', methods=['POST'])
def live_post_comment():
    """发送生产环境评论"""
    data = request.get_json()
    content = data.get('content', '').strip()
    token = data.get('token', '')
    sess_id = data.get('session_id', '')
    parent_id = data.get('parent_id', None)

    if not content:
        return jsonify({'error': '评论内容不能为空'}), 400

    valid, *_ = auth.verify_watch_token(token, 'live')
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    if not sess_id:
        sess_id = session.get_current_session('live')

    success = database.add_comment(content, sess_id, parent_id, False, False, 'live')
    return jsonify({'status': 'ok' if success else 'error'})

@api_blueprint.route('/live/admin/comment', methods=['POST'])
def live_admin_comment():
    """管理员发送生产环境评论"""
    data = request.get_json()
    token = data.get('token', '')
    content = data.get('content', '').strip()
    pinned = data.get('pinned', False)
    parent_id = data.get('parent_id', None)

    valid, _ = auth.verify_stream_token(token, 'live')
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    if not content:
        return jsonify({'error': '评论内容不能为空'}), 400

    sess_id = session.get_current_session('live')
    success = database.add_comment(content, sess_id, parent_id, True, pinned, 'live')
    return jsonify({'status': 'ok' if success else 'error'})

@api_blueprint.route('/live/admin/pin/<int:comment_id>', methods=['POST'])
def live_pin_comment(comment_id):
    """置顶生产环境评论"""
    data = request.get_json()
    token = data.get('token', '')
    pinned = data.get('pinned', True)

    valid, _ = auth.verify_stream_token(token, 'live')
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    success = database.toggle_pin_comment(comment_id, pinned, 'live')
    return jsonify({'status': 'ok' if success else 'error'})

@api_blueprint.route('/live/admin/delete/<int:comment_id>', methods=['DELETE'])
def live_delete_comment(comment_id):
    """删除生产环境评论"""
    data = request.get_json()
    token = data.get('token', '')

    valid, _ = auth.verify_stream_token(token, 'live')
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    success = database.delete_comment(comment_id, 'live')
    return jsonify({'status': 'ok' if success else 'error'})

# ===== 测试环境API（与生产环境相同，只是env参数不同）=====
@api_blueprint.route('/test/recordings')
def test_recordings():
    recordings = database.get_recordings('test')
    return jsonify(recordings)

@api_blueprint.route('/test/replay/<session_id>')
def test_replay(session_id):
    filepath, _ = database.get_recording_file(session_id, 'test')
    if not filepath or not os.path.exists(filepath):
        return "录制不存在", 404
    return send_file(filepath, mimetype='video/x-flv')

@api_blueprint.route('/test/download/<session_id>')
def test_download(session_id):
    filepath, title = database.get_recording_file(session_id, 'test')
    if not filepath or not os.path.exists(filepath):
        return "录制不存在", 404
    filename = f"{title}_{session_id.replace('session_', '')}.flv"
    return send_file(filepath, as_attachment=True, download_name=filename, mimetype='video/x-flv')

@api_blueprint.route('/test/comments', methods=['GET'])
def test_get_comments():
    session_id = request.args.get('session_id', '')
    comments = database.get_comments('test', session_id)
    return jsonify(comments)

@api_blueprint.route('/test/comments', methods=['POST'])
def test_post_comment():
    data = request.get_json()
    content = data.get('content', '').strip()
    token = data.get('token', '')
    sess_id = data.get('session_id', '')
    parent_id = data.get('parent_id', None)

    if not content:
        return jsonify({'error': '评论内容不能为空'}), 400

    valid, *_ = auth.verify_watch_token(token, 'test')
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    if not sess_id:
        sess_id = session.get_current_session('test')

    success = database.add_comment(content, sess_id, parent_id, False, False, 'test')
    return jsonify({'status': 'ok' if success else 'error'})

@api_blueprint.route('/test/admin/comment', methods=['POST'])
def test_admin_comment():
    data = request.get_json()
    token = data.get('token', '')
    content = data.get('content', '').strip()
    pinned = data.get('pinned', False)
    parent_id = data.get('parent_id', None)

    valid, _ = auth.verify_stream_token(token, 'test')
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    if not content:
        return jsonify({'error': '评论内容不能为空'}), 400

    sess_id = session.get_current_session('test')
    success = database.add_comment(content, sess_id, parent_id, True, pinned, 'test')
    return jsonify({'status': 'ok' if success else 'error'})

@api_blueprint.route('/test/admin/pin/<int:comment_id>', methods=['POST'])
def test_pin_comment(comment_id):
    data = request.get_json()
    token = data.get('token', '')
    pinned = data.get('pinned', True)

    valid, _ = auth.verify_stream_token(token, 'test')
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    success = database.toggle_pin_comment(comment_id, pinned, 'test')
    return jsonify({'status': 'ok' if success else 'error'})

@api_blueprint.route('/test/admin/delete/<int:comment_id>', methods=['DELETE'])
def test_delete_comment(comment_id):
    data = request.get_json()
    token = data.get('token', '')

    valid, _ = auth.verify_stream_token(token, 'test')
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    success = database.delete_comment(comment_id, 'test')
    return jsonify({'status': 'ok' if success else 'error'})
