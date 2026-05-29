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
   * 单线程模式：下载图片
   * @param {Object} args 下载参数
   * @returns {Promise<Object>} 下载结果
   */
  async function saveImageSingleThread(args) {
    const savePath = path.normalize(args.savePath);
    const sharpStream = sharp({
      failOnError: false,
    });
    const promises = [];

    return new Promise((resolve) => {
      if (args.imageBuffer) {
        const base64Data = args.imageBuffer.replace(/^data:image\/\w+;base64,/, '');
        const dataBuffer = Buffer.from(base64Data, 'base64');
        promises.push(
          sharpStream
            .composite([{ input: dataBuffer, gravity: 'centre', blend: 'dest-in' }])
            .toFile(savePath),
        );
      } else {
        promises.push(
          sharpStream
            .toFile(savePath),
        );
      }

      const req = request.get(args.url).set(getHeader());
      const stream = req.pipe(sharpStream);

      // 处理请求中止事件
      req.on('aborted', () => {
        console.error('[IPC Main] 请求被中止');
        try {
          fs.unlinkSync(savePath);
        } catch {
          // do nothing
        }
        resolve({ success: false, error: 'aborted' });
      });

      stream.on('finish', () => {
        Promise.all(promises)
          .then(() => {
            resolve({ success: true });
          })
          .catch((err) => {
            console.error('[IPC Main] 保存图片错误', err);
            try {
              fs.unlinkSync(savePath);
            } catch {
              // do nothing
            }
            resolve({ success: false, error: err.message });
          });
      });

      stream.on('error', (err) => {
        console.error('[IPC Main] 下载流错误', err);
        try {
          fs.unlinkSync(savePath);
        } catch {
          // do nothing
        }
        req.abort();
        resolve({ success: false, error: err.message });
      });

      req.on('error', (err) => {
        console.error('[IPC Main] 请求错误', err);
        try {
          fs.unlinkSync(savePath);
        } catch {
          // do nothing
        }
        resolve({ success: false, error: err.message });
      });
    });
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

      for (let index = 0; index < layers.length; index++) {
        const item = layers[index];
        const sharpStream = sharp({
          failOnError: false,
        });

        // 修复：使用 item.url 而不是 args.url
        const bff = await new Promise((resolve, reject) => {
          const req = request.get(item.url).set(getHeader());
          const stream = req.pipe(sharpStream);

          // 处理请求中止事件
          req.on('aborted', () => {
            reject(new Error('aborted'));
          });

          stream.on('finish', () => {
            sharpStream.toBuffer()
              .then(resolve)
              .catch(reject);
          });

          stream.on('error', reject);
          req.on('error', reject);
        });

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
          return new Promise((resolve) => {
            // 生成自定义任务ID
            const customTaskId = `save-image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // 设置任务完成回调
            const originalOnComplete = worker.onTaskComplete;
            worker.setOnTaskComplete((taskData, result) => {
              if (taskData.customTaskId === customTaskId) {
                worker.setOnTaskComplete(originalOnComplete);
                resolve(result);
              } else if (originalOnComplete) {
                originalOnComplete(taskData, result);
              }
            });

            // 设置任务错误回调
            const originalOnError = worker.onTaskError;
            worker.setOnTaskError((taskData, error) => {
              if (taskData.customTaskId === customTaskId) {
                worker.setOnTaskError(originalOnError);
                resolve({ success: false, error: error.message || 'Unknown error' });
              } else if (originalOnError) {
                originalOnError(taskData, error);
              }
            });

            // 添加任务
            worker.addTask({
              customTaskId,
              url: args.url,
              savePath: args.savePath,
              type: args.imageBuffer ? TaskType.DOWNLOAD_WITH_MASK : TaskType.DOWNLOAD,
              imageBuffer: args.imageBuffer,
            });
          });
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
          return new Promise((resolve) => {
            // 生成自定义任务ID
            const customTaskId = `save-image-merge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // 设置任务完成回调
            const originalOnComplete = worker.onTaskComplete;
            worker.setOnTaskComplete((taskData, result) => {
              if (taskData.customTaskId === customTaskId) {
                worker.setOnTaskComplete(originalOnComplete);
                resolve(result);
              } else if (originalOnComplete) {
                originalOnComplete(taskData, result);
              }
            });

            // 设置任务错误回调
            const originalOnError = worker.onTaskError;
            worker.setOnTaskError((taskData, error) => {
              if (taskData.customTaskId === customTaskId) {
                worker.setOnTaskError(originalOnError);
                resolve({ success: false, error: error.message || 'Unknown error' });
              } else if (originalOnError) {
                originalOnError(taskData, error);
              }
            });

            // 添加任务
            worker.addTask({
              customTaskId,
              layers: args.layers,
              savePath: args.savePath,
              type: TaskType.MERGE,
              imageBuffer: args.imageBuffer,
            });
          });
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
