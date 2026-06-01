"""
直播系统主入口
模块化重构版本 - 2026年2月11日
流畅模式功能 - 2026年4月4日添加
"""
from flask import Flask
import config
from utils import database

app = Flask(__name__)
app.config['SECRET_KEY'] = config.SECRET_KEY

for env_name in config.ENV_CONFIG:
    database.init_db(env_name)

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', config.CORS_ORIGINS)
    response.headers.add('Access-Control-Allow-Headers', config.CORS_HEADERS)
    response.headers.add('Access-Control-Allow-Methods', config.CORS_METHODS)
    return response

from routes import (
    watch_blueprint,
    admin_blueprint,
    api_blueprint,
    internal_blueprint,
    speed_test_blueprint,
    monitor_blueprint,
    auth_blueprint,
    quality_blueprint,
)

app.register_blueprint(watch_blueprint)
app.register_blueprint(admin_blueprint)
app.register_blueprint(api_blueprint, url_prefix='/api')
app.register_blueprint(internal_blueprint, url_prefix='/api/internal')
app.register_blueprint(speed_test_blueprint)
app.register_blueprint(monitor_blueprint)
app.register_blueprint(auth_blueprint)
app.register_blueprint(quality_blueprint, url_prefix='/api/quality')

if __name__ == '__main__':
    import os
    for dir_path in config.RECORDINGS_DIR.values():
        os.makedirs(dir_path, exist_ok=True)
    os.makedirs(config.LOG_DIR, exist_ok=True)

    print(f"""
╔═══════════════════════════════════════════════════════════╗
║           直播系统启动                                      ║
║           端口: {config.FLASK_PORT}                                    ║
║           环境: 生产(live) + 测试(test)                     ║
║           新功能: 流畅模式 (Smooth Mode)                     ║
╚═══════════════════════════════════════════════════════════╝
    """)

    app.run(
        host=config.FLASK_HOST,
        port=config.FLASK_PORT,
        debug=False
    )
