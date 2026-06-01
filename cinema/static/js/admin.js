/* ===================================
   管理页 JS v3 - 分块上传系统
   - 10MB/块,断点续传
   - 多文件队列(串行)
   - 多用户排队(服务端锁)
   - 暂停/恢复/取消
   =================================== */

(function () {
    'use strict';

    const CHUNK_SIZE = 10 * 1024 * 1024;  // 10MB

    // DOM
    const usageDisplay = document.getElementById('usage-display');
    const usageBarFill = document.getElementById('usage-bar-fill');
    const uploadInput = document.getElementById('upload-input');
    const uploadBtn = document.getElementById('upload-btn');
    const uploadProgressArea = document.getElementById('upload-progress-area');
    const tasksList = document.getElementById('tasks-list');
    const videosList = document.getElementById('videos-list');
    const configForm = document.getElementById('config-form');
    const vetoEnabledInput = document.getElementById('veto-enabled');
    const vetoDelayInput = document.getElementById('veto-delay');
    const configStatus = document.getElementById('config-status');
    const refreshAllBtn = document.getElementById('refresh-all-btn');
    const tasksRefreshBtn = document.getElementById('tasks-refresh-btn');
    const cancelAllPausedBtn = document.getElementById('cancel-all-paused-btn');

    let pollingInterval = null;
    let cachedSingleMaxBytes = 0;

    // 上传状态
    let activeUpload = null;   // { taskId, file, paused, abortController, statusItem }
    const uploadQueue = [];    // [{ file, statusItem }]
    let queuePollTimer = null;

    // ===== 工具 =====
    function formatBytes(bytes) {
        if (!bytes || bytes < 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0; let v = bytes;
        while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
        return v.toFixed(i === 0 ? 0 : 2) + ' ' + units[i];
    }
    function formatDuration(seconds) {
        if (!seconds || seconds < 0) return '--:--';
        const total = Math.floor(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        return `${m}:${String(s).padStart(2,'0')}`;
    }
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    async function computeFileHash(file) {
        const sliceSize = Math.min(65536, file.size);
        const slice = file.slice(0, sliceSize);
        const buffer = await slice.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex + '_' + file.size;
    }

    // ===== 加载空间用量 =====
    async function loadUsage() {
        try {
            const res = await fetch('/cinema/api/usage', { credentials: 'same-origin' });
            if (!res.ok) return;
            const data = await res.json();
            const usedGB = data.used_bytes / 1024 / 1024 / 1024;
            const remainingGB = (data.remaining_bytes || 0) / 1024 / 1024 / 1024;
            const singleMaxGB = (data.single_max_bytes || 0) / 1024 / 1024 / 1024;
            cachedSingleMaxBytes = data.single_max_bytes || 0;
            const percent = data.limit_bytes > 0 ? (data.used_bytes / data.limit_bytes) * 100 : 0;
            usageDisplay.querySelector('.usage-text').textContent =
                `已用 ${usedGB.toFixed(2)} GB · 还可上传 ${remainingGB.toFixed(2)} GB · ` +
                `单个视频最大 ${singleMaxGB.toFixed(2)} GB`;
            usageBarFill.style.width = Math.min(100, percent) + '%';
            usageBarFill.classList.toggle('warn', percent >= 70 && percent < 90);
            usageBarFill.classList.toggle('danger', percent >= 90);
            const diskInfo = document.getElementById('disk-info');
            if (diskInfo && data.disk_free_bytes !== undefined) {
                const diskFreeGB = data.disk_free_bytes / 1024 / 1024 / 1024;
                const dynamicCapGB = data.dynamic_cap_bytes / 1024 / 1024 / 1024;
                diskInfo.textContent =
                    `磁盘剩余(不含放映室) ${diskFreeGB.toFixed(1)} GB · ` +
                    `最大可设上限 ${dynamicCapGB.toFixed(1)} GB`;
            }
        } catch (e) { console.error(e); }
    }

    // ===== 加载视频库 =====
    async function loadVideos() {
        try {
            const res = await fetch('/cinema/api/videos', { credentials: 'same-origin' });
            if (!res.ok) { videosList.innerHTML = '<div class="empty">加载失败</div>'; return; }
            const data = await res.json();
            const videos = data.videos || [];
            if (videos.length === 0) { videosList.innerHTML = '<div class="empty">视频库还是空的</div>'; return; }
            videosList.innerHTML = videos.map(v => `
                <div class="video-row">
                    <div class="info">
                        <div class="name">${escapeHtml(v.display_name)}</div>
                        <div class="meta">${formatDuration(v.duration_seconds)} · ${formatBytes(v.size_bytes)} · 添加于 ${escapeHtml(v.added_at || '')}</div>
                    </div>
                    <button class="delete-btn" data-id="${escapeHtml(v.id)}" data-name="${escapeHtml(v.display_name)}">删除</button>
                </div>
            `).join('');
            if (window.CinemaCovers && window.CinemaCovers.attachCoverButtons) window.CinemaCovers.attachCoverButtons();
            videosList.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (!confirm(`确定要删除视频《${btn.dataset.name}》吗?\n此操作不可恢复。`)) return;
                    btn.disabled = true;
                    try {
                        const res = await fetch(`/cinema/api/video/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE', credentials: 'same-origin' });
                        if (res.ok) { await loadVideos(); await loadUsage(); }
                        else { const d = await res.json().catch(() => ({})); alert('删除失败: ' + (d.error || res.status)); btn.disabled = false; }
                    } catch (e) { alert('网络错误: ' + e); btn.disabled = false; }
                });
            });
        } catch (e) { console.error(e); videosList.innerHTML = '<div class="empty">网络错误</div>'; }
    }

    // ===== 加载上传任务列表 =====
    async function loadTasks() {
        try {
            const res = await fetch('/cinema/api/upload_tasks', { credentials: 'same-origin' });
            if (!res.ok) { tasksList.innerHTML = '<div class="empty">加载失败</div>'; return false; }
            const data = await res.json();
            const tasks = data.tasks || [];
            if (tasks.length === 0) { tasksList.innerHTML = '<div class="empty">无任务</div>'; return false; }

            let hasInProgress = false;
            tasksList.innerHTML = tasks.map(t => {
                if (t.status === 'uploading' || t.status === 'processing') hasInProgress = true;
                const received = t.received_bytes || 0;
                const total = t.original_size_bytes || 0;
                const percent = total > 0 ? (received / total * 100) : 0;
                let statusText, statusClass, actions = '';
                switch (t.status) {
                    case 'uploading':
                        statusText = `上传中 ${percent.toFixed(1)}%`;
                        statusClass = 'uploading';
                        actions = `<button class="small-btn" onclick="CinemaAdmin.pauseTask('${t.id}')">暂停</button>
                            <button class="small-btn danger task-cancel-x" onclick="CinemaAdmin.cancelTask('${t.id}')" title="取消">x</button>`;
                        break;
                    case 'paused':
                        statusText = `已暂停 ${percent.toFixed(1)}%`;
                        statusClass = 'paused';
                        actions = `<button class="small-btn" onclick="CinemaAdmin.resumeTaskUI('${t.id}')">恢复</button>
                            <button class="small-btn danger task-cancel-x" onclick="CinemaAdmin.cancelTask('${t.id}')" title="取消">x</button>`;
                        break;
                    case 'processing': statusText = '转码中'; statusClass = 'processing'; break;
                    case 'done': statusText = '已完成'; statusClass = 'done'; break;
                    case 'failed': statusText = '失败'; statusClass = 'failed'; break;
                    default: statusText = t.status; statusClass = '';
                }
                const progressBar = (t.status === 'uploading' || t.status === 'paused')
                    ? `<div class="task-progress-bar"><div class="task-progress-fill" style="width:${percent}%"></div></div>` : '';
                const errorLine = t.error_message ? `<div class="task-error">${escapeHtml(t.error_message)}</div>` : '';
                return `<div class="task-row">
                    <div class="task-info" style="flex:1;min-width:0;">
                        <div class="name">${escapeHtml(t.original_filename)}</div>
                        <div class="meta">${formatBytes(received)} / ${formatBytes(total)} · ${escapeHtml(t.created_at || '')}</div>
                        ${progressBar}${errorLine}
                    </div>
                    <div class="task-status ${statusClass}">${statusText}</div>
                    <div class="task-actions">${actions}</div>
                </div>`;
            }).join('');
            return hasInProgress;
        } catch (e) { console.error(e); return false; }
    }

    async function loadConfig() {
        try {
            const res = await fetch('/cinema/api/config', { credentials: 'same-origin' });
            if (!res.ok) return;
            const data = await res.json();
            vetoEnabledInput.checked = !!data.veto_enabled;
            vetoDelayInput.value = data.veto_delay_seconds;
        } catch (e) { console.error(e); }
    }

    async function loadUploadsDir() {
        const infoEl = document.getElementById('uploads-dir-info');
        const cleanBtn = document.getElementById('uploads-dir-clean');
        if (!infoEl) return;
        try {
            const res = await fetch('/cinema/api/uploads_dir_info', { credentials: 'same-origin' });
            if (!res.ok) return;
            const data = await res.json();
            const textEl = infoEl.querySelector('.uploads-dir-text');
            if (textEl) textEl.textContent = `${data.file_count} 个文件 · ${formatBytes(data.total_size_bytes)}`;
            if (cleanBtn) cleanBtn.style.display = data.file_count > 0 ? 'inline-block' : 'none';
        } catch (e) { console.error(e); }
    }

    // ===== 上传 UI 创建 =====
    function createUploadUI(file, showButtons) {
        const item = document.createElement('div');
        item.className = 'upload-item';
        item.innerHTML = `
            <div class="name">${escapeHtml(file.name)} (${formatBytes(file.size)})</div>
            <div class="progress-bar"><div class="progress-bar-fill" style="width:0%"></div></div>
            <div class="status">准备中...</div>
            <div class="upload-btns" style="margin-top:6px;display:flex;gap:6px;">
                ${showButtons ? '<button class="small-btn pause-btn">暂停</button><button class="small-btn danger task-cancel-x cancel-btn">x</button>' : ''}
            </div>
        `;
        uploadProgressArea.appendChild(item);
        return {
            item,
            progressFill: item.querySelector('.progress-bar-fill'),
            status: item.querySelector('.status'),
            pauseBtn: item.querySelector('.pause-btn'),
            cancelBtn: item.querySelector('.cancel-btn'),
        };
    }

    // ===== 选文件 → 加入队列 =====
    uploadBtn.addEventListener('click', () => uploadInput.click());

    uploadInput.addEventListener('change', async () => {
        const file = uploadInput.files[0];
        if (!file) return;
        uploadInput.value = '';

        await loadUsage();
        if (file.size > 5 * 1024 * 1024 * 1024) { alert('文件超过 5 GB 上限'); return; }
        if (cachedSingleMaxBytes > 0 && file.size > cachedSingleMaxBytes) {
            alert(`文件过大: ${(file.size/1024/1024/1024).toFixed(2)} GB,当前允许最大 ${(cachedSingleMaxBytes/1024/1024/1024).toFixed(2)} GB`);
            return;
        }

        // 加入队列
        const statusItem = createUploadUI(file, false);
        statusItem.status.textContent = '⏳ 等待上传...';

        // 等待中的取消按钮
        const cancelDiv = statusItem.item.querySelector('.upload-btns');
        const qCancelBtn = document.createElement('button');
        qCancelBtn.className = 'small-btn danger task-cancel-x';
        qCancelBtn.textContent = 'x';
        qCancelBtn.title = '取消';
        cancelDiv.appendChild(qCancelBtn);

        const queueEntry = { file, statusItem };
        uploadQueue.push(queueEntry);

        qCancelBtn.onclick = () => {
            const idx = uploadQueue.indexOf(queueEntry);
            if (idx >= 0) uploadQueue.splice(idx, 1);
            statusItem.item.remove();
        };

        // 尝试开始
        processQueue();
    });

    // ===== 队列处理 =====
    async function processQueue() {
        if (activeUpload && !activeUpload.paused) return; // 有活跃上传
        if (uploadQueue.length === 0) return;

        const { file, statusItem } = uploadQueue.shift();

        // 替换按钮为暂停+取消
        const btnsDiv = statusItem.item.querySelector('.upload-btns');
        btnsDiv.innerHTML = '<button class="small-btn pause-btn">暂停</button><button class="small-btn danger task-cancel-x cancel-btn">x</button>';
        statusItem.pauseBtn = btnsDiv.querySelector('.pause-btn');
        statusItem.cancelBtn = btnsDiv.querySelector('.cancel-btn');

        statusItem.status.textContent = '计算文件校验...';

        let fileHash;
        try {
            fileHash = await computeFileHash(file);
        } catch (e) {
            statusItem.status.textContent = '校验失败: ' + e.message;
            statusItem.item.classList.add('error');
            processQueue();
            return;
        }

        // 初始化上传(可能返回 queued)
        statusItem.status.textContent = '初始化上传...';
        let initData;
        try {
            const res = await fetch(
                `/cinema/api/upload_init?filename=${encodeURIComponent(file.name)}` +
                `&file_size=${file.size}&file_hash=${encodeURIComponent(fileHash)}`,
                { method: 'POST', credentials: 'same-origin' }
            );
            if (res.status === 409) {
                // 排队: 服务端有其他 uploading 任务
                statusItem.status.textContent = '排队中,等待其他用户上传完成...';
                // 放回队列头部
                uploadQueue.unshift({ file, statusItem });
                // 3 秒后重试
                startQueuePolling();
                return;
            }
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                statusItem.status.textContent = err.error || '初始化失败';
                statusItem.item.classList.add('error');
                btnsDiv.innerHTML = '';
                processQueue();
                return;
            }
            initData = await res.json();
        } catch (e) {
            statusItem.status.textContent = '网络错误: ' + e.message;
            statusItem.item.classList.add('error');
            btnsDiv.innerHTML = '';
            processQueue();
            return;
        }

        stopQueuePolling();

        const taskId = initData.task_id;
        let offset = initData.received_bytes || 0;
        if (initData.resumed && offset > 0) {
            statusItem.status.textContent = `断点续传,从 ${formatBytes(offset)} 继续...`;
            statusItem.progressFill.style.width = (offset / file.size * 100) + '%';
        }

        await loadTasks();
        await runChunkLoop(taskId, file, offset, statusItem);

        // 上传完成/暂停后处理队列中下一个
        processQueue();
    }

    function startQueuePolling() {
        if (queuePollTimer) return;
        queuePollTimer = setInterval(() => processQueue(), 3000);
    }
    function stopQueuePolling() {
        if (queuePollTimer) { clearInterval(queuePollTimer); queuePollTimer = null; }
    }

    // ===== 分块上传循环 =====
    async function runChunkLoop(taskId, file, startOffset, statusItem) {
        const abortController = new AbortController();
        activeUpload = { taskId, file, paused: false, abortController, statusItem };

        statusItem.pauseBtn.textContent = '暂停';
        statusItem.pauseBtn.onclick = () => pauseActiveUpload();
        statusItem.cancelBtn.onclick = async () => {
            if (activeUpload && activeUpload.taskId === taskId) {
                activeUpload.paused = true;
                activeUpload.abortController.abort();
            }
            await fetch(`/cinema/api/upload_cancel?task_id=${taskId}`, { method: 'POST', credentials: 'same-origin' });
            statusItem.item.remove();
            activeUpload = null;
            await loadTasks(); await loadUsage(); await loadUploadsDir();
        };

        const beforeUnload = (e) => { e.preventDefault(); e.returnValue = '上传进行中'; };
        window.addEventListener('beforeunload', beforeUnload);

        let offset = startOffset;
        const uploadStartTime = Date.now();

        while (offset < file.size) {
            if (!activeUpload || activeUpload.paused) break;
            const end = Math.min(offset + CHUNK_SIZE, file.size);
            const chunk = file.slice(offset, end);
            try {
                const res = await fetch(
                    `/cinema/api/upload_chunk?task_id=${taskId}&offset=${offset}`,
                    { method: 'POST', body: chunk, headers: { 'Content-Type': 'application/octet-stream' },
                      credentials: 'same-origin', signal: abortController.signal }
                );
                if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `HTTP ${res.status}`); }
                offset = end;
                const percent = (offset / file.size * 100);
                const elapsed = (Date.now() - uploadStartTime) / 1000;
                const speed = elapsed > 0 ? (offset - startOffset) / elapsed : 0;
                const remaining = speed > 0 ? (file.size - offset) / speed : 0;
                statusItem.progressFill.style.width = percent + '%';
                statusItem.status.textContent =
                    `上传中 ${percent.toFixed(1)}% · ${formatBytes(offset)} / ${formatBytes(file.size)} · ${formatBytes(speed)}/s · 剩余 ${formatDuration(remaining)}`;
            } catch (e) {
                if (e.name === 'AbortError') break;
                statusItem.status.textContent = `网络错误,3 秒后重试... (${e.message})`;
                await new Promise(r => setTimeout(r, 3000));
                continue;
            }
        }

        window.removeEventListener('beforeunload', beforeUnload);

        if (activeUpload && !activeUpload.paused && offset >= file.size) {
            statusItem.status.textContent = '上传完成,等待转码...';
            statusItem.pauseBtn.style.display = 'none';
            statusItem.cancelBtn.style.display = 'none';
            try { await fetch(`/cinema/api/upload_complete?task_id=${taskId}`, { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
            activeUpload = null;
            setTimeout(() => statusItem.item.remove(), 3000);
            startPolling();
            await loadTasks(); await loadUsage();
        } else if (activeUpload && activeUpload.paused) {
            await fetch(`/cinema/api/upload_pause?task_id=${taskId}`, { method: 'POST', credentials: 'same-origin' });
            statusItem.item.remove();
            activeUpload = null;
            await loadTasks(); await loadUsage(); await loadUploadsDir();
        }
    }

    function pauseActiveUpload() {
        if (!activeUpload) return;
        activeUpload.paused = true;
        activeUpload.abortController.abort();
    }

    // ===== 任务列表操作 =====
    window.CinemaAdmin = {
        reloadVideos: loadVideos, reloadUsage: loadUsage, reloadTasks: loadTasks,

        pauseTask: async (taskId) => {
            if (activeUpload && activeUpload.taskId === taskId) {
                pauseActiveUpload();
            } else {
                await fetch(`/cinema/api/upload_pause?task_id=${taskId}`, { method: 'POST', credentials: 'same-origin' });
                await loadTasks(); await loadUsage(); await loadUploadsDir();
            }
        },

        cancelTask: async (taskId) => {
            if (!confirm('确定取消此上传任务?\n临时文件将被删除,预留空间将释放。')) return;
            if (activeUpload && activeUpload.taskId === taskId) {
                activeUpload.paused = true;
                activeUpload.abortController.abort();
                activeUpload = null;
                uploadProgressArea.innerHTML = '';
            }
            await fetch(`/cinema/api/upload_cancel?task_id=${taskId}`, { method: 'POST', credentials: 'same-origin' });
            await loadTasks(); await loadUsage(); await loadUploadsDir();
        },

        resumeTaskUI: async (taskId) => {
            // 暂停任务已预留空间,恢复不需要排队
            const taskRes = await fetch(`/cinema/api/upload_resume?task_id=${taskId}`, { method: 'POST', credentials: 'same-origin' });
            if (!taskRes.ok) {
                const err = await taskRes.json().catch(() => ({}));
                alert('恢复失败: ' + (err.error || '未知错误'));
                return;
            }
            const taskData = await taskRes.json();
            await loadTasks(); await loadUploadsDir();

            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'video/*';
            fileInput.onchange = async () => {
                const file = fileInput.files[0];
                if (!file) {
                    await fetch(`/cinema/api/upload_pause?task_id=${taskId}`, { method: 'POST', credentials: 'same-origin' });
                    await loadTasks();
                    return;
                }
                const hash = await computeFileHash(file);
                if (hash !== taskData.file_hash) {
                    alert(`文件不一致!请选择与原上传相同的文件。\n期望: ${taskData.original_filename}\n选择: ${file.name}`);
                    await fetch(`/cinema/api/upload_pause?task_id=${taskId}`, { method: 'POST', credentials: 'same-origin' });
                    await loadTasks();
                    return;
                }
                const statusItem = createUploadUI(file, true);
                const offset = taskData.received_bytes || 0;
                statusItem.progressFill.style.width = (offset / file.size * 100) + '%';
                statusItem.status.textContent = `断点续传,从 ${formatBytes(offset)} 继续...`;
                await loadTasks();
                await runChunkLoop(taskId, file, offset, statusItem);
                processQueue();
            };
            fileInput.click();
        },
    };

    // ===== 取消所有暂停任务 =====
    if (cancelAllPausedBtn) {
        cancelAllPausedBtn.addEventListener('click', async () => {
            if (!confirm('确定取消所有暂停中的上传任务?\n所有临时文件将被删除。')) return;
            await fetch('/cinema/api/upload_cancel_all', { method: 'POST', credentials: 'same-origin' });
            await loadTasks(); await loadUsage(); await loadUploadsDir();
        });
    }

    if (tasksRefreshBtn) {
        tasksRefreshBtn.addEventListener('click', async () => {
            tasksRefreshBtn.textContent = '⏳';
            await loadTasks();
            setTimeout(() => { tasksRefreshBtn.textContent = '🔄'; }, 500);
        });
    }

    const uploadsDirRefresh = document.getElementById('uploads-dir-refresh');
    const uploadsDirClean = document.getElementById('uploads-dir-clean');
    if (uploadsDirRefresh) uploadsDirRefresh.addEventListener('click', loadUploadsDir);
    if (uploadsDirClean) {
        uploadsDirClean.addEventListener('click', async () => {
            if (!confirm('清理 uploads 目录中没有对应任务的孤儿文件?')) return;
            await fetch('/cinema/api/uploads_dir_clean', { method: 'POST', credentials: 'same-origin' });
            await loadUploadsDir(); await loadUsage();
        });
    }

    function startPolling() {
        if (pollingInterval) return;
        pollingInterval = setInterval(async () => {
            const hasInProgress = await loadTasks();
            await loadUsage();
            if (!hasInProgress) { clearInterval(pollingInterval); pollingInterval = null; await loadVideos(); }
        }, 2000);
    }

    configForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData();
        formData.append('veto_enabled', vetoEnabledInput.checked ? 'true' : 'false');
        formData.append('veto_delay_seconds', vetoDelayInput.value);
        try {
            const res = await fetch('/cinema/api/config', { method: 'POST', body: formData, credentials: 'same-origin' });
            if (res.ok) { configStatus.textContent = '✓ 已保存'; setTimeout(() => configStatus.textContent = '', 2000); }
            else { const d = await res.json().catch(() => ({})); configStatus.textContent = '保存失败: ' + (d.error || res.status); configStatus.style.color = 'var(--error)'; }
        } catch (e) { configStatus.textContent = '网络错误'; configStatus.style.color = 'var(--error)'; }
    });

    refreshAllBtn.addEventListener('click', () => {
        loadUsage(); loadTasks(); loadVideos(); loadConfig(); loadStorageLimit(); loadUploadsDir();
    });

    const limitInput = document.getElementById('storage-limit-input');
    const limitSaveBtn = document.getElementById('storage-limit-save');
    const limitHint = document.getElementById('storage-limit-hint');
    const limitStatus = document.getElementById('storage-limit-status');

    async function loadStorageLimit() {
        try {
            const res = await fetch('/cinema/api/storage_limit', { credentials: 'same-origin' });
            if (!res.ok) return;
            const data = await res.json();
            if (limitInput) limitInput.value = data.user_limit_gb;
            if (limitHint) limitHint.textContent = `(最大可设 ${data.dynamic_cap_gb} GB)`;
        } catch (e) { console.error(e); }
    }

    if (limitSaveBtn) {
        limitSaveBtn.addEventListener('click', async () => {
            const gb = parseInt(limitInput.value, 10);
            if (!isFinite(gb) || gb < 1) { limitStatus.textContent = '请输入有效数字'; limitStatus.className = 'storage-limit-status error'; return; }
            const formData = new FormData();
            formData.append('limit_gb', String(gb));
            try {
                const res = await fetch('/cinema/api/storage_limit', { method: 'POST', body: formData, credentials: 'same-origin' });
                if (res.ok) { limitStatus.textContent = '✓ 已保存'; limitStatus.className = 'storage-limit-status success'; setTimeout(() => limitStatus.textContent = '', 2000); await loadUsage(); await loadStorageLimit(); }
                else { const d = await res.json().catch(() => ({})); limitStatus.textContent = d.error || '保存失败'; limitStatus.className = 'storage-limit-status error'; await loadStorageLimit(); }
            } catch (e) { limitStatus.textContent = '网络错误'; limitStatus.className = 'storage-limit-status error'; }
        });
    }

    // ===== 初始化 =====
    uploadProgressArea.innerHTML = '';
    loadUsage();
    loadTasks().then(hasInProgress => { if (hasInProgress) startPolling(); });
    loadVideos(); loadConfig(); loadStorageLimit(); loadUploadsDir();
})();
