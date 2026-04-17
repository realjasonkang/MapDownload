<template>
  <n-modal
    :show="showModal"
    :show-icon="false"
    :on-mask-click="cancel"
    :on-esc="cancel"
    :on-close="cancel"
    preset="dialog"
  >
    <template #header>
      设置
    </template>
    <div class="dialog-content">
      <!-- 地图密钥配置区域 -->
      <div class="section-title">
        地图密钥配置
      </div>
      <div class="item">
        <span class="label">天地图：</span>
        <input
          v-model="tdtKey"
          class="value"
          type="text"
          placeholder="请输入天地图密钥"
        >
      </div>
      <div class="item">
        <span class="label">MapBox：</span>
        <input
          v-model="mapboxKey"
          class="value"
          type="text"
          placeholder="请输入MapBox密钥"
        >
      </div>
      
      <!-- 分隔线 -->
      <n-divider style="margin: 16px 0;" />
      
      <!-- 下载设置区域 -->
      <div class="section-title">
        下载设置
      </div>
      <div class="item">
        <span class="label">下载线程数：</span>
        <input
          v-model.number="downloadConcurrency"
          class="value"
          type="number"
          :min="configInfo.min"
          :max="configInfo.max"
          placeholder="请输入线程数"
        >
        <span class="unit">个</span>
      </div>
      <div class="config-info">
        <div class="info-item">
          当前 CPU 核心数: {{ configInfo.cpuCores }} 核
        </div>
        <div class="info-item">
          有效范围: {{ configInfo.min }} - {{ configInfo.max }} 个线程
        </div>
        <div class="info-item">
          默认范围: {{ configInfo.defaultMin }} - {{ configInfo.defaultMax }} 个线程
        </div>
      </div>
      <div class="config-tip">
        <n-alert
          type="info"
          :bordered="false"
        >
          <template #default>
            建议设置为 CPU 核心数的 1-2 倍，可获得最佳下载性能。线程数过少无法充分利用网络带宽，过多可能导致系统资源不足或被服务器限流。修改后将在下次下载时生效。
          </template>
        </n-alert>
      </div>
    </div>
    <template #action>
      <n-button @click="resetToDefault">
        恢复默认
      </n-button>
      <n-button @click="cancel">
        取消
      </n-button>
      <n-button
        type="info"
        @click="ok"
      >
        确定
      </n-button>
    </template>
  </n-modal>
</template>

<script>
import { defineComponent } from 'vue';
import { getKeys, setKeys } from '/@/utils/mapKey.js';
import {
  setDownloadConcurrency,
  resetDownloadConcurrency,
  getConcurrencyConfig,
} from '/@/utils/config.js';
import { useMessage } from 'naive-ui';

export default defineComponent({
  name: 'MapKey',
  props: {
    visible: {
      required: true,
      type: Boolean,
    },
  },
  setup() {
    const message = useMessage();
    return { message };
  },
  data() {
    return {
      showModal: false,
      tdtKey: '',
      mapboxKey: '',
      downloadConcurrency: 4,
      configInfo: {
        min: 1,
        max: 16,
        defaultMin: 2,
        defaultMax: 8,
        cpuCores: 4,
        current: 4,
      },
    };
  },
  watch: {
    visible() {
      this.showModal = this.visible;
      if (this.visible) {
        this.loadConfig();
      }
    },
  },
  created() {
    this.showModal = this.visible;
  },
  mounted() {
    this.loadConfig();
  },
  methods: {
    /**
     * 加载所有配置信息
     */
    loadConfig() {
      // 加载地图密钥
      const data = getKeys();
      this.tdtKey = data?.tdtKey || '';
      this.mapboxKey = data?.mapboxKey || '';

      // 加载下载线程数配置
      const config = getConcurrencyConfig();
      this.configInfo = config;
      this.downloadConcurrency = config.current;
    },
    /**
     * 重置为默认配置
     */
    resetToDefault() {
      if (resetDownloadConcurrency()) {
        const config = getConcurrencyConfig();
        this.configInfo = config;
        this.downloadConcurrency = config.current;
        this.message.success('已恢复默认下载线程数配置');
      } else {
        this.message.error('重置配置失败');
      }
    },
    cancel() {
      // eslint-disable-next-line
      this.$emit('hide');
    },
    /**
     * 保存所有配置
     */
    ok() {
      // 保存地图密钥
      setKeys({
        tdtKey: this.tdtKey || '',
        mapboxKey: this.mapboxKey || '',
      });

      // 保存下载线程数配置
      if (setDownloadConcurrency(this.downloadConcurrency)) {
        this.message.success('配置保存成功');
      } else {
        this.message.error('下载线程数配置保存失败，请检查输入值是否有效');
      }

      this.cancel();
    },
  },
});
</script>

<style lang="scss" scoped>
.dialog-content{
  width: 100%;
  padding: 8px 16px;

  .section-title {
    font-size: 14px;
    font-weight: 600;
    color: #333;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid #e0e0e0;
  }

  .item{
    margin: 8px 0;
    display: flex;
    align-items: center;
  }
  .label{
    display: inline-block;
    width: 100px;
    text-align: right;
    margin-right: 8px;
  }
  .value{
    display: inline-block;
    width: 260px;
    padding: 4px 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
    
    &:focus {
      outline: none;
      border-color: #18a058;
    }
  }
  .unit {
    margin-left: 8px;
    color: #666;
    font-size: 14px;
  }

  .config-info {
    margin-top: 12px;
    padding: 12px;
    background-color: rgba(24, 160, 88, 0.05);
    border-radius: 4px;
    border: 1px solid rgba(24, 160, 88, 0.2);

    .info-item {
      font-size: 13px;
      color: #666;
      line-height: 1.8;
    }
  }

  .config-tip {
    margin-top: 12px;
  }
}
</style>
