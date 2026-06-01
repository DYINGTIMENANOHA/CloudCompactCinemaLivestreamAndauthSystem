"""
网速测试路由 - 观众可用
"""
from flask import Blueprint, request, jsonify, render_template, Response
import time
from utils import auth

speed_test_blueprint = Blueprint('speed_test', __name__)

@speed_test_blueprint.route('/speed-test')
def speed_test_page():
    """网速测试页面"""
    token = request.args.get('token', '')
    
    # 验证Token
    valid, message, *_ = auth.verify_watch_token(token)
    if not valid:
        return f"⛔ 访问被拒绝: {message}", 403
    
    return render_template('speed_test.html', token=token)

@speed_test_blueprint.route('/api/speed-test/download')
def speed_test_download():
    """下载速度测试 - 生成指定大小的数据"""
    size_mb = request.args.get('size', '10')
    try:
        size_mb = int(size_mb)
    except:
        size_mb = 10
    
    # 限制最大20MB
    size_mb = min(size_mb, 20)
    
    chunk_size = 1024 * 1024  # 1MB
    
    def generate():
        for _ in range(size_mb):
            yield b'0' * chunk_size
    
    return Response(generate(), mimetype='application/octet-stream')

@speed_test_blueprint.route('/api/speed-test/upload', methods=['POST'])
def speed_test_upload():
    """上传速度测试"""
    start_time = time.time()
    total_bytes = 0
    
    chunk_size = 8192
    while True:
        chunk = request.stream.read(chunk_size)
        if not chunk:
            break
        total_bytes += len(chunk)
    
    elapsed = time.time() - start_time
    
    return jsonify({
        'bytes': total_bytes,
        'time': elapsed,
        'mbps': (total_bytes * 8 / 1000000) / elapsed if elapsed > 0 else 0
    })

@speed_test_blueprint.route('/api/speed-test/ping')
def speed_test_ping():
    """Ping测试 - 返回时间戳"""
    return jsonify({'timestamp': time.time()})
