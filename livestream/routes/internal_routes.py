"""
内部API路由 - SRS回调接口，用于会话管理
"""
from flask import Blueprint, request, jsonify
from utils import session

internal_blueprint = Blueprint('internal', __name__)

@internal_blueprint.route('/session', methods=['POST'])
def live_session():
    """生产环境会话管理"""
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        action = data.get('action')
        
        if action == 'start':
            session.set_current_session(session_id, 'live')
        elif action == 'stop':
            session.clear_current_session('live')
        
        return jsonify({'status': 'ok'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@internal_blueprint.route('/test-session', methods=['POST'])
def test_session():
    """测试环境会话管理"""
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        action = data.get('action')
        
        if action == 'start':
            session.set_current_session(session_id, 'test')
        elif action == 'stop':
            session.clear_current_session('test')
        
        return jsonify({'status': 'ok'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
