import type { Node, Edge } from '@xyflow/react'
import type {
  PipelineContext,
  NodeExecutionConfig,
  NodeExecutionContext,
  NodeExecutionResult,
  LogEntry,
  NodeStatus,
} from '#/types/engine'
import { topologicalLayers, getPredecessors, getAncestorIds, getReachableNodeIds } from './topological'
import { getExecutor } from './executors'
import { useGlobalStore } from '#/store/global'
import { extractAccumulated } from './accumulate'

/** 从 node.data 中安全提取标题 */
function getNodeTitle(node: Node): string {
  const data = node.data
  return typeof data.title === 'string' ? data.title : ''
}

/** 创建初始 PipelineContext */
export function createPipelineContext(): PipelineContext {
  return {
    currentNodeId: null,
    nodeStatuses: {},
    nodeOutputs: {},
    logs: [],
    globalStatus: 'idle',
  }
}

/** 断点续跑 · 持久化执行状态 checkpoint（P0-5） */
async function persistExecState(
  ctx: PipelineContext,
  workflowId: string,
  globalMode?: 'normal' | 'spec',
): Promise<void> {
  try {
    await fetch('/api/workflow/exec-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId,
        state: {
          workflowId,
          globalMode,
          globalStatus: ctx.globalStatus,
          nodeOutputs: ctx.nodeOutputs,
          nodeStatuses: ctx.nodeStatuses,
          savedAt: new Date().toISOString(),
        },
      }),
    })
  } catch {
    // checkpoint 写盘失败不阻断执行
  }
}

/** 断点续跑 · 清除执行状态 checkpoint（执行彻底完成 / 重置时） */
async function clearExecState(workflowId: string): Promise<void> {
  try {
    await fetch(`/api/workflow/exec-state?workflowId=${encodeURIComponent(workflowId)}`, {
      method: 'DELETE',
    })
  } catch {
    // 忽略
  }
}

/** 添加日志 */
function addLog(ctx: PipelineContext, nodeId: string, nodeTitle: string, level: LogEntry['level'], message: string): void {
  ctx.logs.push({
    timestamp: Date.now(),
    nodeId,
    nodeTitle,
    level,
    message,
  })
}

/**
 * 执行工作流
 * @param nodes - 所有节点
 * @param edges - 所有连线
 * @param onUpdate - 每执行完一个节点的回调（用于 UI 更新）
 * @param options - 可选参数
 */
export async function executeWorkflow(
  nodes: Node[],
  edges: Edge[],
  onUpdate: (ctx: PipelineContext) => void,
  options?: {
    startNodeId?: string
    userInputs?: Record<string, any>
    /** 固定节点输出：{ [nodeId]: output }，注入后该节点直接使用固定输出，跳过执行 */
    nodeOutputOverrides?: Record<string, Record<string, any>>
    /** 全局模式：spec = 标记模式（仅显示脚印标记/步骤总览，不产出任何文件） */
    globalMode?: 'normal' | 'spec'
    /** 工作流 ID */
    workflowId?: string
    /** 断点续跑：恢复上次暂停时已完成的节点输出（P0-5），启动时跳过已完成节点 */
    restoreState?: {
      nodeOutputs: Partial<Record<string, Record<string, any>>>
      nodeStatuses: Partial<Record<string, NodeStatus>>
    }
    /** 执行开始时间（ms），断点续跑时沿用首次执行的时间 */
    startedAt?: number
  },
): Promise<PipelineContext> {
  const ctx = createPipelineContext()
  ctx.globalStatus = 'running'
  // 执行开始时间（断点续跑沿用上次传入的 startedAt，不重置）
  ctx.startedAt = options?.startedAt || Date.now()

  // 已注入 PIN 输出的节点 ID（跳过执行）
  const injectedIds = new Set<string>()

  // 找出有连线参与的节点（DAG 中的节点），孤立节点不执行
  const connectedNodeIds = new Set<string>()
  for (const edge of edges) {
    connectedNodeIds.add(edge.source)
    connectedNodeIds.add(edge.target)
  }

  // 如果指定了 startNodeId，需要确保它也包含在内（可能新节点还没连上线）
  if (options?.startNodeId) {
    connectedNodeIds.add(options.startNodeId)
  }

  // 如果没有连线但用户点了单节点执行，允许执行单个节点
  const dagNodes = connectedNodeIds.size > 0 || options?.startNodeId
    ? nodes.filter((n) => connectedNodeIds.has(n.id))
    : []

  if (dagNodes.length === 0 && !options?.startNodeId) {
    ctx.globalStatus = 'completed'
    addLog(ctx, '', '', 'warn', '没有需要执行的节点（请用连线连接节点后再运行）')
    onUpdate(ctx)
    return ctx
  }

  // 计算拓扑层（并行分组）
  let layers: string[][]
  let checkNodes: Node[]
  if (options?.startNodeId) {
    const reachable = getReachableNodeIds(options.startNodeId, edges)
    checkNodes = dagNodes.filter((n) => reachable.has(n.id))
    const subEdges = edges.filter(
      (e) => reachable.has(e.source) && reachable.has(e.target),
    )
    layers = topologicalLayers(checkNodes, subEdges)
  } else {
    checkNodes = dagNodes
    layers = topologicalLayers(dagNodes, edges)
  }

  // 检测循环依赖：所有节点都应出现在层中
  const allLayered = new Set(layers.flat())
  const missing = checkNodes.filter((n) => !allLayered.has(n.id)).map((n) => n.id)
  if (missing.length > 0) {
    ctx.globalStatus = 'error'
    ctx.endedAt = Date.now()
    addLog(ctx, '', '', 'error', `检测到循环依赖: ${missing.join(', ')}`)
    onUpdate(ctx)
    return ctx
  }

  // 初始化节点状态（只初始化 DAG / 子图中的节点）
  for (const node of checkNodes) {
    ctx.nodeStatuses[node.id] = 'idle'
  }

  const nodeMap = new Map(checkNodes.map((n) => [n.id, n]))

  // 断点续跑（P0-5）：恢复上次暂停时已完成的节点输出（供下游读取），
  // 执行范围内已恢复的节点加入 injectedIds 跳过执行
  if (options?.restoreState) {
    const { nodeOutputs = {}, nodeStatuses = {} } = options.restoreState
    let restoredCount = 0
    for (const [restoredId, output] of Object.entries(nodeOutputs)) {
      if (!output || typeof output !== 'object') continue
      ctx.nodeOutputs[restoredId] = output
      if (nodeStatuses[restoredId] === 'success') {
        ctx.nodeStatuses[restoredId] = 'success'
        if (nodeMap.has(restoredId)) {
          injectedIds.add(restoredId)
          restoredCount++
        }
      }
    }
    if (restoredCount > 0) {
      addLog(
        ctx,
        '',
        '',
        'info',
        `断点续跑：已恢复 ${restoredCount} 个已完成节点并跳过（如需全新执行，请先重置执行状态）`,
      )
    }
  }

  // 注入固定节点输出（PIN 节点）：按 nodeId 匹配，只注入用户明确加载了 pin 的节点
  if (options?.nodeOutputOverrides) {
    for (const [nodeId, override] of Object.entries(options.nodeOutputOverrides)) {
      const node = nodeMap.get(nodeId)
      if (node) {
        ctx.nodeOutputs[nodeId] = override
        ctx.nodeStatuses[nodeId] = 'success'
        injectedIds.add(nodeId)
        addLog(ctx, nodeId, getNodeTitle(node), 'info', '使用固定节点输出（PIN）')
      }
    }
  }

  // 按层并行执行
  let hasWaiting = false
  loop: for (const layer of layers) {
    // 过滤掉已通过 PIN 注入的节点
    const activeIds = layer.filter((id) => !injectedIds.has(id))

    if (activeIds.length === 0) continue

    // 并行执行当前层的所有节点
    const results = await Promise.all(
      activeIds.map(async (nodeId): Promise<{ nodeId: string; title?: string; status: 'skipped' | 'success' | 'error' | 'waiting'; result?: NodeExecutionResult; error?: string }> => {
        const node = nodeMap.get(nodeId)
        if (!node) return { nodeId, status: 'skipped' as const }

        const nodeTitle = getNodeTitle(node)

        ctx.currentNodeId = nodeId
        ctx.nodeStatuses[nodeId] = 'running'
        addLog(ctx, nodeId, nodeTitle, 'info', `开始执行...`)
        onUpdate({ ...ctx })

        // 获取上游节点的 output 作为当前节点的 input
        const predecessors = getPredecessors(nodeId, edges)
        const input: Record<string, any> = {}
        for (const predId of predecessors) {
          const predOutput = ctx.nodeOutputs[predId]
          if (predOutput) {
            Object.assign(input, predOutput)
          }
        }

        // 上下文累积：收集所有上游祖先节点的"规范摘要"（按节点类型只提取关键字段），
        // 供 agent 等节点把整条链路的上下文拼进 prompt，避免线性链路中途丢数据。
        const ancestorIds = getAncestorIds(nodeId, edges)
        if (ancestorIds.length > 0) {
          const upstreams: any[] = []
          for (const ancId of ancestorIds) {
            const ancOutput = ctx.nodeOutputs[ancId]
            const ancNode = nodeMap.get(ancId)
            if (!ancOutput || !ancNode) continue
            upstreams.push({
              nodeId: ancId,
              nodeType: ancNode.type || '',
              title: getNodeTitle(ancNode),
              ...extractAccumulated(ancNode.type || '', ancOutput),
            })
          }
          if (upstreams.length > 0) {
            input.upstreams = upstreams
          }
        }

        // 构建执行上下文
        const execConfig: NodeExecutionConfig = {
          nodeId: node.id,
          nodeType: node.type || '',
          title: nodeTitle,
          data: {
            ...(node.data as Record<string, any>),
            // 全流程统一本地工具：已选全局工具则覆盖节点级 tool，避免各节点选用不同 CLI 造成偏差
            ...(useGlobalStore.getState().tool ? { tool: useGlobalStore.getState().tool } : {}),
          },
        }

        const execCtx: NodeExecutionContext = {
          config: execConfig,
          input,
          globalContext: {
            userInputs: options?.userInputs || {},
          },
        }

        // 获取执行器并执行
        const executor = getExecutor(node.type || '')
        if (!executor) {
          return { nodeId, title: nodeTitle, status: 'error' as const, error: `未知节点类型: ${node.type}` }
        }

        const result = await executor.execute(execCtx)
        return { nodeId, title: nodeTitle, status: result.status, result, error: result.error }
      }),
    )

    // 汇总当前层的结果
    let layerHasError = false
    for (const r of results) {
      if (r.status === 'skipped') continue
      const nodeTitle = r.title || ''

      if (r.status === 'error') {
        ctx.nodeStatuses[r.nodeId] = 'error'
        ctx.globalStatus = 'error'
        ctx.endedAt = Date.now()
        addLog(ctx, r.nodeId, nodeTitle, 'error', r.error || '执行失败')
        if (r.result?.logs) {
          for (const logMsg of r.result.logs) {
            addLog(ctx, r.nodeId, nodeTitle, 'info', logMsg)
          }
        }
        layerHasError = true
      } else if (r.status === 'waiting' && r.result) {
        ctx.nodeStatuses[r.nodeId] = 'waiting'
        ctx.globalStatus = 'paused'
        ctx.nodeOutputs[r.nodeId] = r.result.output
        addLog(ctx, r.nodeId, nodeTitle, 'warn', '等待用户输入...')
        hasWaiting = true
      } else if (r.result) {
        ctx.nodeStatuses[r.nodeId] = 'success'
        ctx.nodeOutputs[r.nodeId] = r.result.output
        for (const logMsg of r.result.logs) {
          addLog(ctx, r.nodeId, nodeTitle, 'info', logMsg)
        }
      }

      onUpdate({ ...ctx })
    }

    // 每层执行完成：持久化执行状态 checkpoint（断点续跑，覆盖正常/暂停/错误任一情况）
    if (options?.workflowId) {
      await persistExecState(ctx, options.workflowId, options.globalMode)
    }

    if (layerHasError) break loop
    if (hasWaiting) return ctx
  }

  // 检查是否所有节点都完成了
  if (ctx.globalStatus === 'running') {
    ctx.globalStatus = 'completed'
    ctx.currentNodeId = null
    ctx.endedAt = Date.now()
    addLog(ctx, '', '', 'info', '工作流执行完成')
    // 执行彻底完成：清除 checkpoint，避免下次运行误恢复
    if (options?.workflowId) {
      await clearExecState(options.workflowId)
    }
    onUpdate({ ...ctx })
  }

  return ctx
}

/**
 * 恢复执行（用于 Answer 节点用户输入后继续）
 */
export async function resumeWorkflow(
  nodeId: string,
  userInput: string,
  _pipelineCtx: PipelineContext,
  nodes: Node[],
  edges: Edge[],
  onUpdate: (ctx: PipelineContext) => void,
  options?: {
    globalMode?: 'normal' | 'spec'
    workflowId?: string
    /** 断点续跑：恢复上次暂停时已完成的节点输出（P0-5） */
    restoreState?: {
      nodeOutputs: Partial<Record<string, Record<string, any>>>
      nodeStatuses: Partial<Record<string, NodeStatus>>
    }
    /** 执行开始时间（ms），续跑沿用首次执行的时间 */
    startedAt?: number
  },
): Promise<PipelineContext> {
  const userInputs = { [nodeId]: userInput }

  return executeWorkflow(nodes, edges, onUpdate, {
    startNodeId: nodeId,
    userInputs,
    globalMode: options?.globalMode,
    workflowId: options?.workflowId,
    ...(options?.restoreState ? { restoreState: options.restoreState } : {}),
    ...(options?.startedAt ? { startedAt: options.startedAt } : {}),
  })
}
