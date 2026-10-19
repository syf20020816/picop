import { useNodeStore } from '#/store/node'
import { NodeTypes } from '#/types'
import type { NLoop, NLoopData } from '#/types'
import type { NodeProps } from '@xyflow/react'
import { DynEditKV } from './item'
import type { DynEditKVRow } from './item'
import { Button, Divider, Typography, InputNumber, Tag } from 'antd'
import { PlusOutlined, DisconnectOutlined } from '@ant-design/icons'
import { v4 as uuidv4 } from 'uuid'
import { useShallow } from 'zustand/react/shallow'

const { Text } = Typography

const d = (
  draft: NonNullable<ReturnType<typeof useNodeStore.getState>['currentNode']>,
) => draft.data as NLoopData

export const EditLoop = () => {
  const currentNode = useNodeStore((state) => state.currentNode) as NodeProps<NLoop>
  const patchCurrentNode = useNodeStore((state) => state.patchCurrentNode)
  const addConnectNode = useNodeStore((state) => state.addConnectNode)
  const setCurrentNode = useNodeStore((state) => state.setCurrentNode)

  // 只订阅循环条件节点的派生原始值：拖拽时 nodes/edges 每帧变化但值不变，
  // 经 useShallow 浅比较跳过重渲染，避免编辑面板跟着拖拽卡顿
  const { hasCondition, conditionText } = useNodeStore(
    useShallow((state) => {
      const e = state.edges.find(
        (edge) =>
          edge.source === currentNode.id &&
          state.nodes.find((n) => n.id === edge.target)?.type ===
            NodeTypes.LOOP_CONDITION,
      )
      const n = e ? state.nodes.find((x) => x.id === e.target) : null
      const data = (n?.data ?? {}) as { condition?: string }
      return { hasCondition: !!n, conditionText: data.condition || '' }
    }),
  )

  const addCondition = () => {
    if (hasCondition) return
    const pos = currentNode as any
    const node = {
      id: uuidv4(),
      type: NodeTypes.LOOP_CONDITION,
      position: {
        x: (pos.positionAbsoluteX ?? pos.position?.x ?? 0) + 200,
        y: pos.positionAbsoluteY ?? pos.position?.y ?? 0,
      },
      deletable: true,
      draggable: true,
      selectable: true,
      selected: false,
      data: {
        title: '循环条件节点',
        condition: '',
      },
    } as any

    addConnectNode(node)
    setCurrentNode(node)
  }

  const removeCondition = () => {
    if (!hasCondition) return
    const { nodes, edges, setNodes, setEdges } = useNodeStore.getState()
    const target = nodes.find(
      (n) =>
        n.type === NodeTypes.LOOP_CONDITION &&
        edges.some((e) => e.source === currentNode.id && e.target === n.id),
    )
    if (!target) return
    setNodes(nodes.filter((n) => n.id !== target.id))
    setEdges(edges.filter((e) => e.target !== target.id && e.source !== target.id))
  }

  const rows: DynEditKVRow[] = [
    {
      key: 'maxLoopCount',
      label: '最大循环次数',
      valueRender: (onChange) => (
        <InputNumber
          style={{ width: '100%' }}
          min={1}
          max={100}
          value={currentNode.data.maxLoopCount}
          onChange={(v) => {
            patchCurrentNode((draft) => {
              d(draft).maxLoopCount = v ?? 5
            })
            onChange(v)
          }}
        />
      ),
      actionRender: null,
    },
    {
      key: 'condition',
      label: '循环条件描述',
      value: currentNode.data.condition,
      inputType: 'textArea',
      rows: 2,
      placeholder: '什么条件下继续循环',
    },
  ]

  return (
    <>
      <DynEditKV
        rows={rows}
        onChange={(key, value) => {
          if (key === 'condition') {
            patchCurrentNode((draft) => {
              d(draft).condition = (value || '') as string
            })
          }
          // maxLoopCount 的变更已在 valueRender 中处理
        }}
      />

      <Divider style={{ margin: '12px 0' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text strong style={{ fontSize: 12 }}>循环条件节点</Text>
        {!hasCondition ? (
          <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addCondition}>
            添加
          </Button>
        ) : (
          <Button type="text" size="small" danger icon={<DisconnectOutlined />} onClick={removeCondition}>
            移除
          </Button>
        )}
      </div>

      {hasCondition && (
        <div style={{ marginTop: 8, padding: 8, background: 'var(--xy-node-background-color)', borderRadius: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Tag color="blue" style={{ fontSize: 9, margin: 0 }}>
              {conditionText || '未设置条件'}
            </Tag>
          </div>
          <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 4 }}>
            与该节点相连的节点为循环体；与循环条件节点相连的节点为循环结束后执行的节点
          </Text>
        </div>
      )}

      {!hasCondition && (
        <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 4 }}>
          添加循环条件节点后，连入的节点将作为循环体
        </Text>
      )}
    </>
  )
}
