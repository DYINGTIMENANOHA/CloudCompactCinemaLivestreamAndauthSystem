"""
SRS API工具模块 - 与SRS服务器交互
"""
import requests
import config

def check_stream_status(app_name):
    """
    检查指定应用的直播流状态
    
    Args:
        app_name: SRS应用名称 ('live' 或 'test')
    
    Returns:
        dict: {'live': bool, 'app': str, 'error': str}
    """
    try:
        url = f"{config.SRS_API_BASE}/streams/"
        resp = requests.get(url, timeout=2)
        data = resp.json()
        
        if data.get('streams'):
            for stream in data['streams']:
                if stream.get('app') == app_name and stream.get('publish', {}).get('active'):
                    clients = max(0, stream.get('clients', 1) - 1)
                    return {'live': True, 'app': app_name, 'clients': clients}
        
        return {'live': False, 'app': app_name, 'clients': 0}
    except Exception as e:
        return {'live': False, 'app': app_name, 'error': str(e)}

def get_stream_info(app_name):
    """
    获取流的详细信息
    
    Args:
        app_name: SRS应用名称 ('live' 或 'test')
    
    Returns:
        dict: 流信息或None
    """
    try:
        url = f"{config.SRS_API_BASE}/streams/"
        resp = requests.get(url, timeout=2)
        data = resp.json()
        
        if data.get('streams'):
            for stream in data['streams']:
                if stream.get('app') == app_name:
                    return stream
        
        return None
    except Exception as e:
        print(f"获取流信息失败: {e}")
        return None

def get_server_summary():
    """
    获取SRS服务器摘要信息
    
    Returns:
        dict: 服务器信息或None
    """
    try:
        url = f"{config.SRS_API_BASE}/summaries"
        resp = requests.get(url, timeout=2)
        return resp.json()
    except Exception as e:
        print(f"获取服务器信息失败: {e}")
        return None