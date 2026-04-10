<template>
  <n-spin
    class="loadingSpin"
    :show="mapLoading"
  >
    <div id="map" />
  </n-spin>
  <div class="box-controls">
    <layer-control
      @choose="chooseLayers"
    />
    <div class="splitline" />
    <n-icon
      size="20"
      title="绘制矩形"
      style="cursor: pointer;"
      :color="isDrawing ? '#2080f0' : '#333333'"
      @click="drawRect"
    >
      <SquareOutline />
    </n-icon>
    <div class="splitline" />
    <n-icon
      size="20"
      title="下载地图"
      style="cursor: pointer;"
      @click="showSave"
    >
      <CloudDownloadOutline />
    </n-icon>
    <div class="splitline" />
    <GridIcon @show-grid="showGrid" />
    <div class="splitline" />
    <n-icon
      size="20"
      title="设置"
      style="cursor: pointer;"
      @click="showSet(true)"
    >
      <SettingsOutline />
    </n-icon>
    <div class="splitline" />
    <n-icon
      size="20"
      title="帮助"
      style="cursor: pointer;"
      @click="showHelp(true)"
    >
      <HelpCircleOutline />
    </n-icon>
    <div class="splitline" />
    <n-badge
      :value="failedRecordsCount"
      :max="99"
      :show="failedRecordsCount > 0"
    >
      <n-icon
        size="20"
        title="失败记录"
        style="cursor: pointer;"
        :color="failedRecordsCount > 0 ? '#d03050' : '#333333'"
        @click="showFailedRecords(true)"
      >
        <AlertCircleOutline />
      </n-icon>
    </n-badge>
    <div class="splitline" />
    <area-choose
      @choose="chooseArea"
    />

    <save-diablog
      :visible="saveVisible"
      :download-extent="downloadExtent"
      :base-layer="saveLayers"
      :limit-max-zoom="limitMaxZoom"
      :limit-min-zoom="limitMinZoom"
      :is-baidu="isBaidu"
      @ok="save"
      @cancel="cancelSave"
    />
    <help-diablog
      :visible="helpVisible"
      @ok="showHelp(false)"
    />
    <map-key
      :visible="setVisible"
      @hide="showSet(false)"
    />
    <failed-records-dialog
      v-model:show="failedRecordsVisible"
      @retry-task="handleRetryTask"
    />
  </div>
  <ProgressControl />
  <tips />
</template>

<script>
import {defineComponent} from 'vue';
import baseMap from '../utils/baseMap.js';
import {setMapLoading,getMapLoading} from '../utils/baseMap.js';
import LayerControl from './LayerControl.vue';
import AreaChoose from './AreaChoose.vue';
import SaveDiablog from './Save.vue';
import FileSave from '../utils/fileSave.js';
import HelpDiablog from './Help.vue';
import MapKey from './MapKey.vue';
import Tips from './Tips.vue';
import {useMessage, useNotification} from 'naive-ui';
import GridIcon from './GridIcon.vue';
import ProgressControl from './ProgressControl.vue';
import FailedRecordsDialog from './FailedRecordsDialog.vue';
import { getFailedTilesManager } from '../utils/failedTilesManager';
import { getState } from '../utils/progress';
import { retryFailedTask } from '../utils/download';
import { CloudDownloadOutline, HelpCircleOutline, SettingsOutline, SquareOutline, AlertCircleOutline } from '@vicons/ionicons5';
// eslint-disable-next-line
let map
export default defineComponent({
  name: 'HomeMain',
  components: {
    LayerControl,
    SaveDiablog,
    HelpDiablog,
    MapKey,
    Tips,
    AreaChoose,
    GridIcon,
    ProgressControl,
    FailedRecordsDialog,
    CloudDownloadOutline,
    HelpCircleOutline,
    SettingsOutline,
    SquareOutline,
    AlertCircleOutline,
  },
  setup() {
    window.$message = useMessage();
    window.$notification = useNotification();
    const mapLoading = getMapLoading();
    return {
      mapLoading: mapLoading,
    };
  },
  data() {
    return {
      isDrawing: false,
      saveVisible: false,
      downloadExtent: {},
      helpVisible: false,
      setVisible: false,
      saveLayers: [],
      limitMinZoom: 1,
      limitMaxZoom: 18,
      isBaidu: false,
      failedRecordsVisible: false,
      failedRecordsCount: 0,
    };
  },
  computed: {
  },
  mounted() {
    map = new baseMap('map');
    this.addMapRightClickHandle();
    this.updateFailedRecordsCount();
    this._failedCountTimer = setInterval(() => {
      this.updateFailedRecordsCount();
    }, 30000);
  },
  beforeUnmount() {
    if (this._failedCountTimer) {
      clearInterval(this._failedCountTimer);
      this._failedCountTimer = null;
    }
  },
  methods: {
    async updateFailedRecordsCount() {
      try {
        const manager = getFailedTilesManager();
        await manager.init();
        this.failedRecordsCount = await manager.getFailedTasksCount();
      } catch (error) {
        console.error('获取失败记录数量失败:', error);
      }
    },
    showFailedRecords(val) {
      this.failedRecordsVisible = val;
    },
    async handleRetryTask(task) {
      if (getState()) {
        window.$message.warning('下载任务执行中，请稍后重试');
        return;
      }
      await retryFailedTask(task);
      await this.updateFailedRecordsCount();
    },
    chooseLayers(data) {
      this._currentLayer = data;
      map.switchBaseLayer(data);
    },
    drawRect() {
      this.isDrawing = !this.isDrawing;
      if (this.isDrawing) {
        this.hideDrawTips();
        this._drawStartInfo = window.$notification.create({
          content: '已开启矩形绘制，右键下载瓦片',
          duration: 10000,
        });
        map.startDraw();
      } else {
        map.endDraw();
      }
    },
    hideDrawTips() {
      if (this._drawStartInfo) {
        this._drawStartInfo.destroy();
        this._drawStartInfo = null;
      }
    },
    // 地图右键下载瓦片
    addMapRightClickHandle() {
      map.getMap().addEventListener('contextmenu', () => {
        if (!this.isDrawing) return;
        if (!this.showSave(false)) {
          setTimeout(() => {
            this.isDrawing = false;
            map.endDraw();
            this.hideDrawTips();
          }, 50);
          return;
        }
      });
    },
    showSave(showMsg = true) {
      this.downloadExtent = map.getDownloadExtent();
      if (!this.downloadExtent) {
        if (showMsg) window.$message.warning('获取下载范围错误，请重新绘制下载范围');
        return false;
      }
      const {tileLayer,maxZoom,minZoom,projection} = map.getBaseMapConfig();
      this.saveLayers = tileLayer;
      this.limitMaxZoom = maxZoom;
      this.limitMinZoom = minZoom;
      this.isBaidu = projection.code === 'BAIDU';
      this.saveVisible = true;
      map.fitExtent();
      setMapLoading(true);
      return true;
    },
    save(val) {
      this.saveVisible = false;
      this.$nextTick(() => {
        const mapConfig = map.getBaseMapConfig();
        val.mapConfig = mapConfig;
        if (val.clipImage) {
          val.downloadGeometry = map.getDownloadGeometry();
        }
        new FileSave(val);
      });
    },
    cancelSave() {
      setMapLoading(false);
      this.saveVisible = false;
    },
    showHelp(val) {
      this.helpVisible = val;
    },
    showSet(val) {
      this.setVisible = val;
      if (!val && this._currentLayer && (this._currentLayer.parent === 'Tdt' || this._currentLayer.parent === 'Mapbox')) {
        map.switchBaseLayer(this._currentLayer);
      }
    },
    chooseArea(data) {
      // 结束绘制
      this.isDrawing = false;
      map.endDraw();
      this.hideDrawTips();
      // 添加区域至地图
      const {geojson} = data;
      // console.log(option);
      map.addGeometry(geojson, true, () => {
        this.showSave();
      });
      map.fitExtent();
    },
    showGrid(val) {
      map.showTileGrid(val);
    },
  },
});
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style lang="scss" scoped>
.loadingSpin{
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}
#map{
  position: absolute;
  margin: 0;
  padding: 0;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
.box-controls{
  position: absolute;
  left: 70px;
  top: 10px;
  background-color: white;
  box-shadow: 0px 2px 4px 0px rgb(54 58 80 / 30%);
  // width: 200px;
  padding: 8px;
  display: flex;
  // .items{
  //   width: 20px;
  //   height: 20px;
  //   background-size: contain;
  //   background-repeat: no-repeat;
  //   background-position: center center;
  //   cursor: pointer;
  // }
  .splitline{
    width: 1px;
    height: 20px;
    margin: 0 8px;
    background-color: #999999;
  }
}

</style>
