#!/usr/bin/env node
/**
 * Picop MCP Server（stdio）
 *
 * 让用户在自己工具（Claude Code / Codex / Trae 等）中通过 MCP 直连 Picop 能力：
 *   - workflow_build：自然语言 → 工作流定义（复用 prompts/flowBuilder.md + Runner /agent-cli）
 *   - workflow_export：工作流定义 → 全量导出为目录文件（主文件 + 输入物 + manifest，
 *     与画布 zip 同源 shared/artifact-collect.mjs，非 zip；经 Runner /file-write 落盘到用户项目）
 *   - workflow_save：工作流定义 → 保存到 Picop 工作流模板库（与画布「保存」共享同一存储）
 *   - workflow_list：列出 Picop 已保存工作流（名称 + 描述）
 *
 * 用户侧注册示例（Claude Code，源码运行形态）：
 *   claude mcp add picop -- node <ai-workflow>/runner/mcp.mjs
 *
 * 已安装桌面应用形态：本文件位于 App 包内，且不假设系统装有 node，
 * 直接复用 App 自带 Node（ELECTRON_RUN_AS_NODE=1）：
 *   command = /Applications/Picop.app/Contents/MacOS/Picop
 *   args    = [/Applications/Picop.app/Contents/Resources/app/runner/mcp.mjs]
 *   env     = { ELECTRON_RUN_AS_NODE: "1" }
 *
 * 依赖：Runner 已在 127.0.0.1:7523 就绪
 *   - 源码运行：手动执行 node runner/server.mjs
 *   - 已安装 App：由 App 主进程自动拉起（保持 App 运行即可）
 * 环境变量：
 *   RUNNER_URL   Runner 地址，默认 http://127.0.0.1:7523
 *   PICOP_DIR    定位 prompts/ 的目录，默认本文件上一级
 *                （已装 App 想与画布共用自定义 prompts 时，指向 App 的 userData/data）
 *
 * 启动：node runner/mcp.mjs（源码运行）
 */

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import {
  NodeTypes,
  buildWorkflow,
  autoSkillDescription,
} from '../shared/export-core.mjs'

const PROTOCOL_VERSION = '2024-11-05'
const RUNNER_URL = process.env.RUNNER_URL || 'http://127.0.0.1:7523'
const PICOP_DIR =
  process.env.PICOP_DIR ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER_INFO = { name: 'picop-mcp', version: '0.1.0' }

// === Runner HTTP 客户端（无 Origin 请求，Runner 按本机脚本放行） ===

async function runnerJson(pathname, { method = 'GET', body } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const res = await fetch(RUNNER_URL + pathname, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Runner HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// === 工具 1：workflow_build ===

/** 与 src/services/flowBuilder.ts parseWorkflowResponse 对齐 */
function parseWorkflowResponse(text) {
  const jsonMatch = String(text || '').match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : String(text || '').trim()
  const parsed = JSON.parse(jsonStr)
  if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
    throw new Error('AI 响应中缺少 nodes 数组')
  }
  if (!Array.isArray(parsed.edges)) parsed.edges = []
  if (!parsed.explanation) parsed.explanation = '工作流已生成'
  return {
    explanation: parsed.explanation,
    workflow: { nodes: parsed.nodes, edges: parsed.edges },
  }
}

async function buildWorkflowFromPrompt({ description, tool, timeoutMs }) {
  if (!description || !String(description).trim()) {
    throw new Error('缺少 description（用户需求描述）')
  }

  // 工具探测：未指定时自动选第一个本机已安装的 AI CLI
  let toolId = tool
  if (!toolId) {
    const probe = await runnerJson('/tools')
    const first = (probe?.output?.tools || []).find((t) => t.available)
    if (!first) {
      throw new Error(
        '本机未安装任何 AI CLI 工具（claude-code / codex / deepseek），请先安装一个',
      )
    }
    toolId = first.id
  }

  const flowBuilderPrompt = fs.readFileSync(
    path.join(PICOP_DIR, 'prompts/flowBuilder.md'),
    'utf-8',
  )
  const prompt = [
    flowBuilderPrompt,
    `[用户需求]\n${String(description).trim()}`,
    '--- 当前工作流状态 ---\n当前画布为空',
  ].join('\n\n')

  const timeout = Math.min(Number(timeoutMs) || 5 * 60_000, 30 * 60_000)
  const start = await runnerJson('/agent-cli', {
    method: 'POST',
    body: { tool: toolId, prompt, timeoutMs: timeout },
  })
  if (start.error) throw new Error(start.error)
  const taskId = start?.output?.taskId
  if (!taskId) throw new Error('Runner 未返回 taskId')

  // 轮询任务结果（3s 间隔，最长 = 任务超时 + 30s）
  const deadline = Date.now() + timeout + 30_000
  let task = null
  while (Date.now() < deadline) {
    await sleep(3000)
    const res = await runnerJson(`/task/${taskId}`)
    task = res?.output || null
    if (task && (task.status === 'done' || task.status === 'error')) break
  }
  if (!task || task.status === 'running') throw new Error('工作流生成超时')
  if (task.status === 'error') throw new Error(task.error || '工作流生成失败')

  return parseWorkflowResponse(task.output?.response || '')
}

// === 工具 2：workflow_export ===

/** 平台节点类型全集（与共享导出核心 NodeTypes 对齐） */
const VALID_NODE_TYPES = new Set(Object.values(NodeTypes))

/** 校验导出目标目录（防路径穿越，遵循项目硬约束） */
function safeResolve(targetDir) {
  const raw = String(targetDir || '')
  if (!raw.trim()) throw new Error('缺少 targetDir（导出目标目录）')
  if (raw.includes('..')) throw new Error('targetDir 不允许包含 ".."')
  return path.resolve(raw)
}

/**
 * 归一化工作流定义（build / save / export 共用）：
 * 补 id / position / data（AI 生成的节点可能缺字段），校验类型，
 * flowBuilder 把标题放在顶层 title、data 内不含 title，这里归位到 data.title 以对齐画布节点结构，
 * 并把 edges 的 nodes 数组下标引用修复为节点 id 引用。
 */
function normalizeWorkflow(def) {
  // workflow 允许是对象或 JSON 字符串
  if (typeof def === 'string') def = JSON.parse(def)
  if (!def || !Array.isArray(def.nodes)) {
    throw new Error('workflow 参数必须是 { nodes, edges } 结构')
  }
  const rawNodes = def.nodes
  const rawEdges = Array.isArray(def.edges) ? def.edges : []
  if (rawNodes.length === 0) throw new Error('工作流没有节点')

  const nodes = rawNodes.map((n, i) => {
    if (!n || typeof n.type !== 'string')
      throw new Error(`第 ${i + 1} 个节点缺少 type`)
    if (!VALID_NODE_TYPES.has(n.type))
      throw new Error(`未知节点类型: ${n.type}`)
    const data = n.data && typeof n.data === 'object' ? { ...n.data } : {}
    if (!data.title && typeof n.title === 'string' && n.title.trim()) {
      data.title = n.title.trim()
    }
    return {
      id: typeof n.id === 'string' && n.id ? n.id : `node-${i + 1}`,
      type: n.type,
      position: n.position || { x: 0, y: 0 },
      data,
    }
  })

  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges = rawEdges
    .map((e) => {
      const source =
        typeof e.source === 'number' ? nodes[e.source]?.id : e.source
      const target =
        typeof e.target === 'number' ? nodes[e.target]?.id : e.target
      return { ...e, source, target, id: e.id || `${source}-${target}` }
    })
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))

  return { nodes, edges }
}

async function exportWorkflow({
  workflow,
  format = 'speckit',
  name,
  targetDir,
  description,
  full = true,
}) {
  if (!name || !String(name).trim()) throw new Error('缺少 name（工作流名称）')
  const { nodes, edges } = normalizeWorkflow(workflow)

  const fmt = String(format)
  if (!['speckit', 'openspec', 'spec', 'skill'].includes(fmt)) {
    throw new Error(
      `不支持的格式: ${format}（支持 speckit / openspec / spec / skill）`,
    )
  }

  // 与画布导出共用同一实现（shared/export-core.mjs），保证产物完全一致
  const { yaml, workflowPath } = buildWorkflow(fmt, nodes, edges, {
    name: String(name).trim(),
    description,
  })

  const baseDir = safeResolve(targetDir)
  const files = []
  const logs = []

  /** 相对 targetDir 落盘单个文件（路径穿越防护） */
  const writeFile = async (relPath, content) => {
    const filePath = path.join(baseDir, relPath)
    if (!filePath.startsWith(baseDir + path.sep)) {
      throw new Error(`导出路径越界: ${relPath}`)
    }
    const r = await runnerJson('/file-write', {
      method: 'POST',
      body: { filePath, content },
    })
    if (r.status !== 'success')
      throw new Error(r.error || `文件写入失败: ${relPath}`)
    files.push(filePath)
  }

  // 1. 主工作流文件
  await writeFile(workflowPath, yaml)
  logs.push(`已生成 ${workflowPath}`)

  // 2. 全量导出：与画布 zip 同源（shared/artifact-collect.mjs），
  //    输入物 + openspec 附加文件 + manifest 全部落盘为真实目录文件（非 zip）
  if (full) {
    const { collectArtifacts, openSpecSchemaDir, specChangeDir, skillDir } =
      await import('../shared/artifact-collect.mjs')

    const collected = await collectArtifacts(nodes, { baseDir: PICOP_DIR })

    // OpenSpec：输入物与 schema.yaml 同级；Spec：变更目录下；Skill：与 SKILL.md 同级；Speckit：保持导出根目录
    const workflowName = String(name).trim()
    const prefix =
      fmt === 'openspec'
        ? `${openSpecSchemaDir(workflowName)}/`
        : fmt === 'spec'
          ? `${specChangeDir(workflowName)}/`
          : fmt === 'skill'
            ? `${skillDir(workflowName)}/`
            : ''

    for (const item of collected) {
      await writeFile(prefix + item.path, item.content)
      if (item.warning) logs.push(`警告: ${item.warning}`)
    }

    // OpenSpec 附加文件：config.yaml（默认 schema）+ changes/archive/ 目录
    if (fmt === 'openspec') {
      const schemaName = prefix.split('/').filter(Boolean).pop() || workflowName
      await writeFile('openspec/config.yaml', `schema: ${schemaName}\n`)
      await writeFile('openspec/changes/archive/.gitkeep', '')
      logs.push('已生成 openspec/config.yaml')
    }

    // manifest
    const manifest = {
      name: workflowName,
      target: fmt,
      workflowPath,
      artifactCount: collected.length,
      collectedSources: collected.map((c) => c.source),
      logs,
    }
    await writeFile('manifest.json', JSON.stringify(manifest, null, 2))
  }

  return {
    format: fmt,
    full: Boolean(full),
    files,
    workflowPath,
    nodes: nodes.length,
    edges: edges.length,
    logs,
  }
}

// === 工具 3：workflow_save / 工具 4：workflow_list ===

/** 保存到 Picop 工作流模板库（与画布「保存工作流模板」共用同一存储） */
async function saveWorkflow({ workflow, name, description }) {
  if (!name || !String(name).trim()) throw new Error('缺少 name（工作流名称）')
  const { nodes, edges } = normalizeWorkflow(workflow)
  const desc =
    String(description || '').trim() ||
    autoSkillDescription(String(name).trim(), nodes)
  const r = await runnerJson('/workflows', {
    method: 'POST',
    body: {
      name: String(name).trim(),
      description: desc,
      nodes,
      edges,
    },
  })
  if (r.status !== 'success') throw new Error(r.error || '保存到 Picop 失败')
  return r.output
}

/** 列出 Picop 已保存的工作流（仅名称与描述） */
async function listWorkflows() {
  const r = await runnerJson('/workflows')
  if (r.status !== 'success')
    throw new Error(r.error || '获取已保存工作流列表失败')
  const workflows = Array.isArray(r.output?.workflows) ? r.output.workflows : []
  return {
    workflows: workflows.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description || '',
    })),
  }
}

// === MCP stdio transport（newline-delimited JSON-RPC） ===

const TOOLS = [
  {
    name: 'workflow_build',
    description:
      '把用户自然语言描述的工作流程转换为 Picop 工作流定义（JSON）。调用后返回 explanation（AI 对流程的理解）与 workflow（nodes/edges 数组）。产物可通过 workflow_export 导出到用户项目。',
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description:
            '用户用自然语言描述的工作流程（如：每周一早上总结上周飞书会议纪要并生成周报）。',
        },
        tool: {
          type: 'string',
          enum: ['claude-code', 'codex', 'deepseek'],
          description:
            '执行生成的本地 AI CLI 工具 id；缺省自动探测第一个已安装的。',
        },
        timeoutMs: {
          type: 'number',
          description: '生成超时（毫秒），默认 5 分钟，上限 30 分钟。',
        },
      },
      required: ['description'],
    },
  },
  {
    name: 'workflow_export',
    description:
      '把 workflow_build 返回的工作流定义导出为可执行产物并写入用户项目目录，与画布导出一致（共用 shared/export-core.mjs）。默认 full=true 全量导出：主工作流文件 + 各节点引用的输入物（userInput 静态内容 / Skill / Memory / BMad / Lark URL 清单 + lark-cli 技能）+ manifest.json，全部以真实目录文件形式写入 targetDir（非 zip；zip 仅用于画布下载场景）。format 支持 4 种：speckit（specify/workflows/<name>/workflow.yml，SpecKit 命令步骤流水线）、openspec（openspec/schemas/<name>/schema.yaml，artifacts 依赖图 + apply 跟踪 + tasks 自动补全，另附 openspec/config.yaml）、spec（spec/changes/<name>/specs/<name>/workflow.yaml，同构 artifacts 无 apply）、skill（skills/<name>/SKILL.md，独立任务指令技能）。',
    inputSchema: {
      type: 'object',
      properties: {
        workflow: {
          type: 'object',
          description:
            'workflow_build 返回的 workflow 对象（含 nodes/edges）。',
        },
        format: {
          type: 'string',
          enum: ['speckit', 'openspec', 'spec', 'skill'],
          default: 'speckit',
          description: '导出格式：speckit / openspec / spec / skill。',
        },
        name: {
          type: 'string',
          description: '工作流名称（用于生成目录与文件名）。',
        },
        targetDir: {
          type: 'string',
          description:
            '导出目标目录（用户项目根目录的绝对路径），产物将写入其下。',
        },
        description: {
          type: 'string',
          description: '工作流一句话描述（用于 openspec/spec/skill 产物）。',
        },
        full: {
          type: 'boolean',
          description:
            '是否全量导出（主文件 + 输入物 + manifest），缺省 true；false 则仅写主工作流文件。',
        },
      },
      required: ['workflow', 'name', 'targetDir'],
    },
  },
  {
    name: 'workflow_save',
    description:
      '把工作流定义保存到 Picop 本地工作流模板库（与画布「保存工作流模板」共享同一存储，保存后可回到画布加载、继续编排或重新导出）。',
    inputSchema: {
      type: 'object',
      properties: {
        workflow: {
          type: 'object',
          description:
            'workflow_build 返回的 workflow 对象（含 nodes/edges）。',
        },
        name: {
          type: 'string',
          description: '工作流名称（用于生成保存 id）。',
        },
        description: {
          type: 'string',
          description:
            '简短描述（供 workflow_list 列表展示）；缺省按节点自动生成。',
        },
      },
      required: ['workflow', 'name'],
    },
  },
  {
    name: 'workflow_list',
    description:
      '列出 Picop 本地已保存的工作流模板（仅名称与描述），供复用、续编或挑选后导出。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
]

async function handle(msg) {
  const { method, params = {}, id } = msg
  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      }
    case 'notifications/initialized':
      return null
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
    case 'tools/call': {
      const { name, arguments: args = {} } = params
      let result
      if (name === 'workflow_build')
        result = await buildWorkflowFromPrompt(args)
      else if (name === 'workflow_export') result = await exportWorkflow(args)
      else if (name === 'workflow_save') result = await saveWorkflow(args)
      else if (name === 'workflow_list') result = await listWorkflows()
      else throw new Error(`未知工具: ${name}`)
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
      }
    }
    default:
      if (id !== undefined) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `未知方法: ${method}` },
        }
      }
      return null
  }
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

async function handleAndSend(msg) {
  try {
    const res = await handle(msg)
    if (res) send(res)
  } catch (err) {
    if (msg.id !== undefined) {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32603, message: err.message },
      })
    }
  }
}

// 串行队列：保证每条消息按序处理、响应按序输出
// （stdin 关闭后不强制退出：等待 pending 的异步任务（Runner 调用）完成，事件循环自然结束）
let queue = Promise.resolve()
const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let msg
  try {
    msg = JSON.parse(trimmed)
  } catch {
    return // 忽略非 JSON 行
  }
  queue = queue.then(() => handleAndSend(msg))
})
