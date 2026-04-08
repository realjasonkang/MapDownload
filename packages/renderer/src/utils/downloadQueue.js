/**
 * 下载队列管理器
 * 解决递归调用导致的调用栈累积和内存泄漏问题
 * 实现可控的并发下载
 */
export class DownloadQueue {
  /**
   * 创建下载队列
   * @param {Object} options 配置选项
   * @param {number} options.concurrency 并发数，默认 5
   * @param {Function} options.onProgress 进度回调
   * @param {Function} options.onComplete 完成回调
   * @param {Function} options.onTaskComplete 单个任务完成回调
   */
  constructor(options = {}) {
    this.concurrency = options.concurrency || 5;
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onTaskComplete = options.onTaskComplete || (() => {});

    this.queue = [];
    this.active = 0;
    this.paused = false;
    this.cancelled = false;
    this.statistics = {
      success: 0,
      error: 0,
      total: 0,
      completed: 0,
    };
  }

  /**
   * 添加任务到队列
   * @param {Array} tasks 任务列表
   */
  add(tasks) {
    if (!Array.isArray(tasks)) return;
    this.queue.push(...tasks);
    this.statistics.total += tasks.length;
  }

  /**
   * 开始处理队列
   */
  start() {
    this.cancelled = false;
    this.paused = false;
    this._processNext();
  }

  /**
   * 暂停队列
   */
  pause() {
    this.paused = true;
  }

  /**
   * 恢复队列
   */
  resume() {
    if (this.paused) {
      this.paused = false;
      this._processNext();
    }
  }

  /**
   * 取消队列
   */
  cancel() {
    this.cancelled = true;
    this.queue = [];
    this.active = 0;
  }

  /**
   * 清空队列
   */
  clear() {
    this.queue = [];
    this.statistics = {
      success: 0,
      error: 0,
      total: 0,
      completed: 0,
    };
    this.active = 0;
  }

  /**
   * 获取队列状态
   * @returns {Object} 队列状态
   */
  getStatus() {
    return {
      pending: this.queue.length,
      active: this.active,
      statistics: { ...this.statistics },
      paused: this.paused,
      cancelled: this.cancelled,
    };
  }

  /**
   * 处理下一个任务
   * @private
   */
  async _processNext() {
    if (this.paused || this.cancelled) return;
    if (this.queue.length === 0 && this.active === 0) {
      this.onComplete(this.statistics);
      return;
    }

    while (this.active < this.concurrency && this.queue.length > 0 && !this.paused && !this.cancelled) {
      const task = this.queue.shift();
      this.active++;

      try {
        const result = await task.handler();
        if (result) {
          this.statistics.success++;
        } else {
          this.statistics.error++;
        }
      } catch (error) {
        console.error('任务执行错误:', error);
        this.statistics.error++;
      }

      this.statistics.completed++;
      this.active--;

      this.onProgress({
        ...this.statistics,
        percentage: this.statistics.total > 0 
          ? Number((this.statistics.completed / this.statistics.total * 100).toFixed(2))
          : 0,
      });

      this.onTaskComplete(this.statistics);

      if (!this.paused && !this.cancelled) {
        this._processNext();
      }
    }
  }
}

export default DownloadQueue;
