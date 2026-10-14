import { useNodeStore } from '#/store/node'
import { Collapse, Typography } from 'antd'
import { CodeEditor } from '#/components/file-editor/editor'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

const { Text } = Typography

export const OutputPanel = () => {
  const pipelineContext = useNodeStore((state) => state.pipelineContext)
  // 只订阅 {nodeId: title} 字符串映射：拖拽时 nodes 数组每帧变化但映射值不变，
  // 经 useShallow 浅比较跳过重渲染，避免执行面板跟着拖拽卡顿
  const nodeTitleMap = useNodeStore(
    useShallow((state) =>
      Object.fromEntries(
        state.nodes.map((n) => [
          n.id,
          typeof n.data.title === 'string' ? n.data.title : '',
        ]),
      ),
    ),
  )

  const outputEntries = useMemo(
    () =>
      Object.keys(pipelineContext.nodeOutputs)
        .filter((id) => id in nodeTitleMap)
        .map((id) => ({ id, title: nodeTitleMap[id] })),
    [pipelineContext.nodeOutputs, nodeTitleMap],
  )

  if (outputEntries.length === 0) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: '#888' }}>
        <Text type="secondary">暂无输出数据，请先执行工作流</Text>
      </div>
    )
  }

  return (
    <Collapse
      defaultActiveKey={outputEntries.map((n) => n.id)}
      ghost
      size="small"
      items={outputEntries.map((entry) => {
        const output = pipelineContext.nodeOutputs[entry.id]
        return {
          key: entry.id,
          label: (
            <Text strong style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
              {entry.title || '未命名节点'}
            </Text>
          ),
          children: output ? (
            <div style={{ borderRadius: 4, overflow: 'auto', height: 400 }}>
              <CodeEditor value={JSON.stringify(output, null, 2)} readOnly />
            </div>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              无输出
            </Text>
          ),
        }
      })}
    />
  )
}
