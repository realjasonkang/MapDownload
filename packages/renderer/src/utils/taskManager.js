/**
 * 任务管理类
 * 实现下载任务的持久化存储和管理
 */
export class TaskManager {
  /**
   * 创建任务管理实例
   * @param {Object} options 配置选项
   * @param {string} options.storageKey 存储键名，默认 'mapdownload_tasks'
   */
  constructor(options = {}) {
    this.storageKey = options.storageKey || 'mapdownload_tasks';
    this.tasks = new Map();
    this._loadFromStorage();
  }

  /**
   * 创建新任务
   * @param {Object} config 任务配置
   * @returns {Object} 创建的任务
   */
  createTask(config) {
    const taskId = this._generateId();
    const task = {
      id: taskId,
      config,
      status: 'pending',
      progress: {
        total: 0,
        completed: 0,
        success: 0,
        error: 0,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      startedAt: null,
      completedAt: null,
    };

    this.tasks.set(taskId, task);
    this._saveToStorage();
    return task;
  }

  /**
   * 获取任务状态
   * @param {string} taskId 任务ID
   * @returns {Object|null} 任务状态
   */
  getTaskStatus(taskId) {
    return this.tasks.get(taskId) || null;
  }

  /**
   * 获取所有任务
   * @returns {Array} 任务列表
   */
  getAllTasks() {
    return Array.from(this.tasks.values());
  }

  /**
   * 更新任务进度
   * @param {string} taskId 任务ID
   * @param {Object} progress 进度信息
   */
  updateProgress(taskId, progress) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.progress = { ...task.progress, ...progress };
      task.updatedAt = Date.now();
      this._saveToStorage();
    }
  }

  /**
   * 开始任务
   * @param {string} taskId 任务ID
   */
  startTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'running';
      task.startedAt = Date.now();
      task.updatedAt = Date.now();
      this._saveToStorage();
    }
  }

  /**
   * 暂停任务
   * @param {string} taskId 任务ID
   */
  pauseTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task && task.status === 'running') {
      task.status = 'paused';
      task.updatedAt = Date.now();
      this._saveToStorage();
    }
  }

  /**
   * 恢复任务
   * @param {string} taskId 任务ID
   */
  resumeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task && task.status === 'paused') {
      task.status = 'running';
      task.updatedAt = Date.now();
      this._saveToStorage();
    }
  }

  /**
   * 取消任务
   * @param {string} taskId 任务ID
   */
  cancelTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task && (task.status === 'running' || task.status === 'paused')) {
      task.status = 'cancelled';
      task.updatedAt = Date.now();
      this._saveToStorage();
    }
  }

  /**
   * 完成任务
   * @param {string} taskId 任务ID
   */
  completeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'completed';
      task.completedAt = Date.now();
      task.updatedAt = Date.now();
      this._saveToStorage();
    }
  }

  /**
   * 删除任务
   * @param {string} taskId 任务ID
   */
  deleteTask(taskId) {
    this.tasks.delete(taskId);
    this._saveToStorage();
  }

  /**
   * 清空所有任务
   */
  clearAllTasks() {
    this.tasks.clear();
    this._saveToStorage();
  }

  /**
   * 保存进度
   * @param {string} taskId 任务ID
   * @param {Object} progress 进度信息
   */
  saveProgress(taskId, progress) {
    this.updateProgress(taskId, progress);
  }

  /**
   * 加载进度
   * @param {string} taskId 任务ID
   * @returns {Object|null} 进度信息
   */
  loadProgress(taskId) {
    const task = this.tasks.get(taskId);
    return task ? task.progress : null;
  }

  /**
   * 生成唯一ID
   * @private
   * @returns {string} 唯一ID
   */
  _generateId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 保存到 localStorage
   * @private
   */
  _saveToStorage() {
    try {
      const data = Array.from(this.tasks.entries());
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (e) {
      console.error('保存任务到 localStorage 失败:', e);
    }
  }

  /**
   * 从 localStorage 加载
   * @private
   */
  _loadFromStorage() {
    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) {
        const entries = JSON.parse(data);
        this.tasks = new Map(entries);
      }
    } catch (e) {
      console.error('从 localStorage 加载任务失败:', e);
      this.tasks = new Map();
    }
  }
}

export default TaskManager;
