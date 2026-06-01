/* ===================================
   封面裁剪 UI 组件(独立,可复用)

   使用:
   window.CinemaCropper.open({
       file: File,                  // 用户选择的图片
       aspectRatio: 16/9 或 null,   // null = 自由比例
       outputWidth: 1280,            // 导出宽度(null = 保持原始尺寸)
       outputHeight: 720,
       quality: 0.85,                // 起始 jpg 质量
       maxSizeBytes: 1024*1024,      // 目标文件大小(质量会自动调低直到符合)
       title: "裁剪封面",
       onConfirm: function(blob) { ... },
       onCancel: function() { ... }
   });

   交互:
   - 鼠标拖动移动图片
   - 滚轮缩放图片
   - 确定 / 取消按钮
   =================================== */

(function () {
    'use strict';

    let currentDialog = null;

    function open(opts) {
        close();  // 关闭上一个(如有)

        const aspectRatio = opts.aspectRatio || null;  // null = 自由
        const outputWidth = opts.outputWidth || null;
        const outputHeight = opts.outputHeight || null;
        const qualityStart = opts.quality || 0.85;
        const maxSizeBytes = opts.maxSizeBytes || null;
        const title = opts.title || '裁剪图片';

        // 读图片
        const img = new Image();
        const reader = new FileReader();
        reader.onload = (e) => {
            img.onload = () => buildDialog(img, opts, aspectRatio, outputWidth, outputHeight, qualityStart, maxSizeBytes, title);
            img.onerror = () => {
                alert('图片加载失败,请换一张');
                if (opts.onCancel) opts.onCancel();
            };
            img.src = e.target.result;
        };
        reader.onerror = () => {
            alert('图片读取失败');
            if (opts.onCancel) opts.onCancel();
        };
        reader.readAsDataURL(opts.file);
    }

    function buildDialog(img, opts, aspectRatio, outputWidth, outputHeight, qualityStart, maxSizeBytes, title) {
        // 创建对话框 DOM
        const overlay = document.createElement('div');
        overlay.className = 'cropper-overlay';
        overlay.innerHTML = `
            <div class="cropper-dialog">
                <div class="cropper-header">
                    <h3>${escapeHtml(title)}</h3>
                    <button class="cropper-close" type="button" title="关闭">✕</button>
                </div>
                <div class="cropper-body">
                    <div class="cropper-canvas-wrap">
                        <canvas class="cropper-canvas"></canvas>
                    </div>
                    <div class="cropper-hint">拖动图片定位 · 滚轮缩放</div>
                </div>
                <div class="cropper-footer">
                    <button class="cropper-btn cropper-cancel" type="button">取消</button>
                    <button class="cropper-btn cropper-confirm primary" type="button">确定</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        currentDialog = overlay;

        const canvas = overlay.querySelector('.cropper-canvas');
        const ctx = canvas.getContext('2d');

        // 画布显示尺寸(CSS 像素)
        const DISPLAY_W = 640;
        const cropAR = aspectRatio || (img.width / img.height);
        const DISPLAY_H = Math.round(DISPLAY_W / cropAR);
        canvas.width = DISPLAY_W;
        canvas.height = DISPLAY_H;
        canvas.style.width = DISPLAY_W + 'px';
        canvas.style.height = DISPLAY_H + 'px';

        // 图片在画布上的状态
        // scale: 图片显示宽度 / 原始宽度
        // 初始缩放: 让图片至少覆盖画布
        const scaleToFitW = DISPLAY_W / img.width;
        const scaleToFitH = DISPLAY_H / img.height;
        let scale = Math.max(scaleToFitW, scaleToFitH);
        let offsetX = (DISPLAY_W - img.width * scale) / 2;
        let offsetY = (DISPLAY_H - img.height * scale) / 2;

        const MIN_SCALE = Math.max(scaleToFitW, scaleToFitH) * 0.5;
        const MAX_SCALE = 8;

        function clampOffset() {
            const imgW = img.width * scale;
            const imgH = img.height * scale;
            // 允许留白:不再强制 cover 画布
            offsetX = Math.max(DISPLAY_W - imgW, Math.min(0, offsetX));
            offsetY = Math.max(DISPLAY_H - imgH, Math.min(0, offsetY));
            // 如果图比画布小,居中
            if (imgW < DISPLAY_W) offsetX = (DISPLAY_W - imgW) / 2;
            if (imgH < DISPLAY_H) offsetY = (DISPLAY_H - imgH) / 2;
        }

        function draw() {
            clampOffset();
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, DISPLAY_W, DISPLAY_H);
            ctx.drawImage(img, offsetX, offsetY, img.width * scale, img.height * scale);
        }

        draw();

        // 拖动
        let dragging = false;
        let lastX = 0, lastY = 0;
        canvas.addEventListener('mousedown', (e) => {
            dragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
            canvas.style.cursor = 'grabbing';
        });
        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            offsetX += e.clientX - lastX;
            offsetY += e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;
            draw();
        });
        window.addEventListener('mouseup', () => {
            dragging = false;
            canvas.style.cursor = 'grab';
        });
        canvas.style.cursor = 'grab';

        // 滚轮缩放(以鼠标位置为中心)
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));
            // 让鼠标位置下的图片像素保持不动
            const imgPxX = (mx - offsetX) / scale;
            const imgPxY = (my - offsetY) / scale;
            scale = newScale;
            offsetX = mx - imgPxX * scale;
            offsetY = my - imgPxY * scale;
            draw();
        }, { passive: false });

        // 关闭 / 取消
        function doCancel() {
            close();
            if (opts.onCancel) opts.onCancel();
        }
        overlay.querySelector('.cropper-close').addEventListener('click', doCancel);
        overlay.querySelector('.cropper-cancel').addEventListener('click', doCancel);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) doCancel();
        });

        // 确定: 把当前画布内容导出成 blob
        overlay.querySelector('.cropper-confirm').addEventListener('click', async () => {
            try {
                // 生成输出 canvas
                const outW = outputWidth || DISPLAY_W;
                const outH = outputHeight || DISPLAY_H;
                const outCanvas = document.createElement('canvas');
                outCanvas.width = outW;
                outCanvas.height = outH;
                const outCtx = outCanvas.getContext('2d');
                outCtx.fillStyle = '#000';
                outCtx.fillRect(0, 0, outW, outH);
                // 把显示画布按比例缩放到输出尺寸
                outCtx.drawImage(canvas, 0, 0, DISPLAY_W, DISPLAY_H, 0, 0, outW, outH);

                // 导出,按需降质量
                let quality = qualityStart;
                let blob = await canvasToBlob(outCanvas, quality);
                if (maxSizeBytes) {
                    while (blob.size > maxSizeBytes && quality > 0.4) {
                        quality -= 0.1;
                        blob = await canvasToBlob(outCanvas, quality);
                    }
                }

                close();
                if (opts.onConfirm) opts.onConfirm(blob);
            } catch (e) {
                console.error(e);
                alert('导出图片失败: ' + e.message);
            }
        });
    }

    function canvasToBlob(canvas, quality) {
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('toBlob 返回空'));
            }, 'image/jpeg', quality);
        });
    }

    function close() {
        if (currentDialog) {
            currentDialog.remove();
            currentDialog = null;
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    window.CinemaCropper = { open, close };
})();
