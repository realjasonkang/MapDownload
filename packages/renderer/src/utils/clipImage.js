// 裁切瓦片
import * as maptalks from 'maptalks';

export class ClipImage {
  constructor() {
    this.tileSize = {
      width: 256,
      height: 256,
    };
    this.map = null;
    this.vectorLayer = null;
    this.dom = null;
    // 修复内存泄漏：跟踪 requestAnimationFrame ID 和当前 Promise
    this._currentRafId = null;
    this._currentImagePromise = null;
    // 串行化队列：保证同一时刻只有一个裁切任务操作地图，避免并发 addTempGeometry/setCenterAndZoom 互相打断导致 getImage 永久等待
    this._lock = Promise.resolve();
    this._timeoutId = null;
    this.createMap();
  }

  setSize(width, height) {
    if (this.tileSize.width === width && this.tileSize.height === height) return;
    this.tileSize.width = width;
    this.tileSize.height = height;
    if (this.dom) {
      this.dom.style.width = width + 'px';
      this.dom.style.height = height + 'px';
    }
  }

  createMap() {
    if (this.map) return;
    const dom = document.createElement('div');
    dom.id = 'map-clip-image';
    dom.style = `
    position: fixed;
    margin: 0;
    padding: 0;
    top: 0;
    left: 0;
    width: ${this.tileSize.width}px;
    height: ${this.tileSize.height}px;
    z-index: -1;
    `;
    document.body.append(dom);
    this.dom = dom;
    const map = new maptalks.Map(dom, {
      center: [105.08052356963802, 36.04231948670001],
      zoom: 5,
      zoomAnimation: false,
      zoomAnimationDuration: 1,
      panAnimation: false,
      panAnimationDuration: 1,
      rotateAnimation: false,
      rotateAnimationDuration: 1,
    });
    this.map = map;
    this.vectorLayer = new maptalks.VectorLayer('vector', {
      drawImmediate: true,
      geometryEvents: false,
      hitDetect: false,
      forceRenderOnMoving: true,
      forceRenderOnZooming: true,
      forceRenderOnRotating: true,
    }).addTo(map);
  }

  /**
   * 清理地图实例和相关资源
   * 解决地图实例内存累积问题
   */
  cleanup() {
    // 修复内存泄漏：先取消进行中的 rAF 和 image 请求
    this._cancelCurrentImageRequest();

    if (this.vectorLayer) {
      this.vectorLayer.clear();
      this.vectorLayer = null;
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    if (this.dom && this.dom.parentNode) {
      this.dom.parentNode.removeChild(this.dom);
      this.dom = null;
    }
  }

  /**
   * 重建地图实例
   * 用于长时间下载过程中定期清理内存
   */
  recreate() {
    this.cleanup();
    this.createMap();
  }

  /**
   * 串行化裁剪操作：addTempGeometry + getImage 原子执行
   * 多任务并发下载时，必须保证同一时刻只有一个任务操作地图，
   * 否则并发 setCenterAndZoom 会使地图持续运动，getImage 的等待循环永不结束
   * @param {Object} intersection 相交几何
   * @param {Object} rect 矩形范围
   * @param {string} imageType 图片类型
   * @returns {Promise<string>} Base64 图片
   */
  generateClipImage(intersection, rect, imageType) {
    const task = () => {
      this.addTempGeometry(intersection, rect);
      return this.getImage(imageType);
    };
    const run = this._lock.then(task);
    this._lock = run.then(() => undefined, () => undefined);
    return run;
  }

  addTempGeometry(intersection, rect) {
    if (!this.vectorLayer) {
      this.createMap();
    }
    this.vectorLayer.clear();
    const polygon = maptalks.GeoJSON.toGeometry(intersection);
    this.vectorLayer.addGeometry(polygon);
    const extent = new maptalks.Polygon(rect.geometry.coordinates, {
      symbol: {
        'lineWidth' : 0,
        'polygonFill' : 'rgba(0,0,0,0)',
      },
    });
    this.vectorLayer.addGeometry(extent);

    const zoom = this.map.getFitZoom(extent.getExtent());
    const center = extent.getCenter();
    this.map.setCenterAndZoom(center, zoom);
  }

  getImage(imageType) {
    // 修复内存泄漏：如果已有进行中的请求，先取消
    this._cancelCurrentImageRequest();

    let cancelled = false;

    // 使用 setTimeout 而非 requestAnimationFrame：
    // 1) rAF 在页面隐藏/后台/最小化时会暂停，导致等待循环永不结束、下载卡死
    // 2) 加入最大等待次数兜底，即使地图因异常持续动画，也能强制截图返回，避免永久挂起
    const promise = new Promise(resolve => {
      let tries = 0;
      const MAX_TRIES = 100;

      const isComplete = () => {
        if (cancelled) {
          resolve(null);
          return;
        }

        if (!this.map) {
          resolve(null);
          return;
        }

        const over = !this.map.isMoving() && !this.map.isZooming() && !this.map.isAnimating();
        if (!over && tries < MAX_TRIES) {
          tries++;
          this._timeoutId = setTimeout(isComplete, 50);
          return;
        }

        this._timeoutId = null;
        this._currentImagePromise = null;
        const img = this.map.toDataURL({
          'mimeType' : 'image/' + imageType,
          'save' : false,
        });
        resolve(img);
      };

      this._timeoutId = setTimeout(isComplete, 30);
    });

    // 保存当前 Promise 以便取消
    this._currentImagePromise = promise;

    // 添加取消方法
    promise.cancel = () => {
      cancelled = true;
      if (this._timeoutId) {
        clearTimeout(this._timeoutId);
        this._timeoutId = null;
      }
      this._currentRafId = null;
      this._currentImagePromise = null;
    };

    return promise;
  }

  /**
   * 取消当前的图片请求
   * @private
   */
  _cancelCurrentImageRequest() {
    if (this._currentImagePromise && this._currentImagePromise.cancel) {
      this._currentImagePromise.cancel();
    }
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
    if (this._currentRafId) {
      cancelAnimationFrame(this._currentRafId);
      this._currentRafId = null;
    }
  }
}
