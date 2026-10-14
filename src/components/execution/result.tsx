import { useNodeStore } from '#/store/node'
import { NodeTypes } from '#/types'
import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Typography, Tag, Input, Space, Button, Timeline, Card, Descriptions } from 'antd'
import type { LogEntry } from '#/types/engine'
import { CodeEditor } from '#/components/file-editor/editor'

const { Text } = Typography

const levelColorMap: Record<LogEntry['level'], string> = {
  info: 'green',
  warn: 'orange',
  error: 'red',
  debug: 'default',
}

/**
 * # 执行结果组件
 * 显示执行状态、等待输入、日志和最终执行结果。
 */
export const ExecutionResult = () => {
  const pipelineContext = useNodeStore((state) => state.pipelineContext)
  const resumeFrom = useNodeStore((state) => state.resumeFrom)
  // 只订阅 {nodeId: type/title} 字符串映射：拖拽时 nodes 数组每帧变化，
  // 但映射的字符串值不变，经 useShallow 浅比较跳过重渲染
  const nodeTypeMap = useNodeStore(
    useShallow((state) =>
      Object.fromEntries(state.nodes.map((n) => [n.id, n.type as string])),
    ),
  )
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
  const { nodeOutputs, globalStatus, logs } = pipelineContext

  const [result, setResult] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [replyText, setReplyText] = useState('')
  // 执行中/等待输入时每秒刷新，用于实时显示已耗时
  const [now, setNow] = useState(Date.now())

  // 执行信息：总消耗 token（汇总各节点 output.usage）
  const totalTokens = Object.values(nodeOutputs).reduce((sum, out) => {
    const usage = out?.usage
    if (!usage || typeof usage !== 'object') return sum
    return sum + (usage.totalTokens || usage.total_tokens || 0)
  }, 0)

  // 执行时间：结束时间优先，进行中则用当前时间
  const startedAt = pipelineContext.startedAt
  const endedAt = pipelineContext.endedAt
  const durationMs = endedAt
    ? Math.max(0, endedAt - (startedAt || endedAt))
    : startedAt
      ? Math.max(0, now - startedAt)
      : 0

  // 找到处于 waiting 状态的节点
  const waitingNodeEntry = Object.entries(pipelineContext.nodeStatuses).find(
    ([, status]) => status === 'waiting',
  )
  const waitingNodeId = waitingNodeEntry?.[0]
  const waitingOutput = waitingNodeId
    ? pipelineContext.nodeOutputs[waitingNodeId]
    : null

  // 执行中/等待输入时实时刷新耗时显示
  useEffect(() => {
    if (globalStatus === 'running' || globalStatus === 'paused') {
      const t = setInterval(() => setNow(Date.now()), 1000)
      return () => clearInterval(t)
    }
    setNow(Date.now())
  }, [globalStatus])

  const handleResume = () => {
    if (waitingNodeId && replyText.trim()) {
      resumeFrom(waitingNodeId, replyText.trim())
      setReplyText('')
    }
  }

  useEffect(() => {
    const executedNodeIds = Object.keys(nodeOutputs)
    if (executedNodeIds.length === 0) {
      setResult('')
      setSourceLabel('')
      return
    }

    // 优先找 AI_OUTPUT 类型节点
    const aiOutputId = executedNodeIds.find(
      (id) => nodeTypeMap[id] === NodeTypes.AI_OUTPUT,
    )

    if (aiOutputId) {
      setSourceLabel(nodeTitleMap[aiOutputId] || 'AI 输出')
      setResult(formatOutput(nodeOutputs[aiOutputId]))
      return
    }

    // 否则取最后执行的节点
    const lastNodeId = executedNodeIds[executedNodeIds.length - 1]
    setSourceLabel(nodeTitleMap[lastNodeId] || '最后节点')
    setResult(formatOutput(nodeOutputs[lastNodeId]))
  }, [nodeOutputs, nodeTypeMap, nodeTitleMap])

  const statusColorMap: Record<string, string> = {
    idle: 'default',
    running: 'processing',
    completed: 'success',
    error: 'error',
    paused: 'warning',
  }

  const statusLabelMap: Record<string, string> = {
    idle: '未执行',
    running: '执行中',
    completed: '已完成',
    error: '出错',
    paused: '等待输入',
  }

  return (
    <div>
      {/* 执行状态 */}
      {globalStatus !== 'idle' && (
        <div style={{ marginBottom: 8 }}>
          <Tag color={statusColorMap[globalStatus] || 'default'}>
            {statusLabelMap[globalStatus] || globalStatus}
          </Tag>
        </div>
      )}

      {/* Answer 节点输入面板 */}
      {globalStatus === 'paused' && waitingOutput && (
        <div
          style={{
            margin: '8px 0',
            padding: 8,
            border: '1px solid var(--xy-edge-stroke-default)',
            borderRadius: 4,
            backgroundColor: 'var(--xy-node-background-color)',
          }}
        >
          <Text strong style={{ fontSize: 12 }}>
            {waitingOutput.question || '请输入:'}
          </Text>
          {waitingOutput.options && waitingOutput.options.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 4,
                marginTop: 4,
              }}
            >
              {waitingOutput.options.map((opt: string) => (
                <Tag
                  key={opt}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setReplyText(opt)}
                >
                  {opt}
                </Tag>
              ))}
            </div>
          )}
          <Space.Compact style={{ width: '100%', marginTop: 8 }}>
            <Input
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onPressEnter={handleResume}
              placeholder="输入回复..."
              size="small"
            />
            <Button
              type="primary"
              size="small"
              onClick={handleResume}
              disabled={!replyText.trim()}
            >
              提交
            </Button>
          </Space.Compact>
        </div>
      )}

      {/* 执行结果 */}
      <div style={{ marginBottom: 8 }}>
        <Text strong style={{ fontSize: 14 }}>
          执行结果
        </Text>
      </div>

      {/* 执行信息 */}
      {globalStatus !== 'idle' && (
        <Card size="small" title="执行信息" style={{ marginBottom: 12 }}>
          <Descriptions size="small" column={1}>
            <Descriptions.Item label="执行状态">
              <Tag color={statusColorMap[globalStatus] || 'default'}>
                {statusLabelMap[globalStatus] || globalStatus}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="执行时间">
              {startedAt
                ? `${new Date(startedAt).toLocaleTimeString()} 开始 · 耗时 ${formatDuration(durationMs)}${globalStatus === 'running' ? '（进行中）' : ''}`
                : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="总消耗 Token">
              {totalTokens > 0 ? totalTokens.toLocaleString() : '暂无数据'}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}
      {!result ? (
        <div style={{ textAlign: 'center', padding: 24, color: '#888' }}>
          <Text type="secondary">
            {globalStatus === 'idle'
              ? '暂无执行结果'
              : globalStatus === 'running'
                ? '正在执行...'
                : '无输出数据'}
          </Text>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 4 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              来源: {sourceLabel}
            </Text>
          </div>
          <div style={{ borderRadius: 4, overflow: 'hidden' }}>
            <CodeEditor value={result} readOnly maxHeight={300} />
          </div>
        </>
      )}

      {/* 执行日志 */}
      {logs.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Text strong style={{ fontSize: 13 }}>
            执行日志
          </Text>
          <div style={{ marginTop: 8, height: 'calc(100vh - 400px)', overflow: "auto" }}>
            <Timeline
              items={logs.map((log, i) => ({
                color: levelColorMap[log.level] || 'blue',
                content: (
                  <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                    <Text
                      style={{
                        color: '#888',
                        whiteSpace: 'nowrap',
                        marginRight: 8,
                      }}
                    >
                      {log.nodeTitle}
                    </Text>
                    <Text>{log.message}</Text>
                  </div>
                ),
              }))}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** 将 output 对象格式化为可读字符串 */
function formatOutput(output: Record<string, any> | undefined): string {
  if (!output) return ''

  const keys = Object.keys(output)
  if (keys.length === 1) {
    const val = output[keys[0]]
    if (typeof val === 'string') return val
    return JSON.stringify(val, null, 2)
  }

  return JSON.stringify(output, null, 2)
}

/** 将毫秒耗时格式化为可读文本 */
function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
