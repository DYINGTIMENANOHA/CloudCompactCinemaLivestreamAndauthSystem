/**
 * 播放器模块 - FLV播放器管理
 * 依赖：flv.js, 全局变量(STREAM_URL, IS_REPLAY, API_PREFIX)
 */

let flvPlayer = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;
const RECONNECT_DELAYS = [2000, 3000, 5000, 8000, 10000, 15000];

/**
 * 启动直播流
 */
function startLiveStream() {
    if (isIOS()) { startHLSStream(); return; }
    const videoElement = document.getElementById('videoElement');
    console.log('启动播放器，流地址:', STREAM_URL);
    
    if (!flvjs.isSupported()) {
        alert('您的浏览器不支持FLV播放');
        return;
    }
    
    flvPlayer = flvjs.createPlayer({
        type: 'flv',
        url: STREAM_URL,
        isLive: !IS_REPLAY,
        config: {
            enableStashBuffer: true,
            stashInitialSize: 3072,
            isLive: !IS_REPLAY,
            lazyLoad: false,
            lazyLoadMaxDuration: 600,
            enableWorker: true,
            seekType: 'range',
            autoCleanupMaxBackwardDuration: 60,
            autoCleanupMinBackwardDuration: 20,
            liveBufferLatencyChasing: false,
            liveBufferLatencyMaxLatency: 60,
            liveBufferLatencyMinRemain: 5,
            fixAudioTimestampGap: true,
            accurateSeek: false,
            deferLoadAfterSourceOpen: false,
        }
    });
    
    flvPlayer.attachMediaElement(videoElement);
    flvPlayer.load();

    const autoplay = localStorage.getItem('autoplay_enabled');
    if (autoplay === null || autoplay === 'true') {
        flvPlayer.play().then(() => {
            hideManualPlayOverlay();
        }).catch(e => {
            console.log('自动播放被阻止，需要用户交互', e);
            showManualPlayOverlay();
        });
    } else {
        hideManualPlayOverlay();
    }

    // 缓冲监测
    setupBufferMonitoring(videoElement);
    
    // 错误处理
    setupErrorHandling(videoElement);
    
    // 重连机制
    setupReconnect(videoElement);
}

/**
 * 启动回放流
 */
function startReplayStream(sessionId) {
    const videoElement = document.getElementById('videoElement');
    const replayUrl = API_PREFIX + '/replay/' + sessionId;
    console.log('播放回放:', replayUrl);
    
    if (flvPlayer) {
        flvPlayer.destroy();
    }
    
    flvPlayer = flvjs.createPlayer({
        type: 'flv',
        url: replayUrl,
        isLive: false
    });
    
    flvPlayer.attachMediaElement(videoElement);
    flvPlayer.load();

    const autoplay = localStorage.getItem('autoplay_enabled');
    if (autoplay === null || autoplay === 'true') {
        flvPlayer.play().then(() => {
            hideManualPlayOverlay();
        }).catch(e => {
            console.log('自动播放被阻止，需要用户交互', e);
            showManualPlayOverlay();
        });
    } else {
        hideManualPlayOverlay();
    }

    hideOfflineMessage();
}

/**
 * 显示手动播放覆盖层
 */
function showManualPlayOverlay() {
    hideManualPlayOverlay();

    const container = document.querySelector('.video-container');
    if (!container) return;

    container.style.position = 'relative';

    const overlay = document.createElement('div');
    overlay.id = 'manualPlayOverlay';
    overlay.style.cssText = `
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.45);
        z-index: 9999;
    `;

    const button = document.createElement('button');
    button.textContent = '▶ 点击播放';
    button.style.cssText = `
        background: #667eea;
        color: #fff;
        border: none;
        padding: 18px 36px;
        border-radius: 14px;
        font-size: 24px;
        font-weight: bold;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(0,0,0,0.35);
    `;

    button.onclick = () => {
        const videoElement = document.getElementById('videoElement');
        if (!videoElement) return;

        videoElement.play().then(() => {
            hideManualPlayOverlay();
        }).catch(e => {
            console.error('手动点击播放仍失败:', e);
        });
    };

    overlay.appendChild(button);
    container.appendChild(overlay);
}

/**
 * 隐藏手动播放覆盖层
 */
function hideManualPlayOverlay() {
    const old = document.getElementById('manualPlayOverlay');
    if (old) old.remove();
}

/**
 * 缓冲监测系统
 */
function setupBufferMonitoring(videoElement) {
    let bufferMonitor = {
        stalledCount: 0,
        lastReportTime: Date.now(),
        bufferHistory: [],
        speedHistory: []
    };
    
    videoElement.addEventListener('waiting', () => {
        bufferMonitor.stalledCount++;
        console.warn('⚠️ 播放卡顿 #' + bufferMonitor.stalledCount, new Date().toISOString());
    });
    
    videoElement.addEventListener('playing', () => {
        console.log('✅ 播放恢复', new Date().toISOString());
        hideManualPlayOverlay();
    });
    
    setInterval(() => {
        if (!flvPlayer || !flvPlayer.statisticsInfo) return;
        
        const stats = flvPlayer.statisticsInfo;
        const bufferSize = (videoElement.buffered.length > 0) ? 
            videoElement.buffered.end(0) - videoElement.currentTime : 0;
        const currentSpeed = stats.speed || 0;
        const speedKBps = Math.round(currentSpeed / 1024);
        
        bufferMonitor.bufferHistory.push(bufferSize);
        bufferMonitor.speedHistory.push(speedKBps);
        
        if (bufferMonitor.bufferHistory.length > 20) {
            bufferMonitor.bufferHistory.shift();
            bufferMonitor.speedHistory.shift();
        }
        
        console.log('📊 监测数据:', {
            '缓冲区': bufferSize.toFixed(1) + 's',
            '下载速度': speedKBps + ' KB/s',
            '卡顿次数': bufferMonitor.stalledCount,
            '已接收': Math.round(stats.decodedFrames || 0) + ' 帧'
        });
        
        if (speedKBps < 800 && speedKBps > 0) {
            console.warn('⚠️ 下载速度过低！需要至少1200 KB/s (10Mbps)');
        }
        
        if (bufferSize < 1 && videoElement.paused === false) {
            console.warn('⚠️ 缓冲区不足！可能即将卡顿');
        }
        
        // 上报缓冲数据
        const now = Date.now();
        if (now - bufferMonitor.lastReportTime > 15000) {
            fetch('/api/log-buffering', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    time: new Date().toISOString(),
                    session: 'viewer_' + Math.random().toString(36).substr(2, 9),
                    buffer_size: Math.round(bufferSize * 1000),
                    buffer_duration: bufferSize,
                    stalled_count: bufferMonitor.stalledCount,
                    current_speed: speedKBps
                })
            }).catch(e => console.error('上报失败:', e));
            bufferMonitor.lastReportTime = now;
        }
    }, 3000);
    
    // 大缓冲区警告
    setInterval(() => {
        if (videoElement.buffered.length === 0) return;
        const bufferSize = videoElement.buffered.end(0) - videoElement.currentTime;
        if (bufferSize > 20) {
            console.error('🔴 缓冲区过大！(' + bufferSize.toFixed(1) + 's) 可能导致延迟累积');
        }
        if (bufferSize > 30) {
            console.error('🔴🔴 严重：缓冲区超过30秒！');
        }
    }, 5000);
}

/**
 * 错误处理
 */
function setupErrorHandling(videoElement) {
    flvPlayer.on(flvjs.Events.ERROR, (errorType, errorDetail, errorInfo) => {
        console.error('播放器错误:', errorType, errorDetail);
        
        if (errorType === flvjs.ErrorTypes.NETWORK_ERROR) {
            if (errorDetail === flvjs.ErrorDetails.NETWORK_TIMEOUT ||
                errorDetail === flvjs.ErrorDetails.NETWORK_EXCEPTION) {
                console.warn('网络中断，启动重连');
                smartReconnect();
            }
        } else if (errorType === flvjs.ErrorTypes.MEDIA_ERROR) {
            console.warn('媒体错误，尝试恢复');
            try {
                flvPlayer.unload();
                setTimeout(() => {
                    flvPlayer.load();
                    flvPlayer.play().then(() => {
                        hideManualPlayOverlay();
                    }).catch(e => {
                        console.log('恢复播放失败，需要用户交互', e);
                        showManualPlayOverlay();
                    });
                }, 1000);
            } catch (e) {
                smartReconnect();
            }
        }
    });
}

/**
 * 重连机制
 */
function setupReconnect(videoElement) {
    videoElement.addEventListener('playing', () => {
        console.log('播放恢复');
        reconnectAttempts = 0;
        hideOfflineMessage();
        hideManualPlayOverlay();
    });
    
    let stuckTimer = null;
    videoElement.addEventListener('waiting', () => {
        stuckTimer = setTimeout(() => {
            console.error('播放卡住超过60秒');
            smartReconnect();
        }, 60000);
    });
    
    videoElement.addEventListener('playing', () => {
        if (stuckTimer) {
            clearTimeout(stuckTimer);
            stuckTimer = null;
        }
    });
}

/**
 * 智能重连
 */
function smartReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT) {
        console.error('重连次数过多');
        document.getElementById('offline-msg').innerHTML = 
            '<h2>⚠️ 连接失败</h2><p>网络无法承载高清直播（需要10Mbps+）<br><a href="#" onclick="location.reload()" style="color:#667eea">刷新重试</a></p>';
        showOfflineMessage();
        return;
    }
    
    const delay = RECONNECT_DELAYS[Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1)];
    console.log(`尝试重连 (${reconnectAttempts + 1}/${MAX_RECONNECT}) 延迟${delay}ms`);
    
    document.getElementById('offline-msg').innerHTML = 
        `<h2>🔄 正在重新连接...</h2><p>第 ${reconnectAttempts + 1} 次尝试</p>`;
    showOfflineMessage();
    
    setTimeout(() => {
        try {
            if (flvPlayer) {
                flvPlayer.unload();
                flvPlayer.detachMediaElement();
                flvPlayer.destroy();
                flvPlayer = null;
            }
            const videoElement = document.getElementById('videoElement');
            videoElement.src = '';
            videoElement.load();
            setTimeout(() => {
                startLiveStream();
                reconnectAttempts++;
            }, 500);
        } catch (e) {
            console.error('重连失败:', e);
            reconnectAttempts++;
            smartReconnect();
        }
    }, delay);
}

/**
 * 显示/隐藏离线提示
 */
function showOfflineMessage() {
    document.getElementById('offline-msg').classList.remove('hidden');
}

function hideOfflineMessage() {
    document.getElementById('offline-msg').classList.add('hidden');
}

/**
 * 检查流状态
 */
function checkStreamStatus() {
    if (IS_REPLAY) return;
    
    // 流状态检测
    fetch('/api/stream-status/' + APP_NAME)
        .then(r => r.json())
        .then(data => {
            const indicator = document.getElementById('status-indicator');
            const statusText = document.getElementById('status-text');
            if (data.live) {
                indicator.className = 'status-indicator';
                statusText.textContent = '🔴 直播中';
                hideOfflineMessage();
            } else {
                indicator.className = 'status-indicator status-offline';
                statusText.textContent = '⚫ 离线';
                showOfflineMessage();
                document.getElementById('viewer-count').textContent = '观众: -';
            }
        })
        .catch(e => console.error('状态检查失败:', e));
    
    // 观众数从心跳系统取（精确到标签页级别）
    fetch('/api/quality/status?token=' + TOKEN)
        .then(r => r.json())
        .then(data => {
            const viewers = data.viewers || {original: 0, smooth: 0};
            const total = (viewers.original || 0) + (viewers.smooth || 0);
            document.getElementById('viewer-count').textContent = '观众: ' + total;
        })
        .catch(e => console.error('观众数获取失败:', e));
}

/**
 * 延迟显示控制
 */
let alwaysShowDelay = false;

function toggleDelayDisplay() {
    alwaysShowDelay = !alwaysShowDelay;
    const btn = document.getElementById('toggleDelayBtn');
    if (alwaysShowDelay) {
        btn.textContent = '📊 隐藏延迟';
        btn.style.background = '#FF9800';
        document.getElementById('delay-info').style.display = 'inline';
    } else {
        btn.textContent = '📊 显示延迟';
        btn.style.background = '#667eea';
    }
}

/**
 * 延迟监控（每2秒）
 */
function startDelayMonitoring() {
    setInterval(() => {
        const videoElement = document.getElementById('videoElement');
        if (!videoElement || videoElement.buffered.length === 0 || IS_REPLAY) return;
        
        try {
            const currentTime = videoElement.currentTime;
            const latestTime = videoElement.buffered.end(videoElement.buffered.length - 1);
            const delay = latestTime - currentTime;
            document.getElementById('delay-seconds').textContent = delay.toFixed(1);
            
            if (alwaysShowDelay || delay > 10) {
                document.getElementById('delay-info').style.display = 'inline';
            } else if (!alwaysShowDelay && delay <= 10) {
                document.getElementById('delay-info').style.display = 'none';
            }
        } catch(e) {
            console.error('延迟检测失败:', e);
        }
    }, 2000);
}

/**
 * 销毁播放器
 */
function destroyPlayer() {
    hideManualPlayOverlay();
    if (flvPlayer) {
        flvPlayer.destroy();
        flvPlayer = null;
    }
}
/**
 * iOS设备检测
 */
function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

/**
 * iOS原生HLS播放
 */
function startHLSStream() {
    const videoElement = document.getElementById('videoElement');
    console.log('iOS设备，使用HLS:', HLS_URL);

    videoElement.src = HLS_URL;
    videoElement.load();

    const autoplay = localStorage.getItem('autoplay_enabled');
    if (autoplay === null || autoplay === 'true') {
        videoElement.play().then(() => {
            hideManualPlayOverlay();
        }).catch(e => {
            console.log('自动播放被阻止', e);
            showManualPlayOverlay();
        });
    }

    // 错误处理
    videoElement.addEventListener('error', (e) => {
        console.error('HLS播放错误:', e);
        showOfflineMessage();
    });

    videoElement.addEventListener('playing', () => {
        hideOfflineMessage();
        hideManualPlayOverlay();
    });
}
