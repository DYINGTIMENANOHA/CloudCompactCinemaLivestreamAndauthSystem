"""
监控面板路由 - 完整的诊断数据
"""
from flask import Blueprint, request, jsonify, render_template
import time
import os
from utils import auth, srs

monitor_blueprint = Blueprint('monitor', __name__)

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

@monitor_blueprint.route('/monitor')
def monitor_page():
    """监控面板"""
    token = request.args.get('token', '')
    valid, message, *_ = auth.verify_watch_token(token)
    if not valid:
        return f"⛔ 访问被拒绝: {message}", 403
    return render_template('monitor.html', token=token)

@monitor_blueprint.route('/api/monitor/stats')
def monitor_stats():
    """获取完整的监控诊断数据"""
    try:
        stats = {
            'timestamp': time.time(),
            'system': get_system_stats(),
            'srs': get_srs_stats(),
            'streams': {
                'live': get_stream_stats('live'),
                'test': get_stream_stats('test'),
            }
        }
        return jsonify(stats)
    except Exception as e:
        print(f"监控统计错误: {e}")
        return jsonify({'error': str(e)}), 500

@monitor_blueprint.route('/api/log-buffering', methods=['POST'])
def log_buffering():
    """记录观众端缓冲事件"""
    try:
        data = request.get_json()
        timestamp = data.get('time', time.time())
        session = data.get('session', 'unknown')
        buffer_size = data.get('buffer_size', 0)
        buffer_duration = data.get('buffer_duration', 0)
        stalled_count = data.get('stalled_count', 0)
        current_speed = data.get('current_speed', 0)
        
        import config
        from datetime import datetime
        log_file = os.path.join(config.LOG_DIR, f"buffering_{datetime.now().strftime('%Y%m%d')}.log")
        
        with open(log_file, 'a', encoding='utf-8') as f:
            f.write(f"{datetime.now().isoformat()} | Session: {session} | BufferSize: {buffer_size}KB | BufferDuration: {buffer_duration}s | Stalled: {stalled_count} | Speed: {current_speed}KB/s\n")
        
        return jsonify({'status': 'ok'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def get_system_stats():
    """获取系统资源统计"""
    if not HAS_PSUTIL:
        return {'cpu_percent': 0, 'memory_percent': 0, 'disk_percent': 0, 'available': False}
    try:
        return {
            'cpu_percent': round(psutil.cpu_percent(interval=0.1), 1),
            'memory_percent': round(psutil.virtual_memory().percent, 1),
            'disk_percent': round(psutil.disk_usage('/').percent, 1),
            'available': True
        }
    except Exception as e:
        print(f"系统统计错误: {e}")
        return {'available': False}

def get_srs_stats():
    """获取SRS服务器统计"""
    try:
        summary = srs.get_server_summary()
        if summary and summary.get('data'):
            return {'available': True, 'data': summary}
    except Exception as e:
        print(f"SRS统计错误: {e}")
    return {'available': False}

def get_stream_stats(env):
    """获取流的详细统计 - 修复版"""
    try:
        import config
        env_config = config.get_env_config(env)
        app_name = env_config['app_name']
        
        stream_info = srs.get_stream_info(app_name)
        if stream_info and stream_info.get('publish', {}).get('active'):
            # 从正确的位置提取码率
            kbps = stream_info.get('kbps', {})
            video = stream_info.get('video', {})
            audio = stream_info.get('audio', {})
            
            # 接收码率（主播推流质量）
            recv_kbps = kbps.get('recv_30s', 0)
            # 发送码率（给观众的码率）
            send_kbps = kbps.get('send_30s', 0)
            
            # 粗略估算视频/音频码率（80%视频 20%音频）
            video_kbps = recv_kbps * 0.8
            audio_kbps = recv_kbps * 0.2
            
            return {
                'live': True,
                'recv_kbps': round(recv_kbps, 0),      # 接收码率
                'send_kbps': round(send_kbps, 0),      # 发送码率
                'video_kbps': round(video_kbps, 0),    # 估算视频码率
                'audio_kbps': round(audio_kbps, 0),    # 估算音频码率
                'total_kbps': round(recv_kbps, 0),     # 总码率
                'clients': stream_info.get('clients', 0),  # 观众数
                'codec': video.get('codec', 'unknown'),
                'width': video.get('width', 0),
                'height': video.get('height', 0),
                'frames': stream_info.get('frames', 0),    # 总帧数
                'send_bytes': stream_info.get('send_bytes', 0),  # 发送字节数
                'recv_bytes': stream_info.get('recv_bytes', 0),  # 接收字节数
            }
    except Exception as e:
        print(f"流统计错误 ({env}): {e}")
    
    return {'live': False}

@monitor_blueprint.route('/api/monitor/diagnose', methods=['POST'])
def diagnose():
    """智能诊断系统 - 分析卡顿根源"""
    try:
        import subprocess
        import statistics
        
        results = {
            'timestamp': time.time(),
            'tests': {},
            'conclusion': '',
            'recommendations': []
        }
        
        # 测试1：检查SRS流质量
        stream_info = srs.get_stream_info('live')
        if stream_info:
            kbps = stream_info.get('kbps', {})
            recv_kbps = kbps.get('recv_30s', 0)
            send_kbps = kbps.get('send_30s', 0)
            
            # 计算码率稳定性
            bitrate_diff = abs(recv_kbps - send_kbps)
            bitrate_loss_percent = (bitrate_diff / recv_kbps * 100) if recv_kbps > 0 else 0
            
            results['tests']['stream_quality'] = {
                'name': '流质量检测',
                'status': 'good' if bitrate_loss_percent < 5 else 'warning',
                'recv_kbps': recv_kbps,
                'send_kbps': send_kbps,
                'loss_percent': round(bitrate_loss_percent, 2),
                'message': f"码率损失: {bitrate_loss_percent:.1f}%"
            }
            
            if bitrate_loss_percent > 10:
                results['recommendations'].append('⚠️ 服务器转发存在明显损失，检查服务器资源')
        
        # 测试2：服务器资源检测
        if HAS_PSUTIL:
            cpu = psutil.cpu_percent(interval=1)
            mem = psutil.virtual_memory().percent
            disk_io = psutil.disk_io_counters()
            
            resource_status = 'good'
            resource_issues = []
            
            if cpu > 80:
                resource_status = 'error'
                resource_issues.append(f'CPU使用率过高: {cpu}%')
            if mem > 85:
                resource_status = 'error'
                resource_issues.append(f'内存使用率过高: {mem}%')
            
            results['tests']['server_resources'] = {
                'name': '服务器资源',
                'status': resource_status,
                'cpu': cpu,
                'memory': mem,
                'message': ', '.join(resource_issues) if resource_issues else '资源充足'
            }
            
            if resource_issues:
                results['recommendations'].append('🔴 服务器资源不足！升级服务器或降低码率')
        
        # 测试3：网络连接质量（通过SRS统计）
        try:
            summary = srs.get_server_summary()
            if summary and summary.get('data', {}).get('system'):
                sys_info = summary['data']['system']
                conn_count = sys_info.get('conn_srs', 0)
                
                results['tests']['connections'] = {
                    'name': '网络连接',
                    'status': 'good' if conn_count < 50 else 'warning',
                    'active_connections': conn_count,
                    'message': f'当前连接数: {conn_count}'
                }
        except:
            pass
        
        # 测试4：检查缓冲日志（过去5分钟）
        try:
            from datetime import datetime, timedelta
            log_file = os.path.join(config.LOG_DIR, f"buffering_{datetime.now().strftime('%Y%m%d')}.log")
            
            if os.path.exists(log_file):
                five_min_ago = datetime.now() - timedelta(minutes=5)
                
                with open(log_file, 'r') as f:
                    lines = f.readlines()
                
                recent_events = []
                for line in lines[-50:]:  # 最近50条
                    if 'Stalled:' in line:
                        try:
                            parts = line.split('|')
                            stalled = int(parts[3].split(':')[1].strip())
                            speed = int(parts[4].split(':')[1].strip().replace('KB/s', ''))
                            recent_events.append({'stalled': stalled, 'speed': speed})
                        except:
                            pass
                
                if recent_events:
                    avg_stalled = statistics.mean([e['stalled'] for e in recent_events])
                    avg_speed = statistics.mean([e['speed'] for e in recent_events])
                    
                    buffer_status = 'good' if avg_stalled < 3 else 'error'
                    
                    results['tests']['buffering_history'] = {
                        'name': '观众端缓冲',
                        'status': buffer_status,
                        'avg_stalled_count': round(avg_stalled, 1),
                        'avg_speed_kbps': round(avg_speed, 0),
                        'message': f'平均卡顿: {avg_stalled:.1f}次, 平均速度: {avg_speed:.0f}KB/s'
                    }
                    
                    if avg_stalled > 5:
                        results['recommendations'].append('🔴 观众端频繁卡顿！观众网络带宽不足或服务器出口带宽不够')
                    
                    if avg_speed < 1000:
                        results['recommendations'].append('⚠️ 观众下载速度过低（需要1250KB/s+），建议观众升级网络')
        except Exception as e:
            print(f"缓冲日志分析失败: {e}")
        
        # 生成诊断结论
        error_tests = [t for t in results['tests'].values() if t['status'] == 'error']
        warning_tests = [t for t in results['tests'].values() if t['status'] == 'warning']
        
        if error_tests:
            results['conclusion'] = '🔴 检测到严重问题！'
            results['severity'] = 'error'
        elif warning_tests:
            results['conclusion'] = '⚠️ 存在潜在问题'
            results['severity'] = 'warning'
        else:
            results['conclusion'] = '✅ 系统运行正常'
            results['severity'] = 'good'
        
        # 智能判断问题位置
        if not results['recommendations']:
            results['recommendations'].append('✅ 未发现明显问题，系统运行良好')
        
        return jsonify(results)
        
    except Exception as e:
        print(f"诊断失败: {e}")
        return jsonify({'error': str(e)}), 500
