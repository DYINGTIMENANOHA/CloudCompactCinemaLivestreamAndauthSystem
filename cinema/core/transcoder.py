"""
后台转码 worker

asyncio 队列 + ffmpeg subprocess。
- 重封装为片段化 mp4(MSE 兼容)
- 转码后用 ffprobe 检查编码白名单
- 移动到 videos/,删除原文件
- 更新数据库状态
"""
import asyncio
import json
import sqlite3
import time
import uuid
from pathlib import Path
from core import config, db, uploader

VIDEOS_DIR = config.VIDEOS_DIR
UPLOADS_DIR = config.UPLOADS_DIR

# 浏览器能播的视频编码白名单
CODEC_WHITELIST = {"h264", "hevc", "vp8", "vp9", "av1"}

# 任务队列
_queue: asyncio.Queue = asyncio.Queue()


async def enqueue_task(task_id: str, temp_path: str, original_filename: str,
                        original_size: int, reservation_id: str):
    """把一个上传完成的任务放进转码队列。"""
    await _queue.put({
        "task_id": task_id,
        "temp_path": temp_path,
        "original_filename": original_filename,
        "original_size": original_size,
        "reservation_id": reservation_id,
    })
    print(f"[transcoder] enqueued task {task_id} ({original_filename})")


def _update_task(task_id: str, **fields):
    """更新 upload_tasks 表的某个任务。"""
    if not fields:
        return
    cols = ", ".join(f"{k} = ?" for k in fields.keys())
    values = list(fields.values()) + [task_id]
    conn = sqlite3.connect(db.DB_PATH)
    try:
        conn.execute(f"UPDATE upload_tasks SET {cols} WHERE id = ?", values)
        conn.commit()
    finally:
        conn.close()


def _insert_video(video_id: str, filename: str, display_name: str,
                  duration: float, size_bytes: int,
                  video_codec: str = "", audio_codec: str = ""):
    """往 videos 表插入一条新视频。"""
    conn = sqlite3.connect(db.DB_PATH)
    try:
        conn.execute(
            "INSERT INTO videos (id, filename, display_name, duration_seconds, size_bytes, video_codec, audio_codec) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (video_id, filename, display_name, duration, size_bytes, video_codec, audio_codec),
        )
        conn.commit()
    finally:
        conn.close()


async def _run_subprocess(cmd: list[str]) -> tuple[int, str, str]:
    """异步执行 subprocess,返回 (returncode, stdout, stderr)。"""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode, stdout.decode(errors="replace"), stderr.decode(errors="replace")


async def _probe_video(file_path: str) -> tuple[bool, str, float]:
    """
    用 ffprobe 检查视频编码和时长。
    返回 (是否兼容, 编码名/错误信息, 时长秒)。
    """
    cmd = [
        config.FFPROBE_BIN,
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=codec_name",
        "-show_entries", "format=duration",
        "-of", "json",
        file_path,
    ]
    code, out, err = await _run_subprocess(cmd)
    if code != 0:
        return False, f"ffprobe 失败: {err.strip()[:200]}", 0.0

    try:
        info = json.loads(out)
        codec = info.get("streams", [{}])[0].get("codec_name", "").lower()
        duration_str = info.get("format", {}).get("duration", "0")
        duration = float(duration_str) if duration_str else 0.0
    except (json.JSONDecodeError, KeyError, ValueError, IndexError) as e:
        return False, f"解析 ffprobe 输出失败: {e}", 0.0

    if not codec:
        return False, "无法识别视频编码", duration

    if codec not in CODEC_WHITELIST:
        return False, f"不支持的视频编码: {codec}(支持 H.264/H.265/VP8/VP9/AV1)", duration

    return True, codec, duration


async def _probe_audio_codec(file_path: str) -> str:
    """探测音频编码,没有音频返回空字符串。"""
    cmd = [
        config.FFPROBE_BIN,
        "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=codec_name",
        "-of", "json",
        file_path,
    ]
    code, out, err = await _run_subprocess(cmd)
    if code != 0:
        return ""
    try:
        info = json.loads(out)
        streams = info.get("streams", [])
        if not streams:
            return ""
        return streams[0].get("codec_name", "").lower()
    except (json.JSONDecodeError, KeyError, IndexError):
        return ""


async def _process_task(task: dict):
    """处理单个转码任务。"""
    task_id = task["task_id"]
    temp_path = task["temp_path"]
    original_filename = task["original_filename"]
    reservation_id = task["reservation_id"]

    print(f"[transcoder] processing {task_id}: {original_filename}")
    _update_task(task_id, status="processing")

    # 输出文件名:用 task_id 作为 uuid
    video_id = task_id
    output_filename = f"{video_id}.mp4"
    output_path = VIDEOS_DIR / output_filename

    try:
        # 第 0 步: 先探测输入文件的编码,决定 ffmpeg 参数
        ok, video_codec, _ = await _probe_video(temp_path)
        if not ok:
            raise RuntimeError(video_codec)  # 此时 video_codec 是错误信息

        # 探测音频编码(可能没有音频)
        audio_codec = await _probe_audio_codec(temp_path)
        print(f"[transcoder] detected: video={video_codec}, audio={audio_codec}")

        # 第 1 步: 构造 ffmpeg 命令
        cmd = [
            config.FFMPEG_BIN,
            "-y",
            "-i", temp_path,
            "-map", "0:v:0",
            "-map", "0:a:0?",
            "-c:v", "copy",
        ]

        # 音频处理: AAC/MP3/Opus 直接 copy,其他(AC3/DTS/FLAC等)转码成 AAC
        # 因为很多音频编码在 fragmented mp4 里有问题
        AUDIO_PASSTHROUGH = {"aac", "mp3", "opus"}
        if audio_codec and audio_codec in AUDIO_PASSTHROUGH:
            cmd += ["-c:a", "copy"]
        elif audio_codec:
            cmd += ["-c:a", "aac", "-b:a", "192k"]
        # 如果没音频,不加 -c:a

        # HEVC 在 mp4 里需要 hvc1 tag,H.264 不能加
        if video_codec == "hevc":
            cmd += ["-tag:v", "hvc1"]

        cmd += [
            "-movflags", "+faststart",
            "-f", "mp4",
            str(output_path),
        ]
        print(f"[transcoder] cmd: {' '.join(cmd)}")
        code, out, err = await _run_subprocess(cmd)
        if code != 0:
            print(f"[transcoder] ffmpeg full stderr:\n{err}\n[end stderr]")
            error_msg = err.strip().split("\n")[-1][:300] if err.strip() else "ffmpeg 失败"
            raise RuntimeError(f"重封装失败: {error_msg}")

        if not output_path.exists():
            raise RuntimeError("ffmpeg 完成但输出文件不存在")

        # 第 2 步: ffprobe 检查编码白名单和读取时长
        ok, codec_or_err, duration = await _probe_video(str(output_path))
        if not ok:
            output_path.unlink(missing_ok=True)
            raise RuntimeError(codec_or_err)

        if duration <= 0:
            output_path.unlink(missing_ok=True)
            raise RuntimeError("无法读取视频时长")

        # 第 3 步: 删除原临时文件
        try:
            Path(temp_path).unlink(missing_ok=True)
            original_deleted = True
        except OSError as e:
            print(f"[transcoder] warning: failed to delete temp {temp_path}: {e}")
            original_deleted = False

        # 第 4 步: 写入数据库
        actual_size = output_path.stat().st_size
        display_name = Path(original_filename).stem  # 去扩展名

        out_video_codec = codec_or_err
        out_audio_codec = await _probe_audio_codec(str(output_path))
        _insert_video(video_id, output_filename, display_name, duration, actual_size,
                      video_codec=out_video_codec, audio_codec=out_audio_codec)

        _update_task(
            task_id,
            status="done",
            error_message=None,
            original_deleted=1 if original_deleted else 0,
            completed_at=time.strftime("%Y-%m-%d %H:%M:%S"),
            resulting_video_id=video_id,
        )

        # 第 5 步: 更新预留为实际大小
        uploader.update_reservation(reservation_id, actual_size)

        print(f"[transcoder] done: {task_id} -> {output_filename} ({actual_size} bytes, codec={codec_or_err})")

    except Exception as e:
        # 失败处理: 清理输出文件,标记失败,释放预留
        print(f"[transcoder] failed: {task_id}: {e}")
        try:
            output_path.unlink(missing_ok=True)
        except OSError:
            pass
        try:
            Path(temp_path).unlink(missing_ok=True)
        except OSError:
            pass
        _update_task(
            task_id,
            status="failed",
            error_message=str(e)[:500],
            completed_at=time.strftime("%Y-%m-%d %H:%M:%S"),
        )
        uploader.release_reservation(reservation_id)


async def transcoder_loop():
    """转码 worker 主循环,程序启动时启动。"""
    print("[transcoder] worker started")
    while True:
        try:
            task = await _queue.get()
            await _process_task(task)
        except asyncio.CancelledError:
            print("[transcoder] worker cancelled")
            raise
        except Exception as e:
            print(f"[transcoder] unexpected error in loop: {e}")
            await asyncio.sleep(1)
