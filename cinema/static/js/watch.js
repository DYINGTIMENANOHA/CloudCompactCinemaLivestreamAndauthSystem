/* ===================================
   观看页 - 原生 HTML5 video + 同步事件
   =================================== */

(function () {
    'use strict';

    const VIDEO = window.CINEMA_VIDEO;
    if (!VIDEO) return;

    // ===== DOM =====
    const player = document.getElementById('player');
    const playerOverlay = document.getElementById('player-overlay');
    const playOverlay = document.getElementById('play-overlay');
    const progressSlider = document.getElementById('progress-slider');
    const bufferedBar = document.getElementById('buffered-bar');
    const currentTimeEl = document.getElementById('current-time');
    const totalTimeEl = document.getElementById('total-time');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const muteBtn = document.getElementById('mute-btn');
    const volumeSlider = document.getElementById('volume-slider');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const downloadStatus = document.getElementById('download-status');
    const skipBackBtn = document.getElementById('skip-back-btn');
    const skipForwardBtn = document.getElementById('skip-forward-btn');
    const skipSyncToast = document.getElementById('skip-sync-toast');
    const skipSyncSendBtn = document.getElementById('skip-sync-send-btn');
    const skipSyncCancelBtn = document.getElementById('skip-sync-cancel-btn');
    const skipSyncCountdownEl = document.getElementById('skip-sync-countdown');

    // ===== 工具 =====
    function formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        const total = Math.floor(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    // ===== 初始化 video =====
    // 检测观看页背景图是否存在
    const bgProbe = new Image();
    bgProbe.onload = () => { document.body.classList.add('has-bg-watch'); };
    bgProbe.src = '/cinema/static/img/bg_watch.jpg';

    const videoUrl = '/cinema/videos/' + encodeURIComponent(VIDEO.filename);
    console.log('[watch] video url:', videoUrl);
    player.src = videoUrl;
    totalTimeEl.textContent = formatTime(VIDEO.duration_seconds);
    downloadStatus.textContent = '准备就绪,点击中央按钮播放';

    // 支持 URL 参数 ?t=xxx 自动 seek(从其他视频跳转过来时用)
    const urlParams = new URLSearchParams(window.location.search);
    const startTime = parseFloat(urlParams.get('t') || '0');
    if (isFinite(startTime) && startTime > 0) {
        player.addEventListener('loadedmetadata', () => {
            player.currentTime = startTime;
            player.play().catch(() => {});
        }, { once: true });
    }

    // ===== 同步控制标志 =====
    // 当收到远程 sync_apply 时,我们会主动改 currentTime / play / pause
    // 这些改动不应该再触发 sync_action 发给服务器(避免循环)
    let suppressSyncEvents = false;

    function withSuppressed(fn) {
        suppressSyncEvents = true;
        try { fn(); } catch (e) { console.error(e); }
        // 延迟一点再恢复,因为 seeked/play/pause 事件是异步触发的
        setTimeout(() => { suppressSyncEvents = false; }, 300);
    }

    // ===== 是否在多人房间里 =====
    function isInRoom() {
        const ws = window.CINEMA_WS;
        if (!ws) return false;
        const sid = ws.getSid();
        const hostSid = ws.getHostSid();
        if (!sid || !hostSid) return false;
        // 在房间里 = hostSid 不是自己(是成员),或者自己是房主但有其他成员
        // 简单判断: 只要 hostSid 存在就行,实际同步逻辑由服务端判断是否有多人
        return true;
    }

    function sendSyncAction(action, params) {
        if (suppressSyncEvents) return;
        if (!isInRoom()) return;
        const ws = window.CINEMA_WS;
        if (!ws) return;
        ws.send({
            type: 'sync_action',
            action: action,
            params: params || {},
        });
    }

    // ===== 跳转 ±10s(本地跳转,不立即同步) =====
    let skipSyncTimer = null;
    let skipSyncCountdown = 0;

    function hideSkipSyncToast() {
        skipSyncToast.classList.remove('visible');
        clearInterval(skipSyncTimer);
        skipSyncTimer = null;
    }

    function showSkipSyncToast() {
        if (!isInRoom()) return;
        skipSyncToast.classList.add('visible');
        clearInterval(skipSyncTimer);
        skipSyncCountdown = 10;
        skipSyncCountdownEl.textContent = skipSyncCountdown;
        skipSyncTimer = setInterval(() => {
            skipSyncCountdown--;
            skipSyncCountdownEl.textContent = skipSyncCountdown;
            if (skipSyncCountdown <= 0) hideSkipSyncToast();
        }, 1000);
    }

    function doSkip(delta) {
        if (!player.duration || !isFinite(player.duration)) return;
        player.currentTime = Math.max(0, Math.min(player.duration, player.currentTime + delta));
        showSkipSyncToast();
    }

    skipBackBtn.addEventListener('click', () => doSkip(-10));
    skipForwardBtn.addEventListener('click', () => doSkip(10));

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); doSkip(-10); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); doSkip(10); }
        else if (e.key === ' ') {
            e.preventDefault();
            if (skipSyncToast.classList.contains('visible')) {
                sendSyncAction('seek', { time: player.currentTime });
                hideSkipSyncToast();
            } else {
                if (player.paused) player.play();
                else player.pause();
            }
        }
    });

    skipSyncSendBtn.addEventListener('click', () => {
        sendSyncAction('seek', { time: player.currentTime });
        hideSkipSyncToast();
    });

    skipSyncCancelBtn.addEventListener('click', hideSkipSyncToast);

    // ===== 进度条 =====
    let isDraggingSlider = false;

    function updatePlayedProgress() {
        if (!player.duration || !isFinite(player.duration)) return;
        const ratio = player.currentTime / player.duration;
        if (!isDraggingSlider) {
            progressSlider.value = Math.floor(ratio * 1000);
        }
        progressSlider.style.setProperty('--played', (ratio * 100) + '%');
        currentTimeEl.textContent = formatTime(player.currentTime);
        updateBufferedBar();
    }

    function updateBufferedBar() {
        const buffered = player.buffered;
        if (buffered.length === 0 || !player.duration || !isFinite(player.duration)) {
            bufferedBar.style.width = '0%';
            return;
        }
        const currentTime = player.currentTime;
        let endNearCurrent = 0;
        for (let i = 0; i < buffered.length; i++) {
            if (currentTime >= buffered.start(i) - 0.5 && currentTime <= buffered.end(i) + 0.5) {
                endNearCurrent = buffered.end(i);
                break;
            }
        }
        if (endNearCurrent === 0 && buffered.length > 0) {
            endNearCurrent = buffered.end(buffered.length - 1);
        }
        bufferedBar.style.width = (endNearCurrent / player.duration * 100) + '%';
    }

    function updateDownloadStatus() {
        if (player.error) return;
        const buffered = player.buffered;
        let aheadSec = 0;
        if (buffered.length > 0) {
            const currentTime = player.currentTime;
            for (let i = 0; i < buffered.length; i++) {
                if (currentTime >= buffered.start(i) - 0.5 && currentTime <= buffered.end(i) + 0.5) {
                    aheadSec = Math.max(0, buffered.end(i) - currentTime);
                    break;
                }
            }
        }
        downloadStatus.textContent = `📥 已缓冲 ${aheadSec.toFixed(0)} 秒`;
        downloadStatus.classList.remove('error');
    }

    setInterval(updateDownloadStatus, 500);

    // ===== video 事件 =====
    player.addEventListener('loadedmetadata', () => {
        totalTimeEl.textContent = formatTime(player.duration || VIDEO.duration_seconds);
    });
    player.addEventListener('timeupdate', updatePlayedProgress);
    player.addEventListener('progress', updateBufferedBar);
    player.addEventListener('durationchange', () => {
        totalTimeEl.textContent = formatTime(player.duration || VIDEO.duration_seconds);
    });

    player.addEventListener('play', () => {
        playPauseBtn.textContent = '⏸';
        playerOverlay.classList.add('hidden');
        // 同步: 发送 play
        sendSyncAction('play');
    });

    player.addEventListener('pause', () => {
        playPauseBtn.textContent = '▶';
        // 同步: 发送 pause
        sendSyncAction('pause');
    });

    player.addEventListener('waiting', () => {
        downloadStatus.textContent = '⏳ 等待缓冲...';
    });
    player.addEventListener('playing', () => {
        updateDownloadStatus();
    });
    player.addEventListener('error', () => {
        if (player.error) {
            downloadStatus.textContent = '播放出错: ' + (player.error.message || '未知错误');
            downloadStatus.classList.add('error');
        }
    });

    // ===== 进度条拖动(seek) =====
    progressSlider.addEventListener('mousedown', () => { isDraggingSlider = true; });
    progressSlider.addEventListener('touchstart', () => { isDraggingSlider = true; });

    progressSlider.addEventListener('input', () => {
        if (!player.duration || !isFinite(player.duration)) return;
        const ratio = progressSlider.value / 1000;
        const targetTime = ratio * player.duration;
        currentTimeEl.textContent = formatTime(targetTime);
        progressSlider.style.setProperty('--played', (ratio * 100) + '%');
    });

    function handleSliderRelease() {
        if (!isDraggingSlider) return;
        isDraggingSlider = false;
        if (!player.duration || !isFinite(player.duration)) return;
        const ratio = progressSlider.value / 1000;
        const targetTime = ratio * player.duration;
        try {
            player.currentTime = targetTime;
            // 同步: 发送 seek
            sendSyncAction('seek', { time: targetTime });
        } catch (e) {
            console.error('seek failed', e);
        }
    }

    progressSlider.addEventListener('mouseup', handleSliderRelease);
    progressSlider.addEventListener('touchend', handleSliderRelease);
    progressSlider.addEventListener('change', handleSliderRelease);

    // ===== 控件 =====
    playPauseBtn.addEventListener('click', () => {
        if (player.paused) player.play();
        else player.pause();
    });

    playOverlay.addEventListener('click', (e) => {
        e.stopPropagation();
        player.play();
    });

    player.addEventListener('click', () => {
        if (player.paused) player.play();
        else player.pause();
    });

    volumeSlider.addEventListener('input', () => {
        player.volume = volumeSlider.value / 100;
        player.muted = (player.volume === 0);
        muteBtn.textContent = player.muted || player.volume === 0 ? '🔇' : '🔊';
    });

    muteBtn.addEventListener('click', () => {
        player.muted = !player.muted;
        muteBtn.textContent = player.muted ? '🔇' : '🔊';
    });

    const wrapper = document.getElementById('player-wrapper');

    fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            wrapper.requestFullscreen().catch(e => console.error(e));
        } else {
            document.exitFullscreen();
        }
    });

    // ===== 全屏控件自动隐藏: 鼠标静止 3 秒后隐藏,移动时显示 =====
    let hideControlsTimer = null;
    const controlsEl = document.getElementById('player-controls');
    const fsRoomBtn = document.getElementById('fs-room-btn');

    function showControlsTemporarily() {
        if (controlsEl) {
            controlsEl.classList.add('auto-hide', 'visible');
        }
        if (fsRoomBtn && fsRoomBtn.style.display !== 'none') {
            fsRoomBtn.classList.add('auto-hide', 'visible');
        }
        clearTimeout(hideControlsTimer);
        hideControlsTimer = setTimeout(() => {
            if (controlsEl) controlsEl.classList.remove('visible');
            if (fsRoomBtn) fsRoomBtn.classList.remove('visible');
        }, 3000);
    }

    wrapper.addEventListener('mousemove', showControlsTemporarily);
    wrapper.addEventListener('click', showControlsTemporarily);
    wrapper.addEventListener('touchstart', showControlsTemporarily);

    document.addEventListener('fullscreenchange', () => {
        // 进入或退出全屏都保持自动隐藏行为
        showControlsTemporarily();
    });

    // 初始化: 启动自动隐藏
    if (controlsEl) controlsEl.classList.add('auto-hide', 'visible');
    showControlsTemporarily();

    // ===== 接收远程同步操作 =====
    // ws.js 会调用这些函数
    window.CINEMA_PLAYER = {
        // 收到 sync_apply: 执行远程的 seek/play/pause
        applySyncAction: function (action, params) {
            console.log('[watch] applying sync:', action, params);
            hideSkipSyncToast();
            withSuppressed(() => {
                if (action === 'seek') {
                    const t = parseFloat(params.time || 0);
                    if (isFinite(t)) {
                        player.currentTime = t;
                    }
                } else if (action === 'play') {
                    player.play();
                } else if (action === 'pause') {
                    player.pause();
                }
            });
        },

        // 服务端问我当前位置
        getCurrentTime: function () {
            return player.currentTime || 0;
        },

        // 追上房主: 远程 seek(不发 sync_action)
        seekTo: function (time) {
            withSuppressed(() => {
                player.currentTime = time;
            });
        },
    };
})();
