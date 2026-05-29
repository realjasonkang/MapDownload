// 下载
import { setState, setProgress, notifyStatusChange, getState } from './progress';
import { judgeTile } from './baseMap';
import { ClipImage } from './clipImage';
import { DownloadQueue } from './downloadQueue';
import { MemoryMonitor } from './memoryMonitor';
import { TaskManager } from './taskManager';
import { getFailedTilesManager } from './failedTilesManager';
import { getDownloadConcurrency } from './config';

let currentQueue = null;
let currentTaskId = null;
let currentFailedTaskId = null;
let memoryMonitor = null;
let taskManager = null;
let failedTilesManager = null;
let downloadController = {
  cancelled: false,
  paused: false,
};
const CLIPIMAGE = new ClipImage();

const CLIPIMAGE_RECREATE_INTERVAL = 500;

// 性能监控相关变量
let performanceMonitor = {
  startTime: 0,
  totalBytes: 0,
  activeThreads: 0,
  maxThreads: 0,
  lastUpdateTime: 0,
  lastCompletedCount: 0,
  // 滑动窗口：用于计算平滑速度
  speedHistory: [],  // 记录最近的时间戳和完成数
  speedWindowSize: 5000,  // 5秒滑动窗口
};

function getTaskManager() {
  if (!taskManager) {
    taskManager = new TaskManager();
  }
  return taskManager;
}

function getMemoryMonitor() {
  if (!memoryMonitor) {
    memoryMonitor = new MemoryMonitor({
      warningThreshold: 0.7,
      criticalThreshold: 0.85,
      interval: 10000,
      onWarning: (usage) => {
        const usedMB = Math.round(usage.usedJSHeapSize / 1024 / 1024);
        const limitMB = Math.round(usage.jsHeapSizeLimit / 1024 / 1024);
        const percent = Math.round(usage.usageRatio * 100);
        window.$message.warning(`内存使用较高: ${usedMB}MB / ${limitMB}MB (${percent}%)`);
      },
      onCritical: (usage) => {
        const usedMB = Math.round(usage.usedJSHeapSize / 1024 / 1024);
        window.$message.error(`内存使用过高: ${usedMB}MB，正在尝试清理...`);
      },
      onCleanup: () => {
        CLIPIMAGE.recreate();
      },
    });
  }
  return memoryMonitor;
}

function getFailedManager() {
  if (!failedTilesManager) {
    failedTilesManager = getFailedTilesManager();
  }
  return failedTilesManager;
}

/**
 * 初始化工作线程池
 * 通过 IPC 调用主进程初始化多线程下载
 *
 * @param {number} concurrency - 并发度（线程数）
 * @returns {Promise<boolean>} 是否初始化成功
 */
async function initWorkerPool(concurrency) {
  try {
    const result = await window.electron.ipcRenderer.invoke('init-download-worker', {
      concurrency,
    });
    if (result && result.success) {
      console.log(`[Download] Worker pool initialized with ${concurrency} threads`);
      return true;
    }
    console.warn('[Download] Worker pool initialization returned false');
    return false;
  } catch (error) {
    console.error('[Download] Failed to initialize worker pool:', error);
    return false;
  }
}

/**
 * 初始化性能监控
 *
 * @param {number} maxThreads - 最大线程数
 */
function initPerformanceMonitor(maxThreads) {
  performanceMonitor = {
    startTime: Date.now(),
    totalBytes: 0,
    activeThreads: 0,
    maxThreads,
    lastUpdateTime: Date.now(),
    lastCompletedCount: 0,
    lastSpeed: 0,
    pendingTasks: 0,
    speedHistory: [],
    speedWindowSize: 5000,
  };
}

/**
 * 更新性能监控数据
 *
 * @param {Object} stats - 下载统计数据
 * @returns {Object} 性能指标
 */
function updatePerformanceMonitor(stats) {
  const now = Date.now();

  // 修复内存泄漏：先清理再添加，控制数组大小
  const windowStart = now - performanceMonitor.speedWindowSize;
  performanceMonitor.speedHistory = performanceMonitor.speedHistory.filter(
    entry => entry.time >= windowStart,
  );

  // 修复：限制最大条目数，防止极端情况下内存累积
  if (performanceMonitor.speedHistory.length > 100) {
    performanceMonitor.speedHistory = performanceMonitor.speedHistory.slice(-50);
  }

  // 记录当前时间点和完成数到历史
  performanceMonitor.speedHistory.push({
    time: now,
    completed: stats.completed,
  });

  // 计算滑动窗口内的速度
  const history = performanceMonitor.speedHistory;
  let speed = 0;
  if (history.length >= 2) {
    const firstEntry = history[0];
    const lastEntry = history[history.length - 1];
    const timeDiff = (lastEntry.time - firstEntry.time) / 1000; // 秒
    const completedDiff = lastEntry.completed - firstEntry.completed;
    speed = timeDiff > 0 ? completedDiff / timeDiff : 0;
  } else if (history.length === 1) {
    // 如果只有一个采样点，使用总平均速度
    const totalTime = (now - performanceMonitor.startTime) / 1000;
    speed = totalTime > 0 ? stats.completed / totalTime : 0;
  }

  // 计算平均速度（从开始到现在）
  const totalTime = (now - performanceMonitor.startTime) / 1000;
  const avgSpeed = totalTime > 0 ? stats.completed / totalTime : 0;

  // 估算活跃线程数（基于队列状态）
  // 对于串行下载，活跃线程数为 1（如果正在下载）或 0（如果完成）
  const activeThreads = currentQueue ? currentQueue.active : (stats.completed < stats.total ? 1 : 0);

  const pendingTasks = stats.total - stats.completed;

  // 更新状态
  performanceMonitor.lastUpdateTime = now;
  performanceMonitor.lastCompletedCount = stats.completed;
  performanceMonitor.activeThreads = activeThreads;
  performanceMonitor.lastSpeed = speed;
  performanceMonitor.pendingTasks = pendingTasks;

  return {
    speed: Math.round(speed * 10) / 10, // 保留一位小数
    avgSpeed: Math.round(avgSpeed * 10) / 10,
    activeThreads,
    maxThreads: performanceMonitor.maxThreads,
    pendingTasks,
    elapsedTime: Math.round(totalTime),
  };
}

/**
 * 获取性能监控数据
 *
 * @returns {Object} 性能监控数据
 */
function getPerformanceStats() {
  if (performanceMonitor.startTime === 0) {
    return null;
  }

  const now = Date.now();
  const totalTime = (now - performanceMonitor.startTime) / 1000;
  const avgSpeed = totalTime > 0 ? performanceMonitor.lastCompletedCount / totalTime : 0;

  // 清理超出窗口的历史记录
  const windowStart = now - performanceMonitor.speedWindowSize;
  performanceMonitor.speedHistory = performanceMonitor.speedHistory.filter(
    entry => entry.time >= windowStart,
  );

  // 计算滑动窗口内的速度
  const history = performanceMonitor.speedHistory;
  let speed = 0;
  if (history.length >= 2) {
    const firstEntry = history[0];
    const lastEntry = history[history.length - 1];
    const timeDiff = (lastEntry.time - firstEntry.time) / 1000;
    const completedDiff = lastEntry.completed - firstEntry.completed;
    speed = timeDiff > 0 ? completedDiff / timeDiff : 0;
  } else if (history.length === 1) {
    // 如果只有一个采样点，使用总平均速度
    speed = totalTime > 0 ? performanceMonitor.lastCompletedCount / totalTime : 0;
  }

  return {
    speed: Math.round(speed * 10) / 10,
    avgSpeed: Math.round(avgSpeed * 10) / 10,
    activeThreads: performanceMonitor.activeThreads || 0,
    maxThreads: performanceMonitor.maxThreads || 0,
    pendingTasks: performanceMonitor.pendingTasks || 0,
    elapsedTime: Math.round(totalTime),
  };
}

/**
 * 设置当前活动队列（供外部使用）
 * @param {DownloadQueue|null} queue - 下载队列实例
 */
export function setCurrentQueue(queue) {
  currentQueue = queue;
}

/**
 * 获取当前活动队列
 * @returns {DownloadQueue|null}
 */
export function getCurrentQueue() {
  return currentQueue;
}

export function cancelDownload() {
  downloadController.cancelled = true;
  downloadController.paused = false;

  if (currentQueue) {
    currentQueue.cancel();
  }
  if (currentTaskId) {
    getTaskManager().cancelTask(currentTaskId);
  }
  if (memoryMonitor) {
    memoryMonitor.stop();
  }
  CLIPIMAGE.cleanup();
}

export function pauseDownload() {
  downloadController.paused = true;

  if (currentQueue) {
    currentQueue.pause();
  }
  if (currentTaskId) {
    getTaskManager().pauseTask(currentTaskId);
  }

  notifyStatusChange({
    queueStatus: currentQueue ? currentQueue.getStatus() : { paused: true },
  });
}

export function resumeDownload() {
  downloadController.paused = false;

  if (currentQueue) {
    currentQueue.resume();
  }
  if (currentTaskId) {
    getTaskManager().resumeTask(currentTaskId);
  }

  notifyStatusChange({
    queueStatus: currentQueue ? currentQueue.getStatus() : { paused: false },
  });
}

export function getDownloadStatus() {
  const isDownloading = getState();
  return {
    isDownloading,
    queueStatus: currentQueue
      ? currentQueue.getStatus()
      : isDownloading
        ? { paused: downloadController.paused }
        : null,
    taskId: currentTaskId,
    memoryUsage: memoryMonitor ? memoryMonitor.getMemoryUsage() : null,
    performance: isDownloading ? getPerformanceStats() : null,
  };
}

export function downloadLoop(list, apiDownload, taskConfig = null, onTileFailed = null, concurrency = null) {
  downloadController.cancelled = false;
  downloadController.paused = false;

  if (!Array.isArray(list)) {
    window.$message.error('下载失败：瓦片列表格式错误');
    return;
  }

  if (typeof apiDownload !== 'function') {
    window.$message.error('下载失败：下载函数未定义');
    return;
  }

  const length = list.length;
  if (length === 0) {
    window.$message.warning('没有需要下载的瓦片');
    return;
  }

  // 获取并发度配置
  const downloadConcurrency = concurrency || getDownloadConcurrency();

  // 初始化工作线程池
  initWorkerPool(downloadConcurrency).catch((err) => {
    console.error('[Download] Failed to init worker pool:', err);
  });

  // 初始化性能监控
  initPerformanceMonitor(downloadConcurrency);

  const statistics = { success: 0, error: 0, percentage: 0, count: length };
  const failedTiles = [];

  if (taskConfig) {
    const task = getTaskManager().createTask({
      ...taskConfig,
      totalTiles: length,
    });
    currentTaskId = task.id;
    getTaskManager().startTask(currentTaskId);
  }

  let clipImageCounter = 0;

  currentQueue = new DownloadQueue({
    concurrency: downloadConcurrency,
    onProgress: (stats) => {
      statistics.success = stats.success;
      statistics.error = stats.error;
      statistics.percentage = stats.percentage;
      setProgress(statistics);

      // 更新性能监控
      const perfStats = updatePerformanceMonitor(stats);

      // 通知性能统计更新
      notifyStatusChange({ performance: perfStats });

      if (currentTaskId) {
        getTaskManager().updateProgress(currentTaskId, {
          total: stats.total,
          completed: stats.completed,
          success: stats.success,
          error: stats.error,
          performance: perfStats,
        });
      }
    },
    onComplete: async (stats) => {
      statistics.success = stats.success;
      statistics.error = stats.error;
      statistics.percentage = 100;
      setProgress(statistics);
      setState(false);

      // 获取最终性能统计
      const finalPerfStats = getPerformanceStats();

      if (currentTaskId) {
        if (stats.cancelled) {
          getTaskManager().cancelTask(currentTaskId);
        } else {
          getTaskManager().completeTask(currentTaskId, {
            performance: finalPerfStats,
          });
        }
        currentTaskId = null;
      }

      if (memoryMonitor) {
        memoryMonitor.stop();
      }

      if (failedTiles.length > 0 && currentFailedTaskId) {
        await getFailedManager().flushWriteQueue();
        await getFailedManager().updateFailedTask(currentFailedTaskId, {
          failedCount: failedTiles.length,
          successCount: stats.success,
        });
      }

      if (stats.cancelled) {
        window.$message.info(`下载已取消。已完成${stats.success}，失败${stats.error}`);
      } else {
        const avgSpeed = finalPerfStats.avgSpeed || 0;
        const elapsedTime = finalPerfStats.elapsedTime || 0;
        window.$message.success(
          `下载完成。下载成功${stats.success}，下载失败${stats.error}。` +
          `平均速度: ${avgSpeed} 瓦片/秒，耗时: ${elapsedTime} 秒`,
        );
      }

      notifyStatusChange({ downloading: false, queueStatus: null, failedCount: stats.error });
      currentQueue = null;
      currentFailedTaskId = null;
    },
    onTaskComplete: () => {
      clipImageCounter++;
      if (clipImageCounter % CLIPIMAGE_RECREATE_INTERVAL === 0) {
        CLIPIMAGE.recreate();
      }
    },
    onTaskFailed: (tileData) => {
      if (tileData && currentFailedTaskId) {
        failedTiles.push(tileData);
        getFailedManager().addFailedTilesBatch([{
          ...tileData,
          taskId: currentFailedTaskId,
        }]);
      }
      if (onTileFailed) {
        onTileFailed(tileData);
      }
    },
  });

  const tasks = list.map((item) => ({
    handler: () => apiDownload(item),
    tileData: item,
  }));

  currentQueue.add(tasks);
  setState(true);
  getMemoryMonitor().start();

  if (taskConfig) {
    currentFailedTaskId = getFailedManager().generateTaskId();
    getFailedManager().createFailedTask({
      taskId: currentFailedTaskId,
      taskConfig,
      totalTiles: length,
    }).catch((err) => {
      console.error('创建失败任务记录失败:', err);
    });
  }

  currentQueue.start();
}

export function downloadClipLoop(list, apiDownload, tileLayer, downloadGeometry, imageType, taskConfig = null, onTileFailed = null, concurrency = null) {
  downloadController.cancelled = false;
  downloadController.paused = false;

  if (!Array.isArray(list)) {
    window.$message.error('下载失败：瓦片列表格式错误');
    return;
  }

  if (typeof apiDownload !== 'function') {
    window.$message.error('下载失败：下载函数未定义');
    return;
  }

  const length = list.length;
  if (length === 0) {
    window.$message.warning('没有需要下载的瓦片');
    return;
  }

  // 获取并发度配置（裁切下载默认使用较低的并发度）
  const downloadConcurrency = concurrency || getDownloadConcurrency();

  // 初始化工作线程池
  initWorkerPool(downloadConcurrency).catch((err) => {
    console.error('[Download] Failed to init worker pool:', err);
  });

  // 初始化性能监控
  initPerformanceMonitor(downloadConcurrency);

  const { width, height } = tileLayer.getTileSize();
  const spatialReference = tileLayer.getSpatialReference();
  const prj = spatialReference.getProjection();
  const fullExtent = spatialReference.getFullExtent();
  const code = prj.code;

  const statistics = { success: 0, error: 0, percentage: 0, count: length };
  const failedTiles = [];

  if (taskConfig) {
    const task = getTaskManager().createTask({
      ...taskConfig,
      totalTiles: length,
      clipImage: true,
    });
    currentTaskId = task.id;
    getTaskManager().startTask(currentTaskId);
  }

  let clipImageCounter = 0;

  currentQueue = new DownloadQueue({
    concurrency: downloadConcurrency,
    onProgress: (stats) => {
      statistics.success = stats.success;
      statistics.error = stats.error;
      statistics.percentage = stats.percentage;
      setProgress(statistics);

      // 更新性能监控
      const perfStats = updatePerformanceMonitor(stats);

      // 通知性能统计更新
      notifyStatusChange({ performance: perfStats });

      if (currentTaskId) {
        getTaskManager().updateProgress(currentTaskId, {
          total: stats.total,
          completed: stats.completed,
          success: stats.success,
          error: stats.error,
          performance: perfStats,
        });
      }
    },
    onComplete: async (stats) => {
      statistics.success = stats.success;
      statistics.error = stats.error;
      statistics.percentage = 100;
      setProgress(statistics);
      setState(false);

      // 获取最终性能统计
      const finalPerfStats = getPerformanceStats();

      if (currentTaskId) {
        if (stats.cancelled) {
          getTaskManager().cancelTask(currentTaskId);
        } else {
          getTaskManager().completeTask(currentTaskId, {
            performance: finalPerfStats,
          });
        }
        currentTaskId = null;
      }

      if (memoryMonitor) {
        memoryMonitor.stop();
      }

      CLIPIMAGE.cleanup();

      if (failedTiles.length > 0 && currentFailedTaskId) {
        await getFailedManager().flushWriteQueue();
        await getFailedManager().updateFailedTask(currentFailedTaskId, {
          failedCount: failedTiles.length,
          successCount: stats.success,
        });
      }

      if (stats.cancelled) {
        window.$message.info(`下载已取消。已完成${stats.success}，失败${stats.error}`);
      } else {
        const avgSpeed = finalPerfStats.avgSpeed || 0;
        const elapsedTime = finalPerfStats.elapsedTime || 0;
        window.$message.success(
          `下载完成。下载成功${stats.success}，下载失败${stats.error}。` +
          `平均速度: ${avgSpeed} 瓦片/秒，耗时: ${elapsedTime} 秒`,
        );
      }

      notifyStatusChange({ downloading: false, queueStatus: null, failedCount: stats.error });
      currentQueue = null;
      currentFailedTaskId = null;
    },
    onTaskComplete: () => {
      clipImageCounter++;
      if (clipImageCounter % CLIPIMAGE_RECREATE_INTERVAL === 0) {
        CLIPIMAGE.recreate();
      }
    },
    onTaskFailed: (tileData) => {
      if (tileData && currentFailedTaskId) {
        failedTiles.push(tileData);
        getFailedManager().addFailedTilesBatch([{
          ...tileData,
          taskId: currentFailedTaskId,
        }]);
      }
      if (onTileFailed) {
        onTileFailed(tileData);
      }
    },
  });

  const tasks = list.map((item) => ({
    handler: async () => {
      const relation = judgeTile(downloadGeometry, {
        width,
        height,
        spatialReference,
        prj,
        fullExtent,
        code,
        tile: { x: item.x, y: item.y, z: item.zoom },
      });

      if (relation === 1) {
        return apiDownload(item);
      } else if (relation === 2) {
        return true;
      } else if (typeof relation === 'object') {
        CLIPIMAGE.addTempGeometry(relation.intersection, relation.rect);
        const imageBuffer = await CLIPIMAGE.getImage(imageType);
        item.imageBuffer = imageBuffer;
        return apiDownload(item);
      }
      return false;
    },
    tileData: item,
  }));

  currentQueue.add(tasks);
  setState(true);
  getMemoryMonitor().start();

  if (taskConfig) {
    currentFailedTaskId = getFailedManager().generateTaskId();
    getFailedManager().createFailedTask({
      taskId: currentFailedTaskId,
      taskConfig,
      totalTiles: length,
    }).catch((err) => {
      console.error('创建失败任务记录失败:', err);
    });
  }

  currentQueue.start();
}

export async function downloadImage(tile, downloadOption) {
  const { clipImage } = downloadOption;
  if (clipImage) {
    return _downloadClipImage(tile, downloadOption);
  } else {
    return _downloadImage(tile, downloadOption);
  }
}

async function _downloadImage(tile, downloadOption) {
  const temppath = downloadOption.downloadPath + tile.z + '/' + tile.x;
  window.electron.ipcRenderer.send('ensure-dir', temppath);
  const savePath = temppath + '/' + tile.y + downloadOption.pictureType;
  const param = { zoom: tile.z, url: tile.url, savePath, x: tile.x, y: tile.y };

  try {
    const result = await window.electron.ipcRenderer.invoke('save-image', param);
    return result.success;
  } catch (error) {
    console.error('下载图片错误:', error);
    return false;
  }
}

async function _downloadClipImage(tile, downloadOption) {
  const { tileLayer, downloadGeometry, pictureType, downloadPath, imageType } = downloadOption;
  const { width, height } = tileLayer.getTileSize();
  const spatialReference = tileLayer.getSpatialReference();
  const prj = spatialReference.getProjection();
  const fullExtent = spatialReference.getFullExtent();
  const code = prj.code;

  const item = tile;
  const relation = judgeTile(downloadGeometry, {
    width,
    height,
    spatialReference,
    prj,
    fullExtent,
    code,
    tile: { x: item.x, y: item.y, z: item.zoom || item.z },
  });

  if (relation === 1) {
    const temppath = downloadPath + item.z + '/' + item.x;
    window.electron.ipcRenderer.send('ensure-dir', temppath);
    const savePath = temppath + '/' + item.y + pictureType;
    const param = { zoom: item.z, url: item.url, savePath, x: item.x, y: item.y };

    try {
      const result = await window.electron.ipcRenderer.invoke('save-image', param);
      return result.success;
    } catch (error) {
      console.error('下载图片错误:', error);
      return false;
    }
  } else if (relation === 2) {
    return true;
  } else if (typeof relation === 'object') {
    CLIPIMAGE.addTempGeometry(relation.intersection, relation.rect);
    const imageBuffer = await CLIPIMAGE.getImage(imageType);

    const temppath = downloadPath + item.z + '/' + item.x;
    window.electron.ipcRenderer.send('ensure-dir', temppath);
    const savePath = temppath + '/' + item.y + pictureType;
    const param = { zoom: item.z, url: item.url, savePath, x: item.x, y: item.y, imageBuffer };

    try {
      const result = await window.electron.ipcRenderer.invoke('save-image', param);
      return result.success;
    } catch (error) {
      console.error('下载裁切图片错误:', error);
      return false;
    }
  }

  return false;
}

/**
 * 重试下载失败瓦片
 * @param {Object} task 失败任务对象
 * @param {number} concurrency - 可选的并发度配置
 * @returns {Promise<void>}
 */
export async function retryFailedTask(task, concurrency = null) {
  if (getState()) {
    window.$message.warning('下载任务执行中，请稍后重试');
    return;
  }

  const manager = getFailedManager();
  await manager.init();

  const tiles = await manager.getFailedTilesByTaskId(task.taskId);
  if (tiles.length === 0) {
    window.$message.warning('没有需要重试的瓦片');
    return;
  }

  downloadController.cancelled = false;
  downloadController.paused = false;

  // 获取并发度配置
  const downloadConcurrency = concurrency || getDownloadConcurrency();

  // 初始化工作线程池
  initWorkerPool(downloadConcurrency).catch((err) => {
    console.error('[Download] Failed to init worker pool:', err);
  });

  // 初始化性能监控
  initPerformanceMonitor(downloadConcurrency);

  const statistics = { success: 0, error: 0, percentage: 0, count: tiles.length };
  const successTileIds = [];
  const stillFailedTiles = [];

  currentFailedTaskId = task.taskId;

  currentQueue = new DownloadQueue({
    concurrency: downloadConcurrency,
    onProgress: (stats) => {
      statistics.success = stats.success;
      statistics.error = stats.error;
      statistics.percentage = stats.percentage;
      setProgress(statistics);

      // 更新性能监控
      const perfStats = updatePerformanceMonitor(stats);

      // 通知性能统计更新
      notifyStatusChange({ performance: perfStats });
    },
    onComplete: async (stats) => {
      statistics.success = stats.success;
      statistics.error = stats.error;
      statistics.percentage = 100;
      setProgress(statistics);
      setState(false);

      // 获取最终性能统计
      const finalPerfStats = getPerformanceStats();

      if (memoryMonitor) {
        memoryMonitor.stop();
      }

      if (successTileIds.length > 0) {
        await manager.removeFailedTilesBatch(successTileIds);
      }

      if (stillFailedTiles.length > 0) {
        for (const tile of stillFailedTiles) {
          await manager.updateOrAddFailedTile({
            ...tile,
            taskId: task.taskId,
            retryCount: (tile.retryCount || 0) + 1,
          });
        }
      }

      await manager.updateFailedTask(task.taskId, {
        failedCount: stillFailedTiles.length,
        successCount: (task.successCount || 0) + stats.success,
      });

      if (stats.cancelled) {
        window.$message.info(`重试已取消。已完成${stats.success}，失败${stats.error}`);
      } else if (stats.error === 0) {
        window.$message.success(`重试完成。全部成功${stats.success}`);
        await manager.deleteFailedTask(task.taskId);
      } else {
        const avgSpeed = finalPerfStats.avgSpeed || 0;
        const elapsedTime = finalPerfStats.elapsedTime || 0;
        window.$message.success(
          `重试完成。成功${stats.success}，失败${stats.error}。` +
          `平均速度: ${avgSpeed} 瓦片/秒，耗时: ${elapsedTime} 秒`,
        );
      }

      notifyStatusChange({ downloading: false, queueStatus: null, failedCount: stats.error });
      currentQueue = null;
      currentFailedTaskId = null;
    },
    onTaskFailed: (tileData) => {
      if (tileData) {
        stillFailedTiles.push(tileData);
      }
    },
  });

  const tasks = tiles.map((tile) => ({
    handler: async () => {
      const success = await retryDownloadTile(tile);
      if (success) {
        successTileIds.push(tile.id);
      }
      return success;
    },
    tileData: tile,
  }));

  currentQueue.add(tasks);
  setState(true);
  getMemoryMonitor().start();
  currentQueue.start();
}

/**
 * 重试下载单个瓦片
 * @param {Object} tile 瓦片数据
 * @returns {Promise<boolean>}
 */
async function retryDownloadTile(tile) {
  try {
    const ensureDir = (savePath) => {
      const lastSlash = Math.max(savePath.lastIndexOf('/'), savePath.lastIndexOf('\\'));
      if (lastSlash > 0) {
        const dirPath = savePath.substring(0, lastSlash);
        window.electron.ipcRenderer.send('ensure-dir', dirPath);
      }
    };

    if (tile.downloadType === 'merge' && tile.layers) {
      ensureDir(tile.savePath);
      const param = {
        layers: tile.layers,
        savePath: tile.savePath,
      };
      const result = await window.electron.ipcRenderer.invoke('save-image-merge', param);
      return result.success;
    } else if (tile.downloadType === 'clip' && tile.clipData) {
      if (tile.clipData.relation === 1) {
        ensureDir(tile.savePath);
        const param = { zoom: tile.z, url: tile.tileUrl, savePath: tile.savePath, x: tile.x, y: tile.y };
        const result = await window.electron.ipcRenderer.invoke('save-image', param);
        return result.success;
      } else if (tile.clipData.relation === 2) {
        return true;
      } else if (tile.clipData.relation === 3) {
        ensureDir(tile.savePath);
        CLIPIMAGE.addTempGeometry(tile.clipData.intersection, tile.clipData.rect);
        const imageBuffer = await CLIPIMAGE.getImage('png');
        const param = { zoom: tile.z, url: tile.tileUrl, savePath: tile.savePath, x: tile.x, y: tile.y, imageBuffer };
        const result = await window.electron.ipcRenderer.invoke('save-image', param);
        return result.success;
      }
    } else {
      ensureDir(tile.savePath);
      const param = { zoom: tile.z, url: tile.tileUrl, savePath: tile.savePath, x: tile.x, y: tile.y };
      const result = await window.electron.ipcRenderer.invoke('save-image', param);
      return result.success;
    }
  } catch (error) {
    console.error('重试下载瓦片错误:', error);
    return false;
  }
  return false;
}

export { getTaskManager, getMemoryMonitor, downloadController, getPerformanceStats, initPerformanceMonitor, updatePerformanceMonitor };
