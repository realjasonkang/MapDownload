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
      v-if="isDownloading && performanceStats"
      class="item performance"
    >
      速度:<span class="speed">{{ speedText }} 瓦片/秒</span>
    </div>
    <div
      v-if="isDownloading && performanceStats"
      class="item performance"
    >
      线程:<span class="threads">{{ activeThreadsText }}</span>
    </div>
    <div
      v-if="isDownloading && performanceStats"
      class="item performance"
    >
      耗时:<span class="time">{{ elapsedTimeText }}</span>
    </div>
    <div
      v-if="showFinalStats"
      class="item final-stats"
    >
      <div class="stats-title">
        性能统计
      </div>
      <div class="stats-item">
        平均速度: <span class="avg-speed">{{ avgSpeedText }} 瓦片/秒</span>
      </div>
      <div class="stats-item">
        总耗时: <span class="total-time">{{ elapsedTimeText }}</span>
      </div>
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
      performanceStats: null,
      performanceTimer: null,
      finalStats: null,
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
    speedText() {
      if (!this.performanceStats) return '0';
      return this.performanceStats.speed || '0';
    },
    activeThreadsText() {
      if (!this.performanceStats) return '0';
      return `${this.performanceStats.activeThreads || 0}/${this.performanceStats.maxThreads || 0}`;
    },
    elapsedTimeText() {
      if (!this.performanceStats) return '0秒';
      const seconds = this.performanceStats.elapsedTime || 0;
      if (seconds < 60) return `${seconds}秒`;
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${minutes}分${secs}秒`;
    },
    avgSpeedText() {
      if (!this.finalStats && !this.performanceStats) return '0';
      const stats = this.finalStats || this.performanceStats;
      return stats.avgSpeed || '0';
    },
    showFinalStats() {
      return !this.isDownloading && this.finalStats;
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
    this.startPerformanceTimer();
  },
  beforeUnmount() {
    removeStatusCallback();
    this.stopPerformanceTimer();
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

      if (status.isDownloading && status.performance) {
        this.performanceStats = status.performance;
      }
    },
    startPerformanceTimer() {
      this.stopPerformanceTimer();
      this.performanceTimer = setInterval(() => {
        if (this.isDownloading) {
          const status = getDownloadStatus();
          if (status.performance) {
            this.performanceStats = status.performance;
          }
        }
      }, 1000);
    },
    stopPerformanceTimer() {
      if (this.performanceTimer) {
        clearInterval(this.performanceTimer);
        this.performanceTimer = null;
      }
    },
    onStatusChange(status) {
      if (status.downloading !== undefined) {
        this.isDownloading = status.downloading;
        if (!status.downloading) {
          const progress = getProgress();
          this.failedCount = progress.error || 0;
          this.showRetryButton = this.failedCount > 0;

          // 保存最终性能统计
          if (this.performanceStats) {
            this.finalStats = { ...this.performanceStats };
          }
        } else {
          this.showRetryButton = false;
          this.finalStats = null;
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
      if (status.performance) {
        this.performanceStats = status.performance;
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
  .performance {
    font-size: 11px;
    color: #666;
    .speed {
      color: #18a058;
      font-weight: 500;
    }
    .threads {
      color: #2080f0;
      font-weight: 500;
    }
    .time {
      color: #f0a020;
      font-weight: 500;
    }
  }
  .final-stats {
    margin-top: 8px;
    padding: 6px;
    background-color: #f5f7fa;
    border-radius: 4px;
    border-left: 3px solid #18a058;
    .stats-title {
      font-size: 12px;
      font-weight: bold;
      color: #333;
      margin-bottom: 4px;
    }
    .stats-item {
      font-size: 11px;
      color: #666;
      margin: 2px 0;
      .avg-speed {
        color: #18a058;
        font-weight: 500;
      }
      .total-time {
        color: #f0a020;
        font-weight: 500;
      }
    }
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
