import type { AppNode } from '#/types'
import { NodeTypes } from '#/types'
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'

import type {
  NodeChange,
  Node,
  Edge,
  EdgeChange,
  OnConnect,
} from '@xyflow/react'
import { v4 as uuidv4 } from 'uuid'
import { create } from 'zustand'
import { produce } from 'immer'
import type { PipelineContext } from '#/types/engine'
import {
  createPipelineContext,
  executeWorkflow,
  resumeWorkflow,
} from '#/engine/workflow'
import { useGlobalStore } from './global'
import { getAncestorIds } from '#/engine/topological'
import { extractAccumulated } from '#/engine/accumulate'

/** 保存执行结果到后端 */
async function saveExecutionHistory(
  workflowId: string,
  workflowName: string,
  ctx: PipelineContext,
  globalMode: 'normal' | 'spec',
) {
  try {
    const nodeResults: Array<{
      nodeId: string
      nodeTitle: string
      status: 'success' | 'error'
      output: Record<string, any>
    }> = []
    for (const [nodeId, output] of Object.entries(ctx.nodeOutputs)) {
      nodeResults.push({
        nodeId,
        nodeTitle: '',
        status: ctx.nodeStatuses[nodeId] === 'success' ? 'success' : 'error',
        output: output || {},
      })
    }
    // 从日志中补充节点标题
    for (const result of nodeResults) {
      const log = ctx.logs.find((l) => l.nodeId === result.nodeId)
      if (log) result.nodeTitle = log.nodeTitle
    }
    await fetch('/api/workflow/exec-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId,
        workflowName,
        timestamp: String(Date.now()),
        status:
          ctx.globalStatus === 'completed'
            ? 'completed'
            : ctx.globalStatus === 'error'
              ? 'error'
              : ctx.globalStatus === 'paused'
                ? 'paused'
                : 'completed',
        globalMode,
        nodeCount: nodeResults.length,
        nodeResults,
        logs: ctx.logs,
      }),
    })
  } catch {
    // 静默失败，不影响主流程
  }
}

/** 读取断点续跑状态（仅 globalStatus === 'paused' 时返回有效状态，P0-5） */
async function loadExecState(workflowId: string): Promise<{
  nodeOutputs: Record<string, Record<string, any>>
  nodeStatuses: Record<string, any>
} | null> {
  try {
    const res = await fetch(
      `/api/workflow/exec-state?workflowId=${encodeURIComponent(workflowId)}`,
    )
    const json = await res.json()
    if (json.status === 'success' && json.state?.globalStatus === 'paused') {
      return {
        nodeOutputs: json.state.nodeOutputs || {},
        nodeStatuses: json.state.nodeStatuses || {},
      }
    }
  } catch {
    // 读取失败视为无断点
  }
  return null
}

/** 清除断点 checkpoint（用户重置执行状态时） */
async function clearExecStateFile(workflowId: string) {
  try {
    await fetch(
      `/api/workflow/exec-state?workflowId=${encodeURIComponent(workflowId)}`,
      { method: 'DELETE' },
    )
  } catch {
    // 忽略
  }
}

export interface UseNodeStoreProps {
  currentNode: AppNode
  setCurrentNode: (node: AppNode) => void
  deleteCurrentNode: () => void
  /** 使用 immer producer 直接修改当前节点的深层字段 */
  patchCurrentNode: (recipe: (draft: NonNullable<AppNode>) => void) => void
  /** 右键空白画布时待落位的工作流坐标点（右键菜单创建节点用，一次性消费后清除） */
  addPos: { x: number; y: number } | null
  /** 记录右键空白处的工作流坐标（由 React Flow onPaneContextMenu 写入） */
  setAddPos: (pos: { x: number; y: number }) => void
  /** 清除待落位点（节点右键 / 已消费后调用） */
  clearAddPos: () => void
  nodes: Node[]
  edges: Edge[]
  onNodesChange: (changes: NodeChange<Node>[]) => void
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void
  onConnect: OnConnect
  setNodes: (nodes: Node[]) => void
  setEdges: (edges: Edge[]) => void
  // 添加连接节点，新节点会直接与currentNode连接起来
  addConnectNode: (node: Exclude<AppNode, null>) => void
  // 添加未连接节点，新节点不会与currentNode连接起来
  addUnConnectNode: (node: Exclude<AppNode, null>) => void
  /** 为当前 AgentNode 创建一个 BMadAgentNode 子节点并连接 */
  addBmadAgentForCurrent: (agent: {
    id: string
    title: string
    name: string
    description: string
    skillContent?: string
  }) => void
  /** 删除当前 AgentNode 连线的 BMadNode */
  removeConnectedBmad: () => void
  /** 为当前输入节点创建/更新一个相连的 SKILL 节点（技能联动） */
  syncSkillForCurrent: (skill: { id?: string; name?: string }) => void

  // ---- 执行引擎集成 ----
  /** 执行管线上下文 */
  pipelineContext: PipelineContext
  /** 执行全部工作流 */
  runAll: () => void
  /** 从指定节点开始执行子图 */
  runFrom: (nodeId: string) => void
  /** 恢复执行（Answer 节点用户回复后恢复，支持断点续跑） */
  resumeFrom: (nodeId: string, reply: string) => Promise<void>
  /** 重置执行状态 */
  resetExecution: () => void
  /** 删除指定边 */
  removeEdge: (edgeId: string) => void
  /** 清空面板 */
  clearPanel: () => void

  // ---- PIN 功能 ----
  /** 当前工作流 ID，用于定位 PIN 文件 */
  workflowId: string
  /** 设置工作流 ID */
  setWorkflowId: (id: string) => void
  /** 已 PIN 的数据：{ [nodeId]: { output, context, workflowId } } (内存缓存，按节点隔离) */
  pinnedNodes: Partial<
    Record<
      string,
      {
        output: Record<string, any>
        /** 该节点执行时看到的累积上下文（上游祖先输出），从中间 PIN 运行时恢复用 */
        context?: { upstreams: any[] }
        workflowId?: string
      }
    >
  >
  /** 保存当前节点的输出为固定节点（写入文件并加载到内存缓存） */
  pinNode: (nodeId: string, title: string) => Promise<void>
  /** 从文件加载固定节点数据到内存缓存（按 nodeId 隔离，只影响当前节点） */
  loadPinnedNode: (nodeId: string, data: Record<string, any>) => void
  /** 取消固定：仅从内存缓存移除，不删除文件（节点不再注入该输出） */
  unpinNode: (nodeId: string) => void
  /** 删除固定节点文件（持久化删除，不可恢复；nodeId 存在时只删该节点的文件，否则删除该类型所有文件） */
  deletePinnedFile: (
    nodeType: string,
    nodeId?: string,
    workflowId?: string,
  ) => Promise<void>
  /** 列出所有已固定的节点（读取文件系统，每个文件一条记录） */
  getPinnedNodeList: () => Promise<
    { nodeType: string; nodeId: string; title: string; savedAt: string }[]
  >
  /** 从固定节点开始执行（注入已 PIN 的输出，按 nodeId 匹配） */
  runFromWithPinned: (
    startNodeId: string,
    pinnedOverrides: Record<string, Record<string, any>>,
  ) => void
}

export const useNodeStore = create<UseNodeStoreProps>((set, get) => ({
  clearPanel: () => {
    set({
      nodes: [],
      edges: [],
      workflowId: `workflow_${Date.now()}`,
      currentNode: null,
      addPos: null,
      pinnedNodes: {},
      pipelineContext: createPipelineContext(),
    })
  },
  removeEdge: (edgeId) => {
    set({
      edges: get().edges.filter((e) => e.id !== edgeId),
    })
  },
  currentNode: null,
  // 右键空白画布创建节点时的待落位点（onPaneContextMenu 写入，创建后消费清除）
  addPos: null,
  setAddPos: (pos) => set({ addPos: pos }),
  clearAddPos: () => set({ addPos: null }),
  // 删除当前节点，并从edges中和nodes删除
  deleteCurrentNode: () => {
    const current = get().currentNode
    if (!current) return
    set({
      nodes: get().nodes.filter((n) => n.id !== current.id),
      edges: get().edges.filter(
        (e) => e.source !== current.id && e.target !== current.id,
      ),
    })
    set({ currentNode: null })
  },
  setCurrentNode: (node: AppNode) => {
    if (!node) {
      set({ currentNode: null })
      return
    }
    const updateNode = get().nodes.find((n) => n.id === node.id)
    if (!updateNode) {
      set({ currentNode: null })
      return
    }

    const updatedNodes = get().nodes.map((n) =>
      n.id === node.id ? { ...n, data: { ...n.data, ...node.data } } : n,
    )
    set({ currentNode: node, nodes: updatedNodes })
  },
  patchCurrentNode: (recipe) => {
    const current = get().currentNode
    if (!current) return

    const patched = produce(current, recipe)
    const updatedNodes = get().nodes.map((n) =>
      n.id === patched.id ? { ...n, data: { ...n.data, ...patched.data } } : n,
    )
    set({ currentNode: patched, nodes: updatedNodes })
  },
  nodes: [],
  edges: [],

  onNodesChange: (changes) => {
    // React Flow 受控同步时会对节点发 replace change，用其内部节点对象整体替换，
    // 导致自定义 data 字段（如 specStep 阶段标记）丢失。这里保留 store 中已有的自定义字段：
    // 以新 item 的字段为准，仅补充 item 里没有、但 store 节点里存在的字段。
    const protectedChanges = changes.map((c) => {
      if (c.type !== 'replace') return c
      const prev = get().nodes.find((n) => n.id === c.id)
      if (!prev) return c
      const itemData = c.item.data
      const preserved = Object.fromEntries(
        Object.entries(prev.data).filter(([k]) => !(k in itemData)),
      )
      if (Object.keys(preserved).length === 0) return c
      return { ...c, item: { ...c.item, data: { ...preserved, ...itemData } } }
    }) as NodeChange[]

    set({
      nodes: applyNodeChanges(protectedChanges, get().nodes),
    })
    // 如果 currentNode 被删除，同步清空
    const currentNodeId = get().currentNode?.id
    if (currentNodeId) {
      const hasCurrentNode = get().nodes.some((n) => n.id === currentNodeId)
      if (!hasCurrentNode) {
        set({ currentNode: null })
      }
    }
  },
  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    })
  },
  onConnect: (connection) => {
    console.error(connection)
    set({
      edges: addEdge(
        {
          ...connection,
          type: 'nodeEdge',
        },
        get().edges,
      ),
    })
  },
  setNodes: (nodes) => {
    set({ nodes })
  },
  setEdges: (edges) => {
    set({ edges })
  },
  // 添加连接节点，新节点会直接与currentNode连接起来
  addConnectNode: (node: Exclude<AppNode, null>) => {
    const currentNode = get().currentNode
    set({
      nodes: [...get().nodes, node as unknown as Node],
      edges: !currentNode
        ? get().edges
        : [
            ...get().edges,
            {
              id: `${currentNode.id}-${node.id}`,
              source: currentNode.id,
              target: node.id,
              type: 'nodeEdge',
            },
          ],
    })
  },
  // 添加未连接节点，新节点不会与currentNode连接起来
  addUnConnectNode: (node: Exclude<AppNode, null>) => {
    set({
      nodes: [...get().nodes, node as unknown as Node],
    })
  },
  /** 为当前 AgentNode 创建一个 BMadAgentNode 子节点并连接 */
  addBmadAgentForCurrent: (agent) => {
    const current = get().currentNode
    if (!current) return

    const nodeEntry = get().nodes.find((n) => n.id === current.id)
    if (!nodeEntry) return

    // 检查当前 AgentNode 是否已经有连线的 BMadNode（BMad 为上游，agent 为下游）
    const existingEdge = get().edges.find(
      (e) =>
        e.target === current.id &&
        get().nodes.find((n) => n.id === e.source)?.type ===
          NodeTypes.BMAD_AGENT,
    )

    if (existingEdge) {
      // 已有连线 BMadNode → 更新其数据
      const existingNode = get().nodes.find((n) => n.id === existingEdge.source)
      if (existingNode) {
        const updatedNodes = get().nodes.map((n) =>
          n.id === existingNode.id
            ? {
                ...n,
                data: {
                  title: agent.title,
                  role: agent.title,
                  agentId: agent.id,
                  roleDescription: agent.skillContent || agent.description,
                },
              }
            : n,
        )
        // 同时更新当前节点（记录关联的 BMad agent 信息）
        const updatedCurrentNodes = updatedNodes.map((n) =>
          n.id === current.id
            ? {
                ...n,
                data: {
                  ...n.data,
                  _connectedBmadAgent: agent.name,
                  modal: { ...(n.data as any).modal, alias: agent.title },
                },
              }
            : n,
        )
        set({
          nodes: updatedCurrentNodes,
          currentNode: updatedCurrentNodes.find(
            (n) => n.id === current.id,
          ) as any,
        })
      }
      return
    }

    // 没有已有连线 → 创建新的 BMadNode（放在 AgentNode 左侧，作为上游）
    const id = uuidv4()
    const x = nodeEntry.position.x - 220
    const y = nodeEntry.position.y

    const bmadNode = {
      id,
      type: NodeTypes.BMAD_AGENT,
      position: { x, y },
      deletable: true,
      draggable: true,
      selectable: true,
      selected: false,
      data: {
        title: agent.title,
        role: agent.title,
        agentId: agent.id,
        roleDescription: agent.skillContent || agent.description,
      },
    } as unknown as Node

    set({
      nodes: [...get().nodes, bmadNode],
      edges: [
        ...get().edges,
        {
          id: `${id}-${current.id}`,
          source: id,
          target: current.id,
          type: 'nodeEdge',
        },
      ],
    })
  },

  /** 删除当前 AgentNode 连线的 BMadNode */
  removeConnectedBmad: () => {
    const current = get().currentNode
    if (!current) return

    const existingEdge = get().edges.find(
      (e) =>
        e.target === current.id &&
        get().nodes.find((n) => n.id === e.source)?.type ===
          NodeTypes.BMAD_AGENT,
    )

    if (!existingEdge) return

    set({
      nodes: get().nodes.filter((n) => n.id !== existingEdge.source),
      edges: get().edges.filter(
        (e) => e.id !== existingEdge.id && e.target !== existingEdge.source,
      ),
    })
  },

  /** 为当前输入节点创建/更新一个相连的 SKILL 节点（技能联动） */
  syncSkillForCurrent: (skill) => {
    const current = get().currentNode
    if (!current) return
    const nodeEntry = get().nodes.find((n) => n.id === current.id)
    if (!nodeEntry) return

    // 查找当前输入节点已有上游 SKILL 节点（source=SKILL, target=当前输入节点）
    const existingEdge = get().edges.find(
      (e) =>
        e.target === current.id &&
        get().nodes.find((n) => n.id === e.source)?.type === NodeTypes.SKILL,
    )

    const skillId = skill.id
    const skillName = skill.name

    if (existingEdge && skillId) {
      // 已有连线 SKILL 节点 → 更新其数据
      const existingNode = get().nodes.find((n) => n.id === existingEdge.source)
      if (existingNode) {
        set({
          nodes: get().nodes.map((n) =>
            n.id === existingNode.id
              ? {
                  ...n,
                  data: {
                    ...(n.data as any),
                    skillId,
                    skillName,
                    title: skillName || n.data.title,
                  },
                }
              : n,
          ),
        })
      }
      return
    }

    if (!skillId) return

    // 没有已有连线 → 创建新的 SKILL 节点（放在输入节点左侧，作为其上游）
    const id = uuidv4()
    const x = nodeEntry.position.x - 260
    const y = nodeEntry.position.y

    const skillNode = {
      id,
      type: NodeTypes.SKILL,
      position: { x, y },
      deletable: true,
      draggable: true,
      selectable: true,
      selected: false,
      data: {
        title: skillName || '技能',
        skillId,
        skillName,
      },
    } as unknown as Node

    set({
      nodes: [...get().nodes, skillNode],
      edges: [
        ...get().edges,
        {
          id: `${id}-${current.id}`,
          source: id,
          target: current.id,
          type: 'nodeEdge',
        },
      ],
    })
  },

  // ---- 执行引擎 ----
  pipelineContext: createPipelineContext(),
  workflowId: `workflow_${Date.now()}`,
  pinnedNodes: {},
  setWorkflowId: (id: string) => {
    set({ workflowId: id })
  },
  pinNode: async (nodeId: string, title: string) => {
    const { pipelineContext, nodes, edges, workflowId } = get()
    const output = pipelineContext.nodeOutputs[nodeId]
    if (!output) return

    // 通过节点 ID 找到节点类型，PIN 文件按类型存储（跨工作流共享）
    const node = get().nodes.find((n) => n.id === nodeId)
    const nodeType = node?.type
    if (!nodeType) return

    // 从 exec 运行记录（pipelineContext.nodeOutputs）提取该节点执行时看到的累积上下文，
    // 供后续从该 PIN 部分运行时恢复上游产物（与引擎 getAncestorIds + extractAccumulated 逻辑一致）
    const upstreams: any[] = []
    const ancestorIds = getAncestorIds(nodeId, edges)
    for (const ancId of ancestorIds) {
      const ancOutput = pipelineContext.nodeOutputs[ancId]
      const ancNode = nodes.find((n) => n.id === ancId)
      if (!ancOutput || !ancNode) continue
      upstreams.push({
        nodeId: ancId,
        nodeType: ancNode.type || '',
        title:
          (ancNode.data as { title?: string } | undefined)?.title ||
          ancNode.type ||
          '',
        ...extractAccumulated(ancNode.type || '', ancOutput),
      })
    }
    const context = upstreams.length > 0 ? { upstreams } : undefined

    // 保存到文件（workflows/<workflowId>/ 目录隔离，避免不同工作流相同 nodeId 互相覆盖）
    await fetch('/api/workflow/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeType,
        nodeId,
        title,
        output,
        workflowId,
        context,
      }),
    })

    // 更新内存缓存（按 nodeId 隔离，只影响当前节点）
    set({
      pinnedNodes: {
        ...get().pinnedNodes,
        [nodeId]: { output, context, workflowId },
      },
    })
  },
  loadPinnedNode: (nodeId: string, data: Record<string, any>) => {
    // data 为完整 PIN 记录（含 output / context / workflowId），按 nodeId 隔离
    set({
      pinnedNodes: {
        ...get().pinnedNodes,
        [nodeId]: {
          output: data.output,
          context: data.context,
          workflowId: data.workflowId,
        },
      },
    })
  },
  unpinNode: (nodeId: string) => {
    // 仅从内存缓存移除，不删除文件，节点不再注入该输出
    const updated = { ...get().pinnedNodes }
    delete updated[nodeId]
    set({ pinnedNodes: updated })
  },
  deletePinnedFile: async (
    nodeType: string,
    nodeId?: string,
    workflowId?: string,
  ) => {
    // 持久化删除文件（带 nodeId 只删该节点的文件，否则删除该类型所有文件；
    // 带 workflowId 只删该工作流下的文件，避免误删其他工作流同名 nodeId 的 PIN）
    const params = new URLSearchParams({ nodeType })
    if (nodeId) params.set('nodeId', nodeId)
    if (workflowId) params.set('workflowId', workflowId)
    await fetch(`/api/workflow/pin?${params.toString()}`, {
      method: 'DELETE',
    })
    // 清理内存中对应节点的缓存（未指定 nodeId 时清理所有该类型节点）
    const { nodes, pinnedNodes } = get()
    const updated = { ...pinnedNodes }
    for (const node of nodes) {
      if (node.type === nodeType && (!nodeId || node.id === nodeId)) {
        delete updated[node.id]
      }
    }
    set({ pinnedNodes: updated })
  },
  getPinnedNodeList: async () => {
    const res = await fetch('/api/workflow/pin')
    const json = await res.json()
    if (json.status === 'success') return json.data
    return []
  },
  runFromWithPinned: async (
    startNodeId: string,
    pinnedOverrides: Record<string, Record<string, any>>,
  ) => {
    const { nodes, edges, workflowId } = get()
    const workflowName = workflowId.replace(/^workflow_/, '')
    const globalMode = useGlobalStore.getState().globalMode

    // 若该 PIN 保存时带了累积上下文（该节点运行过），把上游祖先输出一并注入，
    // 保证下游节点能恢复完整的上下文累积（例如原始需求 + 最终交付物的比对）
    const pin = get().pinnedNodes[startNodeId]
    const upstreams = pin?.context?.upstreams || []
    if (upstreams.length > 0) {
      for (const up of upstreams) {
        if (up?.nodeId && !(up.nodeId in pinnedOverrides)) {
          pinnedOverrides[up.nodeId] = up
        }
      }
    }

    const pipelineCtx = await executeWorkflow(
      nodes,
      edges,
      (ctx) => {
        set({ pipelineContext: { ...ctx } })
      },
      {
        startNodeId,
        nodeOutputOverrides: pinnedOverrides,
        globalMode,
        workflowId,
      },
    )
    // 执行结束后保存历史
    await saveExecutionHistory(
      workflowId,
      workflowName,
      pipelineCtx,
      globalMode,
    )
  },
  runAll: async () => {
    const { nodes, edges, workflowId } = get()
    // 获取工作流名称
    const workflowName = workflowId.replace(/^workflow_/, '')
    const globalMode = useGlobalStore.getState().globalMode
    // 断点续跑（P0-5）：上次 paused 则恢复已完成节点，跳过执行；
    // 执行开始时间沿用已记录的（续跑场景不重置计时）
    const startedAt = get().pipelineContext.startedAt || Date.now()
    const restored = await loadExecState(workflowId)
    const pipelineCtx = await executeWorkflow(
      nodes,
      edges,
      (c) => {
        set({ pipelineContext: { ...c } })
      },
      {
        globalMode,
        workflowId,
        startedAt,
        ...(restored ? { restoreState: restored } : {}),
      },
    )
    // 执行结束后保存历史
    await saveExecutionHistory(
      workflowId,
      workflowName,
      pipelineCtx,
      globalMode,
    )
  },
  runFrom: async (nodeId: string) => {
    const { nodes, edges, workflowId } = get()
    const workflowName = workflowId.replace(/^workflow_/, '')
    const globalMode = useGlobalStore.getState().globalMode
    // 断点续跑（P0-5）：上次 paused 则恢复已完成节点，保证该节点能看到上游输出
    const startedAt = get().pipelineContext.startedAt || Date.now()
    const restored = await loadExecState(workflowId)
    const pipelineCtx = await executeWorkflow(
      nodes,
      edges,
      (ctx) => {
        set({ pipelineContext: { ...ctx } })
      },
      {
        startNodeId: nodeId,
        globalMode,
        workflowId,
        startedAt,
        ...(restored ? { restoreState: restored } : {}),
      },
    )
    await saveExecutionHistory(
      workflowId,
      workflowName,
      pipelineCtx,
      globalMode,
    )
  },
  resumeFrom: async (nodeId: string, reply: string) => {
    const { nodes, edges, pipelineContext, workflowId } = get()
    const globalMode = useGlobalStore.getState().globalMode
    // 断点续跑（P0-5）：恢复上次暂停时已完成的节点输出，从 Answer 节点继续
    const startedAt = pipelineContext.startedAt
    const restored = await loadExecState(workflowId)
    await resumeWorkflow(
      nodeId,
      reply,
      pipelineContext,
      nodes,
      edges,
      (ctx) => {
        set({ pipelineContext: { ...ctx } })
      },
      {
        globalMode,
        workflowId,
        ...(startedAt ? { startedAt } : {}),
        ...(restored ? { restoreState: restored } : {}),
      },
    )
  },
  resetExecution: () => {
    const { workflowId } = get()
    set({ pipelineContext: createPipelineContext() })
    // 重置执行状态时同时清除断点 checkpoint，避免下次运行误恢复
    void clearExecStateFile(workflowId)
  },
}))
