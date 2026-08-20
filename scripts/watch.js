#!/usr/bin/env node

const {createServer, build, createLogger} = require('vite');
const electronPath = require('electron');
const {spawn} = require('child_process');
const esbuild = require('esbuild');
const chokidar = require('chokidar');


/** @type 'production' | 'development'' */
const mode = process.env.MODE = process.env.MODE || 'development';


/** @type {import('vite').LogLevel} */
const LOG_LEVEL = 'info';


/** @type {import('vite').InlineConfig} */
const sharedConfig = {
  mode,
  build: {
    watch: {},
  },
  logLevel: LOG_LEVEL,
};

/** Messages on stderr that match any of the contained patterns will be stripped from output */
const stderrFilterPatterns = [
  // warning about devtools extension
  // https://github.com/cawa-93/vite-electron-builder/issues/492
  // https://github.com/MarshallOfSound/electron-devtools-installer/issues/143
  /ExtensionLoadWarning/,
];

/**
 * 
 * @param {{name: string; configFile: string; writeBundle: import('rollup').OutputPlugin['writeBundle'] }} param0 
 * @returns {import('rollup').RollupWatcher}
 */
const getWatcher = ({name, configFile, writeBundle}) => {
  return build({
    ...sharedConfig,
    configFile,
    plugins: [{name, writeBundle}],
  });
};


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
 * Start or restart App when source files are changed
 * @param {import('vite').ViteDevServer} viteDevServer
 * @returns {Promise<import('vite').RollupOutput | Array<import('vite').RollupOutput> | import('vite').RollupWatcher>}
 */
const setupMainPackageWatcher = (viteDevServer) => {
  // Write a value to an environment variable to pass it to the main process.
  {
    const protocol = `http${viteDevServer.config.server.https ? 's' : ''}:`;
    const host = viteDevServer.config.server.host || 'localhost';
    const port = viteDevServer.config.server.port; // Vite searches for and occupies the first free port: 3000, 3001, 3002 and so on
    const path = '/';
    process.env.VITE_DEV_SERVER_URL = `${protocol}//${host}:${port}${path}`;
  }

  const logger = createLogger(LOG_LEVEL, {
    prefix: '[main]',
  });

  /** @type {ChildProcessWithoutNullStreams | null} */
  let spawnProcess = null;

  return getWatcher({
    name: 'reload-app-on-main-package-change',
    configFile: 'packages/main/vite.config.js',
    async writeBundle() {
      // vite 构建会清空 dist，必须在 electron 启动前重新生成独立 downloadWorker 文件
      try {
        await buildDownloadWorker();
      } catch (e) {
        logger.error(`Failed to build downloadWorker: ${e.message}`, { timestamp: true });
      }

      if (spawnProcess !== null) {
        spawnProcess.kill('SIGINT');
        spawnProcess = null;
      }

      spawnProcess = spawn(String(electronPath), ['.']);

      spawnProcess.stdout.on('data', d => d.toString().trim() && logger.warn(d.toString(), {timestamp: true}));
      spawnProcess.stderr.on('data', d => {
        const data = d.toString().trim();
        if (!data) return;
        const mayIgnore = stderrFilterPatterns.some((r) => r.test(data));
        if (mayIgnore) return;
        logger.error(data, { timestamp: true });
      });
    },
  });
};


/**
 * Start or restart App when source files are changed
 * @param {import('vite').ViteDevServer} viteDevServer
 * @returns {Promise<import('vite').RollupOutput | Array<import('vite').RollupOutput> | import('vite').RollupWatcher>}
 */
const setupPreloadPackageWatcher = (viteDevServer) => {
  return getWatcher({
    name: 'reload-page-on-preload-package-change',
    configFile: 'packages/preload/vite.config.js',
    writeBundle() {
      viteDevServer.ws.send({
        type: 'full-reload',
      });
    },
  });
};

(async () => {
  try {
    const viteDevServer = await createServer({
      ...sharedConfig,
      configFile: 'packages/renderer/vite.config.js',
    });

    await viteDevServer.listen();

    await setupPreloadPackageWatcher(viteDevServer);
    await setupMainPackageWatcher(viteDevServer);

    // downloadWorker 通过 require('./downloadWorker') 动态加载，不在 vite 构建图内，
    // 需要单独监听其源码变化并重建
    chokidar.watch('packages/main/src/downloadWorker.js').on('change', () => {
      buildDownloadWorker().catch((e) => console.error('[main] Failed to rebuild downloadWorker:', e));
    });
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
