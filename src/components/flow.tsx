import { useEffect, useMemo, useRef } from 'react'
import {
  ReactFlow,
  Background,
  MiniMap,
  useReactFlow,
  type Node,
} from '@xyflow/react'
import { Controls } from './controls'

import { UserInputNode } from './node/user/input'
import { AgentNode } from './node/ai/agent'
import { AIOutputNode } from './node/ai/output'
import { AnswerNode } from './node/ai/answer'
import { BmadAgentNode } from './node/ai/bmad'
import { LarkNode } from './node/ai/lark'
import { LarkTemplateNode } from './node/ai/larkTemplate'
import { CodeAgentNode } from './node/ai/codeAgent'
import { SkillNode } from './node/ai/skill'
import { IfNode } from './node/control/if'
import { IfConditionNode } from './node/control/ifCondition'
import { LoopNode } from './node/control/loop'
import { LoopConditionNode } from './node/control/loopCondition'
import { RetryNode } from './node/control/retry'

import { useNodeStore } from '#/store/node'
import { NodeEdge } from './edge'
import { AddNodeBtn } from './node/edge/add'
import { ToolsPanel } from './panel/tools'

import { MemoryNode } from './node/ai/memory'
import { KnowledgeRetrievalNode } from './node/ai/knowledgeRetrieval'
import { KeywordAgentNode } from './node/ai/keywordAgent'
import { TaskPlannerNode } from './node/ai/taskPlanner'
import { SelfCheckNode } from './node/ai/selfCheck'
import { EditPanel } from './panel/edit'
import type { NodeType } from '#/types'
import { GroupPanel } from './panel/tools/group'
import { StepLinePanel } from './panel/tools/stepLine'
import { SenderPanel } from './panel/tools/sender'

export const NODE_TYPES = {
  userInput: UserInputNode,
  agent: AgentNode,
  aiOutput: AIOutputNode,
  answer: AnswerNode,
  bmadAgent: BmadAgentNode,
  lark: LarkNode,
  larkTemplate: LarkTemplateNode,
  codeAgent: CodeAgentNode,
  skill: SkillNode,
  if: IfNode,
  ifCondition: IfConditionNode,
  loop: LoopNode,
  loopCondition: LoopConditionNode,
  retry: RetryNode,
  memory: MemoryNode,
  knowledgeRetrieval: KnowledgeRetrievalNode,
  keywordAgent: KeywordAgentNode,
  taskPlanner: TaskPlannerNode,
  selfCheck: SelfCheckNode,
}

export const NODE_COLORS = {
  userInput: '#10a6f5',
  agent: '#985debff',
  aiOutput: '#52c41a',
  answer: '#fa8c16',
  bmadAgent: '#eb2f96',
  lark: '#1677ff',
  larkTemplate: '#1677ff',
  codeAgent: '#985debff',
  skill: '#985debff',
  if: '#fa8c16',
  ifCondition: '#ff7a45',
  loop: '#1890ff',
  loopCondition: '#1890ff',
  retry: '#eb2f96',
  memory: '#eb2f96',
  knowledgeRetrieval: '#52c41a',
  keywordAgent: '#985debff',
  taskPlanner: '#13c2c2',
  selfCheck: '#985debff',
}

const EDGE_TYPES = {
  nodeEdge: NodeEdge,
}

export function Flow() {
  const nodes = useNodeStore((s) => s.nodes)
  const edges = useNodeStore((s) => s.edges)
  const onNodesChange = useNodeStore((s) => s.onNodesChange)
  const onEdgesChange = useNodeStore((s) => s.onEdgesChange)
  const onConnect = useNodeStore((s) => s.onConnect)
  const removeConnectedBmad = useNodeStore((s) => s.removeConnectedBmad)
  const setCurrentNode = useNodeStore((s) => s.setCurrentNode)
  const setAddPos = useNodeStore((s) => s.setAddPos)
  const clearAddPos = useNodeStore((s) => s.clearAddPos)
  const setNodes = useNodeStore((s) => s.setNodes)
  const setEdges = useNodeStore((s) => s.setEdges)
  const { screenToFlowPosition } = useReactFlow()

  // ---- 复制 / 粘贴选中节点（window 级监听，覆盖拖拽/选中任一状态）----
  // 版本说明：当前 @xyflow/react 未内置 clipboard，故自实现；如后续升级到带
  // useClipboard 的版本，需改为调用其方法，避免双重触发。
  const copiedNodes = useRef<Node[]>([])
  const pastedIdMap = useRef<Map<string, string>>(new Map())
  const pasteOffset = useRef(0)

  const handleCopyPaste = useMemo(
    () => async (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (!mod || (key !== 'c' && key !== 'v')) return

      const selectedNodes = useNodeStore
        .getState()
        .nodes.filter((n) => n.selected)
      // 复制时无选中节点则不拦截（交给系统默认复制文本）；粘贴始终拦截
      if (key === 'c' && selectedNodes.length === 0) return

      e.preventDefault()

      if (key === 'c') {
        copiedNodes.current = selectedNodes
      }
      if (key === 'v') {
        if (copiedNodes.current.length === 0) return
        pasteOffset.current += 32
        pastedIdMap.current = new Map()

        const added = copiedNodes.current.map((node) => {
          const newId = `${node.id}-copy-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 7)}`
          pastedIdMap.current.set(node.id, newId)
          return {
            ...node,
            id: newId,
            position: {
              x: (node.position?.x ?? 0) + pasteOffset.current,
              y: (node.position?.y ?? 0) + pasteOffset.current,
            },
            selected: true,
          }
        })

        const copyEdges = useNodeStore
          .getState()
          .edges.filter(
            (e) =>
              pastedIdMap.current.has(e.source) &&
              pastedIdMap.current.has(e.target),
          )
        const newEdges = copyEdges.map((edge) => ({
          ...edge,
          id: `${pastedIdMap.current.get(edge.source)}->${pastedIdMap.current.get(edge.target)}`,
          source: pastedIdMap.current.get(edge.source) as string,
          target: pastedIdMap.current.get(edge.target) as string,
          selected: true,
        }))

        const state = useNodeStore.getState()
        setNodes([
          ...state.nodes.map((n) => ({ ...n, selected: false })),
          ...added,
        ])
        setEdges([...state.edges, ...newEdges])
      }
    },
    [setNodes, setEdges],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleCopyPaste)
    return () => window.removeEventListener('keydown', handleCopyPaste)
  }, [handleCopyPaste])

  // 监听 BMad 断开事件
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.nodeId) {
        const bmadNode = useNodeStore
          .getState()
          .nodes.find((n) => n.id === detail.nodeId)
        if (bmadNode) {
          setCurrentNode(bmadNode as any)
          removeConnectedBmad()
        }
      }
    }
    window.addEventListener('bmad:disconnect', handler)
    return () => window.removeEventListener('bmad:disconnect', handler)
  }, [removeConnectedBmad, setCurrentNode])

  // 面板元素引用固定：避免拖拽节点时（nodes 每帧变化导致 Flow 重渲染）
  // 把编辑面板等 React Flow children 全部跟着重渲染，造成页面卡顿。
  // useMemo 使元素引用不变，React 会直接跳过这些子树的重渲染；
  // 面板内部各自订阅 store，状态变化时仍会正常更新。
  const panels = useMemo(
    () => (
      <>
        <SenderPanel
          position="bottom-center"
          style={{ left: '40%' }}
        ></SenderPanel>
        <StepLinePanel position="center-left"></StepLinePanel>
        <GroupPanel position="top-center"></GroupPanel>
        <Controls position="bottom-left"></Controls>
        <ToolsPanel position="top-left"></ToolsPanel>
        <EditPanel position="top-right"></EditPanel>
      </>
    ),
    [],
  )

  return (
    <AddNodeBtn trigger={['contextMenu']}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        colorMode="light"
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        deleteKeyCode="Delete"
        proOptions={{ hideAttribution: true }}
        // 右键空白画布：记录右键位置的工作流坐标，供右键菜单创建节点时落位
        onPaneContextMenu={(e) =>
          setAddPos(screenToFlowPosition({ x: e.clientX, y: e.clientY }))
        }
        // 右键节点：清空待落位点，创建仍锚定到当前节点位置
        onNodeContextMenu={() => clearAddPos()}
      >
        <Background />
        <MiniMap
          offsetScale={10}
          style={{ height: 120, width: 140, bottom: 36 }}
          position="bottom-left"
          nodeColor={(node) =>
            NODE_COLORS[(node.type ?? 'userInput') as NodeType] ||
            NODE_COLORS.userInput
          }
        />
        {panels}
      </ReactFlow>
    </AddNodeBtn>
  )
}
