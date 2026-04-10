// 下载
import { setState, setProgress, notifyStatusChange, getState } from './progress';
import { judgeTile } from './baseMap';
import { ClipImage } from './clipImage';
import { DownloadQueue } from './downloadQueue';
import { MemoryMonitor } from './memoryMonitor';
import { TaskManager } from './taskManager';

let currentQueue = null;
let currentTaskId = null;
let memoryMonitor = null;
let taskManager = null;
let downloadController = {
  cancelled: false,
  paused: false,
};
const CLIPIMAGE = new ClipImage();

const CLIPIMAGE_RECREATE_INTERVAL = 500;

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
    queueStatus: currentQueue ? currentQueue.getStatus() : { paused: true }
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
    queueStatus: currentQueue ? currentQueue.getStatus() : { paused: false }
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
  };
}

export function downloadLoop(list, apiDownload, taskConfig = null) {
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

  const statistics = { success: 0, error: 0, percentage: 0, count: length };

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
    concurrency: 5,
    onProgress: (stats) => {
      statistics.success = stats.success;
      statistics.error = stats.error;
      statistics.percentage = stats.percentage;
      setProgress(statistics);

      if (currentTaskId) {
        getTaskManager().updateProgress(currentTaskId, {
          total: stats.total,
          completed: stats.completed,
          success: stats.success,
          error: stats.error,
        });
      }
    },
    onComplete: (stats) => {
      statistics.success = stats.success;
      statistics.error = stats.error;
      statistics.percentage = 100;
      setProgress(statistics);
      setState(false);

      if (currentTaskId) {
        if (stats.cancelled) {
          getTaskManager().cancelTask(currentTaskId);
        } else {
          getTaskManager().completeTask(currentTaskId);
        }
        currentTaskId = null;
      }

      if (memoryMonitor) {
        memoryMonitor.stop();
      }

      if (stats.cancelled) {
        window.$message.info(`下载已取消。已完成${stats.success}，失败${stats.error}`);
      } else {
        window.$message.success(`下载完成。下载成功${stats.success}，下载失败${stats.error}`);
      }

      notifyStatusChange({ downloading: false, queueStatus: null });
      currentQueue = null;
    },
    onTaskComplete: () => {
      clipImageCounter++;
      if (clipImageCounter % CLIPIMAGE_RECREATE_INTERVAL === 0) {
        CLIPIMAGE.recreate();
      }
    },
  });

  const tasks = list.map((item) => ({
    handler: () => apiDownload(item),
  }));

  currentQueue.add(tasks);
  setState(true);
  getMemoryMonitor().start();
  currentQueue.start();
}

export function downloadClipLoop(list, apiDownload, tileLayer, downloadGeometry, imageType, taskConfig = null) {
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

  const { width, height } = tileLayer.getTileSize();
  const spatialReference = tileLayer.getSpatialReference();
  const prj = spatialReference.getProjection();
  const fullExtent = spatialReference.getFullExtent();
  const code = prj.code;

  const statistics = { success: 0, error: 0, percentage: 0, count: length };

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
    concurrency: 3,
    onProgress: (stats) => {
      statistics.success = stats.success;
      statistics.error = stats.error;
      statistics.percentage = stats.percentage;
      setProgress(statistics);

      if (currentTaskId) {
        getTaskManager().updateProgress(currentTaskId, {
          total: stats.total,
          completed: stats.completed,
          success: stats.success,
          error: stats.error,
        });
      }
    },
    onComplete: (stats) => {
      statistics.success = stats.success;
      statistics.error = stats.error;
      statistics.percentage = 100;
      setProgress(statistics);
      setState(false);

      if (currentTaskId) {
        if (stats.cancelled) {
          getTaskManager().cancelTask(currentTaskId);
        } else {
          getTaskManager().completeTask(currentTaskId);
        }
        currentTaskId = null;
      }

      if (memoryMonitor) {
        memoryMonitor.stop();
      }

      CLIPIMAGE.cleanup();

      if (stats.cancelled) {
        window.$message.info(`下载已取消。已完成${stats.success}，失败${stats.error}`);
      } else {
        window.$message.success(`下载完成。下载成功${stats.success}，下载失败${stats.error}`);
      }

      notifyStatusChange({ downloading: false, queueStatus: null });
      currentQueue = null;
    },
    onTaskComplete: () => {
      clipImageCounter++;
      if (clipImageCounter % CLIPIMAGE_RECREATE_INTERVAL === 0) {
        CLIPIMAGE.recreate();
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
  }));

  currentQueue.add(tasks);
  setState(true);
  getMemoryMonitor().start();
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

export { getTaskManager, getMemoryMonitor, downloadController };
