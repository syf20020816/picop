import { useNodeStore } from '#/store/node'
import { NodeTypes } from '#/types'
import type { NRetry, NRetryData } from '#/types'
import type { NodeProps } from '@xyflow/react'
import { DynEditKV } from './item'
import type { DynEditKVRow } from './item'
import { Select, Divider, Typography, InputNumber, Tag } from 'antd'
import { NodeBuilder } from '#/types/builder'
import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'

const { Text } = Typography

const d = (
  draft: NonNullable<ReturnType<typeof useNodeStore.getState>['currentNode']>,
) => draft.data as NRetryData

export const EditRetry = () => {
  const currentNode = useNodeStore((state) => state.currentNode) as NodeProps<NRetry>
  const patchCurrentNode = useNodeStore((state) => state.patchCurrentNode)
  const addConnectNode = useNodeStore((state) => state.addConnectNode)

  // 只订阅 AI 判断分支的派生原始值：拖拽时 nodes/edges 每帧变化但值不变，
  // 经 useShallow 浅比较跳过重渲染，避免编辑面板跟着拖拽卡顿
  const { hasAgentNode, agentTitle } = useNodeStore(
    useShallow((state) => {
      const e = state.edges.find(
        (edge) =>
          edge.source === currentNode.id &&
          state.nodes.find((n) => n.id === edge.target)?.type ===
            NodeTypes.AGENT,
      )
      const n = e ? state.nodes.find((x) => x.id === e.target) : null
      return { hasAgentNode: !!n, agentTitle: String(n?.data?.title || '') }
    }),
  )

  // 切换到 AI 模式时，自动创建 AgentNode
  useEffect(() => {
    if (currentNode.data.judgmentMode === 'ai' && !hasAgentNode) {
      const pos = currentNode as any
      const newNode = NodeBuilder.agent({
        x: pos.positionAbsoluteX ?? pos.position?.x ?? 0,
        y: pos.positionAbsoluteY ?? pos.position?.y ?? 0,
      })
      if (newNode) {
        addConnectNode(newNode)
      }
    }
  }, [currentNode.data.judgmentMode])

  const isManual = currentNode.data.judgmentMode === 'manual'

  const rows: DynEditKVRow[] = [
    {
      key: 'judgmentMode',
      label: '判断模式',
      valueRender: (onChange) => (
        <Select
          style={{ width: '100%' }}
          value={currentNode.data.judgmentMode}
          options={[
            { label: '人工判断（关键词匹配）', value: 'manual' },
            { label: 'AI 判断', value: 'ai' },
          ]}
          onChange={(v) => {
            patchCurrentNode((draft) => {
              d(draft).judgmentMode = v
            })
            onChange(v)
          }}
        />
      ),
      actionRender: null,
    },
    {
      key: 'retryDelay',
      label: '重试间隔（秒）',
      valueRender: (onChange) => (
        <InputNumber
          style={{ width: '100%' }}
          min={0.1}
          max={300}
          step={0.5}
          value={currentNode.data.retryDelay}
          onChange={(v) => {
            patchCurrentNode((draft) => {
              d(draft).retryDelay = v ?? 1
            })
            onChange(v)
          }}
        />
      ),
      actionRender: null,
    },
    {
      key: 'maxRetryCount',
      label: '最大重试次数',
      valueRender: (onChange) => (
        <InputNumber
          style={{ width: '100%' }}
          min={0}
          max={100}
          value={currentNode.data.maxRetryCount}
          onChange={(v) => {
            patchCurrentNode((draft) => {
              d(draft).maxRetryCount = v ?? 5
            })
            onChange(v)
          }}
        />
      ),
      actionRender: null,
    },
  ]

  // 仅 manual 模式显示错误关键词
  if (isManual) {
    rows.push({
      key: 'errorKeywords',
      label: '错误关键词',
      value: currentNode.data.errorKeywords,
      inputType: 'textArea',
      rows: 2,
      placeholder: '输入关键词，用逗号分隔。匹配则判定为错误',
    })
  }

  return (
    <>
      <DynEditKV
        rows={rows}
        onChange={(key, value) => {
          if (key === 'errorKeywords') {
            patchCurrentNode((draft) => {
              d(draft).errorKeywords = (value || '') as string
            })
          }
          // judgmentMode/retryDelay/maxRetryCount 的变更已在 valueRender 中处理
        }}
      />

      {/* AI 判断信息展示 */}
      {!isManual && (
        <div style={{ marginTop: 8 }}>
          <Divider style={{ margin: '12px 0' }} />
          <div className="line">
            <Text>AI 判断</Text>
            {hasAgentNode ? (
              <div style={{ marginTop: 4 }}>
                <Tag color="purple" style={{ fontSize: 10 }}>
                  {agentTitle}
                </Tag>
                <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 2 }}>
                  已连接 AgentNode，AI 将自动判断是否需要重试
                </Text>
              </div>
            ) : (
              <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                将在确认后自动创建 AgentNode 连接
              </Text>
            )}
          </div>
        </div>
      )}
    </>
  )
}
