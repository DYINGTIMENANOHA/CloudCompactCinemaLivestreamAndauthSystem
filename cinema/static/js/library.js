/* ===================================
   视频列表页
   封面优先级: video.cover_url > 默认封面 > emoji
   =================================== */

(function () {
    'use strict';

    const grid = document.getElementById('video-grid');
    const refreshBtn = document.getElementById('refresh-btn');

    // 检测默认封面是否存在(只探测一次,给没有专属封面的视频用)
    let hasDefaultCover = false;
    const defaultCoverUrl = '/cinema/static/img/default_cover.jpg';
    const defaultProbe = new Image();
    defaultProbe.onload = () => {
        hasDefaultCover = true;
        // 已渲染的空 thumbnail 补上默认封面
        document.querySelectorAll('.video-card .thumbnail.no-cover').forEach(el => {
            el.style.backgroundImage = `url('${defaultCoverUrl}')`;
            el.classList.add('has-cover');
            el.classList.remove('no-cover');
            el.textContent = '';
        });
    };
    defaultProbe.src = defaultCoverUrl;

    // 检测背景图是否存在
    const bgProbe = new Image();
    bgProbe.onload = () => {
        document.body.classList.add('has-bg-library');
    };
    bgProbe.src = '/cinema/static/img/bg_library.jpg';

    function formatDuration(seconds) {
        if (!seconds || seconds < 0) return '--:--';
        const total = Math.floor(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) {
            return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function renderVideos(videos) {
        if (!videos || videos.length === 0) {
            grid.innerHTML = '<div class="empty">视频库还是空的,等待管理员上传</div>';
            return;
        }
        grid.innerHTML = videos.map(v => {
            let thumbHtml;
            if (v.cover_url) {
                // 专属封面
                thumbHtml = `<div class="thumbnail has-cover" style="background-image:url('${v.cover_url}')"></div>`;
            } else if (hasDefaultCover) {
                // 默认封面
                thumbHtml = `<div class="thumbnail has-cover" style="background-image:url('${defaultCoverUrl}')"></div>`;
            } else {
                // emoji 占位
                thumbHtml = `<div class="thumbnail no-cover">🎬</div>`;
            }
            return `
                <div class="video-card" data-id="${escapeHtml(v.id)}">
                    ${thumbHtml}
                    <div class="info">
                        <div class="title">${escapeHtml(v.display_name)}</div>
                        <div class="duration">${formatDuration(v.duration_seconds)}</div>
                    </div>
                </div>
            `;
        }).join('');

        grid.querySelectorAll('.video-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.id;
                window.location.href = '/cinema/watch?v=' + encodeURIComponent(id);
            });
        });
    }

    async function loadVideos() {
        grid.innerHTML = '<div class="loading">加载中...</div>';
        try {
            const res = await fetch('/cinema/api/videos', {
                credentials: 'same-origin',
            });
            if (!res.ok) {
                grid.innerHTML = '<div class="empty">加载失败,请刷新重试</div>';
                return;
            }
            const data = await res.json();
            renderVideos(data.videos || []);
        } catch (e) {
            console.error(e);
            grid.innerHTML = '<div class="empty">网络错误</div>';
        }
    }

    refreshBtn.addEventListener('click', loadVideos);
    loadVideos();
})();
