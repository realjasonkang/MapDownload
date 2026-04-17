/**
 * 基于 Worker Threads 的多线程下载模块
 * 实现工作线程池管理、任务分发、负载均衡和错误处理
 *
 * @module downloadWorker
 * @author MapDownload Team
 */

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const fse = require('fs-extra');
const sharp = require('sharp');
const superagent = require('superagent');
const { cpus } = require('os');

/**
 * 默认配置常量
 */
const DEFAULT_CONFIG = {
  // 工作线程数量，默认为 CPU 核心数
  workerCount: Math.min(cpus().length, 8),
  // 每个线程的最大并发任务数
  maxConcurrentPerWorker: 3,
  // 任务超时时间（毫秒）
  taskTimeout: 30000,
  // 最大重试次数
  maxRetries: 3,
  // 重试延迟（毫秒）
  retryDelay: 1000,
  // 线程重启延迟（毫秒）
  workerRestartDelay: 1000,
  // 最大线程重启次数
  maxWorkerRestarts: 5,
};

/**
 * 任务状态枚举
 * @enum {string}
 */
const TaskStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
  CANCELLED: 'cancelled',
};

/**
 * 任务类型枚举
 * @enum {string}
 */
const TaskType = {
  DOWNLOAD: 'download',
  DOWNLOAD_WITH_MASK: 'download_with_mask',
  MERGE: 'merge',
};

/**
 * 工作线程消息类型
 * @enum {string}
 */
const MessageType = {
  // 主线程 -> 工作线程
  TASK_ASSIGN: 'task_assign',
  TASK_CANCEL: 'task_cancel',
  SHUTDOWN: 'shutdown',
  CONFIG_UPDATE: 'config_update',

  // 工作线程 -> 主线程
  TASK_COMPLETE: 'task_complete',
  TASK_ERROR: 'task_error',
  TASK_PROGRESS: 'task_progress',
  WORKER_READY: 'worker_ready',
  WORKER_ERROR: 'worker_error',
};

/**
 * 获取请求头
 * @returns {Object} 请求头配置
 */
function getHeader() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  };
}

// ==================== 工作线程逻辑 ====================

/**
 * 工作线程入口函数
 * 仅在工作线程中执行
 */
if (!isMainThread) {
  runWorker();
}

/**
 * 运行工作线程
 */
function runWorker() {
  const workerId = workerData?.workerId || 0;

  // 通知主线程工作线程已就绪
  parentPort.postMessage({
    type: MessageType.WORKER_READY,
    workerId,
  });

  // 监听主线程消息
  parentPort.on('message', async (message) => {
    const { type, taskId, data } = message;

    switch (type) {
      case MessageType.TASK_ASSIGN:
        try {
          const result = await executeTask(data, taskId, workerId);
          parentPort.postMessage({
            type: MessageType.TASK_COMPLETE,
            taskId,
            workerId,
            result,
          });
        } catch (error) {
          parentPort.postMessage({
            type: MessageType.TASK_ERROR,
            taskId,
            workerId,
            error: {
              message: error.message,
              stack: error.stack,
            },
          });
        }
        break;

      case MessageType.SHUTDOWN:
        process.exit(0);
        break;

      case MessageType.CONFIG_UPDATE:
        // 处理配置更新
        break;

      default:
        console.warn(`[Worker ${workerId}] Unknown message type: ${type}`);
    }
  });

  // 处理未捕获的异常
  process.on('uncaughtException', (error) => {
    parentPort.postMessage({
      type: MessageType.WORKER_ERROR,
      workerId,
      error: {
        message: error.message,
        stack: error.stack,
      },
    });
  });

  process.on('unhandledRejection', (reason) => {
    parentPort.postMessage({
      type: MessageType.WORKER_ERROR,
      workerId,
      error: {
        message: String(reason),
      },
    });
  });
}

/**
 * 执行下载任务
 * @param {Object} data 任务数据
 * @param {string} taskId 任务ID
 * @param {number} workerId 工作线程ID
 * @returns {Promise<Object>} 执行结果
 */
async function executeTask(data, taskId, workerId) {
  const { type, url, savePath, imageBuffer, layers, timeout = 30000 } = data;

  // 确保目录存在
  const dir = path.dirname(savePath);
  await fse.ensureDir(dir);

  switch (type) {
    case TaskType.DOWNLOAD:
      return downloadImage(url, savePath, timeout, workerId);

    case TaskType.DOWNLOAD_WITH_MASK:
      return downloadImageWithMask(url, savePath, imageBuffer, timeout, workerId);

    case TaskType.MERGE:
      return downloadAndMergeImages(layers, savePath, imageBuffer, timeout, workerId);

    default:
      throw new Error(`Unknown task type: ${type}`);
  }
}

/**
 * 下载图片
 * @param {string} url 图片URL
 * @param {string} savePath 保存路径
 * @param {number} timeout 超时时间
 * @returns {Promise<Object>} 下载结果
 */
async function downloadImage(url, savePath, timeout) {
  const normalizedPath = path.normalize(savePath);
  const sharpStream = sharp({
    failOnError: false,
  });

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Download timeout for ${url}`));
    }, timeout);

    const req = superagent.get(url).set(getHeader());
    const stream = req.pipe(sharpStream);

    stream.on('finish', () => {
      clearTimeout(timeoutId);
      sharpStream
        .toFile(normalizedPath)
        .then(() => {
          resolve({ success: true, path: normalizedPath });
        })
        .catch((err) => {
          cleanupFile(normalizedPath);
          reject(err);
        });
    });

    stream.on('error', (err) => {
      clearTimeout(timeoutId);
      req.abort();
      cleanupFile(normalizedPath);
      reject(err);
    });

    req.on('error', (err) => {
      clearTimeout(timeoutId);
      cleanupFile(normalizedPath);
      reject(err);
    });
  });
}

/**
 * 下载图片并应用遮罩
 * @param {string} url 图片URL
 * @param {string} savePath 保存路径
 * @param {string} imageBuffer Base64 编码的遮罩图片
 * @param {number} timeout 超时时间
 * @returns {Promise<Object>} 下载结果
 */
async function downloadImageWithMask(url, savePath, imageBuffer, timeout) {
  const normalizedPath = path.normalize(savePath);
  const sharpStream = sharp({
    failOnError: false,
  });

  // 解析 Base64 遮罩图片
  const base64Data = imageBuffer.replace(/^data:image\/\w+;base64,/, '');
  const maskBuffer = Buffer.from(base64Data, 'base64');

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Download timeout for ${url}`));
    }, timeout);

    const req = superagent.get(url).set(getHeader());
    const stream = req.pipe(sharpStream);

    stream.on('finish', () => {
      clearTimeout(timeoutId);
      sharpStream
        .composite([{ input: maskBuffer, gravity: 'centre', blend: 'dest-in' }])
        .toFile(normalizedPath)
        .then(() => {
          resolve({ success: true, path: normalizedPath });
        })
        .catch((err) => {
          cleanupFile(normalizedPath);
          reject(err);
        });
    });

    stream.on('error', (err) => {
      clearTimeout(timeoutId);
      req.abort();
      cleanupFile(normalizedPath);
      reject(err);
    });

    req.on('error', (err) => {
      clearTimeout(timeoutId);
      cleanupFile(normalizedPath);
      reject(err);
    });
  });
}

/**
 * 下载并合并多图层图片
 * @param {Array} layers 图层配置数组
 * @param {string} savePath 保存路径
 * @param {string} imageBuffer Base64 编码的遮罩图片（可选）
 * @param {number} timeout 超时时间
 * @returns {Promise<Object>} 下载结果
 */
async function downloadAndMergeImages(layers, savePath, imageBuffer, timeout) {
  const normalizedPath = path.normalize(savePath);
  const imgBuffers = [];
  let imgBack = null;

  try {
    // 下载所有图层
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const buffer = await downloadImageToBuffer(layer.url, timeout);

      if (layer.isLabel) {
        imgBack = buffer;
      } else {
        imgBuffers.push(buffer);
      }
    }

    if (!imgBack) {
      throw new Error('No background layer found');
    }

    // 合并图层
    let operation = sharp(imgBack).composite(
      imgBuffers.map((input) => ({
        input,
        gravity: 'centre',
        blend: 'saturate',
      })),
    );

    // 应用遮罩（如果有）
    if (imageBuffer) {
      const base64Data = imageBuffer.replace(/^data:image\/\w+;base64,/, '');
      const maskBuffer = Buffer.from(base64Data, 'base64');
      operation = operation.composite([{ input: maskBuffer, gravity: 'centre', blend: 'dest-in' }]);
    }

    await operation.toFile(normalizedPath);
    return { success: true, path: normalizedPath };
  } catch (error) {
    cleanupFile(normalizedPath);
    throw error;
  }
}

/**
 * 下载图片到 Buffer
 * @param {string} url 图片URL
 * @param {number} timeout 超时时间
 * @returns {Promise<Buffer>} 图片 Buffer
 */
async function downloadImageToBuffer(url, timeout) {
  const sharpStream = sharp({
    failOnError: false,
  });

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Download timeout for ${url}`));
    }, timeout);

    const req = superagent.get(url).set(getHeader());
    const stream = req.pipe(sharpStream);

    stream.on('finish', () => {
      clearTimeout(timeoutId);
      sharpStream.toBuffer().then(resolve).catch(reject);
    });

    stream.on('error', (err) => {
      clearTimeout(timeoutId);
      req.abort();
      reject(err);
    });

    req.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

/**
 * 清理文件
 * @param {string} filePath 文件路径
 */
function cleanupFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // 忽略清理错误
  }
}

// ==================== 主线程逻辑 ====================

/**
 * 下载工作线程管理器
 * 管理工作线程池，负责任务分发和负载均衡
 */
class DownloadWorker {
  /**
   * 创建下载工作线程管理器
   * @param {Object} options 配置选项
   * @param {number} options.workerCount 工作线程数量
   * @param {number} options.maxConcurrentPerWorker 每个线程最大并发数
   * @param {number} options.taskTimeout 任务超时时间
   * @param {number} options.maxRetries 最大重试次数
   */
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.workers = new Map();
    this.taskQueue = [];
    this.pendingTasks = new Map();
    this.taskIdCounter = 0;
    this.isShuttingDown = false;
    this.workerRestartCount = new Map();

    // 统计信息
    this.statistics = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      retriedTasks: 0,
    };

    // 回调函数
    this.onTaskComplete = null;
    this.onTaskError = null;
    this.onProgress = null;
  }

  /**
   * 初始化工作线程池
   * @returns {Promise<void>}
   */
  async initialize() {
    const initPromises = [];
    for (let i = 0; i < this.config.workerCount; i++) {
      initPromises.push(this.createWorker(i));
    }
    await Promise.all(initPromises);
    console.log(`[DownloadWorker] Initialized ${this.workers.size} workers`);
  }

  /**
   * 创建工作线程
   * @param {number} workerId 工作线程ID
   * @returns {Promise<void>}
   */
  async createWorker(workerId) {
    return new Promise((resolve, reject) => {
      const workerPath = __filename;
      const worker = new Worker(workerPath, {
        workerData: { workerId },
      });

      const workerInfo = {
        worker,
        id: workerId,
        busy: false,
        currentTasks: new Set(),
        completedTasks: 0,
        failedTasks: 0,
      };

      // 设置消息监听
      worker.on('message', (message) => {
        this.handleWorkerMessage(workerInfo, message);
      });

      // 设置错误监听
      worker.on('error', (error) => {
        console.error(`[Worker ${workerId}] Error:`, error);
        this.handleWorkerError(workerInfo, error);
      });

      // 设置退出监听
      worker.on('exit', (code) => {
        if (code !== 0 && !this.isShuttingDown) {
          console.warn(`[Worker ${workerId}] Exited with code ${code}`);
          this.handleWorkerExit(workerInfo);
        }
      });

      // 等待工作线程就绪
      const readyTimeout = setTimeout(() => {
        reject(new Error(`Worker ${workerId} failed to initialize`));
      }, 5000);

      const readyHandler = (message) => {
        if (message.type === MessageType.WORKER_READY && message.workerId === workerId) {
          clearTimeout(readyTimeout);
          worker.off('message', readyHandler);
          this.workers.set(workerId, workerInfo);
          resolve();
        }
      };

      worker.on('message', readyHandler);
    });
  }

  /**
   * 处理工作线程消息
   * @param {Object} workerInfo 工作线程信息
   * @param {Object} message 消息对象
   */
  handleWorkerMessage(workerInfo, message) {
    const { type, taskId, result, error } = message;

    switch (type) {
      case MessageType.TASK_COMPLETE:
        this.handleTaskComplete(workerInfo, taskId, result);
        break;

      case MessageType.TASK_ERROR:
        this.handleTaskError(workerInfo, taskId, error);
        break;

      case MessageType.WORKER_ERROR:
        console.error(`[Worker ${workerInfo.id}] Worker error:`, error);
        break;

      default:
        console.warn(`[DownloadWorker] Unknown message type: ${type}`);
    }
  }

  /**
   * 处理任务完成
   * @param {Object} workerInfo 工作线程信息
   * @param {string} taskId 任务ID
   * @param {Object} result 任务结果
   */
  handleTaskComplete(workerInfo, taskId, result) {
    const taskInfo = this.pendingTasks.get(taskId);
    if (!taskInfo) return;

    // 清理任务
    this.pendingTasks.delete(taskId);
    workerInfo.currentTasks.delete(taskId);
    workerInfo.completedTasks++;
    this.statistics.completedTasks++;

    // 更新工作线程状态
    if (workerInfo.currentTasks.size < this.config.maxConcurrentPerWorker) {
      workerInfo.busy = false;
    }

    // 触发回调
    if (this.onTaskComplete) {
      this.onTaskComplete(taskInfo.data, result);
    }

    if (this.onProgress) {
      this.onProgress(this.getStatistics());
    }

    // 处理队列中的下一个任务
    this.processQueue();
  }

  /**
   * 处理任务错误
   * @param {Object} workerInfo 工作线程信息
   * @param {string} taskId 任务ID
   * @param {Object} error 错误信息
   */
  handleTaskError(workerInfo, taskId, error) {
    const taskInfo = this.pendingTasks.get(taskId);
    if (!taskInfo) return;

    // 检查是否需要重试
    if (taskInfo.retries < this.config.maxRetries) {
      taskInfo.retries++;
      this.statistics.retriedTasks++;

      // 延迟重试
      setTimeout(() => {
        this.taskQueue.unshift(taskInfo);
        this.processQueue();
      }, this.config.retryDelay);

      this.pendingTasks.delete(taskId);
      workerInfo.currentTasks.delete(taskId);
    } else {
      // 超过最大重试次数，标记为失败
      this.pendingTasks.delete(taskId);
      workerInfo.currentTasks.delete(taskId);
      workerInfo.failedTasks++;
      this.statistics.failedTasks++;

      // 触发回调
      if (this.onTaskError) {
        this.onTaskError(taskInfo.data, error);
      }

      if (this.onProgress) {
        this.onProgress(this.getStatistics());
      }
    }

    // 更新工作线程状态
    if (workerInfo.currentTasks.size < this.config.maxConcurrentPerWorker) {
      workerInfo.busy = false;
    }

    // 处理队列中的下一个任务
    this.processQueue();
  }

  /**
   * 处理工作线程错误
   * @param {Object} workerInfo 工作线程信息
   */
  handleWorkerError(workerInfo) {
    // 将当前任务重新入队
    for (const taskId of workerInfo.currentTasks) {
      const taskInfo = this.pendingTasks.get(taskId);
      if (taskInfo) {
        taskInfo.retries++;
        this.taskQueue.unshift(taskInfo);
        this.pendingTasks.delete(taskId);
      }
    }

    workerInfo.currentTasks.clear();
    workerInfo.busy = false;
  }

  /**
   * 处理工作线程退出
   * @param {Object} workerInfo 工作线程信息
   */
  handleWorkerExit(workerInfo) {
    const workerId = workerInfo.id;
    this.workers.delete(workerId);

    // 检查重启次数
    const restartCount = this.workerRestartCount.get(workerId) || 0;
    if (restartCount < this.config.maxWorkerRestarts && !this.isShuttingDown) {
      this.workerRestartCount.set(workerId, restartCount + 1);

      setTimeout(() => {
        this.createWorker(workerId)
          .then(() => {
            console.log(`[DownloadWorker] Worker ${workerId} restarted`);
            this.processQueue();
          })
          .catch((err) => {
            console.error(`[DownloadWorker] Failed to restart worker ${workerId}:`, err);
          });
      }, this.config.workerRestartDelay);
    }
  }

  /**
   * 添加下载任务
   * @param {Object} taskData 任务数据
   * @param {string} taskData.url 图片URL
   * @param {string} taskData.savePath 保存路径
   * @param {string} taskData.type 任务类型
   * @param {string} taskData.imageBuffer 遮罩图片（可选）
   * @param {Array} taskData.layers 图层数组（合并任务）
   * @returns {string} 任务ID
   */
  addTask(taskData) {
    const taskId = `task_${++this.taskIdCounter}`;
    const taskInfo = {
      id: taskId,
      data: taskData,
      retries: 0,
      status: TaskStatus.PENDING,
      createdAt: Date.now(),
    };

    this.taskQueue.push(taskInfo);
    this.statistics.totalTasks++;

    // 尝试立即处理
    this.processQueue();

    return taskId;
  }

  /**
   * 批量添加任务
   * @param {Array<Object>} tasks 任务数组
   * @returns {Array<string>} 任务ID数组
   */
  addTasks(tasks) {
    const taskIds = tasks.map((task) => this.addTask(task));
    return taskIds;
  }

  /**
   * 处理任务队列
   */
  processQueue() {
    if (this.isShuttingDown || this.taskQueue.length === 0) {
      return;
    }

    // 查找空闲的工作线程
    for (const workerInfo of this.workers.values()) {
      if (
        !workerInfo.busy &&
        workerInfo.currentTasks.size < this.config.maxConcurrentPerWorker &&
        this.taskQueue.length > 0
      ) {
        const taskInfo = this.taskQueue.shift();
        this.assignTask(workerInfo, taskInfo);
      }
    }
  }

  /**
   * 分配任务给工作线程
   * @param {Object} workerInfo 工作线程信息
   * @param {Object} taskInfo 任务信息
   */
  assignTask(workerInfo, taskInfo) {
    taskInfo.status = TaskStatus.RUNNING;
    taskInfo.assignedAt = Date.now();
    taskInfo.workerId = workerInfo.id;

    this.pendingTasks.set(taskInfo.id, taskInfo);
    workerInfo.currentTasks.add(taskInfo.id);

    if (workerInfo.currentTasks.size >= this.config.maxConcurrentPerWorker) {
      workerInfo.busy = true;
    }

    // 发送任务到工作线程
    workerInfo.worker.postMessage({
      type: MessageType.TASK_ASSIGN,
      taskId: taskInfo.id,
      data: taskInfo.data,
    });

    // 设置超时
    this.setupTaskTimeout(taskInfo, workerInfo);
  }

  /**
   * 设置任务超时
   * @param {Object} taskInfo 任务信息
   * @param {Object} workerInfo 工作线程信息
   */
  setupTaskTimeout(taskInfo, workerInfo) {
    const timeout = taskInfo.data.timeout || this.config.taskTimeout;

    setTimeout(() => {
      if (this.pendingTasks.has(taskInfo.id)) {
        // 任务超时，取消任务
        workerInfo.worker.postMessage({
          type: MessageType.TASK_CANCEL,
          taskId: taskInfo.id,
        });

        this.handleTaskError(workerInfo, taskInfo.id, {
          message: 'Task timeout',
          isTimeout: true,
        });
      }
    }, timeout);
  }

  /**
   * 取消所有任务
   */
  cancelAll() {
    // 清空队列
    this.taskQueue = [];

    // 取消所有待处理任务
    for (const [taskId, taskInfo] of this.pendingTasks) {
      const workerInfo = this.workers.get(taskInfo.workerId);
      if (workerInfo) {
        workerInfo.worker.postMessage({
          type: MessageType.TASK_CANCEL,
          taskId,
        });
      }
    }

    this.pendingTasks.clear();

    // 重置工作线程状态
    for (const workerInfo of this.workers.values()) {
      workerInfo.currentTasks.clear();
      workerInfo.busy = false;
    }
  }

  /**
   * 关闭工作线程池
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.isShuttingDown = true;

    // 等待当前任务完成
    while (this.pendingTasks.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // 关闭所有工作线程
    const shutdownPromises = [];
    for (const workerInfo of this.workers.values()) {
      shutdownPromises.push(
        new Promise((resolve) => {
          workerInfo.worker.on('exit', resolve);
          workerInfo.worker.postMessage({ type: MessageType.SHUTDOWN });
        }),
      );
    }

    await Promise.all(shutdownPromises);
    this.workers.clear();

    console.log('[DownloadWorker] All workers shutdown');
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计信息
   */
  getStatistics() {
    return {
      ...this.statistics,
      pendingTasks: this.taskQueue.length,
      activeTasks: this.pendingTasks.size,
      activeWorkers: this.workers.size,
      percentage:
        this.statistics.totalTasks > 0
          ? Number(((this.statistics.completedTasks + this.statistics.failedTasks) / this.statistics.totalTasks) * 100).toFixed(2)
          : 0,
    };
  }

  /**
   * 获取队列状态
   * @returns {Object} 队列状态
   */
  getStatus() {
    return {
      isRunning: this.pendingTasks.size > 0 || this.taskQueue.length > 0,
      queueLength: this.taskQueue.length,
      activeTasks: this.pendingTasks.size,
      workers: Array.from(this.workers.values()).map((w) => ({
        id: w.id,
        busy: w.busy,
        currentTasks: w.currentTasks.size,
        completedTasks: w.completedTasks,
        failedTasks: w.failedTasks,
      })),
      statistics: this.getStatistics(),
    };
  }

  /**
   * 设置任务完成回调
   * @param {Function} callback 回调函数
   */
  setOnTaskComplete(callback) {
    this.onTaskComplete = callback;
  }

  /**
   * 设置任务错误回调
   * @param {Function} callback 回调函数
   */
  setOnTaskError(callback) {
    this.onTaskError = callback;
  }

  /**
   * 设置进度回调
   * @param {Function} callback 回调函数
   */
  setOnProgress(callback) {
    this.onProgress = callback;
  }
}

/**
 * 创建下载工作线程管理器实例
 * @param {Object} options 配置选项
 * @returns {DownloadWorker} 工作线程管理器实例
 */
function createDownloadWorker(options = {}) {
  return new DownloadWorker(options);
}

// 导出模块
export {
  DownloadWorker,
  createDownloadWorker,
  TaskType,
  TaskStatus,
  MessageType,
  DEFAULT_CONFIG,
};

export default DownloadWorker;
