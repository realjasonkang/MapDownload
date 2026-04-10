// 下载进度
let downloading = false; // 下载状态
const statistics = {success: 0, error: 0, percentage: 0, count: 0}; // 进度统计
let progressDom = null;
let successDom = null;
let errorDom = null;
let containerDom = null;
let statusCallback = null;
export function getState() {
  return downloading;
}
export function setState(val) {
  downloading = val;
  if (val) {
    setProgress({success: 0, error: 0, percentage: 0});
    showProgress(true);
  }
  notifyStatusChange({ downloading });
}
export function getProgress() {
  return statistics;
}
export function setProgress(val) {
  const {success, error, percentage, count} = val;
  if (typeof success !== 'undefined') statistics.success = success;
  if (typeof error !== 'undefined') statistics.error = error;
  if (typeof percentage !== 'undefined') statistics.percentage = percentage;
  if (typeof count !== 'undefined') statistics.count = count;
  updateProgress();
  notifyStatusChange({ statistics: { ...statistics } });
}
export function setProgressDom(val) {
  progressDom = val.progress;
  successDom = val.success;
  errorDom = val.error;
  containerDom = val.container;
}
export function showProgress(visible) {
  containerDom.style.display = visible ? 'block' : 'none';
}
function updateProgress() {
  progressDom.value = statistics.percentage;
  // successDom.innerText = `${statistics.success}/${statistics.count}`;
  successDom.innerText = `${statistics.success}`;
  errorDom.innerText = statistics.error;
}

export function progressAddSuccess() {
  statistics.success++;
  updateProgress();
}
export function progressAddError() {
  statistics.error++;
  updateProgress();
}

/**
 * 注册状态更新回调函数
 * @param {Function} callback - 状态更新回调函数
 */
export function setStatusCallback(callback) {
  statusCallback = callback;
}

/**
 * 移除状态更新回调函数
 */
export function removeStatusCallback() {
  statusCallback = null;
}

/**
 * 触发状态更新回调
 * @param {Object} status - 状态信息
 */
export function notifyStatusChange(status) {
  if (statusCallback && typeof statusCallback === 'function') {
    statusCallback(status);
  }
}
