// 下载
import { setState, setProgress } from './progress';
import { judgeTile } from './baseMap';
import { ClipImage } from './clipImage';
import { DownloadQueue } from './downloadQueue';

let currentQueue = null;
const CLIPIMAGE = new ClipImage();

/**
 * 取消当前下载任务
 */
export function cancelDownload() {
  if (currentQueue) {
    currentQueue.cancel();
    currentQueue = null;
  }
  setState(false);
}

/**
 * 暂停当前下载任务
 */
export function pauseDownload() {
  if (currentQueue) {
    currentQueue.pause();
  }
}

/**
 * 恢复当前下载任务
 */
export function resumeDownload() {
  if (currentQueue) {
    currentQueue.resume();
  }
}

/**
 * 下载瓦片 - 使用队列模式
 * @param {Array} list 瓦片列表
 * @param {Function} apiDownload 下载方法
 * @returns
 */
export function downloadLoop(list, apiDownload) {
  if (!Array.isArray(list) || typeof apiDownload !== 'function') return;
  const length = list.length;
  if (length === 0) return;

  const statistics = { success: 0, error: 0, percentage: 0, count: length };

  currentQueue = new DownloadQueue({
    concurrency: 5,
    onProgress: (stats) => {
      statistics.success = stats.success;
      statistics.error = stats.error;
      statistics.percentage = stats.percentage;
      setProgress(statistics);
    },
    onComplete: (stats) => {
      statistics.success = stats.success;
      statistics.error = stats.error;
      statistics.percentage = 100;
      setProgress(statistics);
      setState(false);
      window.$message.success(`下载完成。下载成功${stats.success}，下载失败${stats.error}`);
      currentQueue = null;
    },
  });

  const tasks = list.map((item) => ({
    handler: () => apiDownload(item),
  }));

  currentQueue.add(tasks);
  setState(true);
  currentQueue.start();
}

/**
 * 下载瓦片并裁切 - 使用队列模式
 * @param {Array} list 瓦片列表
 * @param {Function} apiDownload 下载方法
 * @param {maptalks.TileLayer} tileLayer 下载瓦片图层
 * @param {maptalks.Geometry} downloadGeometry 下载范围
 * @param {String} imageType 瓦片格式
 * @returns
 */
export function downloadClipLoop(list, apiDownload, tileLayer, downloadGeometry, imageType) {
  if (!Array.isArray(list) || typeof apiDownload !== 'function') return;
  const length = list.length;
  if (length === 0) return;

  const { width, height } = tileLayer.getTileSize();
  const spatialReference = tileLayer.getSpatialReference();
  const prj = spatialReference.getProjection();
  const fullExtent = spatialReference.getFullExtent();
  const code = prj.code;

  const statistics = { success: 0, error: 0, percentage: 0, count: length };

  currentQueue = new DownloadQueue({
    concurrency: 3,
    onProgress: (stats) => {
      statistics.success = stats.success;
      statistics.error = stats.error;
      statistics.percentage = stats.percentage;
      setProgress(statistics);
    },
    onComplete: (stats) => {
      statistics.success = stats.success;
      statistics.error = stats.error;
      statistics.percentage = 100;
      setProgress(statistics);
      setState(false);
      window.$message.success(`下载完成。下载成功${stats.success}，下载失败${stats.error}`);
      CLIPIMAGE.cleanup();
      currentQueue = null;
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
  currentQueue.start();
}

/**
 * 下载单张瓦片
 * @param {*} tile 瓦片参数
 * @param {*} downloadOption 下载参数
 * @returns Promise
 */
export async function downloadImage(tile, downloadOption) {
  const { clipImage } = downloadOption;
  if (clipImage) {
    return _downloadClipImage(tile, downloadOption);
  } else {
    return _downloadImage(tile, downloadOption);
  }
}

/**
 * 下载单张瓦片 - Promise 化
 * @param {*} tile
 * @param {*} downloadOption
 * @returns
 */
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

/**
 * 下载单张瓦片并裁切 - Promise 化
 * @param {*} tile
 * @param {*} downloadOption
 * @returns
 */
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
