import { Button, Tooltip } from 'antd'
import styles from '../index.module.scss'
import { Play } from 'lucide-react'
import { useNodeStore } from '#/store/node'

export interface RunNodeProps {
  nodeId: string
}

export const RunNode = ({ nodeId }: RunNodeProps) => {
  const runFrom = useNodeStore((state) => state.runFrom)
  // 只订阅布尔结果，避免订阅 pipelineContext 对象：否则执行状态更新时
  // 每个节点的 RunNode 都会重渲染。
  const isRunning = useNodeStore(
    (state) =>
      state.pipelineContext.currentNodeId === nodeId &&
      state.pipelineContext.globalStatus === 'running',
  )

  return (
    <Tooltip title={isRunning ? '执行中...' : '从此节点开始执行'}>
      <Button
        type={isRunning ? 'default' : 'primary'}
        size="small"
        className={styles.run_button}
        loading={isRunning}
        styles={{
          root: {
            height: 12,
            width: 12,
            padding: 0,
          },
        }}
        onClick={(e) => {
          e.stopPropagation()
          runFrom(nodeId)
        }}
      >
        <Play size={8}></Play>
      </Button>
    </Tooltip>
  )
}
