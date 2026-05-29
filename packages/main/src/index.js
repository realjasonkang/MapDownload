import {app, BrowserWindow, shell} from 'electron';
import {join} from 'path';
import {URL} from 'url';
import  { ipcHandle } from './ipcMain';


const isSingleInstance = app.requestSingleInstanceLock();
const isDevelopment = import.meta.env.MODE === 'development';

// 全局错误处理，防止未捕获的异常导致应用崩溃
process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught Exception:', error);
  // 对于网络相关的 "aborted" 错误，不退出应用，仅记录日志
  if (error.message === 'aborted' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
    console.warn('[Main] Network error caught, app continues running');
    return;
  }
  // 其他严重错误，记录日志但也不退出（避免影响用户体验）
  console.error('[Main] Non-network error, continuing to run');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Main] Unhandled Rejection at:', promise, 'reason:', reason);
});

if (!isSingleInstance) {
  app.quit();
  process.exit(0);
}

app.disableHardwareAcceleration();

// Install "Vue.js devtools"
if (isDevelopment) {
  app.whenReady()
    .then(() => import('electron-devtools-installer'))
    .then(({default: installExtension, VUEJS3_DEVTOOLS}) => installExtension(VUEJS3_DEVTOOLS, {
      loadExtensionOptions: {
        allowFileAccess: true,
      },
    }))
    .catch(e => console.error('Failed install extension:', e));
}

let mainWindow = null;

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    show: false, // Use 'ready-to-show' event to show window
    webPreferences: {
      nativeWindowOpen: true,
      // nodeIntegration: true,
      width: 800,
      height: 600,
      preload: join(__dirname, '../../preload/dist/index.cjs'),
    },
  });

  /**
   * If you install `show: true` then it can cause issues when trying to close the window.
   * Use `show: false` and listener events `ready-to-show` to fix these issues.
   *
   * @see https://github.com/electron/electron/issues/25012
   */
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();

    if (isDevelopment) {
      mainWindow?.webContents.openDevTools();
    }
  });

  /**
   * URL for main window.
   * Vite dev server for development.
   * `file://../renderer/index.html` for production and test
   */
  const pageUrl = isDevelopment && import.meta.env.VITE_DEV_SERVER_URL !== undefined
    ? import.meta.env.VITE_DEV_SERVER_URL
    : new URL('../renderer/dist/index.html', 'file://' + __dirname).toString();


  await mainWindow.loadURL(pageUrl, {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  ipcHandle(mainWindow);
};

 app.on('web-contents-created', (_event, contents) => {

  /**
   * Block navigation to origins not on the allowlist.
   *
   * Navigation is a common attack vector. If an attacker can convince the app to navigate away
   * from its current page, they can possibly force the app to open web sites on the Internet.
   *
   * @see https://www.electronjs.org/docs/latest/tutorial/security#13-disable-or-limit-navigation
   */
  contents.on('will-navigate', (event, url) => {
    const allowedOrigins =
      new Set(); // Do not use insecure protocols like HTTP. https://www.electronjs.org/docs/latest/tutorial/security#1-only-load-secure-content
    const { origin, hostname } = new URL(url);
    const isDevLocalhost = isDevelopment && hostname === 'localhost'; // permit live reload of index.html
    if (!allowedOrigins.has(origin) && !isDevLocalhost){
      console.warn('Blocked navigating to an unallowed origin:', origin);
      event.preventDefault();
    }
  });

  /**
  * Hyperlinks to allowed sites open in the default browser.
  *
  * The creation of new `webContents` is a common attack vector. Attackers attempt to convince the app to create new windows,
  * frames, or other renderer processes with more privileges than they had before; or with pages opened that they couldn't open before.
  * You should deny any unexpected window creation.
  *
  * @see https://www.electronjs.org/docs/latest/tutorial/security#14-disable-or-limit-creation-of-new-windows
  * @see https://www.electronjs.org/docs/latest/tutorial/security#15-do-not-use-openexternal-with-untrusted-content
  */
  contents.setWindowOpenHandler(({ url }) => {
    const allowedOrigins =
      new Set([ // Do not use insecure protocols like HTTP. https://www.electronjs.org/docs/latest/tutorial/security#1-only-load-secure-content
      'https://vitejs.dev',
      'https://github.com',
      'https://v3.vuejs.org']);
    const { origin } = new URL(url);
    if (allowedOrigins.has(origin)){
      shell.openExternal(url);
    } else {
      console.warn('Blocked the opening of an unallowed origin:', origin);
    }
    return { action: 'deny' };
  });
});


app.on('second-instance', () => {
  // Someone tried to run a second instance, we should focus our window.
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});


app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


app.whenReady()
  .then(createWindow)
  .catch((e) => console.error('Failed create window:', e));


// Auto-updates
if (import.meta.env.PROD) {
  app.whenReady()
    .then(() => import('electron-updater'))
    .then(({autoUpdater}) => autoUpdater.checkForUpdatesAndNotify())
    .catch((e) => console.error('Failed check updates:', e));
}

