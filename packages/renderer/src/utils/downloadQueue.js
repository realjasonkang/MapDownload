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
   * @param {Function} options.onTaskFailed 单个任务失败回调
   */
  constructor(options = {}) {
    this.concurrency = options.concurrency || 5;
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onTaskComplete = options.onTaskComplete || (() => {});
    this.onTaskFailed = options.onTaskFailed || (() => {});

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
   * 若队列已启动且未暂停/取消，会继续处理新增任务
   * @param {Array} tasks 任务列表
   */
  add(tasks) {
    if (!Array.isArray(tasks)) return;
    this.queue.push(...tasks);
    this.statistics.total += tasks.length;
    if (this._started && !this.paused && !this.cancelled) {
      this._processNext();
    }
  }

  /**
   * 开始处理队列
   */
  start() {
    this.cancelled = false;
    this.paused = false;
    this._started = true;
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
   * 清空队列，但允许活跃任务继续完成
   * 所有活跃任务完成后触发 onComplete
   */
  cancel() {
    this.cancelled = true;
    this.queue = [];
    if (this.active === 0) {
      this.onComplete({
        ...this.statistics,
        cancelled: this.cancelled,
      });
    }
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
    if (this.paused) {
      return;
    }

    if (this.cancelled) {
      if (this.queue.length === 0 && this.active === 0) {
        this.onComplete({
          ...this.statistics,
          cancelled: this.cancelled,
        });
      }
      return;
    }

    if (this.queue.length === 0 && this.active === 0) {
      this.onComplete({
        ...this.statistics,
        cancelled: this.cancelled,
      });
      return;
    }

    // 启动并发任务，直到达到并发上限或队列为空
    while (this.active < this.concurrency && this.queue.length > 0 && !this.paused && !this.cancelled) {
      const task = this.queue.shift();
      this.active++;

      // 异步执行任务，但不等待完成，让它在后台运行
      this._executeTask(task);
    }
  }

  /**
   * 执行单个任务
   * @param {Object} task 任务对象
   * @private
   */
  async _executeTask(task) {
    try {
      const result = await task.handler();
      if (result) {
        this.statistics.success++;
      } else {
        this.statistics.error++;
        if (task.tileData && this.onTaskFailed) {
          this.onTaskFailed(task.tileData);
        }
      }
    } catch (error) {
      console.error('任务执行错误:', error);
      this.statistics.error++;
      if (task.tileData && this.onTaskFailed) {
        this.onTaskFailed(task.tileData);
      }
    } finally {
      // 修复内存泄漏：显式清理任务引用，帮助 GC 回收大对象
      // task.handler 是异步函数闭包，可能持有 tileData、downloadOption 等大对象
      task.handler = null;
      task.tileData = null;
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

    // 检查是否完成
    if (this.cancelled && this.queue.length === 0 && this.active === 0) {
      this.onComplete({
        ...this.statistics,
        cancelled: this.cancelled,
      });
      return;
    }

    // 处理队列中的下一个任务
    if (!this.paused && !this.cancelled) {
      this._processNext();
    }
  }
}

export default DownloadQueue;
