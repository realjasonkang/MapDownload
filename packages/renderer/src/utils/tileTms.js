// 瓦片转换
import { setState } from './progress';
import { downloadLoop } from './download';

function long2tile(lon, zoom) {
  return (Math.floor((lon + 180) / 360 * Math.pow(2, zoom)));
}

// eslint-disable-next-line
function lat2tileGoogle(lat, zoom) {
  return (Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)));
}
// eslint-disable-next-line
function lat2tileTMS(lat, zoom) {
  return ((1 << zoom) - (Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))) - 1);
}

export class TileTMS {
  constructor(data, apiDownload, apiEnsureDirSync) {
    this.apiDownload = apiDownload;
    this.rootPath = data.savePath;
    this.maxZoom = data.maxZoom;
    this.minZoom = data.minZoom;
    this.mapExtent = data.extent;
    this.urlTemplate = data.mapConfig.config.urlTemplate;
    this.apiEnsureDirSync = apiEnsureDirSync;
    this.tileLayer = data.mapConfig.tileLayer;
    
    const taskConfig = {
      savePath: data.savePath,
      minZoom: data.minZoom,
      maxZoom: data.maxZoom,
    };
    downloadLoop(this.calcTiles(), this.apiDownload, taskConfig);
  }
  calcTiles() {
    const downloadPath = this.rootPath + '/';
    const zmin = this.minZoom;
    const zmax = this.maxZoom + 1;
    const south_edge = this.mapExtent.ymin;
    const north_edge = this.mapExtent.ymax;
    const west_edge = this.mapExtent.xmin;
    const east_edge = this.mapExtent.xmax;
    const pictureType = '.png';
    const list = [];
    for (let z = zmin; z < zmax; z++) {
      const top_tile = lat2tileGoogle(north_edge, z);
      const left_tile = long2tile(west_edge, z);
      const bottom_tile = lat2tileGoogle(south_edge, z);
      const right_tile = long2tile(east_edge, z);
      const minLong = Math.min(left_tile, right_tile);
      const maxLong = Math.max(left_tile, right_tile);
      let minLat = Math.min(bottom_tile, top_tile);
      if (minLat < 0) minLat = 0;
      const maxLat = Math.max(bottom_tile, top_tile);
      for (let x = minLong; x < maxLong; x++) {
        const temppath = downloadPath + z + '/' + x;
        this.apiEnsureDirSync(temppath);
        for (let y = minLat; y < maxLat; y++) {
          const str3 = this.tileLayer.getTileUrl(x, y, z);
          const path2 = temppath + '/' + y + pictureType;
          list.push({zoom: z, url:str3, savePath:path2});
        }
      }
    }
    return list;
  }
}

export class TileTMSList {
  constructor(data, apiDownload, apiEnsureDirSync) {
    this.apiDownload = apiDownload;
    this.rootPath = data.savePath;
    this.maxZoom = data.maxZoom;
    this.minZoom = data.minZoom;
    this.mapExtent = data.extent;
    this.apiEnsureDirSync = apiEnsureDirSync;
    this.tileLayer = data.mapConfig.tileLayer;

    let list = [];
    data.mapConfig.tileLayer.forEach(layer => {
      list = [...list, ...this.calcTiles(layer.config().style, layer)];
    });
    
    const taskConfig = {
      savePath: data.savePath,
      minZoom: data.minZoom,
      maxZoom: data.maxZoom,
      multiLayer: true,
    };
    downloadLoop(list, this.apiDownload, taskConfig);
  }
  calcTiles(subpath, layer) {
    const downloadPath = this.rootPath + '/' + subpath + '/';
    const zmin = this.minZoom;
    const zmax = this.maxZoom + 1;
    const south_edge = this.mapExtent.ymin;
    const north_edge = this.mapExtent.ymax;
    const west_edge = this.mapExtent.xmin;
    const east_edge = this.mapExtent.xmax;
    const pictureType = '.png';
    const list = [];
    for (let z = zmin; z < zmax; z++) {
      const top_tile = lat2tileGoogle(north_edge, z);
      const left_tile = long2tile(west_edge, z);
      const bottom_tile = lat2tileGoogle(south_edge, z);
      const right_tile = long2tile(east_edge, z);
      const minLong = Math.min(left_tile, right_tile);
      const maxLong = Math.max(left_tile, right_tile);
      let minLat = Math.min(bottom_tile, top_tile);
      if (minLat < 0) minLat = 0;
      const maxLat = Math.max(bottom_tile, top_tile);
      for (let x = minLong; x < maxLong; x++) {
        const temppath = downloadPath + z + '/' + x;
        this.apiEnsureDirSync(temppath);
        for (let y = minLat; y < maxLat; y++) {
          const str3 = layer.getTileUrl(x, y, z);
          const path2 = temppath + '/' + y + pictureType;
          list.push({zoom: z, url:str3, savePath:path2});
        }
      }
    }
    return list;
  }
}

export class TileTMSListMerge {
  constructor(data, apiDownload, apiEnsureDirSync) {
    this.apiDownload = apiDownload;
    this.rootPath = data.savePath;
    this.maxZoom = data.maxZoom;
    this.minZoom = data.minZoom;
    this.mapExtent = data.extent;
    this.apiEnsureDirSync = apiEnsureDirSync;
    this.tileLayer = data.mapConfig.tileLayer;

    const taskConfig = {
      savePath: data.savePath,
      minZoom: data.minZoom,
      maxZoom: data.maxZoom,
      mergeLayers: true,
    };
    downloadLoop(this.calcTiles(data.mapConfig.tileLayer), this.apiDownload, taskConfig);
  }
  calcTiles(layers) {
    const downloadPath = this.rootPath + '/';
    const zmin = this.minZoom;
    const zmax = this.maxZoom + 1;
    const south_edge = this.mapExtent.ymin;
    const north_edge = this.mapExtent.ymax;
    const west_edge = this.mapExtent.xmin;
    const east_edge = this.mapExtent.xmax;
    const pictureType = '.png';
    const list = [];
    for (let z = zmin; z < zmax; z++) {
      const top_tile = lat2tileGoogle(north_edge, z);
      const left_tile = long2tile(west_edge, z);
      const bottom_tile = lat2tileGoogle(south_edge, z);
      const right_tile = long2tile(east_edge, z);
      const minLong = Math.min(left_tile, right_tile);
      const maxLong = Math.max(left_tile, right_tile);
      let minLat = Math.min(bottom_tile, top_tile);
      if (minLat < 0) minLat = 0;
      const maxLat = Math.max(bottom_tile, top_tile);
      for (let x = minLong; x < maxLong; x++) {
        const temppath = downloadPath + z + '/' + x;
        this.apiEnsureDirSync(temppath);
        for (let y = minLat; y < maxLat; y++) {
          const str3 = layers.map(ll => {return {url: ll.getTileUrl(x, y, z), isLabel: ll.config().style.includes('_Label')};});
          const path2 = temppath + '/' + y + pictureType;
          list.push({zoom: z, layers:str3, savePath:path2});
        }
      }
    }
    return list;
  }
}
