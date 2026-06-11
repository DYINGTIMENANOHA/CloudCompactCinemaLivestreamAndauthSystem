/* ===================================
   字幕加载器
   支持 SRT / ASS / SSA / VTT
   使用 File System Access API 记忆文件句柄(Chrome/Edge),
   不存储文件内容;不支持该 API 的浏览器降级为普通选择,无记忆功能
   =================================== */
(function () {
    'use strict';

    const subtitleBtn = document.getElementById('subtitle-btn');
    const fileInput   = document.getElementById('subtitle-file-input');
    const player      = document.getElementById('player');

    if (!subtitleBtn || !fileInput || !player) return;

    const VIDEO       = window.CINEMA_VIDEO;
    const videoId     = VIDEO ? VIDEO.id : null;
    const IDB_KEY     = videoId ? ('cinema_sub_' + videoId) : null;
    const LS_NAME_KEY = videoId ? ('cinema_sub_name_' + videoId) : null;
    const HAS_PICKER  = typeof window.showOpenFilePicker === 'function';

    let currentTrack   = null;
    let currentBlobUrl = null;
    let subtitleActive = false;

    // ===== IndexedDB helpers (存储 FileSystemFileHandle) =====
    const DB_NAME    = 'cinema_subtitle';
    const STORE_NAME = 'handles';

    function _openDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                e.target.result.createObjectStore(STORE_NAME);
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror   = ()  => reject(req.error);
        });
    }

    async function _idbSave(key, value) {
        const db = await _openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(value, key);
            tx.oncomplete = resolve;
            tx.onerror    = () => reject(tx.error);
        });
    }

    async function _idbLoad(key) {
        const db = await _openDb();
        return new Promise((resolve, reject) => {
            const tx  = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => reject(req.error);
        });
    }

    async function _idbDelete(key) {
        const db = await _openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(key);
            tx.oncomplete = resolve;
            tx.onerror    = () => reject(tx.error);
        });
    }

    // ===== 选择文件 =====
    // 返回 { handle, file } 或 null(取消/出错)
    async function _pickFile() {
        if (HAS_PICKER) {
            try {
                const [handle] = await window.showOpenFilePicker({
                    types: [{
                        description: '字幕文件',
                        accept: { 'text/plain': ['.srt', '.vtt', '.ass', '.ssa'] },
                    }],
                    multiple: false,
                });
                return { handle, file: await handle.getFile() };
            } catch (e) {
                if (e.name === 'AbortError') return null;
                throw e;
            }
        } else {
            // 降级: 普通 file input
            return new Promise((resolve) => {
                const onChange = (e) => {
                    fileInput.removeEventListener('change', onChange);
                    fileInput.value = '';
                    const f = e.target.files[0];
                    resolve(f ? { handle: null, file: f } : null);
                };
                fileInput.addEventListener('change', onChange);
                fileInput.click();
            });
        }
    }

    // ===== 读取 File 并加载字幕 =====
    // autoLoad=true 时不重新写入持久化(句柄已在库里)
    async function _loadFile(file, handle, autoLoad) {
        const text = await file.text();
        const ext  = file.name.split('.').pop().toLowerCase();
        let vttContent;

        if (ext === 'vtt') {
            vttContent = text;
        } else if (ext === 'srt') {
            vttContent = srtToVtt(text);
        } else if (ext === 'ass' || ext === 'ssa') {
            vttContent = assToVtt(text);
        } else {
            if (text.trim().startsWith('WEBVTT'))                                  vttContent = text;
            else if (text.includes('[Script Info]') || text.includes('[Events]'))  vttContent = assToVtt(text);
            else                                                                    vttContent = srtToVtt(text);
        }

        loadVttToPlayer(vttContent);
        subtitleActive = true;
        subtitleBtn.classList.add('active');
        showSubtitleToast((autoLoad ? '已自动加载字幕: ' : '字幕已加载: ') + file.name);

        // 用户主动选择时持久化句柄
        if (!autoLoad && IDB_KEY) {
            if (handle) {
                _idbSave(IDB_KEY, handle).catch(() => {});
            } else {
                // 降级路径(无 handle):清掉旧句柄,避免下次自动加载到错误文件
                _idbDelete(IDB_KEY).catch(() => {});
            }
            if (LS_NAME_KEY) {
                try { localStorage.setItem(LS_NAME_KEY, file.name); } catch (e) {}
            }
        }
    }

    // ===== CC 按钮点击 =====
    subtitleBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (subtitleActive) {
            showSubtitleMenu(e);
        } else {
            await _userPickSubtitle();
        }
    });

    async function _userPickSubtitle() {
        try {
            const picked = await _pickFile();
            if (!picked) return;
            await _loadFile(picked.file, picked.handle, false);
        } catch (err) {
            console.error('[subtitle] load error:', err);
            showSubtitleToast('字幕加载失败: ' + err.message);
        }
    }

    // ===== 字幕菜单 =====
    let menuEl = null;

    function showSubtitleMenu(e) {
        removeMenu();
        menuEl = document.createElement('div');
        menuEl.className = 'subtitle-menu';
        menuEl.innerHTML = `
            <button class="subtitle-menu-item" id="sub-change">更换字幕</button>
            <button class="subtitle-menu-item" id="sub-remove">关闭字幕</button>
        `;

        const rect        = subtitleBtn.getBoundingClientRect();
        const wrapper     = document.getElementById('player-wrapper');
        const wrapperRect = wrapper ? wrapper.getBoundingClientRect() : { left: 0, top: 0, bottom: 0, right: 0 };
        menuEl.style.cssText = `
            position: absolute;
            bottom: ${wrapperRect.bottom - rect.top + 8}px;
            right: ${wrapperRect.right - rect.right}px;
            z-index: 300;
        `;

        (wrapper || document.body).appendChild(menuEl);

        document.getElementById('sub-change').addEventListener('click', () => {
            removeMenu();
            _userPickSubtitle();
        });
        document.getElementById('sub-remove').addEventListener('click', () => {
            removeMenu();
            removeSubtitle();
        });

        setTimeout(() => {
            document.addEventListener('click', closeMenuHandler, { once: true });
        }, 50);
    }

    function closeMenuHandler() { removeMenu(); }
    function removeMenu() {
        if (menuEl) { menuEl.remove(); menuEl = null; }
    }

    // ===== 自动加载: 页面加载时从 IndexedDB 恢复句柄 =====
    if (IDB_KEY && HAS_PICKER) {
        (async () => {
            try {
                const handle = await _idbLoad(IDB_KEY);
                if (!handle) return;

                const perm = await handle.queryPermission({ mode: 'read' });

                if (perm === 'granted') {
                    // 权限仍有效,直接读取文件
                    const file = await handle.getFile();
                    await _loadFile(file, handle, true);
                } else if (perm === 'prompt') {
                    // 需要用户手势才能请求权限,显示提示按钮
                    const name = LS_NAME_KEY
                        ? (localStorage.getItem(LS_NAME_KEY) || '上次字幕')
                        : '上次字幕';
                    _showReloadPrompt(name, handle);
                }
                // 'denied' → 静默跳过
            } catch (e) {
                // IndexedDB 不可用或句柄失效,静默忽略
            }
        })();
    }

    // ===== 提示按钮: 权限需要用户手势时显示 =====
    function _showReloadPrompt(filename, handle) {
        const wrapper = document.getElementById('player-wrapper');
        if (!wrapper) return;

        const btn = document.createElement('button');
        btn.id = 'subtitle-reload-prompt';
        btn.textContent = `📄 点击加载上次字幕: ${filename}`;
        btn.style.cssText =
            'position:absolute;bottom:56px;left:50%;transform:translateX(-50%);' +
            'z-index:250;background:rgba(40,40,60,0.92);color:#ccc;' +
            'border:1px solid #555;padding:6px 18px;border-radius:6px;' +
            'font-size:12px;cursor:pointer;white-space:nowrap;pointer-events:auto;';
        wrapper.appendChild(btn);

        btn.addEventListener('click', async () => {
            btn.remove();
            try {
                const perm = await handle.requestPermission({ mode: 'read' });
                if (perm === 'granted') {
                    const file = await handle.getFile();
                    await _loadFile(file, handle, true);
                } else {
                    showSubtitleToast('字幕文件访问被拒绝,请手动重新选择');
                    if (IDB_KEY) _idbDelete(IDB_KEY).catch(() => {});
                    if (LS_NAME_KEY) { try { localStorage.removeItem(LS_NAME_KEY); } catch (e) {} }
                }
            } catch (e) {
                showSubtitleToast('字幕文件无法访问,请手动重新选择');
                if (IDB_KEY) _idbDelete(IDB_KEY).catch(() => {});
                if (LS_NAME_KEY) { try { localStorage.removeItem(LS_NAME_KEY); } catch (e) {} }
            }
        }, { once: true });

        // 15 秒后自动移除,不持续打扰
        setTimeout(() => { if (btn.parentNode) btn.remove(); }, 15000);
    }

    // ===== SRT → VTT =====
    function srtToVtt(srt) {
        let vtt = 'WEBVTT\n\n';
        srt = srt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        const blocks = srt.trim().split(/\n\n+/);
        for (const block of blocks) {
            const lines = block.trim().split('\n');
            if (lines.length < 2) continue;

            let timeLineIdx = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('-->')) { timeLineIdx = i; break; }
            }
            if (timeLineIdx < 0) continue;

            const timeLine  = lines[timeLineIdx].replace(/,/g, '.');
            const textLines = lines.slice(timeLineIdx + 1).join('\n');
            if (textLines.trim()) {
                vtt += timeLine + '\n' + textLines + '\n\n';
            }
        }
        return vtt;
    }

    // ===== ASS/SSA → VTT =====
    function assToVtt(ass) {
        let vtt = 'WEBVTT\n\n';
        const lines = ass.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

        let inEvents = false;
        let formatParts = [];
        let textIdx = -1, startIdx = -1, endIdx = -1;

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed === '[Events]') { inEvents = true; continue; }
            if (trimmed.startsWith('[') && trimmed !== '[Events]') { inEvents = false; continue; }

            if (inEvents && trimmed.startsWith('Format:')) {
                formatParts = trimmed.substring(7).split(',').map(s => s.trim().toLowerCase());
                textIdx  = formatParts.indexOf('text');
                startIdx = formatParts.indexOf('start');
                endIdx   = formatParts.indexOf('end');
                continue;
            }

            if (inEvents && trimmed.startsWith('Dialogue:')) {
                const content = trimmed.substring(trimmed.indexOf(':') + 1);
                const parts   = content.split(',');
                if (textIdx < 0 || startIdx < 0 || endIdx < 0) continue;
                if (parts.length <= textIdx) continue;

                const start = parts[startIdx].trim();
                const end   = parts[endIdx].trim();
                const text  = parts.slice(textIdx).join(',').trim();

                const cleanText = text
                    .replace(/\{[^}]*\}/g, '')
                    .replace(/\\N/g, '\n')
                    .replace(/\\n/g, '\n')
                    .replace(/\\h/g, ' ')
                    .trim();

                if (!cleanText) continue;

                const vttStart = assTimeToVtt(start);
                const vttEnd   = assTimeToVtt(end);
                if (vttStart && vttEnd) {
                    vtt += vttStart + ' --> ' + vttEnd + '\n' + cleanText + '\n\n';
                }
            }
        }
        return vtt;
    }

    function assTimeToVtt(assTime) {
        const match = assTime.match(/(\d+):(\d+):(\d+)\.(\d+)/);
        if (!match) return null;
        const h  = match[1].padStart(2, '0');
        const m  = match[2].padStart(2, '0');
        const s  = match[3].padStart(2, '0');
        const cs = match[4].padEnd(3, '0').substring(0, 3);
        return `${h}:${m}:${s}.${cs}`;
    }

    // ===== 加载 VTT 到播放器 =====
    function loadVttToPlayer(vttContent) {
        removeSubtitle(false);  // 内部清理,不触发持久化删除

        const blob = new Blob([vttContent], { type: 'text/vtt' });
        currentBlobUrl = URL.createObjectURL(blob);

        currentTrack          = document.createElement('track');
        currentTrack.kind     = 'subtitles';
        currentTrack.label    = '字幕';
        currentTrack.srclang  = 'zh';
        currentTrack.src      = currentBlobUrl;
        currentTrack.default  = true;
        player.appendChild(currentTrack);

        currentTrack.addEventListener('load', () => {
            if (currentTrack.track) currentTrack.track.mode = 'showing';
        });

        setTimeout(() => {
            for (let i = 0; i < player.textTracks.length; i++) {
                player.textTracks[i].mode = 'showing';
            }
        }, 200);
    }

    // ===== 移除字幕 =====
    // clearPersisted=true(默认): 用户主动关闭,同时清除 IndexedDB/localStorage
    // clearPersisted=false: 内部切换时只清理 DOM
    function removeSubtitle(clearPersisted = true) {
        if (currentTrack) {
            if (currentTrack.track) currentTrack.track.mode = 'disabled';
            currentTrack.remove();
            currentTrack = null;
        }
        if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
            currentBlobUrl = null;
        }
        player.querySelectorAll('track').forEach(t => t.remove());

        subtitleActive = false;
        if (subtitleBtn) subtitleBtn.classList.remove('active');

        if (clearPersisted) {
            if (IDB_KEY)     _idbDelete(IDB_KEY).catch(() => {});
            if (LS_NAME_KEY) { try { localStorage.removeItem(LS_NAME_KEY); } catch (e) {} }
        }
    }

    function showSubtitleToast(msg) {
        const container = document.getElementById('toast-container');
        if (container) {
            const el = document.createElement('div');
            el.className = 'toast-item';
            el.textContent = msg;
            container.appendChild(el);
            setTimeout(() => {
                el.classList.add('toast-out');
                setTimeout(() => el.remove(), 200);
            }, 3000);
        }
    }
})();
