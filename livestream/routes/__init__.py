"""
路由模块 - 导出所有蓝图
"""
from .watch_routes import watch_blueprint
from .admin_routes import admin_blueprint
from .api_routes import api_blueprint
from .internal_routes import internal_blueprint
from .speed_test_routes import speed_test_blueprint
from .monitor_routes import monitor_blueprint
from .auth_routes import auth_blueprint
from .quality_routes import quality_blueprint

__all__ = [
    'watch_blueprint',
    'admin_blueprint',
    'api_blueprint',
    'internal_blueprint',
    'speed_test_blueprint',
    'monitor_blueprint',
    'auth_blueprint',
    'quality_blueprint',
]
