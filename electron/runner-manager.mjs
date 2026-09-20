/**
 * 本地执行 Runner 的生命周期管理
 *
 * Runner（runner/server.mjs）是零依赖 Node 脚本，负责所有需要凭据/本机环境的操作。
 * 打包后的 App 未必有系统 node，故统一用 Electron 自带 Node 运行：
 *   ELECTRON_RUN_AS_NODE=1 + process.execPath
 * 并且 cwd 固定为 DATA_DIR，使 model.conf.json 等路径与主进程保持一致。
 */

import { spawn } from 'node:child_process'
import path from 'node:path'

import { DATA_DIR, RUNNER_ENTRY } from './paths.mjs'

const RUNNER_PORT = Number(process.env.RUNNER_PORT || 7523)
const RUNNER_HOST = process.env.RUNNER_HOST || '127.0.0.1'

let child

export function runnerBaseUrl() {
  return `http://${RUNNER_HOST}:${RUNNER_PORT}`
}

async function waitForRunner(timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${runnerBaseUrl()}/ping`)
      if (res.ok) return
    } catch {
      // 尚未就绪，继续轮询
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('Runner 启动超时')
}

/** 启动 Runner（幂等：已在运行则直接返回） */
export async function startRunner() {
  if (child) return

  child = spawn(process.execPath, [RUNNER_ENTRY], {
    cwd: DATA_DIR,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      RUNNER_PORT: String(RUNNER_PORT),
      RUNNER_HOST,
      RUNNER_MODEL_CONF: path.join(DATA_DIR, 'model.conf.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (d) => process.stdout.write(`[runner] ${d}`))
  child.stderr.on('data', (d) => process.stderr.write(`[runner] ${d}`))
  child.on('exit', () => {
    child = undefined
  })

  await waitForRunner()
}

/** 停止 Runner */
export function stopRunner() {
  if (!child) return
  try {
    child.kill('SIGTERM')
  } catch {
    // 忽略退出竞态
  }
  child = undefined
}
