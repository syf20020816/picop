#!/usr/bin/env node
/**
 * 本地执行 Runner
 *
 * 架构定位：控制面（工作流编辑平台）只负责生成命令/展示结果，
 * 所有需要凭据或本机环境的操作都在用户自己的电脑上执行：
 *   - lark-cli 调用（授权 token 天然 per-user）
 *   - AI 模型调用（model.conf.json 只存在用户机器上，key 不出本机）
 *   - 模型配置 CRUD
 *
 * 安全边界：
 *   - 只绑定 127.0.0.1，不对外网监听
 *   - CORS Origin 白名单：localhost/127.0.0.1 任意端口 + RUNNER_ALLOWED_ORIGINS 环境变量
 *   - lark 命令在本文件内拼装，不接受任意 shell 字符串
 *
 * 启动：node runner/server.mjs
 * 环境变量：
 *   RUNNER_PORT             监听端口，默认 7523
 *   RUNNER_HOST             监听地址，默认 127.0.0.1
 *   RUNNER_MODEL_CONF       model.conf.json 路径，默认 <cwd>/model.conf.json
 *   RUNNER_ALLOWED_ORIGINS  额外允许的 Origin，逗号分隔（统一部署时的平台域名）
 */

import http from 'node:http'
import os from 'node:os'
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.RUNNER_PORT || 7523)
const HOST = process.env.RUNNER_HOST || '127.0.0.1'
const MODEL_CONF =
  process.env.RUNNER_MODEL_CONF ||
  path.resolve(process.cwd(), 'model.conf.json')
const VERSION = '0.1.0'

// === CORS / Origin 校验 ===

/** 判断 Origin 是否在白名单内（无 Origin 的请求视为本机脚本/curl，放行） */
function isOriginAllowed(origin) {
  if (!origin) return true
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin))
    return true
  const extras = (process.env.RUNNER_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return extras.includes(origin)
}

function corsHeaders(req) {
  const origin = req.headers.origin
  return isOriginAllowed(origin)
    ? {
        ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        Vary: 'Origin',
      }
    : {}
}

// === 模型配置 ===

function readModels() {
  try {
    if (fs.existsSync(MODEL_CONF)) {
      const parsed = JSON.parse(fs.readFileSync(MODEL_CONF, 'utf-8'))
      // 配置文件可能是空对象 {} 或损坏内容，统一兜底为空数组
      return Array.isArray(parsed) ? parsed : []
    }
  } catch (err) {
    console.error(`[runner] 读取模型配置失败: ${err.message}`)
  }
  return []
}

function writeModels(models) {
  fs.writeFileSync(MODEL_CONF, JSON.stringify(models, null, 2))
}

/** 从模型 URL 中提取 OpenAI 兼容的 base URL（与 src/services/ai.ts 保持一致） */
function extractBaseUrl(rawUrl) {
  let url = String(rawUrl || '')
    .replace(/\/chat\/completions\/?$/i, '')
    .replace(/\/responses\/?$/i, '')
    .replace(/\/+$/, '')
  const lastSegment = url.split('/').pop() || ''
  if (!/^v\d+$/i.test(lastSegment)) {
    url += '/v1'
  }
  return url
}

/**
 * 调用 OpenAI 兼容的 Chat Completions 接口（纯 fetch，不依赖 AI SDK）
 * 与 src/services/ai.ts 的 callAI 行为对齐：URL 归一化、本地 Ollama 注入 num_ctx
 */
async function callAI({
  model,
  systemPrompt,
  messages = [],
  temperature = 0.3,
}) {
  const baseUrl = extractBaseUrl(model.url)
  const isLocalOllama =
    String(model.url).includes('localhost') ||
    String(model.url).includes('127.0.0.1')

  const body = {
    model: model.modelName,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    temperature,
    ...(model.token?.max ? { max_tokens: model.token.max } : {}),
  }
  if (isLocalOllama && model.token?.max) {
    // Ollama 需要显式扩大上下文窗口（默认 2048 太小）
    body.options = { num_ctx: Math.max(model.token.max, 4096) }
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`模型 API 返回 ${res.status}: ${text.slice(0, 300)}`)
  }

  const data = await res.json()
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? 0,
        }
      : undefined,
  }
}

// === Lark CLI ===

/** 对 shell 双引号内的内容进行转义（与 src/routes/api/execute/lark.ts 保持一致） */
function escapeShellArg(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
}

function executeLark({ action, url, content }) {
  let cmd = ''
  switch (action) {
    case 'read':
      cmd = `lark-cli docs +fetch --doc "${escapeShellArg(url)}" --doc-format markdown --format json`
      break
    case 'write':
      cmd = `lark-cli docs +update --doc "${escapeShellArg(url)}" --command append --doc-format markdown --content "${escapeShellArg(content || '')}" --format json`
      break
    case 'create':
      cmd = `lark-cli docs +create --doc-format markdown --content "${escapeShellArg(content || '新建文档')}" --format json`
      break
    default:
      return {
        status: 'error',
        output: {},
        logs: [`未知操作: ${action}`],
        error: `未知操作类型: ${action}`,
      }
  }

  const logs = [`Lark 操作: ${action}`, `执行命令: ${cmd.slice(0, 120)}...`]
  try {
    const stdout = execSync(cmd, { encoding: 'utf-8', timeout: 30000 })
    const result = JSON.parse(stdout)
    if (result.ok === false) {
      return {
        status: 'error',
        output: { result: stdout, action, url },
        logs: [...logs, `操作失败: ${result.error?.message || '未知错误'}`],
        error: result.error?.message || 'Lark 操作失败',
      }
    }
    return {
      status: 'success',
      output: { result: stdout, action, url, success: true },
      logs: [...logs, `${action} 操作成功`],
    }
  } catch (err) {
    const stderr = err.stderr?.toString() || ''
    const stdout = err.stdout?.toString() || ''
    return {
      status: 'error',
      output: { result: stdout || stderr || err.message, action, url },
      logs: [...logs, `命令失败: ${err.message}`],
      error: `Lark CLI 调用失败: ${err.message}`,
    }
  }
}

// === 本地 CLI 工具（agent-cli）===
//
// Agent 节点可直接使用用户本机的 AI CLI 工具（无头模式），
// 平台不需要任何模型配置：订阅、凭据、本地代码访问全部留在用户机器上。
// 当前支持：Claude Code / Codex CLI / DeepSeek Harness。
// 新增工具只需往 CLI_TOOLS 里加一个 adapter。

const CLI_TOOLS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    cmd: 'claude',
    // Claude Code 的本机 skills 目录（~/.claude/skills，每个子目录一个含 SKILL.md 的技能）
    skillsDir: '~/.claude/skills',
    // -p 无头模式；--output-format json 返回单个 JSON（result 字段为回答）
    buildArgs: (prompt, opts) => [
      '-p',
      prompt,
      '--output-format',
      'json',
      // auto: 放开文件编辑权限（bash 等高危工具仍会被无头模式自动拒绝）
      ...(opts.auto ? ['--permission-mode', 'acceptEdits'] : []),
    ],
    parse: (stdout) => {
      const j = JSON.parse(stdout)
      return {
        response: j.result ?? '',
        meta: {
          sessionId: j.session_id,
          costUsd: j.total_cost_usd,
          isError: j.is_error,
        },
      }
    },
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    cmd: 'codex',
    // Codex CLI 的本机 skills 目录（~/.codex/skills）
    skillsDir: '~/.codex/skills',
    // exec 非交互模式；--json 输出 JSONL 事件流，最终回答在 item.completed 的 agent_message
    // --skip-git-repo-check：允许在非 git 目录执行（Runner 的 cwd 不一定是 repo）
    buildArgs: (prompt, opts) => [
      'exec',
      prompt,
      '--json',
      '--skip-git-repo-check',
      // auto: 全权模式。新版 codex 已移除 --full-auto，改用 --sandbox danger-full-access
      // （解除文件系统/网络沙箱限制，MCP 服务器才能正常连接）
      ...(opts.auto ? ['--sandbox', 'danger-full-access'] : []),
    ],
    parse: (stdout) => {
      let response = ''
      for (const line of stdout.split('\n')) {
        const t = line.trim()
        if (!t) continue
        try {
          const ev = JSON.parse(t)
          if (
            ev.type === 'item.completed' &&
            ev.item?.type === 'agent_message'
          ) {
            response = ev.item.text || ''
          }
        } catch {
          // 忽略非 JSON 行（进度提示等）
        }
      }
      return { response }
    },
  },
  {
    id: 'deepseek',
    name: 'DeepSeek Harness',
    cmd: 'deepseek',
    // exec 非交互模式；--json 输出 summary JSON
    buildArgs: (prompt, opts) => [
      'exec',
      prompt,
      '--json',
      ...(opts.auto ? ['--auto'] : []),
    ],
    parse: (stdout) => {
      try {
        const j = JSON.parse(stdout)
        // summary JSON 字段名做多层兜底
        const text =
          j.response ?? j.result ?? j.message ?? j.text ?? j.content ?? ''
        return {
          response: String(text),
          meta: j.session_id ? { sessionId: j.session_id } : undefined,
        }
      } catch {
        // 非 JSON（版本差异/纯文本输出）时原样返回
        return { response: stdout.trim() }
      }
    },
  },
]

/** 工具安装探测缓存（30s），避免每次 /tools 都探测一遍 */
const toolProbeCache = new Map()

function isToolInstalled(tool) {
  const cached = toolProbeCache.get(tool.cmd)
  if (cached && Date.now() - cached.at < 30_000) return cached.available
  let available = false
  try {
    execSync(`command -v ${tool.cmd}`, { stdio: 'ignore', timeout: 3000 })
    available = true
  } catch {
    available = false
  }
  toolProbeCache.set(tool.cmd, { available, at: Date.now() })
  return available
}

// === 本机工具技能（~/.claude/skills、~/.codex/skills 等）===

// 公共个人技能目录（各 agent 工具的通用约定，如 lark-* / viki 等）
const AGENT_SKILLS_DIR = '~/.agents/skills'

/**
 * 某工具的本机技能目录列表：
 *  - 工具自己的 skillsDir（~/.claude/skills、~/.codex/skills 等，从注册表固定取值）
 *  - 公共个人技能目录 ~/.agents/skills（各工具通用）
 * 去重后返回（不接受任意路径参数）
 */
function toolSkillsDirs(tool) {
  const dirs = []
  if (tool?.skillsDir) dirs.push(tool.skillsDir.replace(/^~/, os.homedir()))
  dirs.push(AGENT_SKILLS_DIR.replace(/^~/, os.homedir()))
  return [...new Set(dirs)]
}

/** 解析 SKILL.md 的 YAML front matter，提取 name/description（与平台一致） */
function parseSkillFrontMatter(content) {
  const lines = content.split('\n')
  if (lines.length < 2 || lines[0].trim() !== '---') return {}
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (end === -1) return {}
  const fm = {}
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^(\w+):\s*(.+)/)
    if (m) fm[m[1]] = m[2].replace(/^>-\s*/, '').trim()
  }
  return { name: fm.name, description: fm.description }
}

/** 扫描某工具本机 skills 目录，返回 [{ id, name, description }] */
function scanToolSkills(toolId) {
  const tool = CLI_TOOLS.find((t) => t.id === toolId)
  if (!tool)
    return { error: `未知工具: ${toolId}`, skills: [], supported: false }

  const skills = []
  const seen = new Set()

  for (const dir of toolSkillsDirs(tool)) {
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue // 目录不存在或不可读，跳过
    }
    for (const entry of entries) {
      // 用 statSync（跟随符号链接）：~/.codex/skills/viki 常是指向 ~/.agents/skills/viki 的链接
      let st
      try {
        st = fs.statSync(path.join(dir, entry.name))
      } catch {
        continue
      }
      if (!st.isDirectory()) continue

      const skillMd = path.join(dir, entry.name, 'SKILL.md')
      if (!fs.existsSync(skillMd)) continue
      // 同名技能去重：工具自身目录优先，公共目录补充
      if (seen.has(entry.name)) continue
      seen.add(entry.name)

      const fm = parseSkillFrontMatter(fs.readFileSync(skillMd, 'utf-8'))
      skills.push({
        id: entry.name,
        name: fm.name || entry.name,
        description: fm.description || '',
      })
    }
  }
  return { skills, supported: true }
}

/** 读取某工具本机技能内容（在多目录中查找，仅限注册表内 skillsDir + 公共目录，防目录穿越） */
function readToolSkillContent(toolId, skillName) {
  const tool = CLI_TOOLS.find((t) => t.id === toolId)
  if (!tool || !skillName) return null
  for (const dir of toolSkillsDirs(tool)) {
    const base = path.resolve(dir)
    const fp = path.resolve(path.join(base, skillName, 'SKILL.md'))
    // 字符串前缀校验：symlink 不会被 path.resolve 展开，无法借链接名逃出扫描目录
    if (!fp.startsWith(base + path.sep)) continue
    if (fs.existsSync(fp)) return fs.readFileSync(fp, 'utf-8')
  }
  return null
}

// === 工作流模板存储（与画布 /api/workflows 共用同一目录契约） ===

const WORKFLOWS_DIR = path.resolve(process.cwd(), 'workflows')
const WORKFLOW_VERSIONS_DIR = path.join(WORKFLOWS_DIR, '.versions')

/** 落盘前剥离节点 modal 敏感字段（只保留模型引用，与 src/services/modal.ts stripModal 一致） */
function stripModal(modal) {
  if (!modal || typeof modal !== 'object') return modal
  const stripped = {}
  if (modal.id) stripped.id = modal.id
  else if (modal.name) stripped.name = modal.name // 兼容旧格式（无 id 时以 modelName 作引用）
  if (modal.alias) stripped.alias = modal.alias
  return Object.keys(stripped).length > 0 ? stripped : undefined
}

/** 剥离单个节点的 modal（避免 API Key / URL / Token 落盘） */
function stripNodeModal(node) {
  if (!node?.data?.modal) return node
  return { ...node, data: { ...node.data, modal: stripModal(node.data.modal) } }
}

function stripNodesModals(nodes) {
  return Array.isArray(nodes) ? nodes.map(stripNodeModal) : nodes
}

/** 读取单个工作流文件的元信息（含 description） */
function readWorkflowMeta(file) {
  const fileId = String(file).replace(/\.json$/, '')
  let content
  try {
    content = JSON.parse(
      fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf-8'),
    )
  } catch {
    return null
  }
  return {
    id: fileId,
    name: content.name || fileId,
    description: content.description || '',
    createdAt: content.createdAt || '',
    updatedAt: content.updatedAt || '',
    nodeCount: content.nodes?.length || 0,
    edgeCount: content.edges?.length || 0,
  }
}

/** 已存在同名工作流时先保存版本快照（快照同样只存模型引用） */
function saveWorkflowSnapshot(id, existing) {
  try {
    const dir = path.join(WORKFLOW_VERSIONS_DIR, id)
    fs.mkdirSync(dir, { recursive: true })
    const snapshot = {
      name: existing.name,
      id: existing.id,
      nodes: stripNodesModals(existing.nodes || []),
      edges: existing.edges,
      savedAt: new Date().toISOString(),
      versionId: `v-${Date.now()}`,
    }
    fs.writeFileSync(
      path.join(dir, `${snapshot.versionId}.json`),
      JSON.stringify(snapshot, null, 2),
    )
  } catch {
    // 版本快照保存失败不影响本次保存
  }
}

// === 异步任务队列（CLI agent 一跑几分钟，不能同步等待）===

const tasks = new Map()
const MAX_TASKS = 100

function pruneTasks() {
  if (tasks.size <= MAX_TASKS) return
  const finished = [...tasks.values()]
    .filter((t) => t.status !== 'running')
    .sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0))
  for (const t of finished.slice(0, tasks.size - MAX_TASKS)) tasks.delete(t.id)
}

/**
 * 启动一个 CLI agent 任务
 * @returns {{ taskId: string } | { error: string }}
 */
function startCliTask({ tool: toolId, prompt, auto, timeoutMs, cwd, gitDiff }) {
  const tool = CLI_TOOLS.find((t) => t.id === toolId)
  if (!tool) return { error: `未知工具: ${toolId}` }
  if (!prompt || !String(prompt).trim()) return { error: '缺少 prompt' }
  if (!isToolInstalled(tool)) {
    return { error: `本机未安装 ${tool.name}（命令 "${tool.cmd}" 不可用）` }
  }

  const taskId = crypto.randomUUID()
  const task = {
    id: taskId,
    tool: tool.id,
    toolName: tool.name,
    status: 'running',
    logs: [`启动 ${tool.name} ...`],
    output: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  }
  tasks.set(taskId, task)

  // 超时上限 30 分钟
  const timeout = Math.min(Number(timeoutMs) || 10 * 60_000, 30 * 60_000)
  let stdout = ''
  let stderr = ''
  let killed = false

  // cwd：允许指定项目目录执行（如 codeAgent 在项目里读代码/写文件）
  let workDir = process.cwd()
  if (cwd) {
    try {
      const stat = fs.statSync(cwd)
      if (!stat.isDirectory()) return { error: `项目路径不是目录: ${cwd}` }
      workDir = cwd
    } catch {
      return { error: `项目路径不存在: ${cwd}` }
    }
  }

  // gitDiff：由 Runner（同在用户本地）预先收集项目改动附进 prompt，
  // 这样 CLI 无需执行任何命令（安全模式即可），评审材料自包含
  if (gitDiff && workDir !== process.cwd()) {
    try {
      const diff = execSync('git --no-pager diff HEAD', {
        cwd: workDir,
        timeout: 15_000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf8',
      })
      if (diff && diff.trim()) {
        prompt = `以下是当前项目的 git diff（评审 ground truth 材料）：\n\`\`\`diff\n${diff}\n\`\`\`\n\n${prompt}`
      } else {
        prompt = `（注意：当前项目工作区无未提交改动，git diff 为空）\n\n${prompt}`
      }
    } catch {
      // 非 git 目录或 git 不可用：忽略，仅用其余材料评审
    }
  }

  let child
  try {
    child = spawn(tool.cmd, tool.buildArgs(prompt, { auto }), {
      cwd: workDir,
      shell: false,
      env: process.env,
      // stdin 必须显式关闭：CLI（如 codex）检测到非 tty 的 stdin 会等待附加输入，导致任务挂起
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    task.status = 'error'
    task.error = `启动失败: ${err.message}`
    task.finishedAt = Date.now()
    return { taskId }
  }

  const timer = setTimeout(() => {
    killed = true
    child.kill('SIGKILL')
  }, timeout)

  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  // stderr 采样进任务日志（截尾 5 行），方便排错
  child.stderr.on('data', (chunk) => {
    stderr += chunk
    const lines = String(chunk).trim().split('\n').filter(Boolean)
    if (lines.length) task.logs.push(...lines.slice(-5))
  })
  child.on('error', (err) => {
    clearTimeout(timer)
    task.status = 'error'
    task.error = `进程错误: ${err.message}`
    task.finishedAt = Date.now()
  })
  child.on('close', (code) => {
    clearTimeout(timer)
    task.finishedAt = Date.now()
    if (killed) {
      task.status = 'error'
      task.error = `执行超时（${Math.round(timeout / 1000)}s），已终止`
      return
    }
    if (code !== 0 && !stdout.trim()) {
      task.status = 'error'
      task.error = `${tool.name} 退出码 ${code}: ${stderr.slice(-500) || '无输出'}`
      return
    }
    try {
      const parsed = tool.parse(stdout)
      task.output = {
        response: parsed.response,
        tool: tool.id,
        meta: parsed.meta,
      }
      task.logs.push(
        `${tool.name} 执行完成 (${parsed.response?.length || 0} 字符)`,
      )
      task.status = 'done'
    } catch (err) {
      task.status = 'error'
      task.error = `解析 ${tool.name} 输出失败: ${err.message}`
    }
  })

  pruneTasks()
  return { taskId }
}

// === HTTP 服务 ===

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 10 * 1024 * 1024) {
        reject(new Error('请求体过大'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })
}

function json(res, req, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...corsHeaders(req),
  })
  res.end(JSON.stringify(payload))
}

/** 校验目标 URL 是否为合法的 http/https 地址（仅允许这两种协议，防止探测内网/非 http 服务） */
function isValidHttpUrl(raw) {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`,
  )
  const pathname = parsedUrl.pathname

  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req))
    res.end()
    return
  }

  // Origin 不在白名单内：直接拒绝，防止任意网页指挥本地 Runner
  if (!isOriginAllowed(req.headers.origin)) {
    json(res, req, 403, {
      status: 'error',
      output: {},
      error: 'Origin 不在白名单内',
    })
    return
  }

  try {
    // 心跳探测
    if (req.method === 'GET' && pathname === '/ping') {
      json(res, req, 200, {
        status: 'success',
        output: { online: true, version: VERSION },
      })
      return
    }

    // 模型列表（脱敏，不含 key/url，与 /api/execute/models 契约一致）
    if (req.method === 'GET' && pathname === '/models') {
      const models = readModels().map((m) => ({
        id: m.id,
        name: m.name,
        modelName: m.modelName,
        kind: m.kind,
        description: m.description || '',
      }))
      json(res, req, 200, { status: 'success', output: { models } })
      return
    }

    // 模型配置 CRUD（与 /api/model 契约一致）
    if (pathname === '/model') {
      if (req.method === 'GET') {
        json(res, req, 200, readModels())
        return
      }
      const body = JSON.parse((await readBody(req)) || '{}')
      if (req.method === 'POST') {
        body.id = body.id || crypto.randomUUID()
        const models = readModels()
        models.push(body)
        writeModels(models)
        json(res, req, 201, body)
        return
      }
      if (req.method === 'PUT') {
        const models = readModels()
        const idx = models.findIndex((m) => m.id === body.id)
        if (idx === -1) {
          json(res, req, 404, { error: 'Model not found' })
          return
        }
        models[idx] = body
        writeModels(models)
        json(res, req, 200, models[idx])
        return
      }
      if (req.method === 'DELETE') {
        const id = parsedUrl.searchParams.get('id')
        if (!id) {
          json(res, req, 400, { error: 'Missing id' })
          return
        }
        writeModels(readModels().filter((m) => m.id !== id))
        json(res, req, 200, { success: true })
        return
      }
    }

    // Lark 节点执行
    if (req.method === 'POST' && pathname === '/lark') {
      const body = JSON.parse((await readBody(req)) || '{}')
      json(res, req, 200, executeLark(body))
      return
    }

    // Agent 节点执行：modelId 优先（凭据不出用户机），兼容内联 model 对象
    if (req.method === 'POST' && pathname === '/agent') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const logs = []

      let model = body.model
      if (body.modelId) {
        const found = readModels().find(
          (m) => m.id === body.modelId || m.name === body.modelId,
        )
        if (found) {
          model = found
          logs.push(`通过 modelId 解析模型: ${found.name}`)
        } else {
          logs.push(`modelId "${body.modelId}" 未找到，回退内联 model 配置`)
        }
      }

      if (!model?.url || !model?.modelName) {
        json(res, req, 200, {
          status: 'error',
          output: {},
          logs: [...logs, '模型配置不完整，缺少 url 或 modelName'],
          error: '模型配置不完整，缺少 url 或 modelName',
        })
        return
      }

      logs.push(`调用模型: ${model.modelName}`)
      logs.push(`API URL: ${model.url}`)

      try {
        const result = await callAI({
          model,
          systemPrompt: body.systemPrompt,
          messages: body.messages,
          temperature: body.temperature ?? 0.3,
        })
        logs.push(
          `AI 响应完成 (tokens: ${result.usage?.totalTokens || 'unknown'})`,
        )
        json(res, req, 200, {
          status: 'success',
          output: {
            response: result.text,
            model: model.modelName,
            usage: result.usage,
          },
          logs,
        })
      } catch (err) {
        json(res, req, 200, {
          status: 'error',
          output: {},
          logs: [...logs, `调用异常: ${err.message}`],
          error: `AI API 调用异常: ${err.message}`,
        })
      }
      return
    }

    // 本地 CLI 工具列表（探测本机已安装的 agent CLI）
    if (req.method === 'GET' && pathname === '/tools') {
      const tools = CLI_TOOLS.map((t) => ({
        id: t.id,
        name: t.name,
        available: isToolInstalled(t),
      }))
      json(res, req, 200, { status: 'success', output: { tools } })
      return
    }

    // 本地 CLI 工具的本机 skills 列表（~/.claude/skills 等，用户自己配置的 agent 技能）
    if (req.method === 'GET' && pathname === '/tool-skills') {
      const tool = parsedUrl.searchParams.get('tool')
      const result = scanToolSkills(tool)
      json(res, req, 200, {
        status: result.error ? 'error' : 'success',
        output: {
          skills: result.skills || [],
          supported: result.supported ?? false,
        },
        ...(result.error ? { error: result.error } : {}),
      })
      return
    }

    // 读取本地工具技能内容（供执行时拼入 prompt；仅限注册表内 skillsDir，防穿越）
    if (req.method === 'GET' && pathname === '/tool-skill-content') {
      const content = readToolSkillContent(
        parsedUrl.searchParams.get('tool'),
        parsedUrl.searchParams.get('skill'),
      )
      json(res, req, 200, {
        status: 'success',
        output: { content: content || '' },
      })
      return
    }

    // 工作流模板存储（列表 / 保存；与画布 /api/workflows 共用同一目录，保存后可回画布加载）
    if (pathname === '/workflows') {
      if (req.method === 'GET') {
        try {
          fs.mkdirSync(WORKFLOWS_DIR, { recursive: true })
          const files = fs
            .readdirSync(WORKFLOWS_DIR)
            .filter((f) => f.endsWith('.json'))
          const workflows = files
            .map(readWorkflowMeta)
            .filter(Boolean)
            .sort((a, b) =>
              (b.updatedAt || b.createdAt || '').localeCompare(
                a.updatedAt || a.createdAt || '',
              ),
            )
          json(res, req, 200, { status: 'success', output: { workflows } })
        } catch (err) {
          json(res, req, 200, {
            status: 'error',
            output: {},
            error: `读取工作流列表失败: ${err.message}`,
          })
        }
        return
      }
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}')
        const { name, nodes, edges } = body
        if (
          !name ||
          !String(name).trim() ||
          !Array.isArray(nodes) ||
          !Array.isArray(edges)
        ) {
          json(res, req, 200, {
            status: 'error',
            output: {},
            error: '缺少 name / nodes / edges（edges 需为数组）',
          })
          return
        }
        const now = new Date().toISOString()
        const id = String(name).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')
        const workflowFile = path.join(WORKFLOWS_DIR, `${id}.json`)
        fs.mkdirSync(WORKFLOWS_DIR, { recursive: true })

        if (fs.existsSync(workflowFile)) {
          try {
            const existing = JSON.parse(fs.readFileSync(workflowFile, 'utf-8'))
            saveWorkflowSnapshot(id, existing)
          } catch {
            // 文件损坏等，跳过快照
          }
        }

        const workflow = {
          name: String(name).trim(),
          id,
          description:
            typeof body.description === 'string' ? body.description : '',
          nodes: stripNodesModals(nodes),
          edges,
          createdAt: now,
          updatedAt: now,
        }
        fs.writeFileSync(workflowFile, JSON.stringify(workflow, null, 2))
        json(res, req, 201, {
          status: 'success',
          output: { id, name: workflow.name, success: true },
        })
        return
      }
    }

    // AI 输出落盘（用户配置的输出路径，写入用户本机磁盘）
    if (req.method === 'POST' && pathname === '/file-write') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const { filePath, content } = body
      if (!filePath) {
        json(res, req, 200, {
          status: 'error',
          output: {},
          error: '缺少 filePath',
        })
        return
      }
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        fs.writeFileSync(filePath, content || '', 'utf-8')
        json(res, req, 200, { status: 'success', output: { filePath } })
      } catch (err) {
        json(res, req, 200, {
          status: 'error',
          output: { filePath },
          error: `文件写入失败: ${err.message}`,
        })
      }
      return
    }

    // 知识库远程 API 代理（仅 http/https，60s 超时，规避浏览器跨域）
    if (req.method === 'POST' && pathname === '/http-proxy') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const { url, method = 'GET', headers = [], body: rawBody } = body

      if (!url || !isValidHttpUrl(url)) {
        json(res, req, 400, {
          status: 'error',
          output: {},
          error: '请求 URL 缺失或不是合法的 http/https 地址',
        })
        return
      }

      const logs = [`代理请求: ${method} ${url}`]
      const headerObj = {}
      for (const h of Array.isArray(headers) ? headers : []) {
        if (h?.key) headerObj[h.key] = String(h.value ?? '')
      }

      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 60_000)
        const res = await fetch(url, {
          method,
          headers: headerObj,
          body:
            method === 'GET' || method === 'HEAD'
              ? undefined
              : rawBody || undefined,
          signal: controller.signal,
        })
        clearTimeout(timer)

        const text = await res.text()
        logs.push(
          `响应状态: ${res.status} ${res.statusText} (${text.length} 字符)`,
        )

        let parsedJson = null
        try {
          parsedJson = JSON.parse(text)
        } catch {
          // 非 JSON 响应，保持文本
        }

        json(res, req, 200, {
          status: 'success',
          output: {
            statusCode: res.status,
            statusText: res.statusText,
            text,
            json: parsedJson,
            contentType: res.headers.get('content-type') || '',
          },
          logs,
        })
      } catch (err) {
        logs.push(`代理请求失败: ${err.message}`)
        json(res, req, 200, {
          status: 'error',
          output: {},
          logs,
          error: `外部知识库请求失败: ${err.message}`,
        })
      }
      return
    }

    // 启动 CLI agent 异步任务
    if (req.method === 'POST' && pathname === '/agent-cli') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const started = startCliTask(body)
      if (started.error) {
        json(res, req, 200, {
          status: 'error',
          output: {},
          logs: [],
          error: started.error,
        })
      } else {
        json(res, req, 200, {
          status: 'success',
          output: { taskId: started.taskId },
        })
      }
      return
    }

    // 查询 CLI agent 任务状态
    const taskMatch = pathname.match(/^\/task\/([a-zA-Z0-9-]+)$/)
    if (req.method === 'GET' && taskMatch) {
      const task = tasks.get(taskMatch[1])
      if (!task) {
        json(res, req, 404, {
          status: 'error',
          output: {},
          error: '任务不存在',
        })
        return
      }
      json(res, req, 200, {
        status: 'success',
        output: { ...task, logs: [...task.logs] },
      })
      return
    }

    json(res, req, 404, {
      status: 'error',
      output: {},
      error: `未知路径: ${pathname}`,
    })
  } catch (err) {
    json(res, req, 500, { status: 'error', output: {}, error: err.message })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`[runner] 本地执行 Runner 已启动: http://${HOST}:${PORT}`)
  console.log(`[runner] 模型配置: ${MODEL_CONF}`)
  const extras = process.env.RUNNER_ALLOWED_ORIGINS
  if (extras) console.log(`[runner] 额外允许的 Origin: ${extras}`)
})

process.on('SIGINT', () => {
  console.log('\n[runner] 已停止')
  process.exit(0)
})
