import { Handle, Position } from '@xyflow/react'
import type { AppNode } from '#/types'
import styles from './index.module.scss'
import { useNodeStore } from '#/store/node'
import type { ReactNode } from 'react'
import { AddNodeBtn } from './edge/add'
import { NodeHeader } from './header'
import { RunNode } from './edge/run'
import { PinNode } from './edge/pin-node'
import type { NodeStatus } from '#/types/engine'
import { Badge } from 'antd'
import { StepMarkNode } from './edge/step'
import { useGlobalStore } from '#/store/global'

export interface UNodeProps {
  node: Exclude<AppNode, null>
  children: ReactNode
}

const statusBadgeMap: Record<
  NodeStatus,
  'processing' | 'success' | 'error' | 'default'
> = {
  idle: 'default',
  running: 'processing',
  success: 'success',
  error: 'error',
  waiting: 'processing',
}

export const UNode = ({ node, children }: UNodeProps) => {
  const setCurrentNode = useNodeStore((state) => state.setCurrentNode)
  const mode = useGlobalStore((state) => state.globalMode)
  // 只订阅本节点相关的原始值（选中态、运行状态），而不是 currentNode /
  // pipelineContext 这类对象引用：否则点击任意节点或执行状态更新都会让所有节点重渲染。
  const isChoose = useNodeStore((state) => state.currentNode?.id === node.id)
  const nodeStatus = useNodeStore(
    (state) => state.pipelineContext.nodeStatuses[node.id] ?? 'idle',
  )
  const kind = node.type

  return (
    <div
      className={`${styles.node} ${isChoose ? styles.node_choose : ''} ${nodeStatus === 'running' ? styles.node_running : ''} ${nodeStatus === 'error' ? styles.node_error : ''}`}
      onClick={() => {
        setCurrentNode(node)
      }}
    >
      <Handle type="target" position={Position.Left} />
      {mode === 'spec' && node.data.specStep && (
        <div className={styles.node_step}>{node.data.specStep}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <NodeHeader kind={kind} title={node.data.title || ''} />
        <Badge status={statusBadgeMap[nodeStatus]} size="small" />
      </div>
      <div className={styles.node_content}>{children}</div>
      <div className={styles.node_tools}>
        <RunNode nodeId={node.id} />
        <StepMarkNode node={node} />
        <PinNode
          nodeId={node.id}
          nodeType={node.type}
          title={node.data.title || ''}
        />
        <AddNodeBtn kind={kind} />
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
