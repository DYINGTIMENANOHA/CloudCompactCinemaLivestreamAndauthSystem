/* ===================================
   字幕加载器
   支持 SRT / ASS / SSA / VTT
   纯前端,不存服务器
   =================================== */
(function () {
    'use strict';

    const subtitleBtn = document.getElementById('subtitle-btn');
    const fileInput = document.getElementById('subtitle-file-input');
    const player = document.getElementById('player');

    if (!subtitleBtn || !fileInput || !player) return;

    let currentTrack = null;
    let currentBlobUrl = null;
    let subtitleActive = false;

    // ===== CC 按钮点击 =====
    subtitleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (subtitleActive) {
            // 已有字幕 → 显示选项菜单
            showSubtitleMenu(e);
        } else {
            // 没有字幕 → 打开文件选择
            fileInput.click();
        }
    });

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

        // 定位在按钮上方
        const rect = subtitleBtn.getBoundingClientRect();
        const wrapper = document.getElementById('player-wrapper');
        const wrapperRect = wrapper ? wrapper.getBoundingClientRect() : { left: 0, top: 0 };
        menuEl.style.cssText = `
            position: absolute;
            bottom: ${wrapperRect.bottom - rect.top + 8}px;
            right: ${wrapperRect.right - rect.right}px;
            z-index: 300;
        `;

        (wrapper || document.body).appendChild(menuEl);

        document.getElementById('sub-change').addEventListener('click', () => {
            removeMenu();
            fileInput.click();
        });
        document.getElementById('sub-remove').addEventListener('click', () => {
            removeMenu();
            removeSubtitle();
        });

        // 点其他地方关闭菜单
        setTimeout(() => {
            document.addEventListener('click', closeMenuHandler, { once: true });
        }, 50);
    }

    function closeMenuHandler() {
        removeMenu();
    }

    function removeMenu() {
        if (menuEl) {
            menuEl.remove();
            menuEl = null;
        }
    }

    // ===== 文件选择 =====
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        fileInput.value = '';  // 允许重复选同一文件

        try {
            const text = await file.text();
            const ext = file.name.split('.').pop().toLowerCase();
            let vttContent;

            if (ext === 'vtt') {
                vttContent = text;
            } else if (ext === 'srt') {
                vttContent = srtToVtt(text);
            } else if (ext === 'ass' || ext === 'ssa') {
                vttContent = assToVtt(text);
            } else {
                // 尝试自动检测
                if (text.trim().startsWith('WEBVTT')) {
                    vttContent = text;
                } else if (text.includes('[Script Info]') || text.includes('[Events]')) {
                    vttContent = assToVtt(text);
                } else {
                    vttContent = srtToVtt(text);
                }
            }

            loadVttToPlayer(vttContent);
            subtitleActive = true;
            subtitleBtn.classList.add('active');
            showSubtitleToast('字幕已加载: ' + file.name);
        } catch (err) {
            console.error('[subtitle] parse error:', err);
            showSubtitleToast('字幕加载失败: ' + err.message);
        }
    });

    // ===== SRT → VTT =====
    function srtToVtt(srt) {
        let vtt = 'WEBVTT\n\n';
        // 统一换行符
        srt = srt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        const blocks = srt.trim().split(/\n\n+/);
        for (const block of blocks) {
            const lines = block.trim().split('\n');
            if (lines.length < 2) continue;

            // 找时间行 (包含 -->)
            let timeLineIdx = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('-->')) {
                    timeLineIdx = i;
                    break;
                }
            }
            if (timeLineIdx < 0) continue;

            // 转换时间格式: 逗号 → 点
            const timeLine = lines[timeLineIdx].replace(/,/g, '.');
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
        let textIdx = -1;
        let startIdx = -1;
        let endIdx = -1;

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed === '[Events]') {
                inEvents = true;
                continue;
            }
            if (trimmed.startsWith('[') && trimmed !== '[Events]') {
                inEvents = false;
                continue;
            }

            if (inEvents && trimmed.startsWith('Format:')) {
                formatParts = trimmed.substring(7).split(',').map(s => s.trim().toLowerCase());
                textIdx = formatParts.indexOf('text');
                startIdx = formatParts.indexOf('start');
                endIdx = formatParts.indexOf('end');
                continue;
            }

            if (inEvents && (trimmed.startsWith('Dialogue:') || trimmed.startsWith('Comment:'))) {
                if (trimmed.startsWith('Comment:')) continue;

                const content = trimmed.substring(trimmed.indexOf(':') + 1);
                // ASS 的 Text 字段可以包含逗号,所以只 split 前 N-1 个字段
                const parts = content.split(',');
                if (textIdx < 0 || startIdx < 0 || endIdx < 0) continue;
                if (parts.length <= textIdx) continue;

                const start = parts[startIdx].trim();
                const end = parts[endIdx].trim();
                // Text 是最后一个字段,可能包含逗号
                const text = parts.slice(textIdx).join(',').trim();

                // 清理 ASS 标签
                const cleanText = text
                    .replace(/\{[^}]*\}/g, '')  // 删除 {} 样式标签
                    .replace(/\\N/g, '\n')       // 换行符
                    .replace(/\\n/g, '\n')
                    .replace(/\\h/g, ' ')
                    .trim();

                if (!cleanText) continue;

                const vttStart = assTimeToVtt(start);
                const vttEnd = assTimeToVtt(end);

                if (vttStart && vttEnd) {
                    vtt += vttStart + ' --> ' + vttEnd + '\n' + cleanText + '\n\n';
                }
            }
        }
        return vtt;
    }

    function assTimeToVtt(assTime) {
        // ASS: H:MM:SS.CC → VTT: HH:MM:SS.mmm
        const match = assTime.match(/(\d+):(\d+):(\d+)\.(\d+)/);
        if (!match) return null;
        const h = match[1].padStart(2, '0');
        const m = match[2].padStart(2, '0');
        const s = match[3].padStart(2, '0');
        const cs = match[4].padEnd(3, '0').substring(0, 3);  // centiseconds → milliseconds
        return `${h}:${m}:${s}.${cs}`;
    }

    // ===== 加载 VTT 到播放器 =====
    function loadVttToPlayer(vttContent) {
        // 清理旧字幕
        removeSubtitle();

        // 创建 Blob URL
        const blob = new Blob([vttContent], { type: 'text/vtt' });
        currentBlobUrl = URL.createObjectURL(blob);

        // 创建 <track> 元素
        currentTrack = document.createElement('track');
        currentTrack.kind = 'subtitles';
        currentTrack.label = '字幕';
        currentTrack.srclang = 'zh';
        currentTrack.src = currentBlobUrl;
        currentTrack.default = true;

        player.appendChild(currentTrack);

        // 等 track 加载完后启用
        currentTrack.addEventListener('load', () => {
            if (currentTrack.track) {
                currentTrack.track.mode = 'showing';
            }
        });

        // 强制启用
        setTimeout(() => {
            for (let i = 0; i < player.textTracks.length; i++) {
                player.textTracks[i].mode = 'showing';
            }
        }, 200);
    }

    // ===== 移除字幕 =====
    function removeSubtitle() {
        if (currentTrack) {
            if (currentTrack.track) {
                currentTrack.track.mode = 'disabled';
            }
            currentTrack.remove();
            currentTrack = null;
        }
        if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
            currentBlobUrl = null;
        }
        // 清理所有残留 track
        const tracks = player.querySelectorAll('track');
        tracks.forEach(t => t.remove());

        subtitleActive = false;
        if (subtitleBtn) subtitleBtn.classList.remove('active');
    }

    function showSubtitleToast(msg) {
        // 复用 ws.js 的 toast 或自己创建
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
