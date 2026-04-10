// 瓦片转换
import { downloadLoop } from './download';

const LLBAND = [75, 60, 45, 30, 15, 0];
const LL2MC = [
  [-0.0015702102444, 111320.7020616939, 1704480524535203, -10338987376042340, 26112667856603880, -35149669176653700,
    26595700718403920, -10725012454188240, 1800819912950474, 82.5],
  [0.0008277824516172526, 111320.7020463578, 647795574.6671607, -4082003173.641316, 10774905663.51142,
    -15171875531.51559, 12053065338.62167, -5124939663.577472, 913311935.9512032, 67.5],
  [0.00337398766765, 111320.7020202162, 4481351.045890365, -23393751.19931662, 79682215.47186455, -115964993.2797253,
    97236711.15602145, -43661946.33752821, 8477230.501135234, 52.5],
  [0.00220636496208, 111320.7020209128, 51751.86112841131, 3796837.749470245, 992013.7397791013, -1221952.21711287,
    1340652.697009075, -620943.6990984312, 144416.9293806241, 37.5],
  [-0.0003441963504368392, 111320.7020576856, 278.2353980772752, 2485758.690035394, 6070.750963243378,
    54821.18345352118, 9540.606633304236, -2710.55326746645, 1405.483844121726, 22.5],
  [-0.0003218135878613132, 111320.7020701615, 0.00369383431289, 823725.6402795718, 0.46104986909093,
    2351.343141331292, 1.58060784298199, 8.77738589078284, 0.37238884252424, 7.45]];

function getRange(cC, cB, T) {
  if (cB != null && cB !== undefined) cC = Math.max(cC, cB);
  if (T != null && T !== undefined) cC = Math.min(cC, T);
  return cC;
}


function getLoop(cC, cB, T) {
  while (cC > T) {
    cC -= T - cB;
  }
  while (cC < cB) {
    cC += T - cB;
  }
  return cC;
}


function convertor(cC, cD) {
  if (cC == null || cD == null) {
    return null;
  }
  let T = cD[0] + cD[1] * Math.abs(cC.x);
  const cB = Math.abs(cC.y) / cD[9];
  let cE = cD[2] + cD[3] * cB + cD[4] * cB * cB + cD[5] * cB * cB * cB + cD[6] * cB * cB * cB * cB + cD[
    7] * cB * cB * cB * cB * cB + cD[8] * cB * cB * cB * cB * cB * cB;
  if (cC.x < 0) {
    T = T * -1;
  }
  else {
    // T = T;
  }
  if (cC.y < 0) {
    cE = cE * -1;
  }
  else {
    // cE = cE;
  }
  return [T, cE];
}


function convertLL2MC(T) {
  let cD = null;
  T.x = getLoop(T.x, -180, 180);
  T.y = getRange(T.y, -74, 74);
  let cB = T;
  for (let cC = 0; cC < LLBAND.length; cC++) {
    if (cB.y >= LLBAND[cC]) {
      cD = LL2MC[cC];
      break;
    }
  }
  if (cD != null) {
    for (let cC = LLBAND.length - 1; cC > -1; cC--) {
      if (cB.y <= -LLBAND[cC]) {
        cD = LL2MC[cC];
        break;
      }
    }
  }
  const cE = convertor(T, cD);
  return cE;
}

function LLT(x, y) {
  this.x = x;
  this.y = y;
}
// bd09投影到百度墨卡托
function bd09tomercator(lng, lat) {
  const baidut = new LLT(lng, lat);
  return convertLL2MC(baidut);
}

function getResolution(level) {
  return Math.pow(2, (level - 18));
}

// 经纬度转瓦片行列号
function lngToTileX(lng, level) {
  const point = bd09tomercator(lng, 0);
  return Math.floor(point[0] * getResolution(level) / 256);
}
// 经纬度转瓦片行列号
function latToTileY(lat, level) {
  const point = bd09tomercator(0, lat);
  return Math.floor(point[1] * getResolution(level) / 256);
}
class TileBaidu {
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
      projection: 'BAIDU',
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
      const top_tile = latToTileY(north_edge, z);
      const left_tile = lngToTileX(west_edge, z);
      const bottom_tile = latToTileY(south_edge, z);
      const right_tile = lngToTileX(east_edge, z);
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
          list.push({ zoom: z, url: str3, savePath: path2, x, y, z, downloadType: 'normal' });
        }
      }
    }
    return list;
  }
}

export default TileBaidu;
