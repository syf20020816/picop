import { useNodeStore } from '#/store/node'
import { useBmadAgentStore } from '#/store/bmad'
import { useRouteStore } from '#/store/route'
import { NodeTypes } from '#/types'
import type { NAgent, NAgentData } from '#/types'
import type { NodeProps } from '@xyflow/react'
import { Select, Button, Typography, Tooltip } from 'antd'
import { DisconnectOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { DynEditKV } from './item'
import type { DynEditKVRow } from './item'
import { useEffect } from 'react'
import { useGlobalStore } from '#/store/global'
import { useShallow } from 'zustand/react/shallow'

const { Text } = Typography

const d = (
  draft: NonNullable<ReturnType<typeof useNodeStore.getState>['currentNode']>,
) => draft.data as NAgentData

export const EditAgent = () => {
  const currentNode = useNodeStore(
    (state) => state.currentNode,
  ) as NodeProps<NAgent>
  const patchCurrentNode = useNodeStore((state) => state.patchCurrentNode)
  const addBmadAgentForCurrent = useNodeStore(
    (state) => state.addBmadAgentForCurrent,
  )
  const removeConnectedBmad = useNodeStore((state) => state.removeConnectedBmad)
  const agents = useBmadAgentStore((state) => state.agents)
  const fetchAgents = useBmadAgentStore((state) => state.fetchAgents)
  const switchTo = useRouteStore((state) => state.switchTo)

  useEffect(() => {
    fetchAgents()
  }, [])
  // 全流程统一执行工具（在执行面板顶部选择）
  const selectedTool = useGlobalStore((state) => state.tool)

  // 只订阅由「当前节点上游 BMad 连接」派生出的原始值：拖动任意节点时
  // nodes/edges 每帧生成新引用，但这里取出的值不变，经 useShallow 浅比较后
  // 跳过重渲染，避免编辑面板在拖拽时每帧重渲染整个表单。
  const { connectedAgentId, connectedRole, hasBmadConnection } = useNodeStore(
    useShallow((state) => {
      const bmadEdge = state.edges.find(
        (e) =>
          e.target === currentNode.id &&
          state.nodes.find((n) => n.id === e.source)?.type ===
            NodeTypes.BMAD_AGENT,
      )
      const bmadData = bmadEdge
        ? (state.nodes.find((n) => n.id === bmadEdge.source)?.data as
            | { agentId?: string; role?: string }
            | undefined)
        : undefined
      return {
        connectedAgentId: bmadData?.agentId || undefined,
        connectedRole: bmadData?.role,
        hasBmadConnection: !!bmadEdge,
      }
    }),
  )

  const rows: DynEditKVRow[] = [
    {
      key: 'alias',
      label: '智能体别名',
      value: currentNode.data.modal?.alias,
      placeholder: '给智能体取一个易记的别名',
    },
    {
      key: 'agent',
      label: '选择角色 (BMad)',
      valueRender: (onChange) => (
        <Select
          style={{ width: '100%' }}
          placeholder={
            hasBmadConnection ? '已连接角色（可换选）' : '选择角色...'
          }
          value={connectedAgentId}
          notFoundContent="暂无角色，请先添加"
          options={agents.map((a) => ({
            label: `${a.title} (${a.name})`,
            value: a.id,
          }))}
          onChange={(agentId) => {
            const agent = agents.find((a) => a.id === agentId)
            if (!agent) return

            // 更新当前 AgentNode 的别名
            patchCurrentNode((draft) => {
              const data = d(draft)
              data.modal ??= {}
              data.modal.alias = agent.title
            })

            // 自动创建或更新 BMadAgentNode
            addBmadAgentForCurrent({
              id: agent.id,
              title: agent.title || agent.name,
              name: agent.name,
              description: agent.description,
              skillContent: agent.skillContent,
            })
            onChange(agentId)
          }}
        />
      ),
      actionRender: (
        <Button size="small" onClick={() => switchTo('prompts')}>
          管理
        </Button>
      ),
    },
  ]

  return (
    <>
      <DynEditKV
        rows={rows}
        onChange={(key, value) => {
          if (key === 'alias') {
            patchCurrentNode((draft) => {
              const data = d(draft)
              data.modal ??= {}
              data.modal.alias = (value || '') as string
            })
          }
          // model 和 agent 的变更已在 valueRender 中处理
        }}
      />

      {/* 已连接 BMad 角色的状态提示 */}
      {hasBmadConnection && connectedRole && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 8,
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--xy-edge-stroke-default)' }}>
            <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />
            <Text type="secondary" style={{ fontSize: 11 }}>
              已连接角色: {connectedRole}
            </Text>
          </div>
          <Tooltip title="断开 BMad 角色连接">
            <Button
              type="text"
              size="small"
              danger
              icon={<DisconnectOutlined />}
              onClick={() => {
                removeConnectedBmad()
              }}
            />
          </Tooltip>
        </div>
      )}

      {/* 本机执行工具提示 */}
      {selectedTool && (
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
          <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />
          <Text type="secondary" style={{ fontSize: 11 }}>
            本机 CLI 执行工具：{selectedTool}（在执行面板顶部统一选择）
          </Text>
        </div>
      )}
    </>
  )
}
