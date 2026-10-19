import { useNodeStore } from '#/store/node'
import { NodeTypes } from '#/types'
import type { NIf, NIfData } from '#/types'
import type { NodeProps } from '@xyflow/react'
import { DynEditKV } from './item'
import type { DynEditKVRow } from './item'
import { Button, Divider, Typography, Tag } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { v4 as uuidv4 } from 'uuid'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

const { Text } = Typography

const d = (
  draft: NonNullable<ReturnType<typeof useNodeStore.getState>['currentNode']>,
) => draft.data as NIfData

export const EditIf = () => {
  const currentNode = useNodeStore((state) => state.currentNode) as NodeProps<NIf>
  const patchCurrentNode = useNodeStore((state) => state.patchCurrentNode)
  const addConnectNode = useNodeStore((state) => state.addConnectNode)
  const setCurrentNode = useNodeStore((state) => state.setCurrentNode)
  const removeEdge = useNodeStore((state) => state.removeEdge)

  // 条件分支列表扁平化为字符串（edgeId|nodeId|label|condition）：拖拽时
  // nodes/edges 数组每帧变化但值不变，经 useShallow 跳过重渲染，避免编辑
  // 面板跟着拖拽每帧卡顿
  const conditionItems = useNodeStore(
    useShallow((state) => {
      const out: string[] = []
      for (const e of state.edges) {
        if (e.source !== currentNode.id) continue
        const n = state.nodes.find((x) => x.id === e.target)
        if (n?.type !== NodeTypes.IF_CONDITION) continue
        const data = n.data as { label?: string; condition?: string }
        out.push(
          `${e.id}\u0001${n.id}\u0001${data.label || ''}\u0001${data.condition || ''}`,
        )
      }
      return out
    }),
  )
  const conditionNodes = useMemo(
    () =>
      conditionItems.map((s) => {
        const [edgeId, nodeId, label, condition] = s.split('\u0001')
        return { edgeId, nodeId, label, condition }
      }),
    [conditionItems],
  )

  const addCondition = () => {
    const pos = currentNode as any
    const id = uuidv4()
    const conditionNode = {
      id,
      type: NodeTypes.IF_CONDITION,
      position: {
        x: (pos.positionAbsoluteX ?? pos.position?.x ?? 0) + 200,
        y: (pos.positionAbsoluteY ?? pos.position?.y ?? 0) + conditionNodes.length * 80,
      },
      deletable: true,
      draggable: true,
      selectable: true,
      selected: false,
      data: {
        title: `条件分支 ${conditionNodes.length + 1}`,
        label: `条件${conditionNodes.length + 1}`,
        condition: '',
      },
    }

    addConnectNode(conditionNode as any)
    setCurrentNode(conditionNode as any)
  }

  const rows: DynEditKVRow[] = [
    {
      key: 'expression',
      label: '判断表达式',
      value: currentNode.data.expression,
      inputType: 'textArea',
      rows: 2,
      placeholder: '描述你的判断逻辑',
    },
  ]

  return (
    <>
      <DynEditKV
        rows={rows}
        onChange={(key, value) => {
          patchCurrentNode((draft) => {
            d(draft).expression = (value || '') as string
          })
        }}
      />

      <Divider style={{ margin: '12px 0' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text strong style={{ fontSize: 12 }}>条件分支</Text>
        <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addCondition}>
          添加分支
        </Button>
      </div>

      <div style={{ marginTop: 8 }}>
        {conditionNodes.length === 0 && (
          <Text type="secondary" style={{ fontSize: 11 }}>暂无条件分支，请添加</Text>
        )}
        {conditionNodes.map((item) => (
          <div
            key={item.nodeId}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 0',
              borderBottom: '1px solid var(--xy-edge-stroke-default)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
              <Tag color="orange" style={{ fontSize: 9, margin: 0 }}>
                {item.label || `条件`}
              </Tag>
              <Text type="secondary" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>
                {item.condition || '未设置条件'}
              </Text>
            </div>
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                const { nodes, setNodes } = useNodeStore.getState()
                setNodes(nodes.filter((n) => n.id !== item.nodeId))
                removeEdge(item.edgeId)
              }}
            />
          </div>
        ))}
      </div>
    </>
  )
}
