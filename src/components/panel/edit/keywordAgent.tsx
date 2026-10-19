import { useEffect, useState, useRef } from 'react'
import { useNodeStore } from '#/store/node'
import type { NKeywordAgent } from '#/types'
import type { NodeProps } from '@xyflow/react'
import { Typography, Divider } from 'antd'
import { CodeEditor } from '#/components/file-editor/editor'

const { Text } = Typography

export const EditKeywordAgent = () => {
  const currentNode = useNodeStore(
    (state) => state.currentNode,
  ) as NodeProps<NKeywordAgent>
  const formatValue = currentNode.data.format || '{\n  "keywords": string[]\n}'
  const [promptContent, setPromptContent] = useState('')

  // 本地 CodeEditor state（避免失焦问题）
  const [localFormat, setLocalFormat] = useState(formatValue)
  const formatRef = useRef(formatValue)
  formatRef.current = formatValue

  // 加载 prompt 文件
  useEffect(() => {
    fetch('/api/prompts?name=keywordAgent.md')
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 'success') {
          setPromptContent(data.data.content)
        } else {
          setPromptContent('// 提示文件加载失败')
        }
      })
      .catch(() => {
        setPromptContent('// 提示文件加载失败')
      })
  }, [])

  // 同步外部 format 到本地
  useEffect(() => {
    setLocalFormat(formatValue)
  }, [formatValue])

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 11 }}>
          调用 AI 从上游内容中提取关键词列表，输出格式可由下方编辑器自定义
        </Text>
      </div>

      {/* 输出格式编辑区 */}
      <Divider style={{ margin: '12px 0', fontSize: 12 }}>
        输出格式 (JSON)
      </Divider>
      <div style={{ marginBottom: 6, padding: '0 4px' }}>
        <Text type="secondary" style={{ fontSize: 11 }}>
          AI 将按此 JSON 模板格式输出关键词，需包含 keywords 数组字段
        </Text>
      </div>
      <div
        style={{
          border: '1px solid #333',
          borderRadius: 4,
          overflow: 'hidden',
          maxHeight: 200,
        }}
      >
        <CodeEditor
          value={localFormat}
          onChange={(v) => {
            setLocalFormat(v)
          }}
          maxHeight={160}
          language="json"
        />
      </div>
      <div style={{ marginTop: 4, display: 'flex', gap: 8 }}>
        <Text type="secondary" style={{ fontSize: 10 }}>
          按 ⌘S / Ctrl+S 保存格式
        </Text>
      </div>

      {/* 系统提示词预览 */}
      <Divider style={{ margin: '12px 0', fontSize: 12 }}>系统提示词</Divider>
      {promptContent && (
        <CodeEditor maxHeight={200} value={promptContent} language="markdown" />
      )}
      {!promptContent && (
        <div
          style={{
            padding: '6px 8px',
            background: '#141414',
            borderRadius: 4,
            fontSize: 11,
            color: '#555',
          }}
        >
          正在从 prompts/keywordAgent.md 加载...
        </div>
      )}
    </>
  )
}
