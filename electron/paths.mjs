/**
 * 桌面端路径解析
 *
 * 统一 dev 与打包后的目录差异：
 *   - APP_ROOT   应用根（dev=项目根；打包后=resources/app，asar 已关闭均为真实文件）
 *   - SERVER_ENTRY / CLIENT_DIR  SSR 产物入口与前端静态资源目录
 *   - RUNNER_ENTRY  本地执行 Runner 脚本
 *   - DATA_DIR   可写数据目录（workflows/memory/prompts/.bmad/.skills/model.conf.json 的家）
 *
 * 服务端大量逻辑以 process.cwd() 为基准读取数据，因此启动时会把 cwd 切换到 DATA_DIR，
 * 保证 dev 与打包后行为一致。
 */

import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/** 是否已打包（决定数据目录与静态产物来源） */
export const isPackaged = app.isPackaged

/**
 * 是否开发模式：显式由 ELECTRON_DEV=1 开启（见 dev / dev:all 脚本）。
 * 与 isPackaged 解耦——`npm start`（electron .，未打包但按生产跑）不算开发模式。
 */
export const isDev = process.env.ELECTRON_DEV === '1'

/** 开发模式下 Electron 加载的 Vite dev server 地址（与 vite server.host 一致，固定 IPv4） */
export const DEV_SERVER_URL =
  process.env.ELECTRON_DEV_URL || 'http://127.0.0.1:3030'

/** 应用根目录（含 dist/ runner/ node_modules/ 等） */
export const APP_ROOT = app.getAppPath()

export const SERVER_ENTRY = path.join(APP_ROOT, 'dist', 'server', 'server.js')
export const CLIENT_DIR = path.join(APP_ROOT, 'dist', 'client')
export const RUNNER_ENTRY = path.join(APP_ROOT, 'runner', 'server.mjs')

/** 可写数据目录：未打包直接用项目根；打包后用 userData 并在首次启动时播种 */
export const DATA_DIR = isPackaged
  ? path.join(app.getPath('userData'), 'data')
  : APP_ROOT

/** 需要随应用分发、并在打包后首次启动时复制到 DATA_DIR 的数据目录 */
const SEED_DIRS = [
  'workflows',
  'memory',
  'prompts',
  '.bmad',
  '.skills',
  '.lark',
]
/** 需要播种的单文件（存在才复制，避免覆盖用户配置） */
const SEED_FILES = ['model.conf.json']

/** 确保数据目录存在；打包后首次启动时从应用资源播种默认数据 */
export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!isPackaged) return DATA_DIR

  for (const name of SEED_DIRS) {
    const src = path.join(APP_ROOT, name)
    const dest = path.join(DATA_DIR, name)
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      fs.cpSync(src, dest, { recursive: true })
    }
  }
  for (const name of SEED_FILES) {
    const src = path.join(APP_ROOT, name)
    const dest = path.join(DATA_DIR, name)
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      fs.copyFileSync(src, dest)
    }
  }
  return DATA_DIR
}
