/**
 * 本地 Runner 直连服务
 *
 * 控制面/执行面分离架构：所有需要凭据（模型 key）或本机环境
 * （lark-cli、本地文件）的操作都由用户电脑上的 Runner 执行，
 * 平台只下发命令、回收结果。
 *
 * 策略：Runner 在线时直连 Runner（默认 http://127.0.0.1:7523），
 * 离线时回退到同源服务端路由（本地开发时的 /api/execute/*），
 * 保证未启动 Runner 的存量使用方式不受影响。
 */

export const RUNNER_BASE: string =
  (import.meta.env.VITE_RUNNER_URL as string) || 'http://127.0.0.1:7523'

/** Runner 在线状态缓存（探测结果 + 过期时间，失败短缓存以便 Runner 后启动时自动恢复） */
let probe: { online: boolean; at: number } | null = null
const ONLINE_TTL = 60_000
const OFFLINE_TTL = 5_000

/** 探测 Runner 是否在线（带缓存，避免每个请求都多一次 ping） */
export async function pingRunner(force = false): Promise<boolean> {
  if (!force && probe && Date.now() - probe.at < (probe.online ? ONLINE_TTL : OFFLINE_TTL)) {
    return probe.online
  }
  try {
    const res = await fetch(`${RUNNER_BASE}/ping`, {
      signal: AbortSignal.timeout(1500),
    })
    const data = await res.json()
    probe = { online: data?.status === 'success', at: Date.now() }
  } catch {
    probe = { online: false, at: Date.now() }
  }
  return probe.online
}

/** 当前缓存的在线状态（不发请求） */
export function isRunnerOnline(): boolean {
  return probe?.online === true
}

/**
 * 优先直连 Runner，离线时回退同源服务端路由
 * @param path Runner 路径，如 '/lark'、'/agent'、'/models'（同时也是回退时的服务端路径前缀映射）
 * @param init fetch 参数
 */
export async function runnerFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  if (await pingRunner()) {
    return fetch(`${RUNNER_BASE}${path}`, init)
  }
  // 回退：本地开发/部署时的同源服务端路由
  const fallbackPath = path.startsWith('/models')
    ? '/api/execute/models'
    : path.startsWith('/lark')
      ? '/api/execute/lark'
      : path.startsWith('/file-write')
        ? '/api/execute/fileWrite'
        : path.startsWith('/http-proxy')
          ? '/api/execute/httpProxy'
          : path.startsWith('/model')
            ? '/api/model'
            : `/api/execute${path}`
  return fetch(fallbackPath, init)
}

// === 本地 CLI 工具（agent-cli）===

export interface LocalTool {
  id: string
  name: string
  available: boolean
}

/** 获取本机可用的 CLI agent 工具列表（Runner 离线时返回空数组） */
export async function fetchLocalTools(): Promise<LocalTool[]> {
  if (!(await pingRunner())) return []
  try {
    const res = await fetch(`${RUNNER_BASE}/tools`)
    const data = await res.json()
    return data?.output?.tools || []
  } catch {
    return []
  }
}

/** 本地工具（Claude Code/Codex 等）本机配置的 skill */
export interface LocalToolSkill {
  id: string
  name: string
  description?: string
}

/**
 * 获取本地工具本机配置的 skills 列表（~/.claude/skills、~/.codex/skills 等，
 * 用户自己维护，随所选工具加载；Runner 离线或工具不支持时返回空数组）
 */
export async function fetchLocalToolSkills(toolId: string): Promise<LocalToolSkill[]> {
  if (!toolId || !(await pingRunner())) return []
  try {
    const res = await fetch(
      `${RUNNER_BASE}/tool-skills?tool=${encodeURIComponent(toolId)}`,
    )
    const data = await res.json()
    return data?.output?.skills || []
  } catch {
    return []
  }
}

/** 读取本地工具某技能的内容（SKILL.md，Runner 离线或不存在返回空串） */
export async function fetchLocalToolSkillContent(
  toolId: string,
  skillName: string,
): Promise<string> {
  if (!toolId || !skillName || !(await pingRunner())) return ''
  try {
    const res = await fetch(
      `${RUNNER_BASE}/tool-skill-content?tool=${encodeURIComponent(toolId)}&skill=${encodeURIComponent(skillName)}`,
    )
    const data = await res.json()
    return data?.output?.content || ''
  } catch {
    return ''
  }
}

export interface AgentCliTaskState {
  id: string
  tool: string
  toolName: string
  status: 'running' | 'done' | 'error'
  logs: string[]
  output?: { response: string; tool: string; meta?: Record<string, any> } | null
  error?: string | null
}

/**
 * 启动 CLI agent 异步任务（本地工具跑在用户机器上，平台只收结果）
 * @returns taskId
 */
export async function startAgentCli(body: {
  tool: string
  prompt: string
  auto?: boolean
  timeoutMs?: number
  /** 工作目录（如 codeAgent 在项目路径下执行，可直接读写项目代码） */
  cwd?: string
  /** 让 Runner 预先收集 cwd 的 git diff 附进 prompt（评审场景，CLI 无需执行命令） */
  gitDiff?: boolean
}): Promise<string> {
  const res = await runnerFetch('/agent-cli', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (data.status !== 'success') {
    throw new Error(data.error || '启动本地工具失败')
  }
  return data.output.taskId as string
}

/**
 * 轮询 CLI agent 任务直到完成（done / error）
 * @param taskId startAgentCli 返回的任务 ID
 * @param onProgress 每次轮询的进度回调（任务日志快照）
 */
export async function pollAgentCliTask(
  taskId: string,
  onProgress?: (task: AgentCliTaskState) => void,
): Promise<AgentCliTaskState> {
  const POLL_INTERVAL = 1500
  const MAX_WAIT = 30 * 60_000 // 与 Runner 侧超时上限对齐
  const deadline = Date.now() + MAX_WAIT

  for (;;) {
    if (Date.now() > deadline) {
      throw new Error('等待本地工具执行超时')
    }
    const res = await runnerFetch(`/task/${taskId}`)
    const data = await res.json()
    const task: AgentCliTaskState = data?.output
    if (!task) throw new Error(data?.error || '任务不存在')
    onProgress?.(task)
    if (task.status === 'done' || task.status === 'error') return task
    await new Promise((r) => setTimeout(r, POLL_INTERVAL))
  }
}
