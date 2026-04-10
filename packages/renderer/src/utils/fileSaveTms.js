// 瓦片转换
import { setState, setProgress } from './progress';
import { downloadLoop, downloadClipLoop, downloadController } from './download';
import {setMapLoading} from './baseMap.js';

export class TileTMS {
  constructor(data) {
    this.rootPath = data.savePath;
    this.maxZoom = data.maxZoom;
    this.minZoom = data.minZoom;
    this.imageType = data.imageType;
    this.tileLayer = data.mapConfig.tileLayer;
    this.downloadGeometry = data.downloadGeometry;
    this.downloadTiles(data.clipImage);
  }
  async downloadTiles(clipImage) {
    downloadController.cancelled = false;
    downloadController.paused = false;

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
    }
    statistics.percentage = 100;
    setProgress(statistics);
    setState(false);
    setMapLoading(false);

    if (downloadController.cancelled) {
      window.$message.info('下载已取消');
    } else {
      window.$message.success('瓦片数据下载完成。');
    }
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

    this.downloadLayers(data);
  }
  async downloadLayers(data) {
    downloadController.cancelled = false;
    downloadController.paused = false;

    setState(true);
    const statistics = {percentage: 0, count: 100};
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
    }
    statistics.percentage = 100;
    setProgress(statistics);
    setState(false);
    setMapLoading(false);

    if (downloadController.cancelled) {
      window.$message.info('下载已取消');
    } else {
      window.$message.success('瓦片数据下载完成。');
    }
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

    if (data.clipImage) {
      downloadClipLoop(list, apiDownload, this.tileLayer[0], data.downloadGeometry, this.imageType, taskConfig);
    } else {
      downloadLoop(list, apiDownload, taskConfig);
    }
  }
  calcTiles() {
    const downloadPath = this.rootPath + '/';
    const zmin = this.minZoom;
    const zmax = this.maxZoom + 1;
    const pictureType = '.' + this.imageType;

    const imgLyr = this.tileLayer.find(t => { return !t.config().style.includes('_Label'); });
    const imgLyrLabel = this.tileLayer.find(t => { return t.config().style.includes('_Label'); });
    const storeMap = {};
    for (let z = zmin; z < zmax; z++) {
      const tileGridsList = imgLyr._getCascadeTiles(z).tileGrids;
      tileGridsList.forEach(tileGrids => {
        for (let x = 0; x < tileGrids.tiles.length; x++) {
          const tile = tileGrids.tiles[x];
          const temppath = downloadPath + tile.z + '/' + tile.x;
          this.apiEnsureDirSync(temppath);
          const savePath = temppath + '/' + tile.y + pictureType;

          storeMap[`${tile.x}${tile.y}${tile.z}`] = {zoom: tile.z, layers:[
            {
              url: tile.url,
              isLabel: false,
            },
          ], savePath, x:tile.x, y:tile.y};
        }
      });
    }
    for (let z = zmin; z < zmax; z++) {
      const tileGridsList = imgLyrLabel._getCascadeTiles(z).tileGrids;
      tileGridsList.forEach(tileGrids => {
        for (let x = 0; x < tileGrids.tiles.length; x++) {
          const tile = tileGrids.tiles[x];
          storeMap[`${tile.x}${tile.y}${tile.z}`].layers.push({
            url: tile.url,
            isLabel: true,
          });
        }
      });
    }
    setMapLoading(false);
    return Object.values(storeMap);
  }
}
