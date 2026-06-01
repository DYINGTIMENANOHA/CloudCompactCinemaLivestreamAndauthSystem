/* ===================================
   admin 页封面管理业务逻辑
   - 给视频库每行插入"上传封面"按钮
   - 默认封面上传
   - 调用 CinemaCropper 裁剪
   =================================== */

(function () {
    'use strict';

    const COVER_OPTS = {
        aspectRatio: 16 / 9,
        outputWidth: 1280,
        outputHeight: 720,
        quality: 0.85,
        maxSizeBytes: 1024 * 1024,  // 1 MB
    };

    function pickImage(onPicked) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', () => {
            const f = input.files && input.files[0];
            if (f) onPicked(f);
        });
        input.click();
    }

    function uploadBlob(url, blob, filename) {
        const fd = new FormData();
        fd.append('file', blob, filename || 'cover.jpg');
        return fetch(url, {
            method: 'POST',
            body: fd,
            credentials: 'same-origin',
        });
    }

    async function uploadVideoCover(videoId, blob) {
        try {
            const res = await uploadBlob(
                `/cinema/api/video/${encodeURIComponent(videoId)}/cover`,
                blob,
                `${videoId}.jpg`
            );
            if (res.ok) {
                alert('封面上传成功');
                // 通知 admin.js 重新加载视频列表
                if (window.CinemaAdmin && window.CinemaAdmin.reloadVideos) {
                    window.CinemaAdmin.reloadVideos();
                }
            } else {
                const data = await res.json().catch(() => ({}));
                alert('上传失败: ' + (data.error || res.status));
            }
        } catch (e) {
            alert('网络错误: ' + e);
        }
    }

    async function uploadDefaultCover(blob) {
        try {
            const res = await uploadBlob('/cinema/api/default_cover', blob, 'default_cover.jpg');
            if (res.ok) {
                alert('默认封面已更新');
            } else {
                const data = await res.json().catch(() => ({}));
                alert('上传失败: ' + (data.error || res.status));
            }
        } catch (e) {
            alert('网络错误: ' + e);
        }
    }

    async function uploadBgImage(name, blob) {
        try {
            const res = await uploadBlob(`/cinema/api/bg/${name}`, blob, `bg_${name}.jpg`);
            if (res.ok) {
                alert(`${name} 背景已更新`);
            } else {
                const data = await res.json().catch(() => ({}));
                alert('上传失败: ' + (data.error || res.status));
            }
        } catch (e) {
            alert('网络错误: ' + e);
        }
    }

    // 给视频库的每行插入"上传封面"按钮
    function attachCoverButtons() {
        const rows = document.querySelectorAll('.video-row');
        rows.forEach(row => {
            if (row.querySelector('.cover-btn')) return;  // 已经插过
            const deleteBtn = row.querySelector('.delete-btn');
            if (!deleteBtn) return;
            const videoId = deleteBtn.dataset.id;
            if (!videoId) return;

            const btn = document.createElement('button');
            btn.className = 'cover-btn';
            btn.textContent = '上传封面';
            btn.type = 'button';
            btn.addEventListener('click', () => {
                pickImage((file) => {
                    window.CinemaCropper.open({
                        file: file,
                        title: '裁剪视频封面',
                        ...COVER_OPTS,
                        onConfirm: (blob) => uploadVideoCover(videoId, blob),
                    });
                });
            });

            deleteBtn.parentNode.insertBefore(btn, deleteBtn);
        });
    }

    // 默认封面上传按钮
    function initDefaultCoverBtn() {
        const btn = document.getElementById('default-cover-btn');
        if (!btn) return;
        btn.addEventListener('click', () => {
            pickImage((file) => {
                window.CinemaCropper.open({
                    file: file,
                    title: '裁剪默认封面',
                    ...COVER_OPTS,
                    onConfirm: (blob) => uploadDefaultCover(blob),
                });
            });
        });
    }

    // 背景图上传按钮(library / watch)
    function initBgBtns() {
        document.querySelectorAll('.bg-upload-btn').forEach(btn => {
            const name = btn.dataset.name;
            if (!name) return;
            btn.addEventListener('click', () => {
                pickImage((file) => {
                    window.CinemaCropper.open({
                        file: file,
                        title: `裁剪 ${name} 背景`,
                        aspectRatio: null,        // 自由比例
                        outputWidth: null,         // 保持裁剪后原始尺寸
                        outputHeight: null,
                        quality: 0.95,             // 高质量
                        maxSizeBytes: null,        // 不强制压缩
                        onConfirm: (blob) => uploadBgImage(name, blob),
                    });
                });
            });
        });
    }

    // 暴露 API 给 admin.js
    window.CinemaCovers = {
        attachCoverButtons: attachCoverButtons,
    };

    // 初始化默认封面和背景图按钮
    document.addEventListener('DOMContentLoaded', () => {
        initDefaultCoverBtn();
        initBgBtns();
    });

    // DOMContentLoaded 可能已经过了,直接跑一次
    if (document.readyState !== 'loading') {
        initDefaultCoverBtn();
        initBgBtns();
    }
})();
