/**
 * Spec 目标平台映射（Picop ↔ SpecKit / OpenSpec）
 *
 * 设计说明（对应 workflow.build.md）：
 * - 本平台（Picop）的工作流 JSON 是 React Flow 画布数据，外部框架无法执行；
 *   导出时必须翻译为对方可执行的结构，导入时反向翻译回画布节点。
 * - 导出逻辑已迁移至 `src/services/exporter.ts`，本文件保留映射表与导入解析能力。
 */
import { v4 as uuidv4 } from 'uuid'
import type { Node, Edge } from '@xyflow/react'
import { NodeTypes } from '#/types'
import type { SpecStepKey } from '#/constants/spec'

// ==================== 平台定义 ====================

export type SpecTarget = 'picop' | 'speckit' | 'openspec' | 'spec' | 'skill'

export interface SpecTargetOption {
  key: SpecTarget
  label: string
  description: string
  /** 导出文件扩展名 */
  ext: string
}

/** 导入 / 导出弹窗的 Radio.Group 选项 */
export const SPEC_TARGETS: SpecTargetOption[] = [
  {
    key: 'picop',
    label: 'Picop（本平台）',
    description: '平台原生 JSON，含完整节点与连线数据',
    ext: 'json',
  },
  {
    key: 'speckit',
    label: 'SpecKit',
    description: 'workflow.yml：命令步骤流水线（specify/plan/tasks/implement…）',
    ext: 'yml',
  },
  {
    key: 'openspec',
    label: 'OpenSpec',
    description: 'schema.yaml：artifacts 依赖图（proposal/design/tasks…）',
    ext: 'yml',
  },
  {
    key: 'spec',
    label: 'Spec',
    description: 'workflow.yaml：artifacts 依赖图（spec/plan/tasks…），无需安装框架',
    ext: 'yml',
  },
]

/** 导出目标选项（含 SKILL；导入仅限 SPEC_TARGETS） */
export const EXPORT_TARGETS: SpecTargetOption[] = [
  ...SPEC_TARGETS,
  {
    key: 'skill',
    label: 'Skill',
    description: 'SKILL.md：独立任务指令，用户 /xxx 执行该工作流',
    ext: 'md',
  },
]

// ==================== 阶段标记（specStep）→ 目标平台 ====================

/** SpecStep 阶段标记 → SpecKit 命令 */
export const SPEC_STEP_TO_SPECKIT = new Map<SpecStepKey, string>([
  ['spec', 'speckit.specify'],
  ['research', 'speckit.plan'], // 调研作为 plan 的一部分产出
  ['plan', 'speckit.plan'],
  ['data-model', 'speckit.plan'], // plan 产物家族（data-model.md）
  ['contracts', 'speckit.plan'], // plan 产物家族（API 契约）
  ['tasks', 'speckit.tasks'],
  ['report', 'speckit.analyze'], // 自检报告 → 跨产物一致性分析
  ['adr', 'speckit.converge'], // 架构决策收口
])

/** SpecStep 阶段标记 → OpenSpec artifact */
export const SPEC_STEP_TO_OPENSPEC = new Map<SpecStepKey, string>([
  ['spec', 'proposal'],
  ['research', 'research'],
  ['plan', 'design'],
  ['data-model', 'data-model'],
  ['contracts', 'contracts'],
  ['adr', 'adr'],
  ['tasks', 'tasks'],
  ['report', 'review'],
])

// ==================== 节点类型 → 目标平台（无 specStep 时的兜底） ====================

/** 节点类型 → SpecKit 命令 */
export const NODE_TYPE_TO_SPECKIT = new Map<string, string>([
  [NodeTypes.AGENT, 'speckit.plan'],
  [NodeTypes.TASK_PLANNER, 'speckit.tasks'],
  [NodeTypes.SELF_CHECK, 'speckit.analyze'],
  [NodeTypes.CODE_AGENT, 'speckit.implement'],
  [NodeTypes.KEYWORD_AGENT, 'speckit.specify'],
  [NodeTypes.BMAD_AGENT, 'speckit.plan'],
  [NodeTypes.SKILL, 'speckit.plan'],
])

/** 节点类型 → OpenSpec artifact */
export const NODE_TYPE_TO_OPENSPEC = new Map<string, string>([
  [NodeTypes.AGENT, 'proposal'],
  [NodeTypes.TASK_PLANNER, 'tasks'],
  [NodeTypes.SELF_CHECK, 'review'],
  [NodeTypes.KEYWORD_AGENT, 'proposal'],
])

// ==================== 反向映射（导入用） ====================

/** SpecKit 命令 → 平台阶段标记 */
export const SPECKIT_COMMAND_TO_STEP = new Map<string, SpecStepKey | undefined>([
  ['speckit.specify', 'spec'],
  ['speckit.plan', 'plan'],
  ['speckit.tasks', 'tasks'],
  ['speckit.analyze', 'report'],
  ['speckit.checklist', 'report'],
  ['speckit.converge', 'adr'],
  ['speckit.implement', undefined], // implement → codeAgent（无阶段标记）
])

/** SpecKit 命令 → 平台节点类型 */
export const SPECKIT_COMMAND_TO_NODE = new Map<string, string>([
  ['speckit.specify', NodeTypes.AGENT],
  ['speckit.plan', NodeTypes.AGENT],
  ['speckit.tasks', NodeTypes.TASK_PLANNER],
  ['speckit.analyze', NodeTypes.SELF_CHECK],
  ['speckit.checklist', NodeTypes.SELF_CHECK],
  ['speckit.converge', NodeTypes.AGENT],
  ['speckit.implement', NodeTypes.CODE_AGENT],
])

/** OpenSpec artifact → 平台阶段标记（含 Spec 导出的 step-key artifact id） */
export const OPENSPEC_ARTIFACT_TO_STEP = new Map<string, SpecStepKey>([
  ['proposal', 'spec'],
  ['spec', 'spec'],
  ['research', 'research'],
  ['design', 'plan'],
  ['plan', 'plan'],
  ['data-model', 'data-model'],
  ['contracts', 'contracts'],
  ['adr', 'adr'],
  ['tasks', 'tasks'],
  ['report', 'report'],
  ['review', 'report'],
])

/** OpenSpec artifact → 平台节点类型（含 Spec 导出的 step-key artifact id） */
export const OPENSPEC_ARTIFACT_TO_NODE = new Map<string, string>([
  ['proposal', NodeTypes.AGENT],
  ['spec', NodeTypes.AGENT],
  ['research', NodeTypes.AGENT],
  ['design', NodeTypes.AGENT],
  ['plan', NodeTypes.AGENT],
  ['data-model', NodeTypes.AGENT],
  ['contracts', NodeTypes.AGENT],
  ['adr', NodeTypes.AGENT],
  ['tasks', NodeTypes.TASK_PLANNER],
  ['report', NodeTypes.SELF_CHECK],
  ['review', NodeTypes.SELF_CHECK],
])

// ==================== 解析辅助 ====================

export interface ParsedSpecWorkflow {
  /** 目标文件里的工作流名（可空） */
  name?: string
  nodes: Node[]
  edges: Edge[]
}

// ==================== 最小 YAML 解析（覆盖导入子集） ====================

/**
 * 解析本项目导出 / speckit / openspec 常用结构的 YAML 子集：
 * - 嵌套 map（缩进 2 空格）
 * - list（`- key: value` / `- scalar`）
 * - 行内数组 `[a, b]` / 行内对象 `{k: v}`
 * - 块标量 `|` / `|-` / `>`
 * - 引号字符串、数字、布尔、null、注释
 */
export function yamlParse(src: string): Record<string, unknown> {
  const lines = src.replace(/^\uFEFF/, '').split(/\r?\n/)
  let pos = 0

  const indentOf = (s: string) => (s.match(/^ */)?.[0].length ?? 0)
  const isBlank = (s: string) => s.trim() === ''

  function stripComment(s: string): string {
    let inS = false
    let inD = false
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      if (c === "'" && !inD) inS = !inS
      else if (c === '"' && !inS) inD = !inD
      else if (c === '#' && !inS && !inD) return s.slice(0, i)
    }
    return s
  }

  function parseValue(raw: string): unknown {
    const v = raw.trim()
    if (v === '' || v === 'null' || v === '~') return null
    if (v === 'true') return true
    if (v === 'false') return false
    if (/^-?\d+$/.test(v)) return parseInt(v, 10)
    if (/^-?\d*\.\d+$/.test(v)) return parseFloat(v)
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      return v.slice(1, -1).replace(/\\"/g, '"')
    }
    if (v.startsWith('[') && v.endsWith(']')) {
      const inner = v.slice(1, -1).trim()
      if (!inner) return []
      return inner.split(',').map((x) => parseValue(x.trim()))
    }
    if (v.startsWith('{') && v.endsWith('}')) {
      const obj: Record<string, unknown> = {}
      const inner = v.slice(1, -1).trim()
      if (inner) {
        for (const pair of inner.split(',')) {
          const idx = pair.indexOf(':')
          if (idx > 0) obj[pair.slice(0, idx).trim()] = parseValue(pair.slice(idx + 1))
        }
      }
      return obj
    }
    return v
  }

  function parseBlockScalar(indent: number, fold: boolean): string {
    const out: string[] = []
    while (pos < lines.length) {
      const line = lines[pos]
      if (isBlank(line)) {
        out.push('')
        pos++
        continue
      }
      if (indentOf(line) <= indent) break
      out.push(line.slice(indent + 2))
      pos++
    }
    const text = fold ? out.join(' ').replace(/\s+/g, ' ') : out.join('\n')
    return text.replace(/\n+$/, '').trimEnd()
  }

  function parseNode(indent: number): unknown {
    const obj: Record<string, unknown> = {}
    while (pos < lines.length) {
      const line = lines[pos]
      if (isBlank(line)) {
        pos++
        continue
      }
      const ind = indentOf(line)
      if (ind < indent) break
      if (ind > indent) break
      const content = stripComment(line.trim())
      if (content === '' || content === '---') {
        pos++
        continue
      }

      // ---- list ----
      if (content.startsWith('- ')) {
        const arr: unknown[] = []
        while (pos < lines.length) {
          const l = lines[pos]
          if (isBlank(l)) {
            pos++
            continue
          }
          const li = indentOf(l)
          if (li < indent) break
          if (li > indent) {
            // 当前列表项的深层续写
            const last = arr[arr.length - 1]
            const sub = parseNode(li)
            if (
              last &&
              typeof last === 'object' &&
              !Array.isArray(last) &&
              sub &&
              typeof sub === 'object' &&
              !Array.isArray(sub)
            ) {
              Object.assign(last, sub)
            } else {
              arr.push(sub)
            }
            continue
          }
          const c = stripComment(l.trim())
          if (!c.startsWith('- ')) break
          const rest = c.slice(2).trim()
          if (rest === '') {
            pos++
            if (pos < lines.length && indentOf(lines[pos]) > indent) {
              arr.push(parseNode(indentOf(lines[pos])))
            } else {
              arr.push(null)
            }
            continue
          }
          const idx = rest.indexOf(':')
          if (idx === -1) {
            arr.push(parseValue(rest))
            pos++
            continue
          }
          const key = rest.slice(0, idx).trim()
          const val = rest.slice(idx + 1).trim()
          if (val === '' || /^[|>][+-]?\d*$/.test(val)) {
            const item: Record<string, unknown> = {}
            pos++
            if (pos < lines.length) {
              const ni = indentOf(lines[pos])
              if (ni > indent) {
                if (/^[|>][+-]?\d*$/.test(val)) {
                  item[key] = parseBlockScalar(indent, val.startsWith('>'))
                } else {
                  item[key] = parseNode(ni)
                }
                arr.push(item)
                continue
              }
            }
            item[key] = null
            arr.push(item)
            continue
          }
          arr.push({ [key]: parseValue(val) })
          pos++
        }
        return arr
      }

      // ---- map ----
      const idx = content.indexOf(':')
      if (idx === -1) {
        pos++
        continue
      }
      const key = content.slice(0, idx).trim()
      const val = content.slice(idx + 1).trim()
      if (val === '' || /^[|>][+-]?\d*$/.test(val)) {
        pos++
        if (pos < lines.length) {
          const ni = indentOf(lines[pos])
          if (ni > indent) {
            if (/^[|>][+-]?\d*$/.test(val)) {
              obj[key] = parseBlockScalar(indent, val.startsWith('>'))
            } else {
              obj[key] = parseNode(ni)
            }
            continue
          }
        }
        obj[key] = null
        continue
      }
      obj[key] = parseValue(val)
      pos++
    }
    return obj
  }

  while (pos < lines.length && (isBlank(lines[pos]) || lines[pos].trim() === '---')) {
    pos++
  }
  if (pos >= lines.length) return {}
  const result = parseNode(indentOf(lines[pos]))
  return (result && typeof result === 'object' && !Array.isArray(result)
    ? result
    : {}) as Record<string, unknown>
}

// ==================== 导入：SpecKit workflow.yml → 平台 ====================

/** 创建一个平台节点（导入用） */
function createNode(
  type: string,
  title: string,
  index: number,
  extra: Record<string, unknown> = {},
): Node {
  return {
    id: uuidv4(),
    type,
    position: { x: 60 + index * 220, y: 0 },
    data: { title, ...extra },
  }
}

/** 解析 workflow.yml 的 steps → 平台节点与连线（链式连接） */
export function parseSpecKitWorkflow(text: string): ParsedSpecWorkflow {
  const doc = yamlParse(text)
  const workflow = (doc.workflow as Record<string, unknown> | undefined) ?? {}
  const steps = Array.isArray(workflow.steps)
    ? (workflow.steps as Record<string, unknown>[])
    : Array.isArray(doc.steps)
      ? (doc.steps as Record<string, unknown>[])
      : []

  const nodes: Node[] = []
  const edges: Edge[] = []
  let prevId: string | null = null

  steps.forEach((step, i) => {
    const isGate = step.type === 'gate'
    const command = typeof step.command === 'string' ? step.command : ''
    const nodeType = isGate
      ? NodeTypes.USER_INPUT
      : SPECKIT_COMMAND_TO_NODE.get(command) || NodeTypes.AGENT
    const specStep = isGate ? undefined : SPECKIT_COMMAND_TO_STEP.get(command)
    const args = (step.input as Record<string, unknown> | undefined)?.args

    const title =
      (typeof step.id === 'string' && step.id) ||
      command ||
      `step-${i + 1}`

    const extra: Record<string, unknown> = {}
    if (specStep) extra.specStep = specStep
    if (isGate && typeof step.message === 'string') {
      extra.input = { prompt: step.message }
    }
    if (typeof args === 'string') extra.instruction = args

    const node = createNode(nodeType, title, i, extra)
    nodes.push(node)
    if (prevId) {
      edges.push({
        id: `${prevId}-${node.id}`,
        source: prevId,
        target: node.id,
        type: 'nodeEdge',
      })
    }
    prevId = node.id
  })

  return {
    name: typeof workflow.name === 'string' ? workflow.name : undefined,
    nodes,
    edges,
  }
}

// ==================== 导入：OpenSpec schema.yaml → 平台 ====================

/** 解析 schema.yaml 的 artifacts → 平台节点与连线（requires 建边） */
export function parseOpenSpecSchema(text: string): ParsedSpecWorkflow {
  const doc = yamlParse(text)
  const artifacts = Array.isArray(doc.artifacts)
    ? (doc.artifacts as Record<string, unknown>[])
    : []

  const nodes: Node[] = []
  const edges: Edge[] = []
  const idToNode = new Map<string, Node>()

  artifacts.forEach((artifact, i) => {
    const artifactId =
      typeof artifact.id === 'string' ? artifact.id : `artifact-${i + 1}`
    const nodeType = OPENSPEC_ARTIFACT_TO_NODE.get(artifactId) || NodeTypes.AGENT
    const specStep = OPENSPEC_ARTIFACT_TO_STEP.get(artifactId)

    const title = (typeof artifact.description === 'string' && artifact.description) ||
      artifactId

    const extra: Record<string, unknown> = {}
    if (specStep) extra.specStep = specStep
    if (typeof artifact.instruction === 'string') extra.instruction = artifact.instruction

    const node = createNode(nodeType, title, i, extra)
    nodes.push(node)
    idToNode.set(artifactId, node)
  })

  // requires 建边（source = 被依赖的 artifact）
  artifacts.forEach((artifact) => {
    const target = idToNode.get(String(artifact.id))
    if (!target) return
    const requires = Array.isArray(artifact.requires)
      ? artifact.requires.map((r) => String(r))
      : []
    for (const dep of requires) {
      const source = idToNode.get(dep)
      if (source) {
        edges.push({
          id: `${source.id}-${target.id}`,
          source: source.id,
          target: target.id,
          type: 'nodeEdge',
        })
      }
    }
  })

  // 无 requires 的 artifacts 按顺序链式相连（proposal → design → tasks 惯例）
  const connected = new Set(edges.map((e) => e.target))
  let prevId: string | null = null
  for (const node of nodes) {
    if (connected.has(node.id)) {
      prevId = node.id
      continue
    }
    if (prevId && !edges.some((e) => e.source === prevId && e.target === node.id)) {
      edges.push({
        id: `${prevId}-${node.id}`,
        source: prevId,
        target: node.id,
        type: 'nodeEdge',
      })
    }
    prevId = node.id
  }

  return {
    name: typeof doc.name === 'string' ? doc.name : undefined,
    nodes,
    edges,
  }
}
