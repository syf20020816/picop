import { Panel } from '@xyflow/react'
import type { PanelProps } from '@xyflow/react'
import { Sender } from '@ant-design/x'
import { useState, useRef, useEffect } from 'react'
import styles from '../index.module.scss'
import { Flex, message as messageApi, Button, Tooltip } from 'antd'
import { useGlobalStore } from '#/store/global'
import { buildWorkflow, applyWorkflow } from '#/services/flowBuilder'
import type { ChatMessage } from '#/services/flowBuilder'
import { DeleteOutlined } from '@ant-design/icons'
import { ChevronDown, ChevronUp } from 'lucide-react'

export const SenderPanel = (props: PanelProps) => {
  const [loading, setLoading] = useState(false)
  const [value, setValue] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const [collapse, setCollapse] = useState(true)
  // 全流程统一使用全局本地工具（在执行面板顶部选择）
  const localTool = useGlobalStore((state) => state.tool)

  // 消息变化时自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const handleSubmit = async (content: string) => {
    if (!content.trim()) return
    if (!localTool) {
      messageApi.warning('请先在执行面板顶部选择本地工具（需启动本地 Runner）')
      return
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      ts: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])
    setValue('')
    setLoading(true)

    try {
      const { explanation, workflow } = await buildWorkflow(
        content,
        localTool,
        messages,
      )
      const aiMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `${explanation}\n\n已生成 ${workflow.nodes.length} 个节点，${workflow.edges.length} 条连接，已应用到画布。`,
        ts: Date.now(),
      }
      setMessages((prev) => [...prev, aiMsg])
      applyWorkflow(workflow)
    } catch (e) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `❌ ${e instanceof Error ? e.message : '生成失败，请重试'}`,
        ts: Date.now(),
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }

  const handleClear = () => {
    setMessages([])
  }

  if (collapse)
    return (
      <Panel {...props}>
        <div className={styles.senderPanel}>
          <div className={styles.collapse} onClick={() => setCollapse(false)}>
            <ChevronUp size={16} />
          </div>
        </div>
      </Panel>
    )

  return (
    <Panel {...props}>
      <div className={styles.senderPanel}>
        <div className={styles.collapse} onClick={() => setCollapse(true)}>
          <ChevronDown size={16} />
        </div>
        {messages.length > 0 && (
          <div className={styles.chatHistory} ref={scrollRef}>
            <div className={styles.chatHistoryHeader}>
              <span className={styles.chatHistoryTitle}>对话搭建记录</span>
              <Tooltip title="清空对话">
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={handleClear}
                />
              </Tooltip>
            </div>
            <div className={styles.chatList}>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`${styles.chatMsg} ${
                    msg.role === 'user' ? styles.chatMsgUser : styles.chatMsgAi
                  }`}
                >
                  <div
                    className={`${styles.chatBubble} ${
                      msg.role === 'user'
                        ? styles.chatBubbleUser
                        : styles.chatBubbleAi
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className={`${styles.chatMsg} ${styles.chatMsgAi}`}>
                  <div
                    className={`${styles.chatBubble} ${styles.chatBubbleAi}`}
                  >
                    思考中...
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        <Sender
          styles={{
            root: {
              backgroundColor: 'var(--xy-node-background-color)',
            },
          }}
          suffix={false}
          loading={loading}
          value={value}
          onChange={(v) => {
            setValue(v)
          }}
          onSubmit={(content) => {
            handleSubmit(content)
          }}
          onCancel={() => {
            setLoading(false)
          }}
          autoSize={{ minRows: 1, maxRows: 3 }}
          footer={(_, { components }) => {
            const { SendButton, LoadingButton } = components

            return (
              <Flex justify="flex-end" align="center">
                {loading ? (
                  <LoadingButton type="default" />
                ) : (
                  <SendButton type="primary" disabled={false} />
                )}
              </Flex>
            )
          }}
        />
      </div>
    </Panel>
  )
}
