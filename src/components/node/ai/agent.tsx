import type { NodeProps } from '@xyflow/react'
import type { NAgent } from '#/types'
import { NodeTypes } from '#/types'
import styles from '../index.module.scss'
import { Badge } from 'antd'
import { Tag } from '#/components/tag'
import { UNode } from '../'
import { useNodeStore } from '#/store/node'
import { useBmadAgentStore } from '#/store/bmad'
import { useShallow } from 'zustand/react/shallow'

/**
 * # 智能体节点
 * 接收输入数据，配置智能体参数。
 * 如果连接了 BMad 角色节点，会在节点上显示角色标签。
 */
export const AgentNode = (props: NodeProps<NAgent>) => {
  // 只订阅「本节点的上游 BMad 角色」这一派生结果，且返回值均为原始值。
  // 拖动任意节点时 store 的 nodes/edges 数组每帧都会生成新引用，但这里取出的
  // agentId/role 不变，经 useShallow 浅比较后跳过重渲染，避免所有智能体节点
  // 跟着拖拽每帧重渲染造成卡顿。
  const { agentId, role } = useNodeStore(
    useShallow((state) => {
      const bmadEdge = state.edges.find(
        (e) =>
          e.target === props.id &&
          state.nodes.find((n) => n.id === e.source)?.type ===
            NodeTypes.BMAD_AGENT,
      )
      const bmadData = bmadEdge
        ? (state.nodes.find((n) => n.id === bmadEdge.source)?.data as
            | { agentId?: string; role?: string }
            | undefined)
        : undefined
      return { agentId: bmadData?.agentId, role: bmadData?.role }
    }),
  )

  // 仅取该角色的图标（原始值），agents 列表变化时才重渲染
  const agentIcon = useBmadAgentStore((state) =>
    agentId ? state.agents.find((a) => a.id === agentId)?.icon : undefined,
  )

  return (
    <UNode node={props}>
      {props.data.modal?.alias && (
        <div className={styles.row}>
          <Badge status="processing" size="small" />
          <span>{props.data.modal.alias}</span>
        </div>
      )}

      {/* 已连接 BMad 角色标签 */}
      {role && (
        <div className={styles.row}>
          <Tag color="purple">
            {agentIcon} {role}
          </Tag>
        </div>
      )}
    </UNode>
  )
}
