/**
 * 回放模块 - 回放列表、播放、下载
 * 依赖：全局变量(TOKEN, API_PREFIX, WATCH_URL)
 */

/**
 * 显示回放模态框
 */
function showReplayModal() {
    document.getElementById('replayModal').style.display = 'block';
    loadRecordings();
}

/**
 * 关闭回放模态框
 */
function closeReplayModal() {
    document.getElementById('replayModal').style.display = 'none';
}

/**
 * 加载回放列表
 */
function loadRecordings() {
    fetch(API_PREFIX + '/recordings')
        .then(r => r.json())
        .then(recordings => {
            const list = document.getElementById('recordingList');
            list.innerHTML = '';
            
            if (recordings.length === 0) {
                list.innerHTML = '<p style="text-align:center;color:#888;padding:40px">暂无回放</p>';
                return;
            }
            
            recordings.forEach(rec => {
                const item = document.createElement('div');
                item.className = 'recording-item';
                item.innerHTML = `
                    <div class="recording-title">${escapeHtml(rec.title)}</div>
                    <div class="recording-meta">
                        <span>📅 ${rec.start_time}</span>
                        <span>💾 ${formatSize(rec.filesize)}</span>
                    </div>
                    <div class="recording-actions">
                        <button class="action-btn play-btn" onclick="playRecording('${rec.session_id}', '${escapeHtml(rec.title)}')">▶️ 播放</button>
                        <button class="action-btn download-btn" onclick="downloadRecording('${rec.session_id}')">⬇️ 下载</button>
                    </div>
                `;
                list.appendChild(item);
            });
        })
        .catch(e => console.error('加载录制列表失败:', e));
}

/**
 * 播放回放
 */
function playRecording(sessionId, title) {
    window.location.href = WATCH_URL + '?token=' + TOKEN + '&replay=' + sessionId;
}

/**
 * 下载回放
 */
function downloadRecording(sessionId) {
    window.location.href = DOWNLOAD_URL + sessionId;
}

/**
 * 格式化文件大小
 */
function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/**
 * 初始化模态框点击关闭
 */
function initModalClickClose() {
    window.onclick = function(event) {
        const modal = document.getElementById('replayModal');
        if (event.target === modal) {
            closeReplayModal();
        }
    }
}
