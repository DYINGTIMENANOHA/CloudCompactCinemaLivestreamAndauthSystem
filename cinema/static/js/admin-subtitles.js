/* ===================================
   admin 页字幕管理
   给视频库每行插入"上传字幕"按钮，与 admin-covers.js 同样模式
   =================================== */

(function () {
    'use strict';

    const ALLOWED_EXTS = '.srt,.ass,.ssa,.vtt';

    function pickSubtitleFile(onPicked) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = ALLOWED_EXTS;
        input.addEventListener('change', () => {
            const f = input.files && input.files[0];
            if (f) onPicked(f);
        });
        input.click();
    }

    async function uploadSubtitle(videoId, file) {
        const fd = new FormData();
        fd.append('file', file, file.name);
        try {
            const res = await fetch(
                `/cinema/api/video/${encodeURIComponent(videoId)}/subtitle`,
                { method: 'POST', body: fd, credentials: 'same-origin' }
            );
            if (res.ok) {
                alert('字幕上传成功');
            } else {
                const data = await res.json().catch(() => ({}));
                alert('上传失败: ' + (data.error || res.status));
            }
        } catch (e) {
            alert('网络错误: ' + e);
        }
    }

    // 给视频库每行插入"上传字幕"按钮
    function attachSubtitleButtons() {
        const rows = document.querySelectorAll('.video-row');
        rows.forEach(row => {
            if (row.querySelector('.subtitle-upload-btn')) return;  // 已插入
            const deleteBtn = row.querySelector('.delete-btn');
            if (!deleteBtn) return;
            const videoId = deleteBtn.dataset.id;
            if (!videoId) return;

            const btn = document.createElement('button');
            btn.className = 'subtitle-upload-btn';
            btn.textContent = '上传字幕';
            btn.type = 'button';
            btn.addEventListener('click', () => {
                pickSubtitleFile((file) => uploadSubtitle(videoId, file));
            });

            // 插在封面按钮之前（如果有），否则插在删除按钮之前
            const coverBtn = row.querySelector('.cover-btn');
            if (coverBtn) {
                row.insertBefore(btn, coverBtn);
            } else {
                deleteBtn.parentNode.insertBefore(btn, deleteBtn);
            }
        });
    }

    window.CinemaSubtitles = {
        attachSubtitleButtons: attachSubtitleButtons,
    };
})();
