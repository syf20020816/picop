/**
 * 工作流导出共享核心（纯 JS ESM）
 *
 * 画布导出（src/services/exporter.ts）与 Runner MCP（runner/mcp.mjs）共用同一套实现，
 * 保证 MCP 产物与画布导出一致。逻辑唯一来源，修改此处即同步两者。
 *
 * 依赖：js-yaml（项目已有依赖，node 从 node_modules 解析）。
 * 本模块只含纯函数，不涉及 fs/path 等 Node 内置模块。
 */
import { dump } from 'js-yaml'

// === 平台常量（与 src/types/index.ts、src/constants/spec.ts、src/services/specMap.ts 对齐） ===

/** 平台节点类型全集 */
export const NodeTypes = {
  USER_INPUT: 'userInput',
  AGENT: 'agent',
  AI_OUTPUT: 'aiOutput',
  ANSWER: 'answer',
  BMAD_AGENT: 'bmadAgent',
  LARK: 'lark',
  IF: 'if',
  IF_CONDITION: 'ifCondition',
  LOOP: 'loop',
  LOOP_CONDITION: 'loopCondition',
  RETRY: 'retry',
  CODE_AGENT: 'codeAgent',
  SKILL: 'skill',
  LARK_TEMPLATE: 'larkTemplate',
  MEMORY: 'memory',
  KNOWLEDGE_RETRIEVAL: 'knowledgeRetrieval',
  KEYWORD_AGENT: 'keywordAgent',
  TASK_PLANNER: 'taskPlanner',
  SELF_CHECK: 'selfCheck',
  CUSTOM: 'custom',
}

/** SpecStep 阶段标记 key 全集 */
export const SPEC_STEPS_KEYS = [
  'spec',
  'plan',
  'tasks',
  'report',
  'research',
  'data-model',
  'contracts',
  'adr',
]

/** SpecStep 阶段标记 → SpecKit 命令 */
const SPEC_STEP_TO_SPECKIT = new Map([
  ['spec', 'speckit.specify'],
  ['research', 'speckit.plan'],
  ['plan', 'speckit.plan'],
  ['data-model', 'speckit.plan'],
  ['contracts', 'speckit.plan'],
  ['tasks', 'speckit.tasks'],
  ['report', 'speckit.analyze'],
  ['adr', 'speckit.converge'],
])

/** SpecStep 阶段标记 → OpenSpec artifact */
const SPEC_STEP_TO_OPENSPEC = new Map([
  ['spec', 'proposal'],
  ['research', 'research'],
  ['plan', 'design'],
  ['data-model', 'data-model'],
  ['contracts', 'contracts'],
  ['adr', 'adr'],
  ['tasks', 'tasks'],
  ['report', 'review'],
])

/** 节点类型 → SpecKit 命令（无 specStep 兜底） */
const NODE_TYPE_TO_SPECKIT = new Map([
  [NodeTypes.AGENT, 'speckit.plan'],
  [NodeTypes.TASK_PLANNER, 'speckit.tasks'],
  [NodeTypes.SELF_CHECK, 'speckit.analyze'],
  [NodeTypes.CODE_AGENT, 'speckit.implement'],
  [NodeTypes.KEYWORD_AGENT, 'speckit.specify'],
  [NodeTypes.BMAD_AGENT, 'speckit.plan'],
  [NodeTypes.SKILL, 'speckit.plan'],
])

/** 节点类型 → OpenSpec artifact（无 specStep 兜底） */
const NODE_TYPE_TO_OPENSPEC = new Map([
  [NodeTypes.AGENT, 'proposal'],
  [NodeTypes.TASK_PLANNER, 'tasks'],
  [NodeTypes.SELF_CHECK, 'review'],
  [NodeTypes.KEYWORD_AGENT, 'proposal'],
])

// === 通用工具函数 ===

/** 生成合法的 step / 文件 id */
export function toStepId(raw, fallback) {
  const id = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return id || fallback
}

/** 清洗路径段：去除分隔符并阻断路径穿越（含 '..' 直接拒绝） */
export function safeSegment(raw, fallback) {
  const cleaned = String(raw ?? '')
    .replace(/[/\\]/g, '-')
    .trim()
  if (!cleaned || cleaned.includes('..')) return fallback
  return cleaned
}

/** 读取节点的 Spec 阶段标记 */
function getSpecStep(node) {
  const step = node?.data?.specStep
  return typeof step === 'string' ? step : undefined
}

/** 本机工具技能判断（skillId 形如 local:<tool>:<skillName>，由 Runner 读取用户本机 SKILL.md） */
export function isLocalSkillId(skillId) {
  return String(skillId || '').startsWith('local:')
}

/** modal 序列化剥离（仅保留模型引用，防止凭据泄露） */
function stripModal(modal) {
  if (!modal) return modal
  const stripped = {}
  if (modal.id) stripped.id = modal.id
  else if (modal.name) stripped.name = modal.name
  if (modal.alias) stripped.alias = modal.alias
  return Object.keys(stripped).length > 0 ? stripped : undefined
}

/** 从节点 data 中提取模型别名（已剥离敏感字段） */
function resolveModelAlias(node) {
  const modal = stripModal(node?.data?.modal)
  return modal?.alias || modal?.name || modal?.id || undefined
}

/** Kahn 拓扑排序（loop 回边特殊处理，与 src/engine/topological.ts 对齐） */
export function topologicalSort(nodes, edges) {
  const nodeIds = new Set(nodes.map((n) => n.id))
  const inDegree = new Map()
  const adjacency = new Map()

  const loopNodeIds = new Set(
    nodes.filter((n) => n.type === NodeTypes.LOOP).map((n) => n.id),
  )
  const loopConditionIds = new Set(
    nodes.filter((n) => n.type === NodeTypes.LOOP_CONDITION).map((n) => n.id),
  )

  const loopBackEdges = new Set()
  for (const edge of edges) {
    if (loopNodeIds.has(edge.target)) loopBackEdges.add(edge.id)
    if (loopConditionIds.has(edge.target) && !loopNodeIds.has(edge.source))
      loopBackEdges.add(edge.id)
  }

  for (const id of nodeIds) {
    inDegree.set(id, 0)
    adjacency.set(id, [])
  }
  for (const edge of edges) {
    const { source, target, id } = edge
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue
    if (loopBackEdges.has(id || '')) continue
    adjacency.get(source).push(target)
    inDegree.set(target, (inDegree.get(target) || 0) + 1)
  }

  const queue = []
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id)
  }
  const sortedIds = []
  while (queue.length > 0) {
    const id = queue.shift()
    sortedIds.push(id)
    for (const neighbor of adjacency.get(id) || []) {
      const newDegree = (inDegree.get(neighbor) || 1) - 1
      inDegree.set(neighbor, newDegree)
      if (newDegree === 0) queue.push(neighbor)
    }
  }
  return { sortedIds, cycles: [] }
}

/** 节点产物文件 slug：标题 + 节点 id 前 6 位，避免同名冲突 */
function nodeSlug(node, fallbackPrefix) {
  const title = node?.data?.title || ''
  const suffix = String(node.id || '')
    .replace(/-/g, '')
    .slice(0, 6)
  return toStepId(`${title}-${suffix}`, `${fallbackPrefix}-${suffix}`)
}

// === 输入物导出路径 ===

/** URL 清单的导出路径（飞书读/写文档与用户输入链接集中于此，便于复用时不重新导出 SKILL） */
export const URLS_ARTIFACT_PATH = 'inputs/urls.md'

/** 飞书节点 → 其在 urls.md 对应段落中的序号（读取段 / 写入段各自从 0 计） */
function larkRefIndexMap(nodes) {
  const map = new Map()
  for (const ref of listCollectableArtifacts(nodes).larkRefs) {
    map.set(ref.nodeId, {
      direction: ref.direction,
      index: ref.direction === 'write' ? ref.writeIndex : ref.readIndex,
    })
  }
  return map
}

// === 导出目录布局 ===

/** 取消「单次执行」时的共享根目录：prompts / memory / bmad / skills 提升到此，便于跨工作流复用 */
export const AGENT_ROOT = '.agent'

/** 拼接引用路径：dir 为空时退回相对路径本身 */
export function joinPath(dir, rel) {
  return dir ? `${dir}/${rel}` : rel
}

/**
 * 导出目录布局（决定主文件 / workflow 专属输入物 / 共享输入物的落盘位置与引用前缀）
 * - singleRun（默认）：全部挂在 workflowDir 下，自包含，便于单次执行
 * - 非 singleRun：prompts / memory / bmad / skills 提升到 .agent 顶层共享
 * @returns {{ singleRun:boolean, slug:string, workflowDir:string, sharedDir:string,
 *            skillsDir:string, wfRef:string, sharedRef:string }}
 *   workflowDir：主文件与 workflow 专属输入物（urls / user-input）所在目录
 *   sharedDir：prompts / memory / bmad 所在目录
 *   skillsDir：被引用的其他技能所在目录（skill 形态单次执行时为导出根，即与主技能同级）
 *   wfRef / sharedRef：引用前缀（单次执行保持既有相对写法，非单次执行统一从导出根起算）
 */
export function resolveLayout(format, workflowName, singleRun) {
  const slug = toStepId(workflowName, 'picop-workflow')
  const skillSlug = toStepId(workflowName, 'picop-skill')
  const shared = singleRun === false
  const base =
    format === 'openspec'
      ? `openspec/schemas/${slug}`
      : format === 'spec'
        ? `spec/changes/${slug}`
        : format === 'skill'
          ? `skills/${skillSlug}`
          : ''
  const workflowDir = shared
    ? base
      ? `${AGENT_ROOT}/${base}`
      : AGENT_ROOT
    : base
  // 单次执行：skill 用文件相对写法（前缀为空），其余用变更目录前缀；非单次执行：从导出根起算
  const wfRef = shared ? workflowDir : format === 'skill' ? '' : base
  return {
    singleRun: !shared,
    slug,
    workflowDir,
    sharedDir: shared ? AGENT_ROOT : base,
    skillsDir: shared ? AGENT_ROOT : format === 'skill' ? '' : base,
    wfRef,
    sharedRef: shared ? AGENT_ROOT : wfRef,
  }
}

/** urls.md 中某条飞书文档的文本引用（给 AI agent 读，按方向 + 段内序号） */
function urlsMdRef(direction, index, schemaDir) {
  const section =
    direction === 'write' ? 'Lark 文档（写入）' : 'Lark 文档（读取）'
  const prefix = schemaDir ? `${schemaDir}/` : ''
  return `${prefix}${URLS_ARTIFACT_PATH} 的「${section}」第 ${index + 1} 条`
}

/** urls.md 中某条飞书文档的 shell 取值表达式（运行时读取，避免把 URL 内联进脚本） */
function urlsMdShellRef(direction, index, wfRef) {
  const section = direction === 'write' ? 'Lark 文档（写入' : 'Lark 文档（读取'
  return `"$(sed -n '/^## ${section}/,/^## /p' ${joinPath(wfRef, URLS_ARTIFACT_PATH)} | grep -oE 'https?://[^ )]+' | sed -n '${index + 1}p')"`
}

/** urls.md 中项目位置段落的标题（路径 + 分支集中于此，便于复用） */
export const PROJECT_SECTION = '项目位置'

/** 节点 → 其在 urls.md「项目位置」段中的序号（从 0 计） */
function projectRefIndexMap(nodes) {
  const map = new Map()
  for (const ref of listCollectableArtifacts(nodes).projectRefs) {
    map.set(ref.nodeId, ref.index)
  }
  return map
}

/** urls.md 中某条项目位置的文本引用（给 AI agent 读，按段内序号） */
function projectMdRef(index, schemaDir) {
  const prefix = schemaDir ? `${schemaDir}/` : ''
  return `${prefix}${URLS_ARTIFACT_PATH} 的「${PROJECT_SECTION}」第 ${index + 1} 条`
}

/** 节点系统提示词存放目录（全量导出时落盘于此，便于复用） */
export const SYSTEM_PROMPT_DIR = 'inputs/prompts'

/** 节点类型 → 默认系统提示词文件（prompts/ 下） */
const NODE_SYSTEM_PROMPT_FILE = new Map([
  [NodeTypes.CODE_AGENT, 'codeAgent.md'],
  [NodeTypes.KEYWORD_AGENT, 'keywordAgent.md'],
  [NodeTypes.TASK_PLANNER, 'taskPlanner.md'],
  [NodeTypes.SELF_CHECK, 'selfCheck.md'],
])

/** 节点实际使用的系统提示词文件（codeAgent 按 mode 区分 analyze / batch） */
export function systemPromptFile(node) {
  if (node?.type === NodeTypes.CODE_AGENT) {
    return node?.data?.mode === 'batch' ? 'codeBatch.md' : 'codeAgent.md'
  }
  return NODE_SYSTEM_PROMPT_FILE.get(node?.type)
}

/**
 * 系统提示词在导出目录中的相对路径（相对所在共享根）：
 * - 单次执行：挂在 inputs/prompts/ 下（与 workflow 专属输入物同级）
 * - 非单次执行：提升为 prompts/<file>.md
 */
export function systemPromptArtifactPath(file, singleRun) {
  return singleRun === false
    ? `prompts/${file}`
    : `${SYSTEM_PROMPT_DIR}/${file}`
}

/**
 * 系统提示词片段：
 * - 全量导出：以 path 引用共享目录下的 prompt 文件（真实文件随全量导出落盘，便于复用）
 * - 非全量导出：内联提示词全文（调用方通过 options.systemPrompts 传入内容）
 * 无对应文件或缺少内联内容时返回空串。
 */
function systemPromptBlock(node, layout, options) {
  const file = systemPromptFile(node)
  if (!file) return ''
  if (options?.full) {
    const ref = joinPath(
      layout?.sharedRef,
      systemPromptArtifactPath(file, layout?.singleRun),
    )
    return `**系统提示词：请严格遵循 ${ref} 中的系统提示词执行本步骤。**`
  }
  const inline = options?.systemPrompts?.[file]
  if (!inline) return ''
  return `## 系统提示词\n${String(inline).trim()}`
}

/** userInput / agent 节点静态输入内容的导出路径 */
export function userInputArtifactPath(node) {
  return `inputs/user-input/${nodeSlug(node, 'input')}.md`
}

/** Skill 文件的导出路径 */
export function skillArtifactPath(skillId) {
  return `skills/${safeSegment(skillId, 'skill')}/SKILL.md`
}

/** BMad 角色文件的导出路径 */
export function bmadArtifactPath(node) {
  const data = node?.data || {}
  const name = data?.agentId || data?.role || ''
  return `bmad/agents/${safeSegment(name, nodeSlug(node, 'bmad'))}.md`
}

/** memory 节点的默认记忆路径 */
const DEFAULT_MEMORY_PATH = 'memory/memory.md'

/** 读取 memory 节点引用的路径（带默认值） */
export function memoryArtifactPath(node) {
  const p = String(node?.data?.memoryPath || DEFAULT_MEMORY_PATH).replace(
    /^\/+/,
    '',
  )
  return p.includes('..') ? DEFAULT_MEMORY_PATH : p
}

/** 本机技能导出为指令文件：外部 agent 用自己工具的本机技能执行（与平台技能 cp 文件区分） */
function localSkillInstructionRun(fileName, skillName) {
  return [
    `cat > ${fileName} << 'PICOP_SKILL_EOF'`,
    `使用你本机工具的本机技能「${skillName}」完成对应工作。`,
    'PICOP_SKILL_EOF',
  ].join('\n')
}

/** specStep → 运行时拉取产物落盘文件名 */
const SPEC_STEP_TO_ARTIFACT_FILE = {
  spec: 'spec.md',
  plan: 'plan.md',
  research: 'research.md',
  'data-model': 'data-model.md',
  contracts: 'contracts.md',
  adr: 'adr.md',
  tasks: 'tasks.md',
  report: 'report.md',
}

/** 输入类节点判定 */
const INPUT_NODE_TYPES = new Set([
  NodeTypes.LARK,
  NodeTypes.LARK_TEMPLATE,
  NodeTypes.SKILL,
  NodeTypes.MEMORY,
  NodeTypes.BMAD_AGENT,
])

/** lark 输出节点（action=write）：产物投递目标，非输入源 */
function isLarkWriteNode(node) {
  return node.type === NodeTypes.LARK && node?.data?.action === 'write'
}

/** 输入类节点判定（lark write 属于输出节点，排除） */
function isInputNode(node) {
  return INPUT_NODE_TYPES.has(node.type || '') && !isLarkWriteNode(node)
}

/** 处理类节点：产出「生成型 artifact」，instruction 由节点 data 翻译 */
const PROCESSING_NODE_TYPES = new Set([
  NodeTypes.AGENT,
  NodeTypes.CODE_AGENT,
  NodeTypes.TASK_PLANNER,
  NodeTypes.SELF_CHECK,
  NodeTypes.KEYWORD_AGENT,
  NodeTypes.AI_OUTPUT,
  NodeTypes.KNOWLEDGE_RETRIEVAL,
])

/** 处理类节点判定 */
function isProcessingNode(node) {
  return PROCESSING_NODE_TYPES.has(node.type || '')
}

/** 输入类节点（含 userInput）是否标注了 specStep */
function isSpecStepProvider(node) {
  return Boolean(
    getSpecStep(node) &&
    (isInputNode(node) || node.type === NodeTypes.USER_INPUT),
  )
}

// === Speckit 导出 ===

/** 需要转成 gate 门禁步骤的节点类型 */
const GATE_NODE_TYPES = new Set([NodeTypes.USER_INPUT, NodeTypes.ANSWER])

/** 解析节点应使用的 Speckit 命令 */
function resolveSpeckitCommand(node) {
  return (
    SPEC_STEP_TO_SPECKIT.get(getSpecStep(node)) ||
    NODE_TYPE_TO_SPECKIT.get(node.type || '')
  )
}

/**
 * 输入类节点标注 specStep 时，构建运行时拉取步骤（shell）：
 * 把随 zip 导出的外部内容 / 静态内容落盘为对应 spec 产物文件。
 */
function buildFetchStep(node, specStep, index, larkIdx, layout) {
  const data = node?.data || {}
  const fileName = SPEC_STEP_TO_ARTIFACT_FILE[specStep]
  if (!fileName) return null
  const id = toStepId(`fetch-${data?.title || ''}`, `fetch-step-${index + 1}`)
  let run
  switch (node.type) {
    case NodeTypes.LARK:
    case NodeTypes.LARK_TEMPLATE: {
      const idx = larkIdx?.get(node.id)
      if (!idx) return null
      run = `lark-cli docs +fetch --doc ${urlsMdShellRef('read', idx.index, layout?.wfRef)} --doc-format markdown --jq '.data.document.content' > ${fileName}`
      break
    }
    case NodeTypes.SKILL: {
      const skillId = data.skillId
      if (!skillId) return null
      if (isLocalSkillId(skillId)) {
        run = localSkillInstructionRun(fileName, data.skillName || skillId)
      } else {
        run = `cp ${joinPath(layout?.skillsDir, skillArtifactPath(skillId))} ${fileName}`
      }
      break
    }
    case NodeTypes.MEMORY: {
      run = `cp ${joinPath(layout?.sharedRef, memoryArtifactPath(node))} ${fileName}`
      break
    }
    case NodeTypes.BMAD_AGENT: {
      run = `cp ${joinPath(layout?.sharedRef, bmadArtifactPath(node))} ${fileName}`
      break
    }
    case NodeTypes.USER_INPUT: {
      run = `cp ${joinPath(layout?.wfRef, userInputArtifactPath(node))} ${fileName}`
      break
    }
  }
  if (!run) return null
  return { id, type: 'shell', run, timeout: 60 }
}

/** 知识库检索节点 → shell run 命令（api 用 curl 直调，local 写指令文件供 agent 用 MCP 执行） */
function buildKnowledgeRetrievalRun(node, fileName) {
  const data = node?.data || {}
  const mode = data.mode || 'local'
  if (mode === 'api') {
    const url = data.url
    if (!url) return undefined
    const method = data.method || 'GET'
    const headerArgs = (data.headers || [])
      .filter((h) => h?.key)
      .map((h) => `-H "${h.key}: ${h.value}"`)
      .join(' ')
    const bodyArg = method === 'GET' ? '' : data.body ? `-d '${data.body}'` : ''
    return `curl -sS -X ${method} '${url}' ${headerArgs} ${bodyArg} > ${fileName}`
      .replace(/\s+/g, ' ')
      .trim()
  }
  const skill = data.skillName || data.skillId || ''
  const query = data.query || '使用上游输出作为查询内容'
  return [
    `cat > ${fileName} << 'PICOP_KB_EOF'`,
    `使用你的 MCP 连接用户知识库${skill ? `（技能：${skill}）` : ''}检索：${query}`,
    'PICOP_KB_EOF',
  ].join('\n')
}

/** 解析节点的输入参数 */
function resolveInput(_node) {
  return { args: '{{ inputs.spec }}' }
}

/** 构建一个可用于合并比对的 step 描述对象 */
function buildStepDescriptor(node) {
  const command = resolveSpeckitCommand(node)
  if (!command) return null
  return {
    command,
    integration: '{{ inputs.integration }}',
    model: resolveModelAlias(node),
    input: resolveInput(node),
    specStep: getSpecStep(node),
  }
}

function stepDescriptorKey(desc) {
  return JSON.stringify({
    command: desc.command,
    integration: desc.integration,
    model: desc.model,
    input: desc.input,
    specStep: desc.specStep,
  })
}

/** 把节点解析为 workflow.yml step（可能产出多个：gate + fetch / deliver） */
function nodeToSteps(node, index, larkIdx, layout) {
  const data = node?.data || {}
  const id = toStepId(data?.title || '', `step-${index + 1}`)

  if (GATE_NODE_TYPES.has(node.type || '')) {
    const question = data?.input?.prompt || data?.question
    const gate = {
      id,
      type: 'gate',
      message:
        question ||
        `Review before proceeding (from node "${data?.title || id}").`,
      options: ['approve', 'reject'],
      on_reject: 'abort',
    }
    const specStep = getSpecStep(node)
    if (node.type === NodeTypes.USER_INPUT && specStep) {
      const fetch = buildFetchStep(node, specStep, index, larkIdx, layout)
      if (fetch) return [gate, fetch]
    }
    return [gate]
  }

  if (isLarkWriteNode(node)) {
    const specStep = getSpecStep(node)
    const fileName = specStep ? SPEC_STEP_TO_ARTIFACT_FILE[specStep] : undefined
    const idx = larkIdx?.get(node.id)
    if (!idx || !fileName) return []
    const mode = data?.writeMode === 'append' ? 'append' : 'overwrite'
    return [
      {
        id: toStepId(`deliver-${data?.title || ''}`, `deliver-${index + 1}`),
        type: 'shell',
        run: `lark-cli docs +update --doc ${urlsMdShellRef('write', idx.index, layout?.wfRef)} --command ${mode} --content @${fileName} --doc-format markdown`,
        timeout: 60,
      },
    ]
  }

  if (isInputNode(node)) {
    const specStep = getSpecStep(node)
    if (!specStep) return []
    const fetch = buildFetchStep(node, specStep, index, larkIdx, layout)
    return fetch ? [fetch] : []
  }

  if (node.type === NodeTypes.KNOWLEDGE_RETRIEVAL) {
    const specStep = getSpecStep(node)
    const fileName = specStep
      ? SPEC_STEP_TO_ARTIFACT_FILE[specStep]
      : 'knowledge-retrieval.md'
    const run = buildKnowledgeRetrievalRun(node, fileName)
    if (!run) return []
    return [{ id, type: 'shell', run, timeout: 120 }]
  }

  const command = resolveSpeckitCommand(node)
  if (!command) return []

  const step = { id, command, integration: '{{ inputs.integration }}' }
  const alias = resolveModelAlias(node)
  if (alias) step.model = alias
  const specStep = getSpecStep(node)
  if (specStep) step.spec_step = specStep
  step.input = resolveInput(node)
  return [step]
}

/** 基于拓扑排序结果计算每个节点的层号（最长前驱路径） */
function computeNodeLayers(sortedIds, edges) {
  const layer = new Map()
  const predecessors = new Map()
  for (const edge of edges) {
    if (!predecessors.has(edge.target)) predecessors.set(edge.target, [])
    predecessors.get(edge.target).push(edge.source)
  }
  for (const id of sortedIds) {
    let maxLayer = -1
    for (const pred of predecessors.get(id) || []) {
      if (layer.has(pred)) maxLayer = Math.max(maxLayer, layer.get(pred))
    }
    layer.set(id, maxLayer + 1)
  }
  return layer
}

/** 合并同一拓扑层中完全相同的 command step，保持原顺序 */
function mergeParallelSteps(nodes, layers, steps, stepNodeIds) {
  const idToStepIndex = new Map()
  stepNodeIds.forEach((id, i) => idToStepIndex.set(id, i))

  const layerGroups = new Map()
  for (const id of stepNodeIds) {
    const l = layers.get(id) ?? 0
    if (!layerGroups.has(l)) layerGroups.set(l, [])
    layerGroups.get(l).push(id)
  }

  const merged = []
  let combineIndex = 0

  for (let l = 0; l <= Math.max(...layerGroups.keys(), 0); l++) {
    const layerIds = layerGroups.get(l) || []
    const groups = new Map()
    const layerItems = []

    for (const nodeId of layerIds) {
      const idx = idToStepIndex.get(nodeId)
      if (idx === undefined) continue
      const step = steps[idx]
      if (step.type === 'gate' || step.type === 'shell') {
        layerItems.push({ type: 'single', nodeId })
        continue
      }
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) {
        layerItems.push({ type: 'single', nodeId })
        continue
      }
      const desc = buildStepDescriptor(node)
      if (!desc) {
        layerItems.push({ type: 'single', nodeId })
        continue
      }
      const key = stepDescriptorKey(desc)
      if (!groups.has(key)) {
        groups.set(key, { desc, nodeIds: [] })
        layerItems.push({ type: 'group', key })
      }
      groups.get(key).nodeIds.push(nodeId)
    }

    const seenKeys = new Set()
    for (const item of layerItems) {
      if (item.type === 'single') {
        const idx = idToStepIndex.get(item.nodeId)
        merged.push(steps[idx])
      } else if (!seenKeys.has(item.key)) {
        seenKeys.add(item.key)
        const group = groups.get(item.key)
        if (group.nodeIds.length === 1) {
          const idx = idToStepIndex.get(group.nodeIds[0])
          merged.push(steps[idx])
        } else {
          combineIndex++
          const { desc } = group
          const id = toStepId(
            `combine_${desc.command}_${combineIndex}`,
            `combine-${combineIndex}`,
          )
          const step = {
            id,
            command: desc.command,
            integration: desc.integration,
          }
          if (desc.model) step.model = desc.model
          if (desc.specStep) step.spec_step = desc.specStep
          step.input = desc.input
          merged.push(step)
        }
      }
    }
  }

  return merged
}

/** 平台节点/连线 → Speckit workflow.yml 文本与配套产物 */
export function buildSpecKitWorkflow(nodes, edges, options = {}) {
  const { sortedIds } = topologicalSort(nodes, edges)
  const sorted = sortedIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter(Boolean)

  // 目录布局：决定各输入物的落盘位置与引用前缀（单次执行 / .agent 共享结构）
  const layout = resolveLayout('speckit', options.name, options.singleRun)

  const providedSpecSteps = new Map()
  // 飞书节点 → urls.md 段内序号（shell 步骤运行时取值，URL 不内联）
  const larkIdx = larkRefIndexMap(nodes)
  for (const node of sorted) {
    if (!isSpecStepProvider(node)) continue
    const step = getSpecStep(node)
    if (!providedSpecSteps.has(step)) {
      providedSpecSteps.set(step, node?.data?.title || node.id)
    }
  }

  const steps = []
  const stepNodeIds = []
  let skipped = 0
  const overriddenNotes = []

  sorted.forEach((node, i) => {
    const specStep = getSpecStep(node)
    if (
      specStep &&
      providedSpecSteps.has(specStep) &&
      !isSpecStepProvider(node)
    ) {
      const provider = providedSpecSteps.get(specStep)
      overriddenNotes.push(
        `step "${node?.data?.title || node.id}" (${specStep}) 的产物已由输入节点 "${provider}" 提供，跳过生成命令`,
      )
      return
    }
    const nodeSteps = nodeToSteps(node, i, larkIdx, layout)
    if (nodeSteps.length === 0) {
      if (!isInputNode(node) && !isLarkWriteNode(node)) skipped++
      return
    }
    for (const step of nodeSteps) {
      steps.push(step)
      stepNodeIds.push(node.id)
    }
  })

  let finalSteps = steps
  if (options.mergeParallel) {
    const layers = computeNodeLayers(sortedIds, edges)
    finalSteps = mergeParallelSteps(nodes, layers, steps, stepNodeIds)
  }

  const name = options.name?.trim() || 'picop-workflow'
  const doc = {
    schema_version: '1.0',
    workflow: {
      id: toStepId(name, 'picop-workflow'),
      name,
      version: '1.0.0',
      author: 'ai-workflow',
      description: `Exported from Picop (${nodes.length} nodes, ${edges.length} edges).`,
    },
    requires: {
      speckit_version: '>=0.8.5',
      integrations: { any: ['claude', 'copilot', 'gemini', 'opencode'] },
    },
    inputs: {
      spec: {
        type: 'string',
        required: true,
        prompt: 'Describe what you want to build',
      },
      integration: { type: 'string', default: 'auto' },
    },
    steps: finalSteps,
  }

  const notes = []
  if (skipped > 0) {
    notes.push(
      `# Note: ${skipped} control node(s) (if/loop/retry...) skipped - map expressions manually.`,
    )
  }
  for (const note of overriddenNotes) {
    notes.push(`# Note: ${note}.`)
  }

  const yaml =
    (notes.length > 0 ? notes.join('\n') + '\n' : '') +
    dump(doc, { lineWidth: -1, noRefs: true })
  const workflowPath = joinPath(
    layout.workflowDir,
    `specify/workflows/${layout.slug}/workflow.yml`,
  )

  return { yaml, workflowPath }
}

// === OpenSpec / Spec 导出 ===

/** OpenSpec schema 在 zip 内的目录（输入物与 schema.yaml 同级存放） */
export function openSpecSchemaDir(workflowName, singleRun) {
  return resolveLayout('openspec', workflowName, singleRun).workflowDir
}

/** Spec 导出：变更目录（md 产物与输入物所在层级） */
export function specChangeDir(workflowName, singleRun) {
  return resolveLayout('spec', workflowName, singleRun).workflowDir
}

/** 输入类节点 → OpenSpec artifact 的拉取指引（layout 决定各输入物的引用前缀） */
function buildOpenSpecFetchInstruction(node, artifactId, layout, larkIdx) {
  const data = node?.data || {}
  const file = `${artifactId}.md`
  switch (node.type) {
    case NodeTypes.LARK:
    case NodeTypes.LARK_TEMPLATE: {
      const idx = larkIdx?.get(node.id)
      if (!idx) return `Create the ${file} document for this change.`
      return `使用 lark-cli 拉取 ${urlsMdRef(idx.direction, idx.index, layout.wfRef)} 的文档内容并原样保存为 ${file}，不要自行生成或改写内容。`
    }
    case NodeTypes.SKILL: {
      const skillId = String(data.skillId || '')
      if (!skillId) return `Create the ${file} document for this change.`
      if (isLocalSkillId(skillId)) {
        return `使用你本机工具的本机技能「${data.skillName || skillId}」完成对应工作并保存为 ${file}。`
      }
      return `读取导出的 ${joinPath(layout.skillsDir, skillArtifactPath(skillId))} 文件内容并保存为 ${file}。`
    }
    case NodeTypes.MEMORY:
      return `读取导出的 ${joinPath(layout.sharedRef, memoryArtifactPath(node))} 文件内容并保存为 ${file}。`
    case NodeTypes.BMAD_AGENT:
      return `读取导出的 ${joinPath(layout.sharedRef, bmadArtifactPath(node))} 文件内容并保存为 ${file}。`
    case NodeTypes.USER_INPUT:
      return `读取导出的 ${joinPath(layout.wfRef, userInputArtifactPath(node))} 内容并整理保存为 ${file}。`
    default:
      return `Create the ${file} document for this change.`
  }
}

/** 沿边 BFS 查找最近的满足条件的节点（向上找处理节点 / 向下找注入目标） */
function findNearestNode(start, neighbors, nodeMap, predicate) {
  const visited = new Set([start.id])
  const queue = [...(neighbors.get(start.id) || [])]
  while (queue.length > 0) {
    const id = queue.shift()
    if (visited.has(id)) continue
    visited.add(id)
    const n = nodeMap.get(id)
    if (!n) continue
    if (predicate(n)) return n
    queue.push(...(neighbors.get(id) || []))
  }
  return null
}

/** 输入类节点的导出物引用文本（供处理节点 instruction 的「输入上下文」引用） */
function inputNodeRef(node, layout, larkIdx) {
  const data = node?.data || {}
  switch (node.type) {
    case NodeTypes.LARK:
    case NodeTypes.LARK_TEMPLATE: {
      if (isLarkWriteNode(node)) return undefined
      const idx = larkIdx?.get(node.id)
      if (!idx) return undefined
      const title = data.title || `第 ${idx.index + 1} 条`
      return `Lark 文档「${title}」：${urlsMdRef('read', idx.index, layout.wfRef)}`
    }
    case NodeTypes.SKILL:
      if (!data.skillId) return undefined
      return isLocalSkillId(String(data.skillId))
        ? `本机工具技能「${data.skillName || data.skillId}」`
        : `${joinPath(layout.skillsDir, skillArtifactPath(String(data.skillId)))}（技能指引：${data.skillName || data.skillId}）`
    case NodeTypes.MEMORY:
      return `${joinPath(layout.sharedRef, memoryArtifactPath(node))}（项目记忆）`
    case NodeTypes.USER_INPUT:
      return `${joinPath(layout.wfRef, userInputArtifactPath(node))}（用户输入）`
    default:
      return undefined
  }
}

/** 收集节点的全部上游输入类节点引用（沿边递归遍历祖先） */
function collectUpstreamInputRefs(node, preds, nodeMap, layout, larkIdx) {
  const refs = []
  const visited = new Set([node.id])
  const queue = [...(preds.get(node.id) || [])]
  while (queue.length > 0) {
    const id = queue.shift()
    if (visited.has(id)) continue
    visited.add(id)
    const n = nodeMap.get(id)
    if (!n) continue
    const ref = inputNodeRef(n, layout, larkIdx)
    if (ref) refs.push(ref)
    queue.push(...(preds.get(id) || []))
  }
  return refs
}

/** 处理类节点 → 生成型 artifact 的 instruction */
function buildProcessingInstruction(
  node,
  artifactId,
  layout,
  preds,
  nodeMap,
  nodeDeliveries,
  larkIdx,
  projectIdx,
  options,
) {
  const data = node?.data || {}
  const title = data?.title || artifactId
  const parts = []

  switch (node.type) {
    case NodeTypes.CODE_AGENT: {
      const lines = [
        data.instruction || data.description || '分析项目代码并输出技术文档。',
      ]
      const idx = projectIdx?.get(node.id)
      if (idx !== undefined) {
        lines.push(
          `项目路径：见 ${projectMdRef(idx, layout.wfRef)}，本地执行时直接读取项目源码。`,
        )
      }
      if (data.appMapPath) {
        lines.push(`参考应用映射表:${data.appMapPath}(如果有)`)
      }
      parts.push(lines.join('\n'))
      break
    }
    case NodeTypes.TASK_PLANNER:
      parts.push(
        [
          data.instruction || '',
          `基于上游产物拆解出可勾选的实施任务清单（- [ ] 1.x 子任务格式，含验收标准引用）。`,
        ]
          .filter(Boolean)
          .join('\n'),
      )
      break
    case NodeTypes.SELF_CHECK:
      parts.push(
        [
          data.instruction || '',
          '对全部已产出文档执行跨产物一致性检查，输出问题清单与修订建议。',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      break
    case NodeTypes.KNOWLEDGE_RETRIEVAL: {
      const mode = data.mode || 'local'
      if (mode === 'api') {
        const method = data.method || 'GET'
        const headerArgs = (data.headers || [])
          .filter((h) => h?.key)
          .map((h) => `-H "${h.key}: ${h.value}"`)
          .join(' ')
        const bodyArg =
          method === 'GET' ? '' : data.body ? `-d '${data.body}'` : ''
        parts.push(
          `调用远程知识库接口：\ncurl -sS -X ${method} '${data.url}' ${headerArgs} ${bodyArg}\n` +
            `将接口响应内容整理保存为 ${artifactId}.md。`,
        )
      } else {
        parts.push(
          `使用你的 MCP 连接用户知识库${data.skillName ? `（技能：${data.skillName}）` : ''}检索：` +
            `${data.query || '使用上游产物内容作为查询'}\n` +
            `将检索结果整理保存为 ${artifactId}.md。`,
        )
      }
      break
    }
    default:
      parts.push(
        data.instruction ||
          data.description ||
          `完成「${title}」并输出 ${artifactId}.md。`,
      )
  }

  const refs = collectUpstreamInputRefs(node, preds, nodeMap, layout, larkIdx)
  const embedded =
    data.input?.label ||
    data.input?.prompt ||
    data.input?.files?.length ||
    data.input?.urls?.length
  if (embedded)
    refs.unshift(
      `${joinPath(layout.wfRef, userInputArtifactPath(node))}（本节点输入）`,
    )
  if (refs.length > 0) {
    parts.push('## 输入上下文\n' + refs.map((r) => `- ${r}`).join('\n'))
  }

  // 系统提示词：全量导出走 path 引用，非全量导出内联全文
  const sp = systemPromptBlock(node, layout, options)
  if (sp) parts.push(sp)

  for (const d of nodeDeliveries) {
    parts.push(
      `## 产物投递\n生成完成后使用 lark-cli 将 ${artifactId}.md 全文写入飞书文档（URL 见 ${urlsMdRef('write', d.index, layout.wfRef)}）：\n` +
        `lark-cli docs +update --doc "<上面 urls.md 中该条目的 URL>" --command ${d.mode} --content @${artifactId}.md --doc-format markdown`,
    )
  }

  return parts.join('\n\n')
}

/**
 * artifacts 依赖图构建流水线（OpenSpec / Spec 导出共用）：
 * 输入节点（标注 specStep）→ 拉取型 artifact；处理节点 → 生成型 artifact；
 * lark write → 反向挂接投递；bmadAgent → 角色注入；可选 tasks 自动补全。
 */
function buildArtifactsPipeline(nodes, edges, config) {
  const { sortedIds } = topologicalSort(nodes, edges)
  const sorted = sortedIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter(Boolean)

  const stepToArtifactId = (step) =>
    config.artifactIdMode === 'openspec'
      ? SPEC_STEP_TO_OPENSPEC.get(step) || step
      : step

  const preds = new Map()
  const succs = new Map()
  for (const edge of edges) {
    if (!preds.has(edge.target)) preds.set(edge.target, [])
    preds.get(edge.target).push(edge.source)
    if (!succs.has(edge.source)) succs.set(edge.source, [])
    succs.get(edge.source).push(edge.target)
  }
  const nodeMap = new Map(sorted.map((n) => [n.id, n]))
  // 飞书节点 → urls.md 段内序号（只引用，不内联 URL）
  const larkIdx = larkRefIndexMap(nodes)
  // 项目位置 → urls.md 段内序号（只引用，不内联路径）
  const projectIdx = projectRefIndexMap(nodes)
  // 目录布局：决定各输入物的落盘位置与引用前缀（单次执行 / .agent 共享结构）
  const layout = config.layout

  // ---- 1. lark write 反向挂接：找上游最近处理节点，specStep 与投递指令转移给它 ----
  const mountSpecStep = new Map()
  const deliveries = new Map()
  const orphanWrites = []
  for (const node of sorted) {
    if (!isLarkWriteNode(node)) continue
    if (config.writeNeedsSpecStep && !getSpecStep(node)) continue
    const url = node?.data?.url
    if (!url) continue
    const idx = larkIdx.get(node.id)
    if (!idx) continue
    const mode = node?.data?.writeMode === 'append' ? 'append' : 'overwrite'
    const upstream = findNearestNode(node, preds, nodeMap, isProcessingNode)
    if (upstream) {
      const list = deliveries.get(upstream.id) || []
      list.push({ index: idx.index, mode })
      deliveries.set(upstream.id, list)
      const step = getSpecStep(node)
      if (step && !getSpecStep(upstream) && !mountSpecStep.has(upstream.id)) {
        mountSpecStep.set(upstream.id, step)
      }
    } else {
      orphanWrites.push({
        index: idx.index,
        mode,
        title: node?.data?.title || node.id,
      })
    }
  }

  // ---- 2. 输入节点提供的 specStep（拉取型 artifact 优先） ----
  const providedArtifactIds = new Set()
  for (const node of sorted) {
    if (!isSpecStepProvider(node)) continue
    const artifactId = stepToArtifactId(getSpecStep(node))
    if (artifactId) providedArtifactIds.add(artifactId)
  }

  // ---- 3. 生成 artifacts：输入拉取型 + 处理生成型 ----
  const artifacts = []
  const seenIds = new Set()
  const artifactByNode = new Map()

  for (const node of sorted) {
    if (isLarkWriteNode(node)) continue
    if (node.type === NodeTypes.ANSWER) continue

    if (node.type === NodeTypes.USER_INPUT) {
      const step = getSpecStep(node)
      if (!step) continue
      const artifactId = stepToArtifactId(step)
      if (!artifactId || seenIds.has(artifactId)) continue
      seenIds.add(artifactId)
      artifacts.push({
        id: artifactId,
        generates: `${artifactId}.md`,
        description: node?.data?.title || artifactId,
        instruction: buildOpenSpecFetchInstruction(
          node,
          artifactId,
          layout,
          larkIdx,
        ),
        requires: [],
      })
      continue
    }

    if (isInputNode(node)) {
      const step = getSpecStep(node)
      if (!step) continue
      const artifactId = stepToArtifactId(step)
      if (!artifactId || seenIds.has(artifactId)) continue
      seenIds.add(artifactId)
      artifacts.push({
        id: artifactId,
        generates: `${artifactId}.md`,
        description: node?.data?.title || artifactId,
        instruction: buildOpenSpecFetchInstruction(
          node,
          artifactId,
          layout,
          larkIdx,
        ),
        requires: [],
      })
      continue
    }

    if (!isProcessingNode(node)) continue
    const ownStep = getSpecStep(node)
    const mountedStep = mountSpecStep.get(node.id)
    let artifactId
    if (ownStep)
      artifactId = stepToArtifactId(ownStep) || nodeSlug(node, 'artifact')
    else if (mountedStep)
      artifactId = stepToArtifactId(mountedStep) || nodeSlug(node, 'artifact')
    else if (config.typeFallback)
      artifactId =
        NODE_TYPE_TO_OPENSPEC.get(node.type || '') || nodeSlug(node, 'artifact')
    else continue
    if (seenIds.has(artifactId)) artifactId = nodeSlug(node, 'artifact')
    if (seenIds.has(artifactId)) continue
    if ((ownStep || mountedStep) && providedArtifactIds.has(artifactId))
      continue

    const artifact = {
      id: artifactId,
      generates: `${artifactId}.md`,
      description: node?.data?.title || artifactId,
      instruction: buildProcessingInstruction(
        node,
        artifactId,
        layout,
        preds,
        nodeMap,
        deliveries.get(node.id) || [],
        larkIdx,
        projectIdx,
        config.options,
      ),
      requires: [],
    }
    seenIds.add(artifactId)
    artifacts.push(artifact)
    artifactByNode.set(node.id, artifact)
  }

  // ---- 4. bmadAgent 角色注入：无 specStep 的角色节点，约束注入下游最近处理节点 ----
  for (const node of sorted) {
    if (node.type !== NodeTypes.BMAD_AGENT || getSpecStep(node)) continue
    const target = findNearestNode(node, succs, nodeMap, isProcessingNode)
    const artifact = target ? artifactByNode.get(target.id) : undefined
    if (!artifact) continue
    const data = node?.data || {}
    const roleHeader =
      `## 角色\n以 ${data.role || 'BMad Agent'}（${data.agentId || node.id}）身份执行：` +
      `${data.roleDescription || data.systemPrompt || ''}\n完整角色定义见 ${joinPath(layout.sharedRef, bmadArtifactPath(node))}\n\n`
    artifact.instruction = roleHeader + artifact.instruction
  }

  // ---- 5. 无上游处理节点的 lark write：降级为独立 delivery artifact ----
  for (const w of orphanWrites) {
    if (artifacts.length === 0) break
    const id = toStepId(`deliver-${w.title}`, 'deliver')
    if (seenIds.has(id)) continue
    seenIds.add(id)
    artifacts.push({
      id,
      generates: `${id}.md`,
      description: `将上游产物写入飞书文档（${w.title}）`,
      instruction:
        `读取上游产物文档全文，使用 lark-cli 写入飞书文档（URL 见 ${urlsMdRef('write', w.index, layout.wfRef)}）：\n` +
        `lark-cli docs +update --doc "<上面 urls.md 中该条目的 URL>" --command ${w.mode} --content @<上游产物文件> --doc-format markdown\n` +
        `本步骤不产生新内容，仅投递。`,
      requires: [],
    })
  }

  // ---- 6. tasks artifact 自动补全：保证 /opsx:apply 可执行（OpenSpec 专属） ----
  if (config.autoTasks) {
    const hasTasks =
      seenIds.has('tasks') || sorted.some((n) => getSpecStep(n) === 'tasks')
    if (!hasTasks && artifacts.length > 0) {
      const lastId = artifacts[artifacts.length - 1].id
      seenIds.add('tasks')
      artifacts.push({
        id: 'tasks',
        generates: 'tasks.md',
        description: '实施任务清单（自动补全）',
        instruction: `基于 ${lastId}.md 拆解出可勾选的实施任务清单（- [ ] 1.x 子任务格式，含验收标准引用）。`,
        requires: [],
      })
    }
  }

  // ---- 7. requires 依赖链（拓扑顺序） ----
  artifacts.forEach((a, i) => {
    a.requires = i === 0 ? [] : [artifacts[i - 1].id]
  })

  return artifacts
}

/** 平台节点/连线 → OpenSpec schema 文本与配套产物 */
export function buildOpenSpecWorkflow(nodes, edges, options = {}) {
  const name = options.name?.trim() || 'picop-workflow'
  const layout = resolveLayout('openspec', name, options.singleRun)
  const artifacts = buildArtifactsPipeline(nodes, edges, {
    artifactIdMode: 'openspec',
    typeFallback: true,
    writeNeedsSpecStep: false,
    autoTasks: true,
    layout,
    options,
  })

  const doc = {
    name: toStepId(name, 'picop-workflow'),
    version: 1,
    description: name,
    artifacts,
  }

  if (artifacts.length > 0) {
    const tracked =
      artifacts.find((a) => a.id === 'tasks') || artifacts[artifacts.length - 1]
    doc.apply = {
      requires: [tracked.id],
      tracks: `${tracked.id}.md`,
    }
  }

  const yaml = dump(doc, { lineWidth: -1, noRefs: true })
  const workflowPath = `${layout.workflowDir}/schema.yaml`

  return { yaml, workflowPath }
}

/**
 * Spec 导出：与 OpenSpec 同构的 artifacts 依赖图，差异：
 * - artifact id 直接用 specStep key（plan.md 而非 design.md）
 * - 只认手动标注 specStep 的节点，不做类型兜底 / tasks 自动补全
 * - 无 openspec 目录约定（config.yaml / archive），无需安装框架，任意 agent 读 workflow.yaml 即可执行
 */
export function buildSpecWorkflow(nodes, edges, options = {}) {
  const name = options.name?.trim() || 'picop-workflow'
  const layout = resolveLayout('spec', name, options.singleRun)
  const artifacts = buildArtifactsPipeline(nodes, edges, {
    artifactIdMode: 'step',
    typeFallback: false,
    writeNeedsSpecStep: true,
    autoTasks: false,
    layout,
    options,
  })

  const doc = {
    name: toStepId(name, 'picop-workflow'),
    version: 1,
    description: name,
    artifacts,
  }

  const yaml = dump(doc, { lineWidth: -1, noRefs: true })
  const workflowPath = `${layout.workflowDir}/specs/${layout.slug}/workflow.yaml`

  return { yaml, workflowPath }
}

// === SKILL 导出 ===

/** SKILL 形态导出目录（含目录名，SKILL.md 所在处） */
export function skillDir(workflowName, singleRun) {
  return resolveLayout('skill', workflowName, singleRun).workflowDir
}

/** SKILL 步骤引用：`步骤 N 的 标题`（N 为拓扑序步骤号） */
function skillStepRef(ctx, id) {
  const node = ctx?.nodeMap?.get(id)
  const step = ctx?.stepIndex?.get(id)
  if (!node || !step) return null
  return `步骤 ${step} 的${node?.data?.title || node.type || '上游产物'}`
}

/** 下游节点消费本产物时的动词（写文档 / 输出 / 使用） */
function skillDownstreamVerb(node) {
  if (isLarkWriteNode(node)) return '写入飞书文档'
  if (node?.type === NodeTypes.AI_OUTPUT) return '输出最终产物'
  return '使用'
}

/** 从单个非输入节点生成 SKILL 正文的一句/一段指令（自然语言） */
function skillNodeInstruction(node, projectIdx, ctx) {
  const data = node?.data || {}
  const layout = ctx?.layout
  switch (node.type) {
    case NodeTypes.SKILL:
      return data.skillName || data.skillId || ''
        ? `使用技能「${data.skillName || data.skillId}」完成对应工作。`
        : ''
    case NodeTypes.KNOWLEDGE_RETRIEVAL: {
      const mode = data.mode || 'local'
      const query = data.query
        ? `查询内容：${data.query}`
        : '以上游输出为查询内容'
      if (mode === 'api') {
        return `调用远程知识库接口（${data.method || 'GET'} ${data.url}），将接口响应作为检索结果。${query}`
      }
      return `使用你的 MCP 连接用户知识库检索：${query}${data.skillName ? `（技能：${data.skillName}）` : ''}`
    }
    case NodeTypes.CODE_AGENT: {
      // 项目路径（含分支）不内联：集中在 inputs/urls.md 的「项目位置」段，便于复用
      const idx = projectIdx?.get(node.id)
      const target =
        idx !== undefined
          ? `在项目（位置见 ${projectMdRef(idx, layout?.wfRef)}）`
          : '在当前项目'
      const intent =
        data.instruction || data.description || '分析 / 修改项目代码'
      const appMap = data.appMapPath
        ? `可参考应用映射表 ${data.appMapPath}。`
        : ''
      return `${target}执行：${intent}。${appMap}`
    }
    case NodeTypes.TASK_PLANNER:
      return `${data.instruction ? data.instruction + '\n' : ''}基于上游产物拆解出可勾选的实施任务清单（- [ ] 1.x 子任务，含验收标准引用）。`.trim()
    case NodeTypes.SELF_CHECK:
      return `${data.instruction ? data.instruction + '\n' : ''}对已产出内容执行跨一致性检查，输出问题清单与修订建议。`.trim()
    case NodeTypes.KEYWORD_AGENT:
      return `从上下文提取关键词${
        data.format ? `（按格式：${data.format}）` : '列表'
      }。`
    case NodeTypes.AI_OUTPUT:
      if (data.outputPath) return `将最终产物输出保存到 ${data.outputPath}。`
      if (data.content) return data.content
      return '将总结果汇总输出。'
    case NodeTypes.BMAD_AGENT:
      return `以「${data.role || data.agentId || 'BMad Agent'}」身份行事：完整角色定义见 ${joinPath(layout?.sharedRef, bmadArtifactPath(node))}`
    case NodeTypes.MEMORY:
      return `读取项目记忆文件 ${joinPath(layout?.sharedRef, memoryArtifactPath(node))}。`
    case NodeTypes.LARK:
      // URL 不内联：读/写目标统一落在 urls.md，SKILL 固定后可只改该文件复用
      return data.action === 'write'
        ? `将产物写入飞书文档（URL 见 ${joinPath(layout?.wfRef, URLS_ARTIFACT_PATH)} 的「Lark 文档（写入）」）`
        : `读取飞书文档（URL 见 ${joinPath(layout?.wfRef, URLS_ARTIFACT_PATH)} 的「Lark 文档（读取）」）`
    case NodeTypes.LARK_TEMPLATE:
      return `获取飞书模板文档（URL 见 ${joinPath(layout?.wfRef, URLS_ARTIFACT_PATH)} 的「Lark 文档（读取）」，模板）`
    case NodeTypes.AGENT: {
      // 输入 / 输出由节点连线推导：指明上游来自哪几步、产物交给哪几步，
      // 避免只写一句“调用 AI 完成本步骤”导致 AI 自行脑补
      const intent = (data.instruction || data.description || '').replace(
        /[。\s]+$/,
        '',
      )
      const ins = (ctx?.preds?.get(node.id) || [])
        .map((id) => skillStepRef(ctx, id))
        .filter(Boolean)
      const outs = (ctx?.succs?.get(node.id) || [])
        .map((id) => ({
          ref: skillStepRef(ctx, id),
          node: ctx?.nodeMap?.get(id),
        }))
        .filter((o) => o.ref)
      const outDesc = data.output || '本步骤产物'
      const outText =
        outs.length === 0
          ? `输出${outDesc}。`
          : outs.length === 1
            ? `输出${outDesc}，供${outs[0].ref}${skillDownstreamVerb(outs[0].node)}。`
            : `输出${outDesc}，供${outs.map((o) => o.ref).join('、')}使用。`
      const main = intent ? `${intent}，${outText}` : outText
      return ins.length > 0 ? `输入：${ins.join('、')}。\n${main}` : main
    }
    case NodeTypes.IF:
    case NodeTypes.IF_CONDITION:
    case NodeTypes.LOOP:
    case NodeTypes.LOOP_CONDITION:
    case NodeTypes.RETRY:
      return (
        `控制节点（${node.type}），按条件 / 循环 / 重试编排后续步骤，人工判断表达式：${data.expression || data.condition || ''}`.replace(
          /\s+$/,
          '',
        ) || ''
      )
    case NodeTypes.ANSWER:
      return `暂停等待用户回复：${data.question || ''}`
    case NodeTypes.CUSTOM:
      return data.instruction || ''
    default:
      return data.instruction || data.description || ''
  }
}

/** 按节点自动生成 SKILL frontmatter description */
export function autoSkillDescription(name, nodes) {
  const titles = nodes.map((n) => n?.data?.title || n.type).filter(Boolean)
  const summary =
    titles.slice(0, 8).join(' → ') + (titles.length > 8 ? ' …' : '')
  return `需要执行“${name}”工作流时使用。流程共 ${nodes.length} 个节点：${summary}。用 /${toStepId(name, 'picop-skill')} <prompt> 触发后按步骤依次执行。`
}

/**
 * 常规工程导出（SKILL 形态）：
 * 非 spec 模式的普通工作流 → 独立任务指令目录 `skills/<name>/SKILL.md`。
 * 无需用户标注 specStep，按拓扑序把每个节点映射为一步自然语言指令。
 * `<prompt>` 注入拓扑序首个 userInput 节点（作为运行时的用户输入）。
 */
export function buildSkillWorkflow(nodes, edges, options = {}) {
  const { sortedIds } = topologicalSort(nodes, edges)
  const sorted = sortedIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter(Boolean)

  const name = options.name?.trim() || '未命名工作流'
  const slug = toStepId(name, 'picop-skill')
  // 目录布局：决定主文件 / workflow 专属输入物 / 共享输入物的落盘位置与引用前缀
  const layout = resolveLayout('skill', name, options.singleRun)

  const userInputIds = sorted
    .filter((n) => n.type === NodeTypes.USER_INPUT)
    .map((n) => n.id)
  const userInputParam = new Map()
  userInputIds.forEach((id, i) =>
    userInputParam.set(id, i === 0 ? 'prompt' : `param${i + 1}`),
  )

  const sections = []
  // 项目位置 → urls.md 段内序号（只引用，不内联路径）
  const projectIdx = projectRefIndexMap(nodes)
  // 连线上下文：供 AGENT 步骤推导「输入 / 输出」（步骤号 = 拓扑序下标 + 1）
  const stepIndex = new Map(sorted.map((n, i) => [n.id, i + 1]))
  const nodeMap = new Map(sorted.map((n) => [n.id, n]))
  const preds = new Map()
  const succs = new Map()
  for (const edge of edges) {
    if (!succs.has(edge.source)) succs.set(edge.source, [])
    succs.get(edge.source).push(edge.target)
    if (!preds.has(edge.target)) preds.set(edge.target, [])
    preds.get(edge.target).push(edge.source)
  }
  const ctx = { preds, succs, nodeMap, stepIndex, layout }
  sorted.forEach((node, i) => {
    const data = node?.data || {}
    const title = data?.title || `${node.type} ${i + 1}`
    let instruction
    if (node.type === NodeTypes.USER_INPUT) {
      const param = userInputParam.get(node.id)
      // 静态输入已随全量导出落盘为 inputs/user-input/<slug>.md（与 SKILL.md 同级），
      // 指令只给相对路径引用，避免把内容内联进 SKILL 正文
      const ref = hasStaticInput(node)
        ? `见${joinPath(layout.wfRef, userInputArtifactPath(node))}`
        : '由调用方补充提供'
      instruction =
        param === 'prompt'
          ? `用户输入 <prompt>：取调用 /${slug} <prompt> 时的 prompt 内容作为本节点输入。${
              hasStaticInput(node) ? `\n附加提示词：${ref}` : ''
            }`
          : `用户输入 ${param}：${ref}`
    } else {
      instruction = skillNodeInstruction(node, projectIdx, ctx)
    }
    // 系统提示词：全量导出走 path 引用，非全量导出内联全文
    const sp = systemPromptBlock(node, layout, options)
    if (sp) instruction = `${instruction ? `${instruction}\n\n` : ''}${sp}`
    sections.push(
      `### ${i + 1}. ${title}\n\n${instruction || '（该节点无额外指令，延续上游输出）'}`,
    )
  })

  const desc = options.description?.trim() || autoSkillDescription(name, sorted)
  const md = [
    '---',
    `name: ${name}`,
    'description: >-',
    `  ${desc.replace(/\n+/g, ' ')}`,
    '---',
    '',
    `# ${name}`,
    '',
    `用户以 \`/${slug} <prompt>\` 调用本技能，\`<prompt>\` 激活输入流程。严格按以下步骤顺序执行。`,
    '',
    '## 执行步骤',
    '',
    ...sections,
    '',
  ].join('\n')

  return { yaml: md, workflowPath: `${layout.workflowDir}/SKILL.md` }
}

// === 统一分发 ===

/** 解析目标平台生成主工作流文件 */
export function buildWorkflow(target, nodes, edges, options = {}) {
  if (target === 'openspec') return buildOpenSpecWorkflow(nodes, edges, options)
  if (target === 'spec') return buildSpecWorkflow(nodes, edges, options)
  if (target === 'skill') return buildSkillWorkflow(nodes, edges, options)
  return buildSpecKitWorkflow(nodes, edges, options)
}

/** userInput / agent 节点是否带有可导出的静态输入内容（收集判定与指令引用共用） */
function hasStaticInput(node) {
  const input = node?.data?.input || {}
  return Boolean(
    input.label || input.prompt || input.files?.length || input.urls?.length,
  )
}

// === 输入物收集规划（纯函数，供 artifactCollector 消费） ===

/** 收集所有需要真实内容的输入物清单 */
export function listCollectableArtifacts(nodes) {
  const userInputNodes = []
  const skills = new Set()
  const bmadNodes = []
  const memoryNodes = []
  const larkRefs = []
  const projectRefs = []
  const systemPromptFiles = new Set()

  for (const node of nodes) {
    const data = node?.data || {}
    if (
      (node.type === NodeTypes.USER_INPUT || node.type === NodeTypes.AGENT) &&
      hasStaticInput(node)
    ) {
      userInputNodes.push(node)
    }
    if (
      node.type === NodeTypes.SKILL &&
      data.skillId &&
      !isLocalSkillId(String(data.skillId))
    ) {
      skills.add(data.skillId)
    }
    if (
      node.type === NodeTypes.BMAD_AGENT &&
      (data.role || data.roleDescription || data.systemPrompt)
    ) {
      bmadNodes.push(node)
    }
    if (node.type === NodeTypes.MEMORY) memoryNodes.push(node)
    if (node.type === NodeTypes.CODE_AGENT && data.projectPath) {
      projectRefs.push({
        nodeId: node.id,
        path: String(data.projectPath),
        branch: data.branch ? String(data.branch) : undefined,
        title: data.title || node.id,
      })
    }
    const promptFile = systemPromptFile(node)
    if (promptFile) systemPromptFiles.add(promptFile)
    if (node.type === NodeTypes.LARK && data.url) {
      larkRefs.push({
        nodeId: node.id,
        url: data.url,
        kind: 'doc',
        direction: isLarkWriteNode(node) ? 'write' : 'read',
        title: data.title || node.id,
      })
    }
    if (node.type === NodeTypes.LARK_TEMPLATE && data.templateUrl) {
      larkRefs.push({
        nodeId: node.id,
        url: data.templateUrl,
        kind: 'template',
        direction: 'read',
        title: data.title || node.id,
      })
    }
  }

  // 段内序号：与 urls.md 中「读取 / 写入」两段的排列顺序一一对应，
  // 供各导出格式按序号引用（而非内联 URL），便于替换 urls.md 复用
  let readIndex = 0
  let writeIndex = 0
  for (const ref of larkRefs) {
    if (ref.direction === 'write') ref.writeIndex = writeIndex++
    else ref.readIndex = readIndex++
  }
  // 项目位置段内序号：与 urls.md 中「项目位置」段的排列顺序一一对应
  projectRefs.forEach((ref, i) => {
    ref.index = i
  })

  return {
    userInputNodes,
    skills: [...skills],
    bmadNodes,
    memoryNodes,
    larkRefs,
    projectRefs,
    systemPromptFiles: [...systemPromptFiles],
  }
}
