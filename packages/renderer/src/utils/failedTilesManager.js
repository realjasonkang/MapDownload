/**
 * 失败瓦片管理器
 * 使用 IndexedDB 存储失败瓦片参数，支持大规模数据存储
 */

const DB_NAME = 'MapDownloadFailedTiles';
const DB_VERSION = 1;
const STORE_TASKS = 'failed_tasks';
const STORE_TILES = 'failed_tiles';

class FailedTilesManager {
  constructor() {
    this.db = null;
    this.isInitialized = false;
    this.writeQueue = [];
    this.writeTimer = null;
    this.BATCH_SIZE = 100;
    this.BATCH_INTERVAL = 1000;
  }

  /**
   * 初始化 IndexedDB 数据库
   * @returns {Promise<IDBDatabase>}
   */
  async init() {
    if (this.isInitialized && this.db) {
      return this.db;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => {
        console.error('IndexedDB 初始化失败:', event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        this.isInitialized = true;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(STORE_TASKS)) {
          const taskStore = db.createObjectStore(STORE_TASKS, {
            keyPath: 'id',
            autoIncrement: true,
          });
          taskStore.createIndex('taskId', 'taskId', { unique: true });
          taskStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_TILES)) {
          const tileStore = db.createObjectStore(STORE_TILES, {
            keyPath: 'id',
            autoIncrement: true,
          });
          tileStore.createIndex('taskId', 'taskId', { unique: false });
          tileStore.createIndex('createdAt', 'createdAt', { unique: false });
          tileStore.createIndex('downloadType', 'downloadType', { unique: false });
        }
      };
    });
  }

  /**
   * 确保数据库已初始化
   */
  async ensureInit() {
    if (!this.isInitialized) {
      await this.init();
    }
  }

  /**
   * 创建失败任务记录
   * @param {Object} taskData 任务数据
   * @returns {Promise<number>} 记录ID
   */
  async createFailedTask(taskData) {
    await this.ensureInit();

    const record = {
      taskId: taskData.taskId || this.generateTaskId(),
      taskName: taskData.taskName || this.generateTaskName(taskData),
      totalTiles: taskData.totalTiles || 0,
      failedCount: taskData.failedCount || 0,
      successCount: taskData.successCount || 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      taskConfig: taskData.taskConfig || {},
      downloadOption: taskData.downloadOption || {},
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_TASKS], 'readwrite');
      const store = transaction.objectStore(STORE_TASKS);
      const request = store.add(record);

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = (event) => {
        console.error('创建失败任务记录失败:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * 生成任务ID
   * @returns {string}
   */
  generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 生成任务名称
   * @param {Object} taskData 任务数据
   * @returns {string}
   */
  generateTaskName(taskData) {
    const config = taskData.taskConfig || {};
    const zoomRange = config.minZoom !== undefined && config.maxZoom !== undefined
      ? `Z${config.minZoom}-${config.maxZoom}`
      : '';
    const date = new Date().toLocaleDateString('zh-CN');
    return `下载任务 ${date} ${zoomRange}`.trim();
  }

  /**
   * 获取单个失败任务
   * @param {string} taskId 任务ID
   * @returns {Promise<Object|null>}
   */
  async getFailedTask(taskId) {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_TASKS], 'readonly');
      const store = transaction.objectStore(STORE_TASKS);
      const index = store.index('taskId');
      const request = index.get(taskId);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = (event) => {
        console.error('获取失败任务失败:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * 获取所有失败任务列表
   * @returns {Promise<Array>}
   */
  async getAllFailedTasks() {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_TASKS], 'readonly');
      const store = transaction.objectStore(STORE_TASKS);
      const request = store.getAll();

      request.onsuccess = (event) => {
        const data = event.target.result || [];
        data.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        resolve(data);
      };

      request.onerror = (event) => {
        console.error('获取失败任务列表失败:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * 更新失败任务记录
   * @param {string} taskId 任务ID
   * @param {Object} updateData 更新数据
   * @returns {Promise<boolean>}
   */
  async updateFailedTask(taskId, updateData) {
    await this.ensureInit();

    const task = await this.getFailedTask(taskId);
    if (!task) {
      return false;
    }

    const updatedTask = {
      ...task,
      ...updateData,
      updatedAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_TASKS], 'readwrite');
      const store = transaction.objectStore(STORE_TASKS);
      const request = store.put(updatedTask);

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = (event) => {
        console.error('更新失败任务记录失败:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * 删除失败任务及其所有瓦片记录
   * @param {string} taskId 任务ID
   * @returns {Promise<boolean>}
   */
  async deleteFailedTask(taskId) {
    await this.ensureInit();

    const task = await this.getFailedTask(taskId);
    if (!task) {
      return false;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_TASKS, STORE_TILES], 'readwrite');

      const tileStore = transaction.objectStore(STORE_TILES);
      const tileIndex = tileStore.index('taskId');
      const tileRequest = tileIndex.openCursor(IDBKeyRange.only(taskId));

      tileRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      const taskStore = transaction.objectStore(STORE_TASKS);
      taskStore.delete(task.id);

      transaction.oncomplete = () => {
        resolve(true);
      };

      transaction.onerror = (event) => {
        console.error('删除失败任务记录失败:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * 添加单个失败瓦片记录
   * @param {Object} tileData 瓦片数据
   * @returns {Promise<number>}
   */
  async addFailedTile(tileData) {
    await this.ensureInit();

    const record = {
      taskId: tileData.taskId,
      tileUrl: tileData.tileUrl || null,
      layers: tileData.layers || null,
      savePath: tileData.savePath,
      x: tileData.x,
      y: tileData.y,
      z: tileData.z,
      createdAt: Date.now(),
      retryCount: tileData.retryCount || 0,
      downloadType: tileData.downloadType || 'normal',
      clipData: tileData.clipData || null,
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_TILES], 'readwrite');
      const store = transaction.objectStore(STORE_TILES);
      const request = store.add(record);

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = (event) => {
        console.error('添加失败瓦片记录失败:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * 批量添加失败瓦片记录（使用写入队列优化性能）
   * @param {Array} tileDataArray 瓦片数据数组
   */
  addFailedTilesBatch(tileDataArray) {
    if (!Array.isArray(tileDataArray) || tileDataArray.length === 0) {
      return;
    }

    this.writeQueue.push(...tileDataArray);

    if (!this.writeTimer) {
      this.writeTimer = setTimeout(() => {
        this.flushWriteQueue();
      }, this.BATCH_INTERVAL);
    }

    if (this.writeQueue.length >= this.BATCH_SIZE) {
      this.flushWriteQueue();
    }
  }

  /**
   * 刷新写入队列
   */
  async flushWriteQueue() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }

    if (this.writeQueue.length === 0) {
      return;
    }

    const batch = this.writeQueue.splice(0, Math.min(this.writeQueue.length, this.BATCH_SIZE));

    try {
      await this._writeBatchToDb(batch);
    } catch (error) {
      console.error('批量写入失败瓦片记录失败:', error);
      this.writeQueue.unshift(...batch);
    }

    if (this.writeQueue.length > 0) {
      this.writeTimer = setTimeout(() => {
        this.flushWriteQueue();
      }, this.BATCH_INTERVAL);
    }
  }

  /**
   * 批量写入数据库
   * @param {Array} batch 批量数据
   * @private
   */
  async _writeBatchToDb(batch) {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_TILES], 'readwrite');
      const store = transaction.objectStore(STORE_TILES);

      batch.forEach((tileData) => {
        const record = {
          taskId: tileData.taskId,
          tileUrl: tileData.tileUrl || null,
          layers: tileData.layers || null,
          savePath: tileData.savePath,
          x: tileData.x,
          y: tileData.y,
          z: tileData.z,
          createdAt: Date.now(),
          retryCount: tileData.retryCount || 0,
          downloadType: tileData.downloadType || 'normal',
          clipData: tileData.clipData || null,
        };
        store.add(record);
      });

      transaction.oncomplete = () => {
        resolve();
      };

      transaction.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 查询任务的所有失败瓦片
   * @param {string} taskId 任务ID
   * @returns {Promise<Array>}
   */
  async getFailedTilesByTaskId(taskId) {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_TILES], 'readonly');
      const store = transaction.objectStore(STORE_TILES);
      const index = store.index('taskId');
      const request = index.openCursor(IDBKeyRange.only(taskId));
      const results = [];

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = (event) => {
        console.error('获取失败瓦片列表失败:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * 删除单个失败瓦片记录
   * @param {number} tileId 瓦片记录ID
   * @returns {Promise<boolean>}
   */
  async removeFailedTile(tileId) {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_TILES], 'readwrite');
      const store = transaction.objectStore(STORE_TILES);
      const request = store.delete(tileId);

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = (event) => {
        console.error('删除失败瓦片记录失败:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * 批量删除失败瓦片记录
   * @param {Array<number>} tileIds 瓦片记录ID数组
   * @returns {Promise<boolean>}
   */
  async removeFailedTilesBatch(tileIds) {
    if (!Array.isArray(tileIds) || tileIds.length === 0) {
      return true;
    }

    await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_TILES], 'readwrite');
      const store = transaction.objectStore(STORE_TILES);

      tileIds.forEach((id) => {
        store.delete(id);
      });

      transaction.oncomplete = () => {
        resolve(true);
      };

      transaction.onerror = (event) => {
        console.error('批量删除失败瓦片记录失败:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * 根据瓦片坐标删除失败记录
   * @param {string} taskId 任务ID
   * @param {number} x 瓦片x坐标
   * @param {number} y 瓦片y坐标
   * @param {number} z 瓦片z坐标
   * @returns {Promise<boolean>}
   */
  async removeFailedTileByCoord(taskId, x, y, z) {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_TILES], 'readwrite');
      const store = transaction.objectStore(STORE_TILES);
      const index = store.index('taskId');
      const request = index.openCursor(IDBKeyRange.only(taskId));
      let found = false;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const tile = cursor.value;
          if (tile.x === x && tile.y === y && tile.z === z) {
            cursor.delete();
            found = true;
          }
          cursor.continue();
        } else {
          resolve(found);
        }
      };

      request.onerror = (event) => {
        console.error('删除失败瓦片记录失败:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * 更新或添加失败瓦片记录（确保同一瓦片只有一条记录）
   * @param {Object} tileData 瓦片数据
   * @returns {Promise<number>}
   */
  async updateOrAddFailedTile(tileData) {
    await this.ensureInit();

    const { taskId, x, y, z } = tileData;

    await this.removeFailedTileByCoord(taskId, x, y, z);

    return await this.addFailedTile(tileData);
  }

  /**
   * 获取失败任务数量
   * @returns {Promise<number>}
   */
  async getFailedTasksCount() {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_TASKS], 'readonly');
      const store = transaction.objectStore(STORE_TASKS);
      const request = store.count();

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = (event) => {
        console.error('获取失败任务数量失败:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * 清空所有失败记录
   * @returns {Promise<boolean>}
   */
  async clearAll() {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_TASKS, STORE_TILES], 'readwrite');

      transaction.objectStore(STORE_TASKS).clear();
      transaction.objectStore(STORE_TILES).clear();

      transaction.oncomplete = () => {
        resolve(true);
      };

      transaction.onerror = (event) => {
        console.error('清空失败记录失败:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * 销毁实例
   */
  destroy() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.writeQueue = [];
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.isInitialized = false;
  }
}

let instance = null;

/**
 * 获取 FailedTilesManager 单例
 * @returns {FailedTilesManager}
 */
export function getFailedTilesManager() {
  if (!instance) {
    instance = new FailedTilesManager();
  }
  return instance;
}

export default FailedTilesManager;
