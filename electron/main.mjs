/**
 * Electron 主进程入口
 *
 * 启动顺序：
 *   1. 解析/播种可写数据目录，并把 cwd 切到该目录（对齐服务端的 process.cwd() 约定）
 *   2. 拉起本地执行 Runner（127.0.0.1:7523）
 *   3. 打开窗口：
 *      - 开发模式（ELECTRON_DEV=1）：加载 Vite dev server（默认 http://127.0.0.1:3030）
 *      - 生产模式：启动 SSR 宿主服务（dist/server 的 fetch handler + dist/client 静态资源）
 *
 * 退出时回收 Runner 与 SSR 服务。
 */

import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DATA_DIR, DEV_SERVER_URL, ensureDataDir, isDev } from './paths.mjs'
import { startRunner, stopRunner } from './runner-manager.mjs'
import { startSsrServer } from './ssr-server.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow
let ssrServer

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#ffffff',
    show: false,
    title: 'Picop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => {
    mainWindow = undefined
  })

  // 外链一律交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target)
    return { action: 'deny' }
  })

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' })

  mainWindow.loadURL(url)
}

async function bootstrap() {
  ensureDataDir()
  process.chdir(DATA_DIR)

  await startRunner()

  // 开发模式：直接加载 Vite dev server（HMR），不托管 dist 产物
  if (isDev) {
    createWindow(DEV_SERVER_URL)
    return
  }

  ssrServer = await startSsrServer()
  createWindow(ssrServer.url)
}

/** 当前应加载的页面地址（dev=Vite dev server；否则=内置 SSR 宿主） */
function resolveAppUrl() {
  return isDev ? DEV_SERVER_URL : ssrServer?.url
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app
    .whenReady()
    .then(bootstrap)
    .catch((err) => {
      console.error('[desktop] 启动失败:', err)
      app.quit()
    })

  app.on('activate', () => {
    const url = resolveAppUrl()
    if (BrowserWindow.getAllWindows().length === 0 && url) {
      createWindow(url)
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    stopRunner()
    ssrServer?.close()
  })
}
