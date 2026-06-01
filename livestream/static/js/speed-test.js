/**
 * 网速测试模块 - 30秒稳定性测试
 * 🆕 所有速度显示统一为 MB/s
 */

class SpeedTester {
    constructor() {
        this.stabilityData = [];
        this.isRunning = false;
    }

    /**
     * 执行30秒稳定性测试
     * @returns {Promise<number>} 平均速度(Mbps) - 内部仍用Mbps，但显示时转换
     */
    async runTest(progressCallback, speedCallback) {
        if (this.isRunning) {
            throw new Error('测速正在进行中');
        }

        this.isRunning = true;
        this.stabilityData = [];

        const duration = 30;
        const startTime = Date.now();

        try {
            while ((Date.now() - startTime) < duration * 1000) {
                try {
                    const speed = await this._testDownloadChunk();
                    this.stabilityData.push(speed);

                    const elapsed = (Date.now() - startTime) / 1000;
                    const progress = (elapsed / duration) * 100;

                    if (progressCallback) {
                        progressCallback(Math.min(progress, 100));
                    }

                    if (speedCallback) {
                        speedCallback(speed);
                    }
                } catch (chunkError) {
                    console.warn('单次测速失败，继续:', chunkError.message);
                    // 不中断整个测试，继续下一次
                }
            }

            if (this.stabilityData.length === 0) {
                throw new Error('测速失败：无有效数据');
            }

            const avgSpeed = this.stabilityData.reduce((a, b) => a + b, 0) / this.stabilityData.length;

            this.isRunning = false;
            return avgSpeed;

        } catch (error) {
            this.isRunning = false;
            throw error;
        }
    }

    async _testDownloadChunk() {
        const startTime = performance.now();
        
        // ✅ 增加10秒超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        try {
            const response = await fetch('/api/speed-test/download?size=2', {
                signal: controller.signal
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const reader = response.body.getReader();
            let totalBytes = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                totalBytes += value.length;
            }

            clearTimeout(timeoutId);

            const elapsed = (performance.now() - startTime) / 1000;
            
            if (elapsed === 0 || totalBytes === 0) {
                throw new Error('无效的测速数据');
            }
            
            const speedMbps = (totalBytes * 8 / 1000000) / elapsed;

            return speedMbps;
            
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('下载超时');
            }
            throw error;
        }
    }

    cancel() {
        this.isRunning = false;
    }
}

window.SpeedTester = SpeedTester;
