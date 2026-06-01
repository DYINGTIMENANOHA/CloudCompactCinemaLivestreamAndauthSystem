"""
转码管理器 - 管理FFmpeg转码进程
"""
import subprocess
import sqlite3
import time
import os
import signal
from datetime import datetime
import config

class TranscodeManager:
    def __init__(self):
        self.db_path = config.QUALITY_DB
        self._init_db()

    def _init_db(self):
        """确保默认配置行存在"""
        try:
            conn = sqlite3.connect(self.db_path)
            c = conn.cursor()
            c.execute("SELECT COUNT(*) FROM smooth_mode_config WHERE id=1")
            if c.fetchone()[0] == 0:
                c.execute("""
                    INSERT INTO smooth_mode_config (id, status, min_bitrate, max_bitrate, reduction_factor, preset)
                    VALUES (1, 'idle', 8000, 80000, 0.8, 'veryfast')
                """)
                conn.commit()
            conn.close()
        except Exception as e:
            print(f"初始化数据库失败: {e}")

    def get_config(self):
        """获取配置"""
        try:
            conn = sqlite3.connect(self.db_path)
            c = conn.cursor()
            # ✅ Bug3修复: 补上 original_bitrate, max_transcode_bitrate
            c.execute("""
                SELECT status, test_speed, target_bitrate, reduction_factor,
                       min_bitrate, max_bitrate, preset, ffmpeg_pid, updated_at,
                       original_bitrate, max_transcode_bitrate
                FROM smooth_mode_config WHERE id=1
            """)
            row = c.fetchone()
            conn.close()

            if not row:
                raise Exception("配置不存在")

            return {
                'status': row[0],
                'test_speed': row[1],
                'target_bitrate': row[2],
                'reduction_factor': row[3],
                'min_bitrate': row[4],
                'max_bitrate': row[5],
                'preset': row[6],
                'ffmpeg_pid': row[7],
                'updated_at': row[8],
                'original_bitrate': row[9],
                'max_transcode_bitrate': row[10],
            }
        except Exception as e:
            print(f"获取配置失败: {e}")
            return None

    def update_status(self, status, **kwargs):
        """更新状态"""
        try:
            conn = sqlite3.connect(self.db_path)
            c = conn.cursor()

            set_parts = ["status=?", "updated_at=datetime('now')"]
            values = [status]

            for key, value in kwargs.items():
                set_parts.append(f"{key}=?")
                values.append(value)

            query = f"UPDATE smooth_mode_config SET {', '.join(set_parts)} WHERE id=1"
            c.execute(query, values)
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            print(f"更新状态失败: {e}")
            return False

    def update_config(self, reduction_factor=None, original_bitrate=None, max_transcode_bitrate=None):
        """✅ Bug1修复: 新增方法，供管理员保存配置"""
        try:
            conn = sqlite3.connect(self.db_path)
            c = conn.cursor()

            set_parts = ["updated_at=datetime('now')"]
            values = []

            if reduction_factor is not None:
                set_parts.append("reduction_factor=?")
                values.append(reduction_factor)
            if original_bitrate is not None:
                set_parts.append("original_bitrate=?")
                values.append(original_bitrate)
            if max_transcode_bitrate is not None:
                set_parts.append("max_transcode_bitrate=?")
                values.append(max_transcode_bitrate)

            query = f"UPDATE smooth_mode_config SET {', '.join(set_parts)} WHERE id=1"
            c.execute(query, values)
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            print(f"更新配置失败: {e}")
            return False

    def start_transcode(self, target_bitrate):
        """启动转码，返回 (success: bool, pid: int 或 error: str)"""
        config_data = self.get_config()
        if not config_data:
            return False, "无法读取配置"

        if config_data['status'] != 'idle':
            return False, f"当前状态: {config_data['status']}"

        bitrate_kbps = int(target_bitrate)
        min_bitrate = config_data['min_bitrate']
        max_bitrate = config_data['max_bitrate']

        if bitrate_kbps < min_bitrate:
            bitrate_kbps = min_bitrate
        elif bitrate_kbps > max_bitrate:
            bitrate_kbps = max_bitrate

        preset = config_data.get('preset', 'veryfast')

        cmd = [
            'ffmpeg',
            '-i', 'rtmp://127.0.0.1:1935/live/stream',
            '-c:v', 'libx264',
            '-b:v', f'{bitrate_kbps}k',
            '-preset', preset,
            '-c:a', 'copy',
            '-f', 'flv',
            'rtmp://127.0.0.1:1935/live/stream_smooth'
        ]

        try:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                preexec_fn=os.setsid
            )

            self.update_status('transcoding',
                             target_bitrate=bitrate_kbps,
                             ffmpeg_pid=process.pid)

            print(f"✅ 转码已启动: {bitrate_kbps} Kbps, PID={process.pid}")

            time.sleep(3)

            if process.poll() is not None:
                stderr = process.stderr.read().decode('utf-8', errors='ignore')
                self._log_failure(f"FFmpeg启动失败: {stderr[:500]}")
                self.update_status('idle', ffmpeg_pid=None, target_bitrate=None)
                return False, "转码进程启动失败"

            self.update_status('ready')
            # ✅ Bug2修复: 返回 pid 整数，不再返回消息字符串
            return True, process.pid

        except Exception as e:
            error_msg = str(e)
            self._log_failure(error_msg)
            self.update_status('idle', ffmpeg_pid=None, target_bitrate=None)
            return False, f"启动失败: {error_msg}"

    def stop_transcode(self):
        """停止转码"""
        config_data = self.get_config()
        if not config_data:
            return False

        pid = config_data.get('ffmpeg_pid')
        if not pid:
            self.update_status('idle', ffmpeg_pid=None, target_bitrate=None)
            return True

        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
            time.sleep(1)
            try:
                os.killpg(os.getpgid(pid), signal.SIGKILL)
            except:
                pass
            print(f"✅ 转码已停止 (PID={pid})")
        except Exception as e:
            print(f"停止转码失败: {e}")

        self.update_status('idle', ffmpeg_pid=None, target_bitrate=None)
        return True

    def get_viewer_stats(self):
        """获取观众统计"""
        try:
            conn = sqlite3.connect(self.db_path)
            c = conn.cursor()

            c.execute("""
                DELETE FROM viewer_stats
                WHERE datetime(last_heartbeat) < datetime('now', '-60 seconds')
            """)

            c.execute("""
                SELECT quality, COUNT(*)
                FROM viewer_stats
                GROUP BY quality
            """)

            stats = {'original': 0, 'smooth': 0}
            for row in c.fetchall():
                stats[row[0]] = row[1]

            conn.commit()
            conn.close()
            return stats
        except Exception as e:
            print(f"获取观众统计失败: {e}")
            return {'original': 0, 'smooth': 0}

    def update_viewer(self, viewer_id, quality):
        """更新观众信息"""
        try:
            conn = sqlite3.connect(self.db_path)
            c = conn.cursor()
            c.execute("""
                INSERT OR REPLACE INTO viewer_stats (viewer_id, quality, last_heartbeat)
                VALUES (?, ?, datetime('now'))
            """, (viewer_id, quality))
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            print(f"更新观众信息失败: {e}")
            return False

    def update_viewer_heartbeat(self, viewer_id, quality):
        """✅ Bug1修复: 新增方法，供心跳接口调用"""
        return self.update_viewer(viewer_id, quality)

    def remove_viewer(self, viewer_id):
        """移除观众"""
        try:
            conn = sqlite3.connect(self.db_path)
            c = conn.cursor()
            c.execute("DELETE FROM viewer_stats WHERE viewer_id=?", (viewer_id,))
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            print(f"移除观众失败: {e}")
            return False

    def cleanup_viewers(self):
        """✅ Bug1修复: 新增方法，清空所有观众记录（重置时使用）"""
        try:
            conn = sqlite3.connect(self.db_path)
            c = conn.cursor()
            c.execute("DELETE FROM viewer_stats")
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            print(f"清空观众记录失败: {e}")
            return False

    def check_auto_stop(self):
        """检查是否应该自动停止（无观众60秒）"""
        stats = self.get_viewer_stats()

        if stats['smooth'] == 0:
            config_data = self.get_config()
            if config_data and config_data['status'] == 'ready':
                try:
                    updated_at = datetime.fromisoformat(config_data['updated_at'].replace(' ', 'T'))
                    elapsed = (datetime.now() - updated_at).total_seconds()
                    if elapsed > 60:
                        print(f"⚠️ 无流畅模式观众超过60秒，自动停止转码")
                        self.stop_transcode()
                        return True
                except:
                    pass

        return False

    def _log_failure(self, error_message):
        """记录失败日志"""
        try:
            conn = sqlite3.connect(self.db_path)
            c = conn.cursor()
            c.execute("""
                INSERT INTO transcode_failure_logs (error_message, timestamp)
                VALUES (?, datetime('now'))
            """, (error_message[:1000],))
            c.execute("""
                DELETE FROM transcode_failure_logs
                WHERE id NOT IN (
                    SELECT id FROM transcode_failure_logs
                    ORDER BY timestamp DESC
                    LIMIT 100
                )
            """)
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"记录日志失败: {e}")

    def get_failure_logs(self, limit=20):
        """获取失败日志"""
        try:
            conn = sqlite3.connect(self.db_path)
            c = conn.cursor()
            c.execute("""
                SELECT error_message, timestamp
                FROM transcode_failure_logs
                ORDER BY timestamp DESC
                LIMIT ?
            """, (limit,))
            logs = [{'error': row[0], 'time': row[1]} for row in c.fetchall()]
            conn.close()
            return logs
        except Exception as e:
            print(f"获取日志失败: {e}")
            return []
