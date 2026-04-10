<template>
  <div
    ref="container"
    class="box-progress"
  >
    <progress
      ref="progress"
      class="progress"
      value="0"
      max="100"
    />
    <div class="item">
      已下载:<span
        ref="progressSuccess"
        class="success"
      />
    </div>
    <div class="item">
      失败:<span
        ref="progressError"
        class="error"
      />
    </div>
    <div
      v-if="memoryUsage"
      class="item memory"
    >
      内存:<span :class="memoryClass">{{ memoryText }}</span>
    </div>
    <div class="controls">
      <button
        v-if="showRetryButton"
        class="retry-btn"
        @click="handleRetry"
      >
        重试失败({{ failedCount }})
      </button>
      <button
        v-if="!isPaused"
        :disabled="!isDownloading"
        @click="handlePause"
      >
        暂停
      </button>
      <button
        v-else
        :disabled="!isDownloading"
        @click="handleResume"
      >
        恢复
      </button>
      <button
        :disabled="!isDownloading"
        @click="handleCancel"
      >
        取消
      </button>
      <button @click="closeProgress">
        关闭
      </button>
    </div>
  </div>
</template>

<script >
import { defineComponent } from 'vue';
import { setProgressDom, showProgress, setStatusCallback, removeStatusCallback, getProgress } from '../utils/progress';
import {
  pauseDownload,
  resumeDownload,
  cancelDownload,
  getDownloadStatus,
  retryFailedTask,
} from '../utils/download';
import { getFailedTilesManager } from '../utils/failedTilesManager';

export default defineComponent({
  name: 'ProgressControl',
  data() {
    return {
      isPaused: false,
      isDownloading: false,
      memoryUsage: null,
      failedCount: 0,
      showRetryButton: false,
    };
  },
  computed: {
    memoryText() {
      if (!this.memoryUsage) return '';
      const usedMB = Math.round(this.memoryUsage.usedJSHeapSize / 1024 / 1024);
      const limitMB = Math.round(this.memoryUsage.jsHeapSizeLimit / 1024 / 1024);
      const percent = Math.round(this.memoryUsage.usageRatio * 100);
      return `${usedMB}MB / ${limitMB}MB (${percent}%)`;
    },
    memoryClass() {
      if (!this.memoryUsage) return '';
      const ratio = this.memoryUsage.usageRatio;
      if (ratio >= 0.85) return 'memory-critical';
      if (ratio >= 0.7) return 'memory-warning';
      return 'memory-normal';
    },
  },
  mounted() {
    setProgressDom({
      success: this.$refs['progressSuccess'],
      error: this.$refs['progressError'],
      progress: this.$refs['progress'],
      container: this.$refs['container'],
    });
    this.checkStatus();
    setStatusCallback(this.onStatusChange);
  },
  beforeUnmount() {
    removeStatusCallback();
  },
  methods: {
    closeProgress() {
      showProgress(false);
    },
    handlePause() {
      pauseDownload();
    },
    handleResume() {
      resumeDownload();
    },
    handleCancel() {
      cancelDownload();
    },
    async handleRetry() {
      if (this.isDownloading) {
        window.$message.warning('下载任务执行中，请稍后重试');
        return;
      }
      try {
        const manager = getFailedTilesManager();
        await manager.init();
        const tasks = await manager.getAllFailedTasks();
        if (tasks.length === 0) {
          window.$message.warning('没有需要重试的失败记录');
          this.showRetryButton = false;
          return;
        }
        const latestTask = tasks[0];
        await retryFailedTask(latestTask);
      } catch (error) {
        console.error('重试下载失败:', error);
        window.$message.error('重试下载失败');
      }
    },
    checkStatus() {
      const status = getDownloadStatus();
      this.isDownloading = status.isDownloading;
      this.memoryUsage = status.memoryUsage;

      if (status.queueStatus) {
        this.isPaused = status.queueStatus.paused;
      }
    },
    onStatusChange(status) {
      if (status.downloading !== undefined) {
        this.isDownloading = status.downloading;
        if (!status.downloading) {
          const progress = getProgress();
          this.failedCount = progress.error || 0;
          this.showRetryButton = this.failedCount > 0;
        } else {
          this.showRetryButton = false;
        }
      }
      if (status.queueStatus) {
        this.isPaused = status.queueStatus.paused;
      }
      if (status.memoryUsage) {
        this.memoryUsage = status.memoryUsage;
      }
      if (status.failedCount !== undefined) {
        this.failedCount = status.failedCount;
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.box-progress{
  position: absolute;
  right: 10px;
  bottom: 10px;
  background-color: white;
  box-shadow: 0px 2px 4px 0px rgb(54 58 80 / 30%);
  width: 200px;
  padding: 8px;
  z-index: 100;
  display: none;
  .progress{
    width: 100%;
  }
  .item{
    text-align: left;
    font-size: 12px;
    margin: 4px 0;
  }
  .memory {
    font-size: 11px;
    color: #666;
  }
  .memory-normal {
    color: #18a058;
  }
  .memory-warning {
    color: #f0a020;
    font-weight: bold;
  }
  .memory-critical {
    color: #d03050;
    font-weight: bold;
  }
  .controls {
    display: flex;
    gap: 4px;
    margin-top: 8px;
    button {
      flex: 1;
      padding: 4px 8px;
      font-size: 12px;
      cursor: pointer;
      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
    .retry-btn {
      background-color: #d03050;
      color: white;
      border: none;
      &:hover {
        background-color: #b02846;
      }
    }
  }
}
</style>
