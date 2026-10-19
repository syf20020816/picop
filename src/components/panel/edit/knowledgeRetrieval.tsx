import { useNodeStore } from '#/store/node'
import type { NKnowledgeRetrieval, NKnowledgeRetrievalData } from '#/types'
import type { NodeProps } from '@xyflow/react'
import {
  Typography,
  Select,
  Space,
  Button,
  Input,
  Segmented,
  Tag,
  Tooltip,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  RobotOutlined,
  LinkOutlined,
} from '@ant-design/icons'
import { SkillSelect } from '#/components/select'
import { PicopSender } from '#/components/picop-sender'
import { useGlobalStore } from '#/store/global'

const { Text } = Typography

const d = (
  draft: NonNullable<ReturnType<typeof useNodeStore.getState>['currentNode']>,
) => draft.data as NKnowledgeRetrievalData

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']

export const EditKnowledgeRetrieval = () => {
  const currentNode = useNodeStore(
    (state) => state.currentNode,
  ) as NodeProps<NKnowledgeRetrieval>
  const patchCurrentNode = useNodeStore((state) => state.patchCurrentNode)
  // 全流程统一使用全局本地工具（在执行面板顶部选择），用于加载该工具访问知识库的 MCP / 本机技能
  const globalTool = useGlobalStore((state) => state.tool)

  const data = currentNode.data
  const mode = data.mode || 'local'
  const headers = data.headers || []

  /** 技能统一变更入口：SkillSelect 与 PicopSender 共享，写入节点的 skillId/skillName */
  const handleSkillChange = (value: string | undefined, name?: string) => {
    patchCurrentNode((draft) => {
      const dd = d(draft)
      dd.skillId = value || undefined
      dd.skillName = name
    })
  }

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Segmented
          block
          value={mode}
          options={[
            {
              label: (
                <Space size={4}>
                  <RobotOutlined />
                  本地
                </Space>
              ),
              value: 'local',
            },
            {
              label: (
                <Space size={4}>
                  <LinkOutlined />
                  远程 API
                </Space>
              ),
              value: 'api',
            },
          ]}
          onChange={(v) => {
            patchCurrentNode((draft) => {
              d(draft).mode = v as 'local' | 'api'
            })
          }}
        />
      </div>

      {mode === 'local' ? (
        <>
          <div style={{ marginBottom: 8 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              通过本机配置了 MCP
              的本地工具，用自然语言查询你自己维护的知识库（向量库 / 文档库 /
              关系库 / 本地 md 目录均可）。
            </Text>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '0 4px',
            }}
          >
            <div>
              <Text strong style={{ fontSize: 13 }}>
                查询文本
              </Text>
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                （留空则使用上游节点输出作为查询内容）
              </Text>
              <div style={{ marginTop: 4 }}>
                <PicopSender
                  value={data.query}
                  onChange={(v) => {
                    patchCurrentNode((draft) => {
                      d(draft).query = v
                    })
                  }}
                  skillId={data.skillId}
                  skillName={data.skillName}
                  onSkillChange={handleSkillChange}
                  tool={globalTool || undefined}
                  placeholder="输入查询内容，如：陶文的人数统计口径是什么？"
                />
              </div>
            </div>

            <div>
              <Text strong style={{ fontSize: 13 }}>
                选择技能
              </Text>
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                （可选）
              </Text>
              <SkillSelect
            style={{ width: '100%', marginTop: 4 }}
            placeholder="选择技能作为查询指令上下文..."
            tool={globalTool || undefined}
                value={data.skillId}
                onChange={(value, skill) => handleSkillChange(value, skill?.name)}
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{ marginBottom: 8 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              请求你自己配置的外部知识库接口（由平台后端代理发起，避免跨域限制）。请求体支持{' '}
              {'{{字段名}}'} 引用上游节点输出。
            </Text>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '0 4px',
            }}
          >
            <div>
              <Text strong style={{ fontSize: 13 }}>
                请求 URL
              </Text>
              <Input
                placeholder="https://your-knowledge-api.example.com/search"
                value={data.url}
                onChange={(e) => {
                  patchCurrentNode((draft) => {
                    d(draft).url = e.target.value
                  })
                }}
                style={{ marginTop: 4 }}
              />
            </div>

            <div>
              <Text strong style={{ fontSize: 13 }}>
                请求方法
              </Text>
              <Select
                style={{ width: '100%', marginTop: 4 }}
                value={data.method || 'GET'}
                options={METHODS.map((m) => ({ label: m, value: m }))}
                onChange={(v) => {
                  patchCurrentNode((draft) => {
                    d(draft).method = v
                  })
                }}
              />
            </div>

            {/* ===== 请求头 ===== */}
            <div>
              <Space style={{ marginBottom: 4 }}>
                <Text strong style={{ fontSize: 13 }}>
                  请求头
                </Text>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  （可选）
                </Text>
              </Space>
              {headers.map((h, i) => (
                <Space
                  key={i}
                  style={{ display: 'flex', marginBottom: 6 }}
                  align="center"
                >
                  <Input
                    placeholder="Header 名"
                    style={{ width: 130 }}
                    value={h.key}
                    onChange={(e) => {
                      const next = [...headers]
                      next[i] = { ...next[i], key: e.target.value }
                      patchCurrentNode((draft) => {
                        d(draft).headers = next
                      })
                    }}
                  />
                  <Input
                    placeholder="值（支持 {{字段}}）"
                    style={{ width: 150 }}
                    value={h.value}
                    onChange={(e) => {
                      const next = [...headers]
                      next[i] = { ...next[i], value: e.target.value }
                      patchCurrentNode((draft) => {
                        d(draft).headers = next
                      })
                    }}
                  />
                  <Tooltip title="删除">
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => {
                        patchCurrentNode((draft) => {
                          d(draft).headers = headers.filter((_, j) => j !== i)
                        })
                      }}
                    />
                  </Tooltip>
                </Space>
              ))}
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => {
                  patchCurrentNode((draft) => {
                    d(draft).headers = [...headers, { key: '', value: '' }]
                  })
                }}
              >
                添加请求头
              </Button>
            </div>

            {/* ===== 请求体 ===== */}
            <div>
              <Text strong style={{ fontSize: 13 }}>
                请求体
              </Text>
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                （JSON，支持 {'{{字段}}'} 占位符）
              </Text>
              <Input.TextArea
                rows={5}
                placeholder={'{\n  "query": "{{content}}",\n  "topK": 5\n}'}
                value={data.body}
                onChange={(e) => {
                  patchCurrentNode((draft) => {
                    d(draft).body = e.target.value
                  })
                }}
                style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 12 }}
              />
              <Tag style={{ marginTop: 6 }} color="blue">
                GET 请求时请求体自动忽略
              </Tag>
            </div>
          </div>
        </>
      )}

      {/* <Divider style={{ margin: '12px 0', fontSize: 12 }}>执行结果</Divider>
      {data.result?.retrievalContent ? (
        <div style={{ padding: '0 4px' }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {data.result.mode === 'api' ? '远程 API' : '本地工具'} 检索到{' '}
            {data.result.count} 条内容，共 {data.result.retrievalContent.length}{' '}
            字符
          </Text>
        </div>
      ) : (
        <Text type="secondary" style={{ fontSize: 11, padding: '0 4px' }}>
          执行后可在此查看检索结果概览
        </Text>
      )} */}
    </>
  )
}
