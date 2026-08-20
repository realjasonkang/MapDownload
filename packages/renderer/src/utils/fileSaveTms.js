// 瓦片转换
import { setState, setProgress, notifyStatusChange, getProgress } from './progress';
import { downloadLoop, downloadClipLoop, downloadController, initPerformanceMonitor, updatePerformanceMonitor, getPerformanceStats } from './download';
import {setMapLoading} from './baseMap.js';
import { getFailedTilesManager } from './failedTilesManager';
import { setCurrentFailedTaskId, clearCurrentFailedTaskId, getFailedTilesCount, flushFailedTiles } from './downloadCascadeTiles';
import { getDownloadConcurrency } from './config';

function long2tile(lon, zoom) {
  return (Math.floor((lon + 180) / 360 * Math.pow(2, zoom)));
}

function lat2tileGoogle(lat, zoom) {
  return (Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)));
}

export class TileTMS {
  constructor(data) {
    this.rootPath = data.savePath;
    this.maxZoom = data.maxZoom;
    this.minZoom = data.minZoom;
    this.imageType = data.imageType;
    this.tileLayer = data.mapConfig.tileLayer;
    this.downloadGeometry = data.downloadGeometry;
    this.taskConfig = {
      savePath: data.savePath,
      minZoom: data.minZoom,
      maxZoom: data.maxZoom,
      imageType: data.imageType,
      clipImage: data.clipImage,
    };
    this.downloadTiles(data.clipImage);
  }
  async downloadTiles(clipImage) {
    downloadController.cancelled = false;
    downloadController.paused = false;

    // 获取并发度配置
    const concurrency = getDownloadConcurrency();

    // 初始化性能监控
    initPerformanceMonitor(concurrency);

    const manager = getFailedTilesManager();
    await manager.init();

    const failedTaskId = manager.generateTaskId();
    setCurrentFailedTaskId(failedTaskId);

    await manager.createFailedTask({
      taskId: failedTaskId,
      taskConfig: this.taskConfig,
      totalTiles: 0,
    }).catch((err) => {
      console.error('创建失败任务记录失败:', err);
    });

    const downloadPath = this.rootPath + '/';
    const zmin = this.minZoom;
    const zmax = this.maxZoom + 1;
    const pictureType = '.' + this.imageType;
    const option = {
      downloadPath,
      pictureType,
      imageType: this.imageType,
    };
    if (clipImage) {
      option.clipImage = clipImage;
      option.tileLayer = this.tileLayer;
      option.downloadGeometry = this.downloadGeometry;
    }
    const statistics = {percentage: 0, count: 100};
    setState(true);
    
    // 初始化进度统计
    const progressStats = { success: 0, error: 0, percentage: 0, count: 0 };
    
    for (let z = zmin; z < zmax; z++) {
      if (downloadController.cancelled) {
        break;
      }

      while (downloadController.paused) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (downloadController.cancelled) {
          break;
        }
      }

      if (downloadController.cancelled) break;

      statistics.percentage = Number(((z - zmin) / (zmax - zmin) * 100).toFixed(2));
      setProgress(statistics);
      await this.tileLayer.downloadCascadeTiles(z, option);

      // 更新性能统计：从全局 statistics 读取
      progressStats.success = getProgress().success;
      progressStats.error = getProgress().error;
      progressStats.count = getProgress().count || (progressStats.success + progressStats.error + 100); // 估算总数
      const perfStats = updatePerformanceMonitor({
        completed: progressStats.success + progressStats.error,
        total: progressStats.count,
      });
      notifyStatusChange({ performance: perfStats });
    }
    statistics.percentage = 100;
    setProgress(statistics);
    setState(false);
    setMapLoading(false);

    // 获取最终性能统计
    const finalPerfStats = getPerformanceStats();

    await flushFailedTiles();
    const failedCount = getFailedTilesCount();
    if (failedCount > 0) {
      await manager.updateFailedTask(failedTaskId, {
        failedCount: failedCount,
      });
    } else {
      await manager.deleteFailedTask(failedTaskId);
    }

    clearCurrentFailedTaskId();

    if (downloadController.cancelled) {
      window.$message.info('下载已取消');
    } else {
      const avgSpeed = finalPerfStats ? finalPerfStats.avgSpeed || 0 : 0;
      const elapsedTime = finalPerfStats ? finalPerfStats.elapsedTime || 0 : 0;
      window.$message.success(
        `瓦片数据下载完成。平均速度: ${avgSpeed} 瓦片/秒，耗时: ${elapsedTime} 秒`,
      );
    }

    notifyStatusChange({ downloading: false, queueStatus: null, failedCount: failedCount });
  }
}

export class TileTMSList {
  constructor(data) {
    this.rootPath = data.savePath;
    this.maxZoom = data.maxZoom;
    this.minZoom = data.minZoom;
    this.imageType = data.imageType;
    this.tileLayer = data.mapConfig.tileLayer;
    this.downloadGeometry = data.downloadGeometry;
    this.taskConfig = {
      savePath: data.savePath,
      minZoom: data.minZoom,
      maxZoom: data.maxZoom,
      imageType: data.imageType,
      clipImage: data.clipImage,
      multiLayer: true,
    };

    this.downloadLayers(data);
  }
  async downloadLayers(data) {
    downloadController.cancelled = false;
    downloadController.paused = false;

    // 获取并发度配置
    const concurrency = getDownloadConcurrency();

    // 初始化性能监控
    initPerformanceMonitor(concurrency);

    const manager = getFailedTilesManager();
    await manager.init();

    const failedTaskId = manager.generateTaskId();
    setCurrentFailedTaskId(failedTaskId);

    await manager.createFailedTask({
      taskId: failedTaskId,
      taskConfig: this.taskConfig,
      totalTiles: 0,
    }).catch((err) => {
      console.error('创建失败任务记录失败:', err);
    });

    setState(true);
    const statistics = {percentage: 0, count: 100};
    
    // 初始化进度统计
    const progressStats = { success: 0, error: 0, percentage: 0, count: 0 };
    
    for (let index = 0; index < data.mapConfig.tileLayer.length; index++) {
      if (downloadController.cancelled) {
        break;
      }

      while (downloadController.paused) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (downloadController.cancelled) {
          break;
        }
      }

      if (downloadController.cancelled) break;

      const layer = data.mapConfig.tileLayer[index];
      await this.downloadTiles(data.clipImage, layer, (index + 1) / (data.mapConfig.tileLayer.length) * 100);

      // 更新性能统计：从全局 statistics 读取
      progressStats.success = getProgress().success;
      progressStats.error = getProgress().error;
      progressStats.count = getProgress().count || (progressStats.success + progressStats.error + 100);
      const perfStats = updatePerformanceMonitor({
        completed: progressStats.success + progressStats.error,
        total: progressStats.count,
      });
      notifyStatusChange({ performance: perfStats });
    }
    statistics.percentage = 100;
    setProgress(statistics);
    setState(false);
    setMapLoading(false);

    // 获取最终性能统计
    const finalPerfStats = getPerformanceStats();

    await flushFailedTiles();
    const failedCount = getFailedTilesCount();
    if (failedCount > 0) {
      await manager.updateFailedTask(failedTaskId, {
        failedCount: failedCount,
      });
    } else {
      await manager.deleteFailedTask(failedTaskId);
    }

    clearCurrentFailedTaskId();

    if (downloadController.cancelled) {
      window.$message.info('下载已取消');
    } else {
      const avgSpeed = finalPerfStats ? finalPerfStats.avgSpeed || 0 : 0;
      const elapsedTime = finalPerfStats ? finalPerfStats.elapsedTime || 0 : 0;
      window.$message.success(
        `瓦片数据下载完成。平均速度: ${avgSpeed} 瓦片/秒，耗时: ${elapsedTime} 秒`,
      );
    }

    notifyStatusChange({ downloading: false, queueStatus: null, failedCount: failedCount });
  }
  async downloadTiles(clipImage, tileLayer, count) {
    const downloadPath = this.rootPath + '/' + tileLayer.config().style + '/';
    const zmin = this.minZoom;
    const zmax = this.maxZoom + 1;
    const pictureType = '.' + this.imageType;
    const option = {
      downloadPath,
      pictureType,
      imageType: this.imageType,
    };
    if (clipImage) {
      option.clipImage = clipImage;
      option.tileLayer = tileLayer;
      option.downloadGeometry = this.downloadGeometry;
    }
    for (let z = zmin; z < zmax; z++) {
      if (downloadController.cancelled) {
        break;
      }

      while (downloadController.paused) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (downloadController.cancelled) {
          break;
        }
      }

      if (downloadController.cancelled) break;

      const percentage = Number(((z - zmin) / (zmax - zmin) * count).toFixed(2));
      setProgress({percentage});
      await tileLayer.downloadCascadeTiles(z, option);
    }
    return Promise.resolve();
  }
}

export class TileTMSListMerge {
  constructor(data, apiDownload, apiEnsureDirSync) {
    this.rootPath = data.savePath;
    this.maxZoom = data.maxZoom;
    this.minZoom = data.minZoom;
    this.mapExtent = data.extent;
    this.imageType = data.imageType;
    this.apiEnsureDirSync = apiEnsureDirSync;
    this.tileLayer = data.mapConfig.tileLayer;

    const list = this.calcTiles();
    const taskConfig = {
      savePath: data.savePath,
      minZoom: data.minZoom,
      maxZoom: data.maxZoom,
      imageType: data.imageType,
      mergeLayers: true,
    };
    setMapLoading(false);

    if (data.clipImage) {
      downloadClipLoop(list, apiDownload, this.tileLayer[0], data.downloadGeometry, this.imageType, taskConfig);
    } else {
      downloadLoop(list, apiDownload, taskConfig);
    }
  }
  *calcTiles() {
    const downloadPath = this.rootPath + '/';
    const zmin = this.minZoom;
    const zmax = this.maxZoom + 1;
    const pictureType = '.' + this.imageType;
    const south_edge = this.mapExtent.ymin;
    const north_edge = this.mapExtent.ymax;
    const west_edge = this.mapExtent.xmin;
    const east_edge = this.mapExtent.xmax;

    const imgLyr = this.tileLayer.find(t => { return !t.config().style.includes('_Label'); });
    const imgLyrLabel = this.tileLayer.find(t => { return t.config().style.includes('_Label'); });
    for (let z = zmin; z < zmax; z++) {
      const top_tile = lat2tileGoogle(north_edge, z);
      const left_tile = long2tile(west_edge, z);
      const bottom_tile = lat2tileGoogle(south_edge, z);
      const right_tile = long2tile(east_edge, z);
      const tileCount = Math.pow(2, z);
      const minLong = Math.max(0, Math.min(tileCount - 1, Math.min(left_tile, right_tile)));
      const maxLong = Math.max(0, Math.min(tileCount - 1, Math.max(left_tile, right_tile)));
      const minLat = Math.max(0, Math.min(tileCount - 1, Math.min(bottom_tile, top_tile)));
      const maxLat = Math.max(0, Math.min(tileCount - 1, Math.max(bottom_tile, top_tile)));
      for (let x = minLong; x <= maxLong; x++) {
        const temppath = downloadPath + z + '/' + x;
        this.apiEnsureDirSync(temppath);
        for (let y = minLat; y <= maxLat; y++) {
          const savePath = temppath + '/' + y + pictureType;
          yield {
            zoom: z,
            layers: [
              {
                url: imgLyr.getTileUrl(x, y, z),
                isLabel: false,
              },
              {
                url: imgLyrLabel.getTileUrl(x, y, z),
                isLabel: true,
              },
            ],
            savePath,
            x,
            y,
            z,
            downloadType: 'merge',
          };
        }
      }
    }
  }
}
