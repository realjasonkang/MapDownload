/**
 * 内存监控类
 * 实时监控内存使用，自动触发清理
 */
export class MemoryMonitor {
  /**
   * 创建内存监控实例
   * @param {Object} options 配置选项
   * @param {number} options.warningThreshold 警告阈值，默认 0.7 (70%)
   * @param {number} options.criticalThreshold 危险阈值，默认 0.9 (90%)
   * @param {number} options.interval 检查间隔，默认 10000ms (10秒)
   * @param {Function} options.onWarning 警告回调
   * @param {Function} options.onCritical 危险回调
   * @param {Function} options.onCleanup 清理回调
   */
  constructor(options = {}) {
    this.warningThreshold = options.warningThreshold || 0.7;
    this.criticalThreshold = options.criticalThreshold || 0.9;
    this.interval = options.interval || 10000;
    this.onWarning = options.onWarning || (() => {});
    this.onCritical = options.onCritical || (() => {});
    this.onCleanup = options.onCleanup || (() => {});

    this.timer = null;
    this.isRunning = false;
    this.memoryHistory = [];
    this.maxHistoryLength = 60;
  }

  /**
   * 开始监控
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this._check();
    this.timer = setInterval(() => this._check(), this.interval);
  }

  /**
   * 停止监控
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  /**
   * 获取当前内存使用情况
   * @returns {Object|null} 内存使用信息
   */
  getMemoryUsage() {
    if (performance && performance.memory) {
      const memory = performance.memory;
      return {
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit,
        usageRatio: memory.usedJSHeapSize / memory.jsHeapSizeLimit,
        timestamp: Date.now(),
      };
    }
    return null;
  }

  /**
   * 获取内存使用报告
   * @returns {Object} 内存使用报告
   */
  getReport() {
    const current = this.getMemoryUsage();
    return {
      current,
      history: [...this.memoryHistory],
      isRunning: this.isRunning,
      warningThreshold: this.warningThreshold,
      criticalThreshold: this.criticalThreshold,
    };
  }

  /**
   * 清空历史记录
   */
  clearHistory() {
    this.memoryHistory = [];
  }

  /**
   * 检查内存使用
   * @private
   */
  _check() {
    const usage = this.getMemoryUsage();
    if (!usage) return;

    this.memoryHistory.push(usage);
    if (this.memoryHistory.length > this.maxHistoryLength) {
      this.memoryHistory.shift();
    }

    if (usage.usageRatio >= this.criticalThreshold) {
      this.onCritical(usage);
      this._forceCleanup();
    } else if (usage.usageRatio >= this.warningThreshold) {
      this.onWarning(usage);
    }
  }

  /**
   * 强制清理内存
   * @private
   */
  _forceCleanup() {
    this.onCleanup();

    if (typeof globalThis !== 'undefined' && globalThis.gc) {
      try {
        globalThis.gc();
      } catch (e) {
        console.warn('手动 GC 不可用');
      }
    }
  }
}

export default MemoryMonitor;
