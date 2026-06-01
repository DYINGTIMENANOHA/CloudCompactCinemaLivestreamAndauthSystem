"""
流畅模式路由 - adaptive bitrate quality switching
"""
from flask import Blueprint, request, jsonify
from utils import auth
from utils.transcoder import TranscodeManager
import os
import signal

quality_blueprint = Blueprint('quality', __name__)

# ===== 观众端API =====

@quality_blueprint.route('/test-speed', methods=['POST'])
def test_speed():
    """开始测速"""
    data = request.get_json()
    token = data.get('token', '')

    valid, *_ = auth.verify_watch_token(token)
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    manager = TranscodeManager()
    current_status = manager.get_config().get('status')

    if current_status != 'idle':
        return jsonify({'success': False, 'message': '流畅模式正在使用中,请稍后再试'})

    success = manager.update_status('testing')
    if success:
        return jsonify({'success': True, 'message': '开始测速,请等待30秒'})
    else:
        return jsonify({'success': False, 'message': '启动测速失败'})

@quality_blueprint.route('/submit-speed', methods=['POST'])
def submit_speed():
    """提交测速结果"""
    data = request.get_json()
    token = data.get('token', '')
    speed_mbps = data.get('speed', 0)

    valid, *_ = auth.verify_watch_token(token)
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    if speed_mbps <= 0:
        return jsonify({'success': False, 'message': '测速失败,请重试'})

    manager = TranscodeManager()
    config_data = manager.get_config()

    original_bitrate = config_data.get('original_bitrate', 3000)
    reduction_factor = config_data.get('reduction_factor', 0.8)
    max_transcode = config_data.get('max_transcode_bitrate', 3000)
    speed_kbps = int(speed_mbps * 1000)

    if speed_kbps >= original_bitrate:
        manager.update_status('idle', test_speed=0)
        return jsonify({
            'success': False,
            'message': f'您的网速很好（{speed_mbps:.1f} Mbps）,无需切换流畅模式'
        })

    target_bitrate = min(int(speed_kbps * reduction_factor), max_transcode)
    manager.update_status('idle', test_speed=speed_mbps)

    return jsonify({
        'success': True,
        'target_bitrate': target_bitrate,
        'message': f'测速完成,准备启动流畅模式（{target_bitrate} KB/s）'
    })

@quality_blueprint.route('/start-transcode', methods=['POST'])
def start_transcode():
    """启动转码进程"""
    data = request.get_json()
    token = data.get('token', '')
    target_bitrate = data.get('target_bitrate', 0)

    valid, *_ = auth.verify_watch_token(token)
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    if target_bitrate <= 0:
        return jsonify({'success': False, 'message': '目标码率无效'})

    manager = TranscodeManager()
    config = manager.get_config()

    if config.get('status') != 'idle':
        return jsonify({'success': False, 'message': '系统忙碌中'})

    success, result = manager.start_transcode(target_bitrate)

    if not success:
        return jsonify({'success': False, 'message': result})

    try:
        os.kill(result, 0)
        return jsonify({
            'success': True,
            'message': '流畅模式已启动',
            'stream_url': '/live/stream_smooth.flv'
        })
    except OSError:
        return jsonify({'success': False, 'message': '转码进程意外退出'})

@quality_blueprint.route('/status')
def get_status():
    """获取当前状态"""
    manager = TranscodeManager()
    config = manager.get_config()
    viewers = manager.get_viewer_stats()

    status = config.get('status', 'idle')
    ffmpeg_pid = config.get('ffmpeg_pid')
    process_alive = False

    if ffmpeg_pid:
        try:
            os.kill(ffmpeg_pid, 0)
            process_alive = True
        except:
            process_alive = False
            if status in ['ready', 'transcoding']:
                print(f"[STATUS] FFmpeg进程 {ffmpeg_pid} 已退出，自动重置状态")
                manager.update_status('idle', test_speed=0, target_bitrate=0, ffmpeg_pid=None)
                status = 'idle'

    return jsonify({
        'status': status,
        'test_speed': config.get('test_speed', 0),
        'target_bitrate': config.get('target_bitrate', 0),
        'viewers': viewers,
        'process_alive': process_alive,
        'ffmpeg_pid': ffmpeg_pid
    })

@quality_blueprint.route('/heartbeat', methods=['POST'])
def heartbeat():
    """观众心跳"""
    data = request.get_json()
    token = data.get('token', '')
    # ✅ 修复：读正确的字段名 quality（前端发的是quality，不是stream_type）
    quality = data.get('quality', 'original')
    # ✅ 修复：用前端传来的viewer_id，不用token
    viewer_id = data.get('viewer_id', token)

    valid, *_ = auth.verify_watch_token(token)
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    manager = TranscodeManager()
    manager.update_viewer_heartbeat(viewer_id, quality)

    return jsonify({'status': 'ok'})

@quality_blueprint.route('/leave', methods=['POST'])
def leave():
    """观众离开通知"""
    data = request.get_json()
    token = data.get('token', '')
    viewer_id = data.get('viewer_id', '')

    valid, *_ = auth.verify_watch_token(token)
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    if viewer_id:
        manager = TranscodeManager()
        manager.remove_viewer(viewer_id)

    return jsonify({'status': 'ok'})

# ===== 管理员API =====

@quality_blueprint.route('/admin/config', methods=['GET'])
def admin_get_config():
    """管理员获取配置"""
    token = request.args.get('token', '')

    valid, _ = auth.verify_stream_token(token, 'live')
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    manager = TranscodeManager()
    config = manager.get_config()
    return jsonify(config)

@quality_blueprint.route('/admin/config', methods=['POST'])
def admin_save_config():
    """管理员保存配置"""
    data = request.get_json()
    token = data.get('token', '')

    valid, _ = auth.verify_stream_token(token, 'live')
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    manager = TranscodeManager()
    success = manager.update_config(
        reduction_factor=data.get('reduction_factor'),
        original_bitrate=data.get('original_bitrate'),
        max_transcode_bitrate=data.get('max_transcode_bitrate')
    )

    return jsonify({'status': 'ok'} if success else {'error': '保存失败'}), (200 if success else 500)

@quality_blueprint.route('/admin/reset', methods=['POST'])
def admin_reset():
    """管理员停止流畅模式（有FFmpeg进程时使用）"""
    data = request.get_json()
    token = data.get('token', '')

    valid, _ = auth.verify_stream_token(token, 'live')
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    manager = TranscodeManager()
    config = manager.get_config()

    if config.get('ffmpeg_pid'):
        try:
            os.kill(config['ffmpeg_pid'], signal.SIGKILL)
            print(f"[ADMIN] 已强制停止 FFmpeg 进程: {config['ffmpeg_pid']}")
        except Exception as e:
            print(f"[ADMIN] 停止进程失败: {e}")

    manager.update_status('idle', test_speed=0, target_bitrate=0, ffmpeg_pid=None)
    manager.cleanup_viewers()

    print("[ADMIN] 流畅模式已重置")
    return jsonify({'status': 'ok', 'message': '已重置并停止所有转码进程'})

@quality_blueprint.route('/admin/hard-reset', methods=['POST'])
def admin_hard_reset():
    """✅ 新增：硬重置 - 无论任何状态直接归零，解除死锁"""
    data = request.get_json()
    token = data.get('token', '')

    valid, _ = auth.verify_stream_token(token, 'live')
    if not valid:
        return jsonify({'error': 'Token无效'}), 403

    manager = TranscodeManager()
    config = manager.get_config()

    # 无论状态如何，尝试杀掉可能存在的FFmpeg进程
    pid = config.get('ffmpeg_pid') if config else None
    if pid:
        try:
            os.kill(pid, signal.SIGKILL)
            print(f"[HARD RESET] 已杀死 FFmpeg 进程: {pid}")
        except:
            pass

    # 强制重置所有字段
    manager.update_status('idle', test_speed=0, target_bitrate=0, ffmpeg_pid=None)
    manager.cleanup_viewers()

    print("[HARD RESET] 状态已强制归零")
    return jsonify({'status': 'ok', 'message': '硬重置完成，所有状态已归零'})