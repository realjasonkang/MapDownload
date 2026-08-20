/**
 * 配置管理工具
 * 管理应用程序的各种配置项，包括下载并发度等
 */

// 配置常量
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 16;
const DEFAULT_MIN_CONCURRENCY = 2;
const DEFAULT_MAX_CONCURRENCY = 8;

// localStorage 键名
const STORAGE_KEY = 'downloadConcurrency';

/**
 * 获取默认下载并发度
 * 默认值为 CPU 核心数，限制在 [2, 8] 范围内
 *
 * @returns {number} 默认并发度
 */
function getDefaultConcurrency() {
  // 获取 CPU 核心数，如果无法获取则默认为 4
  const cpuCores = navigator.hardwareConcurrency || 4;

  // 限制在 [DEFAULT_MIN_CONCURRENCY, DEFAULT_MAX_CONCURRENCY] 范围内
  return Math.min(Math.max(cpuCores, DEFAULT_MIN_CONCURRENCY), DEFAULT_MAX_CONCURRENCY);
}

/**
 * 验证并发度配置值是否有效
 *
 * @param {number} value - 待验证的并发度值
 * @returns {boolean} 是否有效
 */
function validateConcurrency(value) {
  // 检查是否为数字
  if (typeof value !== 'number' || isNaN(value)) {
    return false;
  }

  // 检查是否为整数
  if (!Number.isInteger(value)) {
    return false;
  }

  // 检查是否在有效范围内
  if (value < MIN_CONCURRENCY || value > MAX_CONCURRENCY) {
    return false;
  }

  return true;
}

/**
 * 获取下载并发度配置
 * 优先从 localStorage 读取用户配置，如果无效或不存在则返回默认值
 *
 * @returns {number} 下载并发度（1-16）
 */
export function getDownloadConcurrency() {
  try {
    // 尝试从 localStorage 读取配置
    const stored = localStorage.getItem(STORAGE_KEY);

    if (stored !== null) {
      const value = parseInt(stored, 10);

      // 验证配置值是否有效
      if (validateConcurrency(value)) {
        return value;
      }

      // 配置值无效，输出警告并使用默认值
      console.warn(
        `[Config] Invalid download concurrency value: ${stored}. ` +
        `Valid range: [${MIN_CONCURRENCY}, ${MAX_CONCURRENCY}]. ` +
        'Using default value.',
      );
    }
  } catch (error) {
    // localStorage 访问失败（如隐私模式），输出警告
    console.warn('[Config] Failed to read download concurrency from localStorage:', error);
  }

  // 返回默认值
  return getDefaultConcurrency();
}

/**
 * 设置下载并发度配置
 * 将配置保存到 localStorage，并验证配置值的有效性
 *
 * @param {number} value - 要设置的并发度值（1-16）
 * @returns {boolean} 是否设置成功
 */
export function setDownloadConcurrency(value) {
  // 验证配置值
  if (!validateConcurrency(value)) {
    console.error(
      `[Config] Failed to set download concurrency: ${value}. ` +
      `Valid range: [${MIN_CONCURRENCY}, ${MAX_CONCURRENCY}].`,
    );
    return false;
  }

  try {
    // 保存到 localStorage
    localStorage.setItem(STORAGE_KEY, value.toString());
    console.log(`[Config] Download concurrency set to: ${value}`);
    return true;
  } catch (error) {
    // localStorage 访问失败（如隐私模式、存储已满）
    console.error('[Config] Failed to save download concurrency to localStorage:', error);
    return false;
  }
}

/**
 * 重置下载并发度配置为默认值
 *
 * @returns {boolean} 是否重置成功
 */
export function resetDownloadConcurrency() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    console.log('[Config] Download concurrency reset to default');
    return true;
  } catch (error) {
    console.error('[Config] Failed to reset download concurrency:', error);
    return false;
  }
}

/**
 * 获取合并下载并发度配置
 * 合并任务每个瓦片需下载多个图层并执行 sharp 合成，负载远高于普通下载，
 * 因此使用比普通并发更低的并发度，避免大量合成操作同时进行导致卡死。
 *
 * @returns {number} 合并下载并发度（1-16）
 */
export function getMergeConcurrency() {
  const base = getDownloadConcurrency();
  return Math.max(1, Math.min(4, Math.floor(base / 2)));
}

/**
 * 获取并发度配置范围信息
 *
 * @returns {Object} 包含最小值、最大值、默认值等信息的对象
 */
export function getConcurrencyConfig() {
  return {
    min: MIN_CONCURRENCY,
    max: MAX_CONCURRENCY,
    defaultMin: DEFAULT_MIN_CONCURRENCY,
    defaultMax: DEFAULT_MAX_CONCURRENCY,
    cpuCores: navigator.hardwareConcurrency || 4,
    current: getDownloadConcurrency(),
  };
}
