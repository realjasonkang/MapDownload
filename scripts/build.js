#!/usr/bin/env node
const {build} = require('vite');
const esbuild = require('esbuild');

/** @type 'production' | 'development' */
const mode = process.env.MODE = process.env.MODE || 'production';

const packagesConfigs = [
  'packages/main/vite.config.js',
  'packages/preload/vite.config.js',
  'packages/renderer/vite.config.js',
];


/**
 * 构建 downloadWorker 为独立 CJS 文件
 * 主进程通过 require('./downloadWorker') 动态加载它并作为 worker 线程入口，
 * 必须输出到 dist 目录，否则运行时 require 找不到模块导致 worker 模式被禁用
 */
async function buildDownloadWorker() {
  await esbuild.build({
    entryPoints: ['packages/main/src/downloadWorker.js'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    external: ['sharp', 'superagent', 'fs-extra'],
    outfile: 'packages/main/dist/downloadWorker.js',
    sourcemap: 'inline',
  });
}

/**
 * Run `vite build` for config file
 */
const buildByConfig = (configFile) => build({configFile, mode});
(async () => {
  try {
    const totalTimeLabel = 'Total bundling time';
    console.time(totalTimeLabel);

    for (const packageConfigPath of packagesConfigs) {
      console.time(`Building ${packageConfigPath}`);
      console.group();
      console.time('Bundling time');
      console.group(packageConfigPath);
      await buildByConfig(packageConfigPath);

      // 主包构建后，额外构建独立 downloadWorker 文件（dist 会被 vite emptyOutDir 清空，必须在 vite 构建之后生成）
      if (packageConfigPath === 'packages/main/vite.config.js') {
        await buildDownloadWorker();
        console.log('[downloadWorker] bundled successfully');
      }

      console.timeEnd('Bundling time');
      console.groupEnd();
      console.log('\n'); // Just for pretty print
    }
    console.timeEnd(totalTimeLabel);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
