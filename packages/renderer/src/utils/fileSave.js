// 地图
import {TileTMS, TileTMSList, TileTMSListMerge} from './fileSaveTms';
import TileBaidu from './fileSaveBaidu';
import { getState } from './progress';
export default class FileSave{
  constructor(data) {
    const projection = data.mapConfig.projection.code; // BAIDU,EPSG:4326,EPSG:3857
    if (getState()) {
      return window.$message.warning('下载任务执行中，请稍后..');
    }
    if (projection === 'BAIDU') {
      this.downloadBaidu(data);
    } else {
      this.downloadTms(data);
    }
  }
  // 保存单张图片
  saveImage(param) {
    // const param = {
    //   url: 'https://map.geoq.cn/MapServer/tile/9/207/421',
    //   savePath: '',
    // };
    window.electron.ipcRenderer.send('save-image', param);

  }
  // 保存图片并合并
  async saveImagesAndMerge(param) {
    // const param = {
    //   layers: [{url:'https://map.geoq.cn/MapServer/tile/9/207/421',isLabel: true}],
    //   savePath: '',
    // };
    try {
      const result = await window.electron.ipcRenderer.invoke('save-image-merge', param);
      return !!(result && result.success);
    } catch (error) {
      console.error('合并下载图片错误:', error);
      return false;
    }
  }
  ensureDirSync(path) {
    window.electron.ipcRenderer.send('ensure-dir', path);
  }
  downloadTms(data) {
    if (Array.isArray(data.mapConfig.tileLayer) && data.mapConfig.tileLayer.length > 1) {
      if (data.mergeLayers) {
        new TileTMSListMerge(data, this.saveImagesAndMerge, this.ensureDirSync);
      } else {
        new TileTMSList(data, this.saveImage, this.ensureDirSync);
      }
    } else {
      new TileTMS(data);
    }

  }
  downloadBaidu(data) {
    new TileBaidu(data, this.saveImage, this.ensureDirSync);
  }
}
