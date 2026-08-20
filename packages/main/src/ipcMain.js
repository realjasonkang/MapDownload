// 在主进程中.
const { ipcMain } = require('electron');
const { dialog } = require('electron');
const fse = require('fs-extra');
const fs = require('fs');
const sharp = require('sharp');
const request = require('superagent');
const path = require('path');
import { getHeader } from './ipHandle';

// Worker 管理器实例
let downloadWorker = null;
let workerEnabled = true;
let workerAvailable = false;

// 尝试加载 Worker Threads
try {
  // 检测 Worker Threads 是否可用
  require('worker_threads');
  workerAvailable = true;
  console.log('[IPC Main] Worker Threads is available');
} catch (error) {
  workerAvailable = false;
  workerEnabled = false;
  console.warn('[IPC Main] Worker Threads is not available, falling back to single-thread mode:', error.message);
}

// 动态导入 DownloadWorker（仅在可用时）
let DownloadWorker = null;
let TaskType = null;
if (workerAvailable) {
  try {
    const workerModule = require('./downloadWorker');
    DownloadWorker = workerModule.DownloadWorker;
    TaskType = workerModule.TaskType;
    console.log('[IPC Main] DownloadWorker module loaded successfully');
  } catch (error) {
    workerAvailable = false;
    workerEnabled = false;
    console.error('[IPC Main] Failed to load DownloadWorker module:', error.message);
  }
}

/**
 * 按 customTaskId 分发 worker 任务结果的回调表
 * 修复并发任务相互覆盖 onTaskComplete/onTaskError 回调导致结果丢失、渲染进程永久等待的问题
 */
const workerTaskResolvers = new Map();

/**
 * 设置 worker 全局任务完成/错误回调（一次性设置，避免并发任务互相覆盖回调链）
 * @param {DownloadWorker} worker 下载工作线程管理器
 */
function setupWorkerCallbacks(worker) {
  worker.setOnTaskComplete((taskData, result) => {
    if (taskData && taskData.customTaskId) {
      const resolve = workerTaskResolvers.get(taskData.customTaskId);
      if (resolve) {
        workerTaskResolvers.delete(taskData.customTaskId);
        resolve(result);
      }
    }
  });
  worker.setOnTaskError((taskData, error) => {
    if (taskData && taskData.customTaskId) {
      const resolve = workerTaskResolvers.get(taskData.customTaskId);
      if (resolve) {
        workerTaskResolvers.delete(taskData.customTaskId);
        resolve({ success: false, error: (error && error.message) || 'Unknown error' });
      }
    }
  });
}

/**
 * 获取或创建 Worker 实例
 * @returns {Promise<DownloadWorker|null>}
 */
async function getDownloadWorker() {
  if (!workerAvailable || !workerEnabled || !DownloadWorker) {
    return null;
  }

  if (!downloadWorker) {
    try {
      downloadWorker = new DownloadWorker({
        workerCount: Math.min(require('os').cpus().length, 4),
        maxConcurrentPerWorker: 3,
        taskTimeout: 30000,
        maxRetries: 3,
      });
      await downloadWorker.initialize();
      setupWorkerCallbacks(downloadWorker);
      console.log('[IPC Main] DownloadWorker initialized successfully');
    } catch (error) {
      console.error('[IPC Main] Failed to initialize DownloadWorker:', error);
      downloadWorker = null;
      workerEnabled = false;
      return null;
    }
  }
  return downloadWorker;
}

/**
 * 关闭 Worker 实例
 */
async function shutdownDownloadWorker() {
  if (downloadWorker) {
    try {
      await downloadWorker.shutdown();
      console.log('[IPC Main] DownloadWorker shutdown successfully');
    } catch (error) {
      console.error('[IPC Main] Failed to shutdown DownloadWorker:', error);
    }
    downloadWorker = null;
  }
}

ipcMain.handle('show-dialog', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile', 'openDirectory'] });
  return result;
});
// 确保目录存在，不存在则创建
ipcMain.on('ensure-dir', (event, args) => {
  fse.ensureDirSync(args);
});

// 启用/禁用 Worker 模式
ipcMain.handle('set-worker-mode', async (event, enabled) => {
  // 如果 Worker Threads 不可用，无法启用 Worker 模式
  if (enabled && !workerAvailable) {
    console.warn('[IPC Main] Cannot enable worker mode: Worker Threads not available');
    return { success: false, workerEnabled: false, error: 'Worker Threads not available' };
  }

  workerEnabled = enabled;
  if (!enabled) {
    await shutdownDownloadWorker();
  }
  return { success: true, workerEnabled };
});

// 获取 Worker 状态
ipcMain.handle('get-worker-status', async () => {
  return {
    available: workerAvailable,
    enabled: workerEnabled,
    status: downloadWorker ? downloadWorker.getStatus() : null,
  };
});

// 初始化工作线程池
ipcMain.handle('init-download-worker', async (event, { concurrency }) => {
  try {
    // 如果 Worker 不可用，直接返回失败
    if (!workerAvailable || !workerEnabled || !DownloadWorker) {
      console.warn('[IPC Main] Cannot initialize worker pool: Worker Threads not available');
      return { success: false, error: 'Worker Threads not available' };
    }

    // 如果已经初始化，更新配置
    if (downloadWorker) {
      console.log(`[IPC Main] Worker pool already initialized, updating concurrency to ${concurrency}`);
      downloadWorker.config.workerCount = concurrency;
      return { success: true };
    }

    // 创建工作线程池
    downloadWorker = new DownloadWorker({
      workerCount: concurrency,
      maxConcurrentPerWorker: 3,
      taskTimeout: 30000,
      maxRetries: 3,
    });

    await downloadWorker.initialize();
    setupWorkerCallbacks(downloadWorker);
    console.log(`[IPC Main] DownloadWorker initialized successfully with ${concurrency} workers`);
    return { success: true };
  } catch (error) {
    console.error('[IPC Main] Failed to initialize DownloadWorker:', error);
    downloadWorker = null;
    return { success: false, error: error.message };
  }
});

// 批量下载任务（使用 Worker）
ipcMain.handle('download-tiles-batch', async (event, args) => {
  // 检查 Worker 是否可用
  if (!workerEnabled || !workerAvailable) {
    return { success: false, error: 'Worker mode is disabled or not available' };
  }

  try {
    const worker = await getDownloadWorker();
    if (!worker) {
      return { success: false, error: 'Failed to initialize DownloadWorker' };
    }

    const { tiles, onProgress } = args;

    // 设置进度回调
    if (onProgress) {
      worker.setOnProgress((stats) => {
        event.sender.send('download-tiles-progress', stats);
      });
    }

    // 批量添加任务
    const tasks = tiles.map((tile) => ({
      url: tile.url,
      savePath: tile.savePath,
      type: tile.imageBuffer ? TaskType.DOWNLOAD_WITH_MASK : TaskType.DOWNLOAD,
      imageBuffer: tile.imageBuffer,
    }));

    const taskIds = worker.addTasks(tasks);

    return { success: true, taskIds, totalTasks: tasks.length };
  } catch (error) {
    console.error('[IPC Main] 批量下载任务错误:', error);
    return { success: false, error: error.message };
  }
});

// 取消所有下载任务
ipcMain.handle('cancel-download-tiles', async () => {
  if (downloadWorker) {
    downloadWorker.cancelAll();
  }
  return { success: true };
});

// 关闭 Worker
ipcMain.handle('shutdown-worker', async () => {
  await shutdownDownloadWorker();
  return { success: true };
});


// 下载事件
// eslint-disable-next-line no-unused-vars
export function ipcHandle(_win) {

  /**
   * 非流式下载图片并返回 Buffer
   * 不使用 superagent.pipe(sharp) 流式路径：sharp 作为 pipe 目标处理部分
   * 响应（如天地图 chunked JPEG）时会卡死并阻塞事件循环，改用 buffer 方式已验证正常
   * @param {string} url 图片URL
   * @param {number} timeout 超时时间
   * @returns {Promise<Buffer>} 图片数据
   */
  function fetchImageBuffer(url, timeout) {
    return new Promise((resolve, reject) => {
      const req = request.get(url).set(getHeader()).buffer(true);

      const timeoutId = setTimeout(() => {
        req.abort();
        reject(new Error(`Download timeout for ${url}`));
      }, timeout);

      req.on('aborted', () => {
        clearTimeout(timeoutId);
        reject(new Error('aborted'));
      });

      req.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });

      req.parse((res, callback) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      }).end((err, res) => {
        clearTimeout(timeoutId);
        if (err) {
          reject(err);
          return;
        }
        resolve(res.body);
      });
    });
  }

  /**
   * 单线程模式：下载图片
   * @param {Object} args 下载参数
   * @returns {Promise<Object>} 下载结果
   */
  async function saveImageSingleThread(args) {
    const savePath = path.normalize(args.savePath);
    const timeout = args.timeout || 30000;

    try {
      const data = await fetchImageBuffer(args.url, timeout);
      let operation = sharp(data, { failOnError: false });
      if (args.imageBuffer) {
        const base64Data = args.imageBuffer.replace(/^data:image\/\w+;base64,/, '');
        const dataBuffer = Buffer.from(base64Data, 'base64');
        operation = operation.composite([{ input: dataBuffer, gravity: 'centre', blend: 'dest-in' }]);
      }
      await operation.toFile(savePath);
      return { success: true };
    } catch (err) {
      console.error('[IPC Main] 保存图片错误', err.message);
      try {
        fs.unlinkSync(savePath);
      } catch {
        // do nothing
      }
      return { success: false, error: err.message };
    }
  }

  /**
   * 单线程模式：下载并合并图片
   * @param {Object} args 下载参数
   * @returns {Promise<Object>} 下载结果
   */
  async function saveImageMergeSingleThread(args) {
    try {
      const savePath = path.normalize(args.savePath);
      let imgBack;
      const imgBuffer = [];
      const layers = args.layers;
      const timeout = args.timeout || 30000;

      for (let index = 0; index < layers.length; index++) {
        const item = layers[index];

        // 修复：使用 item.url 而不是 args.url
        const data = await fetchImageBuffer(item.url, timeout);
        const bff = await sharp(data, { failOnError: false }).toBuffer();

        if (item.isLabel) {
          imgBack = bff;
        } else {
          imgBuffer.push(bff);
        }
      }

      let operation;
      if (args.imageBuffer) {
        const base64Data = args.imageBuffer.replace(/^data:image\/\w+;base64,/, '');
        const dataBuffer = Buffer.from(base64Data, 'base64');
        operation = sharp(imgBack)
          .composite(imgBuffer.map(input => {
            return { input, gravity: 'centre', blend: 'saturate' };
          }))
          .composite([{ input: dataBuffer, gravity: 'centre', blend: 'dest-in' }]);
      } else {
        operation = sharp(imgBack)
          .composite(imgBuffer.map(input => {
            return { input, gravity: 'centre', blend: 'saturate' };
          }));
      }

      await operation.toFile(savePath);
      return { success: true };
    } catch (err) {
      console.error('[IPC Main] 合并图片错误', err);
      try {
        fs.unlinkSync(path.normalize(args.savePath));
      } catch {
        // do nothing
      }
      return { success: false, error: err.message };
    }
  }

  // superagent & sharp 下载图片 - 支持 Worker 模式和降级处理
  ipcMain.handle('save-image', async (event, args) => {
    // 尝试使用 Worker 模式
    if (workerEnabled && workerAvailable && TaskType) {
      try {
        const worker = await getDownloadWorker();
        if (worker) {
          // 生成自定义任务ID
          const customTaskId = `save-image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          // 注册结果等待器：结果由 setupWorkerCallbacks 按 customTaskId 分发，避免并发任务互相覆盖回调
          const promise = new Promise((resolve) => {
            workerTaskResolvers.set(customTaskId, resolve);
            worker.addTask({
              customTaskId,
              url: args.url,
              savePath: args.savePath,
              type: args.imageBuffer ? TaskType.DOWNLOAD_WITH_MASK : TaskType.DOWNLOAD,
              imageBuffer: args.imageBuffer,
            });
          });

          // 超时保护：防止回调丢失导致渲染进程永久等待
          setTimeout(() => {
            const resolve = workerTaskResolvers.get(customTaskId);
            if (resolve) {
              workerTaskResolvers.delete(customTaskId);
              resolve({ success: false, error: 'Task timeout' });
            }
          }, 120000);

          return promise;
        }
      } catch (error) {
        console.error('[IPC Main] Worker mode failed, falling back to single-thread:', error);
        // 降级为单线程模式
      }
    }

    // 使用单线程模式（原有逻辑）
    return await saveImageSingleThread(args);
  });

  // superagent & sharp 下载、合并图片 - 支持 Worker 模式和降级处理
  ipcMain.handle('save-image-merge', async (event, args) => {
    // 尝试使用 Worker 模式
    if (workerEnabled && workerAvailable && TaskType) {
      try {
        const worker = await getDownloadWorker();
        if (worker) {
          // 生成自定义任务ID
          const customTaskId = `save-image-merge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          // 注册结果等待器：结果由 setupWorkerCallbacks 按 customTaskId 分发，避免并发任务互相覆盖回调
          const promise = new Promise((resolve) => {
            workerTaskResolvers.set(customTaskId, resolve);
            worker.addTask({
              customTaskId,
              layers: args.layers,
              savePath: args.savePath,
              type: TaskType.MERGE,
              imageBuffer: args.imageBuffer,
            });
          });

          // 超时保护：防止回调丢失导致渲染进程永久等待
          setTimeout(() => {
            const resolve = workerTaskResolvers.get(customTaskId);
            if (resolve) {
              workerTaskResolvers.delete(customTaskId);
              console.warn(`[IPC Main] save-image-merge timeout fallback triggered for ${customTaskId}, layers=${args.layers ? args.layers.length : 0}`);
              resolve({ success: false, error: 'Task timeout' });
            }
          }, 120000);

          return promise;
        }
      } catch (error) {
        console.error('[IPC Main] Worker mode failed, falling back to single-thread:', error);
        // 降级为单线程模式
      }
    }

    // 使用单线程模式（原有逻辑）
    return await saveImageMergeSingleThread(args);
  });

}
