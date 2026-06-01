/**
 * 清晰度切换模块
 */

class QualityManager {
    constructor(videoElement, statusCallback) {
        this.videoElement = videoElement;
        this.statusCallback = statusCallback;
        this.currentQuality = 'original';
        this.flvPlayer = null;
        this.viewerId = this._getOrCreateViewerId();
        this.heartbeatInterval = null;
        this.pollInterval = null;
        this.testInProgress = false;
    }

    _getOrCreateViewerId() {
        // sessionStorage 每个标签页独立，解决多标签页共享同一viewer_id的问题
        let viewerId = sessionStorage.getItem('viewer_id');
        if (!viewerId) {
            viewerId = 'viewer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            sessionStorage.setItem('viewer_id', viewerId);
        }
        return viewerId;
    }

    init() {
        this._sendHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            this._sendHeartbeat();
        }, 30000);

        this._checkStatus();
        this.pollInterval = setInterval(() => {
            this._checkStatus();
        }, 2000);

        window.addEventListener('beforeunload', () => {
            this._notifyLeave();
        });
    }

    async _sendHeartbeat() {
        try {
            await fetch('/api/quality/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: TOKEN,
                    viewer_id: this.viewerId,
                    quality: this.currentQuality
                })
            });
        } catch (e) {
            console.error('心跳发送失败:', e);
        }
    }

    async _notifyLeave() {
        try {
            await fetch('/api/quality/leave', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: TOKEN,
                    viewer_id: this.viewerId
                })
            });
        } catch (e) {
            console.error('离开通知失败:', e);
        }
    }

    async _checkStatus() {
        try {
            const response = await fetch(`/api/quality/status?token=${TOKEN}`);
            const status = await response.json();

            if (this.statusCallback) {
                this.statusCallback(status);
            }
        } catch (e) {
            console.error('状态检查失败:', e);
        }
    }

    async switchToSmooth() {
        if (this.currentQuality === 'smooth') {
            return true;
        }

        if (this.testInProgress) {
            alert('测速正在进行中，请稍候...');
            return false;
        }

        const statusResp = await fetch(`/api/quality/status?token=${TOKEN}`);
        const status = await statusResp.json();

        if (status.status === 'ready') {
            this._switchStream('smooth');
            return true;
        }

        if (status.status !== 'idle' && status.status !== 'testing') {
            alert(`系统繁忙，请稍后重试`);
            return false;
        }

        return await this._runSpeedTestAndSwitch();
    }

    async _runSpeedTestAndSwitch() {
        this.testInProgress = true;

        const modal = this._showTestingModal();

        try {
            const resp = await fetch('/api/quality/test-speed', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: TOKEN })
            });

            const result = await resp.json();

            if (!result.success) {
                modal.close();
                this.testInProgress = false;
                alert(result.message || '无法启动测速');
                return false;
            }

        } catch (e) {
            modal.close();
            this.testInProgress = false;
            alert('启动测速失败: ' + e.message);
            return false;
        }

        try {
            const tester = new SpeedTester();
            const avgSpeedMbps = await tester.runTest(
                (progress) => { modal.updateProgress(progress); },
                (speedMbps) => { modal.updateSpeed(speedMbps / 8); }
            );

            modal.close();

            const submitResp = await fetch('/api/quality/submit-speed', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: TOKEN, speed: avgSpeedMbps })
            });

            const submitResult = await submitResp.json();

            if (submitResult.success) {
                const transcodeResp = await fetch('/api/quality/start-transcode', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token: TOKEN,
                        target_bitrate: submitResult.target_bitrate
                    })
                });

                const transcodeResult = await transcodeResp.json();

                if (transcodeResult.success) {
                    // 用后端返回的stream_url，不依赖字符串replace
                    this._switchStream('smooth', transcodeResult.stream_url);
                    this.testInProgress = false;
                    return true;
                } else {
                    alert(transcodeResult.message || '转码启动失败');
                    this.testInProgress = false;
                    return false;
                }
            } else {
                alert(submitResult.message);
                this.testInProgress = false;
                return false;
            }

        } catch (e) {
            modal.close();
            this.testInProgress = false;
            alert('测速失败: ' + e.message);
            return false;
        }
    }

    switchToOriginal() {
        if (this.currentQuality === 'original') {
            return;
        }
        this._switchStream('original');
    }

    _switchStream(quality, smoothUrl) {
        // 流畅模式URL：优先用后端返回的地址，fallback到replace
        const streamUrl = quality === 'original' ? STREAM_URL : (smoothUrl || STREAM_URL.replace('.flv', '_smooth.flv'));
        console.log(`切换到${quality === 'original' ? '原画' : '流畅'}:`, streamUrl);

        // 先销毁 player.js 的全局播放器实例，避免两个实例同时绑定同一个 video 元素
        if (typeof destroyPlayer === 'function') {
            destroyPlayer();
        }

        // 再销毁自己之前创建的实例
        if (this.flvPlayer) {
            this.flvPlayer.unload();
            this.flvPlayer.detachMediaElement();
            this.flvPlayer.destroy();
            this.flvPlayer = null;
        }

        this.flvPlayer = flvjs.createPlayer({
            type: 'flv',
            url: streamUrl,
            isLive: true,
            config: {
                enableStashBuffer: true,
                stashInitialSize: 3072,
                isLive: true,
                autoCleanupMaxBackwardDuration: 60,
                autoCleanupMinBackwardDuration: 20,
                liveBufferLatencyChasing: false,
                liveBufferLatencyMaxLatency: 60,
                liveBufferLatencyMinRemain: 5,
                fixAudioTimestampGap: true,
            }
        });

        this.flvPlayer.attachMediaElement(this.videoElement);
        this.flvPlayer.load();

        this.videoElement.addEventListener('loadedmetadata', () => {
            const autoplay = localStorage.getItem('autoplay_enabled');
            if (autoplay === null || autoplay === 'true') {
                this.videoElement.play().catch(e => console.log('自动播放被阻止'));
            }
        }, { once: true });

        this.currentQuality = quality;
        this._sendHeartbeat();
        this._showSwitchNotification(quality === 'original' ? '已切换到原画' : '已切换到流畅模式');
    }

    _showTestingModal() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;';

        const modal = document.createElement('div');
        modal.style.cssText = 'background:#1a1a1a;padding:40px;border-radius:15px;text-align:center;color:#fff;max-width:400px;';
        modal.innerHTML = `
            <h2 style="margin-bottom:20px">📊 正在测速...</h2>
            <div style="font-size:3em;margin:20px 0" id="speedValue">0.0</div>
            <div style="color:#888;margin-bottom:20px">MB/s</div>
            <div style="background:#2a2a2a;height:30px;border-radius:15px;overflow:hidden;margin-bottom:20px">
                <div id="progressBar" style="height:100%;background:#667eea;width:0%;transition:width 0.3s"></div>
            </div>
            <div style="color:#888" id="progressText">0%</div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        return {
            updateProgress: (p) => {
                document.getElementById('progressBar').style.width = p + '%';
                document.getElementById('progressText').textContent = Math.round(p) + '%';
            },
            updateSpeed: (s) => {
                document.getElementById('speedValue').textContent = s.toFixed(2);
            },
            close: () => {
                document.body.removeChild(overlay);
            }
        };
    }

    _showSwitchNotification(message) {
        const notif = document.createElement('div');
        notif.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#667eea;color:#fff;padding:15px 30px;border-radius:10px;z-index:10000;box-shadow:0 10px 30px rgba(0,0,0,0.3);';
        notif.textContent = message;
        document.body.appendChild(notif);

        setTimeout(() => {
            document.body.removeChild(notif);
        }, 3000);
    }

    destroy() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.pollInterval) clearInterval(this.pollInterval);
        if (this.flvPlayer) {
            this.flvPlayer.unload();
            this.flvPlayer.detachMediaElement();
            this.flvPlayer.destroy();
            this.flvPlayer = null;
        }
        this._notifyLeave();
    }
}

window.QualityManager = QualityManager;