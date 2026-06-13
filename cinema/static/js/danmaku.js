/* ===================================
   弹幕加载器
   支持 Bilibili XML 以及 Bilibili 弹幕转出的 ASS / SSA
   =================================== */
(function () {
    'use strict';

    const danmakuBtn = document.getElementById('danmaku-btn');
    const fileInput = document.getElementById('danmaku-file-input');
    const player = document.getElementById('player');
    const wrapper = document.getElementById('player-wrapper');
    const layer = document.getElementById('danmaku-layer');

    if (!danmakuBtn || !fileInput || !player || !wrapper || !layer) return;

    const VIDEO = window.CINEMA_VIDEO;
    const videoId = VIDEO ? VIDEO.id : null;
    const IDB_KEY = videoId ? ('cinema_danmaku_' + videoId) : null;
    const LS_NAME_KEY = videoId ? ('cinema_danmaku_name_' + videoId) : null;
    const LS_SETTINGS_KEY = videoId ? ('cinema_danmaku_settings_' + videoId) : 'cinema_danmaku_settings';
    const HAS_PICKER = typeof window.showOpenFilePicker === 'function';

    const DB_NAME = 'cinema_danmaku';
    const STORE_NAME = 'handles';
    const DEFAULT_SETTINGS = {
        enabled: true,
        area: 'half',
        opacity: 0.85,
        scale: 1,
        speed: 1,
        density: 'standard',
        style: 'normal',
        colorMode: 'original',
        showScroll: true,
        showTop: true,
        showBottom: true,
        avoidOverlap: false,
    };

    let settings = loadSettings();
    let comments = [];
    let cursor = 0;
    let active = false;
    let rafId = null;
    let menuEl = null;
    let laneCursor = 0;
    let fixedTopCursor = 0;
    let fixedBottomCursor = 0;
    const scrollLaneLocks = [];
    const fixedTopLocks = [];
    const fixedBottomLocks = [];
    const activeNodes = new Set();

    applyLayerSettings();

    function openDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE_NAME);
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function idbSave(key, value) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(value, key);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    }

    async function idbLoad(key) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function idbDelete(key) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(key);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    }

    async function pickFile() {
        if (HAS_PICKER) {
            try {
                const [handle] = await window.showOpenFilePicker({
                    types: [{
                        description: '弹幕文件',
                        accept: { 'text/plain': ['.ass', '.ssa', '.xml', '.json', '.txt'] },
                    }],
                    multiple: false,
                });
                return { handle, file: await handle.getFile() };
            } catch (e) {
                if (e.name === 'AbortError') return null;
                throw e;
            }
        }

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

    async function loadFile(file, handle, autoLoad) {
        const text = await file.text();
        const ext = file.name.split('.').pop().toLowerCase();
        let parsed;

        if (ext === 'xml' || text.trim().startsWith('<')) {
            parsed = parseBilibiliXml(text);
        } else if (ext === 'json' || looksLikeJsonDanmaku(text)) {
            parsed = parseJsonDanmaku(text);
        } else {
            parsed = parseAssDanmaku(text);
        }

        comments = parsed
            .filter(c => isFinite(c.time) && c.time >= 0 && c.text)
            .sort((a, b) => a.time - b.time);
        cursor = findCursor(player.currentTime || 0);
        active = comments.length > 0;
        settings.enabled = true;
        saveSettings();
        applyLayerSettings();
        clearActiveNodes();
        danmakuBtn.classList.toggle('active', active);
        showToast((autoLoad ? '已自动加载弹幕: ' : '弹幕已加载: ') + file.name + ` (${comments.length} 条)`);
        startLoop();

        if (!autoLoad && IDB_KEY) {
            if (handle) idbSave(IDB_KEY, handle).catch(() => {});
            else idbDelete(IDB_KEY).catch(() => {});
            if (LS_NAME_KEY) {
                try { localStorage.setItem(LS_NAME_KEY, file.name); } catch (e) {}
            }
        }
    }

    danmakuBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (active) showMenu();
        else await userPickDanmaku();
    });

    async function userPickDanmaku() {
        try {
            const picked = await pickFile();
            if (!picked) return;
            await loadFile(picked.file, picked.handle, false);
        } catch (err) {
            console.error('[danmaku] load error:', err);
            showToast('弹幕加载失败: ' + err.message);
        }
    }

    function showMenu() {
        removeMenu();
        menuEl = document.createElement('div');
        menuEl.className = 'danmaku-menu';
        menuEl.innerHTML = `
            <button class="danmaku-menu-item" id="dm-toggle">${settings.enabled ? '隐藏弹幕' : '显示弹幕'}</button>
            <button class="danmaku-menu-item" id="dm-change">更换弹幕</button>
            <button class="danmaku-menu-item" id="dm-remove">关闭弹幕</button>
            <div class="danmaku-menu-section">
                <label>显示区域
                    <select id="dm-area">
                        <option value="full">全屏</option>
                        <option value="half">半屏</option>
                        <option value="third">顶部 1/3</option>
                    </select>
                </label>
                <label>字体大小
                    <input id="dm-scale" type="range" min="0.35" max="1.35" value="${settings.scale}" step="0.05">
                </label>
                <label>透明度
                    <input id="dm-opacity" type="range" min="0.25" max="1" value="${settings.opacity}" step="0.05">
                </label>
                <label>速度
                    <select id="dm-speed">
                        <option value="0.75">慢</option>
                        <option value="1">标准</option>
                        <option value="1.35">快</option>
                    </select>
                </label>
                <label>密度
                    <select id="dm-density">
                        <option value="dense">不限</option>
                        <option value="standard">标准</option>
                        <option value="sparse">稀疏</option>
                    </select>
                </label>
                <label>字体深浅
                    <select id="dm-style">
                        <option value="light">浅</option>
                        <option value="normal">标准</option>
                        <option value="strong">深</option>
                    </select>
                </label>
                <label>颜色
                    <select id="dm-color-mode">
                        <option value="original">保留原色</option>
                        <option value="white">统一白色</option>
                    </select>
                </label>
                <label><input id="dm-show-scroll" type="checkbox"> 滚动</label>
                <label><input id="dm-show-top" type="checkbox"> 顶部</label>
                <label><input id="dm-show-bottom" type="checkbox"> 底部</label>
                <label><input id="dm-avoid-overlap" type="checkbox"> 防遮挡</label>
            </div>
        `;

        const rect = danmakuBtn.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        menuEl.style.cssText = `
            position:absolute;
            bottom:${wrapperRect.bottom - rect.top + 8}px;
            right:${wrapperRect.right - rect.right}px;
            z-index:320;
        `;
        wrapper.appendChild(menuEl);

        const byId = (id) => menuEl.querySelector('#' + id);
        byId('dm-area').value = settings.area;
        byId('dm-speed').value = String(settings.speed);
        byId('dm-density').value = settings.density;
        byId('dm-style').value = settings.style;
        byId('dm-color-mode').value = settings.colorMode;
        byId('dm-show-scroll').checked = settings.showScroll;
        byId('dm-show-top').checked = settings.showTop;
        byId('dm-show-bottom').checked = settings.showBottom;
        byId('dm-avoid-overlap').checked = settings.avoidOverlap;

        byId('dm-toggle').addEventListener('click', () => {
            settings.enabled = !settings.enabled;
            saveAndApplySettings(true);
            removeMenu();
        });
        byId('dm-change').addEventListener('click', () => {
            removeMenu();
            userPickDanmaku();
        });
        byId('dm-remove').addEventListener('click', () => {
            removeMenu();
            removeDanmaku();
        });

        bindSetting('dm-area', 'change', el => { settings.area = el.value; });
        bindSetting('dm-scale', 'input', el => { settings.scale = parseFloat(el.value); });
        bindSetting('dm-opacity', 'input', el => { settings.opacity = parseFloat(el.value); });
        bindSetting('dm-speed', 'change', el => { settings.speed = parseFloat(el.value); });
        bindSetting('dm-density', 'change', el => { settings.density = el.value; });
        bindSetting('dm-style', 'change', el => { settings.style = el.value; });
        bindSetting('dm-color-mode', 'change', el => { settings.colorMode = el.value; });
        bindSetting('dm-show-scroll', 'change', el => { settings.showScroll = el.checked; });
        bindSetting('dm-show-top', 'change', el => { settings.showTop = el.checked; });
        bindSetting('dm-show-bottom', 'change', el => { settings.showBottom = el.checked; });
        bindSetting('dm-avoid-overlap', 'change', el => { settings.avoidOverlap = el.checked; resetToCurrentTime(); });

        setTimeout(() => {
            document.addEventListener('click', closeMenuOnOutside, { once: true });
        }, 50);
    }

    function bindSetting(id, eventName, update) {
        const el = menuEl.querySelector('#' + id);
        el.addEventListener(eventName, () => {
            update(el);
            saveAndApplySettings(false);
        });
    }

    function closeMenuOnOutside(e) {
        if (menuEl && !menuEl.contains(e.target)) removeMenu();
    }

    function removeMenu() {
        if (menuEl) {
            menuEl.remove();
            menuEl = null;
        }
    }

    function startLoop() {
        if (rafId) return;
        const tick = () => {
            rafId = null;
            if (!active) return;
            renderDueComments();
            cleanupExpired();
            rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
    }

    function renderDueComments() {
        if (!settings.enabled || player.paused || player.seeking) return;
        const now = player.currentTime || 0;
        const maxPerFrame = settings.density === 'dense' ? 24 : settings.density === 'sparse' ? 5 : 12;
        let rendered = 0;

        while (cursor < comments.length && comments[cursor].time <= now + 0.12 && rendered < maxPerFrame) {
            const c = comments[cursor++];
            if (c.time < now - 1.5 || !isModeVisible(c.mode)) continue;
            if (shouldSkipForDensity()) continue;
            if (createNode(c, now)) rendered++;
        }
    }

    function cleanupExpired() {
        const now = player.currentTime || 0;
        for (const node of Array.from(activeNodes)) {
            const end = parseFloat(node.dataset.end || '0');
            if (!isFinite(end) || now > end + 0.4) removeNode(node);
        }
    }

    function createNode(comment, now) {
        const node = document.createElement('div');
        node.className = 'danmaku-item danmaku-' + comment.mode;
        node.textContent = comment.text;
        node.dataset.end = String(comment.time + comment.duration);
        node.style.color = settings.colorMode === 'white' ? '#fff' : (comment.color || '#fff');
        node.style.fontSize = Math.round((comment.fontSize || 26) * settings.scale) + 'px';
        node.style.opacity = settings.opacity;
        node.style.setProperty('--dm-opacity', settings.opacity);

        node.style.visibility = 'hidden';
        layer.appendChild(node);
        const placed = comment.mode === 'scroll'
            ? placeScrollingNode(node, comment, now)
            : placeFixedNode(node, comment, now);
        if (!placed) {
            node.remove();
            return false;
        }
        node.style.visibility = '';
        activeNodes.add(node);
        return true;
    }

    function placeScrollingNode(node, comment, now) {
        const height = getActiveAreaHeight();
        const fontSize = parseFloat(node.style.fontSize) || 26;
        const laneHeight = Math.max(24, fontSize + 8);
        const laneCount = Math.max(1, Math.floor(height / laneHeight));
        let lane = comment.yRatio != null ? Math.floor(comment.yRatio * laneCount) : laneCursor++;
        lane = Math.max(0, Math.min(laneCount - 1, lane % laneCount));
        const duration = Math.max(3, (comment.duration || 8) / settings.speed);
        lane = pickLane(lane, laneCount, scrollLaneLocks, now);
        if (lane < 0) return false;

        const y = lane * laneHeight + 4;
        const elapsed = Math.max(0, now - comment.time);
        const layerWidth = Math.max(1, layer.getBoundingClientRect().width || wrapper.getBoundingClientRect().width || 640);
        const nodeWidth = Math.max(1, node.offsetWidth || 220);
        const safeDelay = duration * Math.min(0.9, nodeWidth / (layerWidth + nodeWidth)) + 0.15;
        if (settings.avoidOverlap) scrollLaneLocks[lane] = now + safeDelay;

        node.style.top = y + 'px';
        node.style.animationDuration = duration + 's';
        node.style.animationDelay = (-Math.min(elapsed, duration - 0.1)) + 's';
        return true;
    }

    function placeFixedNode(node, comment, now) {
        const height = getActiveAreaHeight();
        const fontSize = parseFloat(node.style.fontSize) || 26;
        const laneHeight = Math.max(24, fontSize + 8);
        const laneCount = Math.max(1, Math.floor(height / laneHeight));
        const yFromFile = comment.yRatio != null ? comment.yRatio * height : null;
        let y;

        if (comment.mode === 'bottom') {
            const lane = yFromFile != null
                ? Math.max(0, Math.min(laneCount - 1, Math.floor(yFromFile / laneHeight)))
                : pickLane(fixedBottomCursor++, laneCount, fixedBottomLocks, now);
            if (lane < 0) return false;
            if (settings.avoidOverlap && fixedBottomLocks[lane] > now) return false;
            if (settings.avoidOverlap) fixedBottomLocks[lane] = now + Math.max(2, (comment.duration || 4) / settings.speed);
            y = yFromFile != null ? yFromFile : height - (lane + 1) * laneHeight;
            node.style.transform = 'translateX(-50%)';
        } else {
            const lane = yFromFile != null
                ? Math.max(0, Math.min(laneCount - 1, Math.floor(yFromFile / laneHeight)))
                : pickLane(fixedTopCursor++, laneCount, fixedTopLocks, now);
            if (lane < 0) return false;
            if (settings.avoidOverlap && fixedTopLocks[lane] > now) return false;
            if (settings.avoidOverlap) fixedTopLocks[lane] = now + Math.max(2, (comment.duration || 4) / settings.speed);
            y = yFromFile != null ? yFromFile : lane * laneHeight + 4;
            node.style.transform = 'translateX(-50%)';
        }

        node.style.left = '50%';
        node.style.top = Math.max(4, Math.min(height - fontSize - 4, y)) + 'px';
        node.style.animationDuration = Math.max(2, (comment.duration || 4) / settings.speed) + 's';
        return true;
    }

    function removeNode(node) {
        activeNodes.delete(node);
        if (node.parentNode) node.remove();
    }

    function clearActiveNodes() {
        for (const node of Array.from(activeNodes)) removeNode(node);
        layer.innerHTML = '';
        activeNodes.clear();
        laneCursor = 0;
        fixedTopCursor = 0;
        fixedBottomCursor = 0;
        scrollLaneLocks.length = 0;
        fixedTopLocks.length = 0;
        fixedBottomLocks.length = 0;
    }

    function pickLane(preferredLane, laneCount, locks, now) {
        if (!settings.avoidOverlap) return ((preferredLane % laneCount) + laneCount) % laneCount;
        for (let i = 0; i < laneCount; i++) {
            const lane = ((preferredLane + i) % laneCount + laneCount) % laneCount;
            if (!locks[lane] || locks[lane] <= now) return lane;
        }
        return -1;
    }

    function resetToCurrentTime() {
        clearActiveNodes();
        cursor = findCursor(player.currentTime || 0);
        startLoop();
    }

    function findCursor(time) {
        let lo = 0;
        let hi = comments.length;
        while (lo < hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (comments[mid].time < time - 0.2) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    function shouldSkipForDensity() {
        const count = activeNodes.size;
        if (settings.density === 'dense') return false;
        if (settings.density === 'sparse') return count > 55;
        return count > 100;
    }

    function isModeVisible(mode) {
        if (mode === 'scroll') return settings.showScroll;
        if (mode === 'top') return settings.showTop;
        if (mode === 'bottom') return settings.showBottom;
        return true;
    }

    function getActiveAreaHeight() {
        const rect = layer.getBoundingClientRect();
        const full = rect.height || wrapper.getBoundingClientRect().height || 360;
        if (settings.area === 'third') return full * 0.34;
        if (settings.area === 'half') return full * 0.58;
        return full;
    }

    function applyLayerSettings() {
        layer.classList.toggle('hidden', !settings.enabled || !active);
        layer.classList.remove('danmaku-style-light', 'danmaku-style-normal', 'danmaku-style-strong');
        layer.classList.add('danmaku-style-' + settings.style);
        danmakuBtn.classList.toggle('active', active && settings.enabled);
        document.documentElement.style.setProperty('--danmaku-area-height', getAreaCssHeight(settings.area));
    }

    function getAreaCssHeight(area) {
        if (area === 'third') return '34%';
        if (area === 'half') return '58%';
        return '100%';
    }

    function saveAndApplySettings(reset) {
        saveSettings();
        applyLayerSettings();
        if (reset) resetToCurrentTime();
    }

    function saveSettings() {
        try { localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
    }

    function loadSettings() {
        try {
            const raw = localStorage.getItem(LS_SETTINGS_KEY);
            if (raw) return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
        } catch (e) {}
        return Object.assign({}, DEFAULT_SETTINGS);
    }

    function removeDanmaku(clearPersisted = true) {
        active = false;
        comments = [];
        cursor = 0;
        clearActiveNodes();
        applyLayerSettings();
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (clearPersisted) {
            if (IDB_KEY) idbDelete(IDB_KEY).catch(() => {});
            if (LS_NAME_KEY) { try { localStorage.removeItem(LS_NAME_KEY); } catch (e) {} }
        }
        showToast('弹幕已关闭');
    }

    function parseAssDanmaku(text) {
        const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        const styles = {};
        let inStyles = false;
        let inEvents = false;
        let styleFormat = [];
        let eventFormat = [];
        const output = [];
        let playResX = 1920;
        let playResY = 1080;

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;

            const resX = line.match(/^PlayResX:\s*(\d+)/i);
            const resY = line.match(/^PlayResY:\s*(\d+)/i);
            if (resX) playResX = parseInt(resX[1], 10) || playResX;
            if (resY) playResY = parseInt(resY[1], 10) || playResY;

            if (/^\[V4\+ Styles\]/i.test(line) || /^\[V4 Styles\]/i.test(line)) {
                inStyles = true;
                inEvents = false;
                continue;
            }
            if (/^\[Events\]/i.test(line)) {
                inEvents = true;
                inStyles = false;
                continue;
            }
            if (line.startsWith('[')) {
                inStyles = false;
                inEvents = false;
                continue;
            }

            if (inStyles && /^Format:/i.test(line)) {
                styleFormat = line.substring(line.indexOf(':') + 1).split(',').map(s => s.trim().toLowerCase());
                continue;
            }
            if (inStyles && /^Style:/i.test(line)) {
                const fields = splitFields(line.substring(line.indexOf(':') + 1), styleFormat.length);
                const style = readByFormat(fields, styleFormat);
                if (style.name) {
                    styles[style.name] = {
                        fontSize: parseFloat(style.fontsize) || 26,
                        color: assColorToCss(style.primarycolour) || '#fff',
                    };
                }
                continue;
            }

            if (inEvents && /^Format:/i.test(line)) {
                eventFormat = line.substring(line.indexOf(':') + 1).split(',').map(s => s.trim().toLowerCase());
                continue;
            }
            if (inEvents && /^Dialogue:/i.test(line)) {
                const fields = splitFields(line.substring(line.indexOf(':') + 1), eventFormat.length);
                const row = readByFormat(fields, eventFormat);
                const start = assTimeToSeconds(row.start);
                const end = assTimeToSeconds(row.end);
                if (!isFinite(start)) continue;

                const rawText = row.text || '';
                const tagText = (rawText.match(/\{[^}]*\}/g) || []).join('');
                const move = tagText.match(/\\move\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)/i);
                const pos = tagText.match(/\\pos\(([-\d.]+),([-\d.]+)/i);
                const colorTag = tagText.match(/\\c&H([0-9a-f]+)&/i);
                const style = styles[row.style] || {};
                const cleanText = cleanAssText(rawText);
                if (!cleanText) continue;

                let mode = 'scroll';
                let y = null;
                if (move) {
                    mode = 'scroll';
                    y = parseFloat(move[2]);
                } else if (pos) {
                    y = parseFloat(pos[2]);
                    mode = y > playResY * 0.72 ? 'bottom' : 'top';
                }

                output.push({
                    time: start,
                    duration: isFinite(end) && end > start ? end - start : (mode === 'scroll' ? 8 : 4),
                    text: cleanText,
                    mode,
                    color: colorTag ? assColorToCss(colorTag[1]) : (style.color || '#fff'),
                    fontSize: style.fontSize || 26,
                    yRatio: isFinite(y) ? Math.max(0, Math.min(1, y / playResY)) : null,
                });
            }
        }

        return output;
    }

    function parseBilibiliXml(text) {
        const doc = new DOMParser().parseFromString(text, 'text/xml');
        const output = [];
        doc.querySelectorAll('d[p]').forEach(d => {
            const p = (d.getAttribute('p') || '').split(',');
            const time = parseFloat(p[0]);
            const modeCode = parseInt(p[1], 10);
            const size = parseFloat(p[2]) || 25;
            const colorNum = parseInt(p[3], 10);
            output.push({
                time,
                duration: modeCode === 4 || modeCode === 5 ? 4 : 8,
                text: d.textContent || '',
                mode: modeCode === 4 ? 'bottom' : modeCode === 5 ? 'top' : 'scroll',
                color: Number.isFinite(colorNum) ? intColorToCss(colorNum) : '#fff',
                fontSize: size,
                yRatio: null,
            });
        });
        return output;
    }

    function parseJsonDanmaku(text) {
        const arr = JSON.parse(text);
        if (!Array.isArray(arr)) return [];
        return arr.map(item => ({
            time: parseFloat(item.time),
            duration: parseFloat(item.duration) || 8,
            text: String(item.text || ''),
            mode: ['scroll', 'top', 'bottom'].includes(item.mode) ? item.mode : 'scroll',
            color: item.color || '#fff',
            fontSize: parseFloat(item.fontSize) || 26,
            yRatio: item.yRatio == null ? null : parseFloat(item.yRatio),
        }));
    }

    function looksLikeJsonDanmaku(text) {
        const trimmed = text.trim();
        if (!trimmed) return false;
        if (/^\[(Script Info|V4\+ Styles|V4 Styles|Events)\]/i.test(trimmed)) return false;
        if (trimmed.startsWith('{')) return true;
        if (!trimmed.startsWith('[')) return false;
        return /^\[\s*[\[{"]/.test(trimmed);
    }

    function splitFields(text, count) {
        if (!count || count < 2) return text.split(',');
        const fields = [];
        let rest = text;
        for (let i = 0; i < count - 1; i++) {
            const idx = rest.indexOf(',');
            if (idx < 0) {
                fields.push(rest.trim());
                rest = '';
            } else {
                fields.push(rest.slice(0, idx).trim());
                rest = rest.slice(idx + 1);
            }
        }
        fields.push(rest.trim());
        return fields;
    }

    function readByFormat(fields, format) {
        const obj = {};
        format.forEach((name, idx) => { obj[name] = fields[idx] || ''; });
        return obj;
    }

    function cleanAssText(text) {
        return text
            .replace(/\{[^}]*\}/g, '')
            .replace(/\\N/g, '\n')
            .replace(/\\n/g, '\n')
            .replace(/\\h/g, ' ')
            .trim();
    }

    function assTimeToSeconds(value) {
        const match = String(value || '').match(/(\d+):(\d+):(\d+)(?:\.(\d+))?/);
        if (!match) return NaN;
        const h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        const s = parseInt(match[3], 10);
        const frac = parseFloat('0.' + (match[4] || '0'));
        return h * 3600 + m * 60 + s + frac;
    }

    function assColorToCss(value) {
        if (!value) return null;
        let hex = String(value).replace(/^&H/i, '').replace(/&$/g, '').trim();
        if (!hex) return null;
        hex = hex.padStart(6, '0');
        const bgr = hex.slice(-6);
        const bb = bgr.slice(0, 2);
        const gg = bgr.slice(2, 4);
        const rr = bgr.slice(4, 6);
        return '#' + rr + gg + bb;
    }

    function intColorToCss(num) {
        return '#' + Math.max(0, num).toString(16).padStart(6, '0').slice(-6);
    }

    function showToast(msg) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const el = document.createElement('div');
        el.className = 'toast-item';
        el.textContent = msg;
        container.appendChild(el);
        setTimeout(() => {
            el.classList.add('toast-out');
            setTimeout(() => el.remove(), 200);
        }, 3000);
    }

    player.addEventListener('play', () => {
        layer.classList.remove('paused');
        startLoop();
    });
    player.addEventListener('pause', () => layer.classList.add('paused'));
    player.addEventListener('waiting', () => layer.classList.add('paused'));
    player.addEventListener('playing', () => {
        layer.classList.remove('paused');
        startLoop();
    });
    player.addEventListener('seeked', resetToCurrentTime);
    player.addEventListener('emptied', () => clearActiveNodes());

    if (IDB_KEY && HAS_PICKER) {
        (async () => {
            try {
                const handle = await idbLoad(IDB_KEY);
                if (!handle) return;
                const perm = await handle.queryPermission({ mode: 'read' });
                if (perm === 'granted') {
                    const file = await handle.getFile();
                    await loadFile(file, handle, true);
                } else if (perm === 'prompt') {
                    const name = LS_NAME_KEY ? (localStorage.getItem(LS_NAME_KEY) || '上次弹幕') : '上次弹幕';
                    showReloadPrompt(name, handle);
                }
            } catch (e) {}
        })();
    }

    function showReloadPrompt(filename, handle) {
        const btn = document.createElement('button');
        btn.id = 'danmaku-reload-prompt';
        btn.textContent = `点击加载上次弹幕: ${filename}`;
        btn.className = 'danmaku-reload-prompt';
        wrapper.appendChild(btn);

        btn.addEventListener('click', async () => {
            btn.remove();
            try {
                const perm = await handle.requestPermission({ mode: 'read' });
                if (perm === 'granted') {
                    const file = await handle.getFile();
                    await loadFile(file, handle, true);
                } else {
                    showToast('弹幕文件访问被拒绝,请手动重新选择');
                    if (IDB_KEY) idbDelete(IDB_KEY).catch(() => {});
                }
            } catch (e) {
                showToast('弹幕文件无法访问,请手动重新选择');
                if (IDB_KEY) idbDelete(IDB_KEY).catch(() => {});
            }
        }, { once: true });

        setTimeout(() => { if (btn.parentNode) btn.remove(); }, 15000);
    }
})();
