import { useNodeStore } from '#/store/node'
import { NodeTypes } from '#/types'
import type { AppNode } from '#/types'
import { NodeIcons } from '../svg'
import styles from './index.module.scss'
import {
  Button,
  Divider,
  Input,
  Tabs,
  Typography,
  Modal,
  Select,
  message,
} from 'antd'
import type { TabsProps } from 'antd'
import { EditUserInput } from './edit/userInput'
import { EditAgent } from './edit/aiAgent'
import { EditAnswer } from './edit/aiAnswer'
import { EditAIOutput } from './edit/aiOutput'
import { EditBMADAgent } from './edit/bmad'
import { EditLark } from './edit/lark'
import { EditIf } from './edit/if'
import { EditIfCondition } from './edit/ifCondition'
import { EditLoop } from './edit/loop'
import { EditLoopCondition } from './edit/loopCondition'
import { EditRetry } from './edit/retry'
import { EditMemory } from './edit/memory'
import { EditSkill } from './edit/skill'
import { EditCodeAgent } from './edit/codeAgent'
import { EditLarkTemplate } from './edit/larkTemplate'
import { EditKnowledgeRetrieval } from './edit/knowledgeRetrieval'
import { EditKeywordAgent } from './edit/keywordAgent'
import { EditTaskPlanner } from './edit/taskPlanner'
import { EditSelfCheck } from './edit/selfCheck'
import { ExecutionPanel } from '../execution/panel'
import { OutputPanel } from '../execution/output'
import { useMemo, useState } from 'react'
import { ExecutionResult } from '../execution/result'
import { ExecutionHistory } from '../execution/history'
import { Expand, Pin, Shrink } from 'lucide-react'
import { Panel } from '@xyflow/react'
import type { PanelProps } from '@xyflow/react'
import { useRouteStore } from '#/store/route'

const { Text } = Typography

type ActiveKey = 'editor' | 'execution' | 'history'

export const EditPanel = (props: PanelProps) => {
  // const [isShrink, setIsShrink] = useState(false)
  const isShrink = useRouteStore((state) => state.shrink)
  const setIsShrink = useRouteStore((state) => state.setShrink)
  const currentNode: AppNode = useNodeStore((state) => state.currentNode)
  const deleteCurrentNode = useNodeStore((state) => state.deleteCurrentNode)
  const loadPinnedNode = useNodeStore((state) => state.loadPinnedNode)
  const deletePinnedFile = useNodeStore((state) => state.deletePinnedFile)
  const workflowId = useNodeStore((state) => state.workflowId)
  const [activeKey, setActiveKey] = useState<ActiveKey>('editor')
  const [loadOpen, setLoadOpen] = useState(false)
  const [pinnedList, setPinnedList] = useState<
    {
      nodeType: string
      nodeId: string
      title: string
      savedAt: string
      workflowId: string
    }[]
  >([])
  const [selectedPin, setSelectedPin] = useState<string | null>(null)

  // PIN 选项唯一 key（跨工作流可能存在相同 nodeId，需带工作流区分）
  const pinKey = (p: { workflowId: string; nodeId: string }) =>
    `${p.workflowId || 'legacy'}::${p.nodeId}`

  // 过滤当前节点类型 + 排序：当前工作流的 PIN 排前面，其余排后面（均按保存时间倒序）
  const filterSortedPins = (list: typeof pinnedList) =>
    list
      .filter((p) => p.nodeType === currentNode?.type)
      .sort((a, b) => {
        const aCur = a.workflowId === workflowId ? 0 : 1
        const bCur = b.workflowId === workflowId ? 0 : 1
        if (aCur !== bCur) return aCur - bCur
        return (b.savedAt || '').localeCompare(a.savedAt || '')
      })

  // 固定选项：value 用「工作流::nodeId」唯一标识；label 标注所属工作流
  const pinOptions = useMemo(() => {
    const counts = pinnedList.reduce<Record<string, number>>((acc, p) => {
      acc[p.nodeType] = (acc[p.nodeType] || 0) + 1
      return acc
    }, {})
    return pinnedList.map((p) => {
      const isCurrent = p.workflowId === workflowId
      const owner = isCurrent ? '当前工作流' : p.workflowId || '旧数据'
      return {
        value: pinKey(p),
        label: `[${owner}] ${p.title}（${p.nodeType}${
          counts[p.nodeType] > 1 ? ' · ' + p.nodeId.slice(0, 8) : ''
        }）`,
      }
    })
  }, [pinnedList, workflowId])

  const items: TabsProps['items'] = [
    {
      key: 'editor',
      label: '编辑',
      children: (
        <div className={styles.editor}>
          {currentNode && (
            <>
              <EditHeader />
              <Divider style={{ margin: '12px 0' }} />
              <main className={styles.editor_main}>
                {currentNode.type === NodeTypes.USER_INPUT && <EditUserInput />}
                {currentNode.type === NodeTypes.AGENT && <EditAgent />}
                {currentNode.type === NodeTypes.ANSWER && <EditAnswer />}
                {currentNode.type === NodeTypes.AI_OUTPUT && <EditAIOutput />}
                {currentNode.type === NodeTypes.BMAD_AGENT && <EditBMADAgent />}
                {currentNode.type === NodeTypes.LARK && <EditLark />}
                {currentNode.type === NodeTypes.IF && <EditIf />}
                {currentNode.type === NodeTypes.IF_CONDITION && (
                  <EditIfCondition />
                )}
                {currentNode.type === NodeTypes.LOOP && <EditLoop />}
                {currentNode.type === NodeTypes.LOOP_CONDITION && (
                  <EditLoopCondition />
                )}
                {currentNode.type === NodeTypes.RETRY && <EditRetry />}
                {currentNode.type === NodeTypes.CODE_AGENT && <EditCodeAgent />}
                {currentNode.type === NodeTypes.MEMORY && <EditMemory />}
                {currentNode.type === NodeTypes.SKILL && <EditSkill />}
                {currentNode.type === NodeTypes.LARK_TEMPLATE && (
                  <EditLarkTemplate />
                )}
                {currentNode.type === NodeTypes.KNOWLEDGE_RETRIEVAL && (
                  <EditKnowledgeRetrieval />
                )}
                {currentNode.type === NodeTypes.KEYWORD_AGENT && (
                  <EditKeywordAgent />
                )}
                {currentNode.type === NodeTypes.TASK_PLANNER && (
                  <EditTaskPlanner />
                )}
                {currentNode.type === NodeTypes.SELF_CHECK && (
                  <EditSelfCheck />
                )}
              </main>
              {isShrink && (
                <footer className={styles.footer}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button
                      icon={<Pin size={14} />}
                      block
                      onClick={async () => {
                        const res = await fetch('/api/workflow/pin')
                        const json = await res.json()
                        if (json.status === 'success' && json.data.length > 0) {
                          // 只展示与当前节点类型相同的固定数据（当前工作流优先排序）
                          const sameType = filterSortedPins(json.data)
                          if (sameType.length > 0) {
                            setPinnedList(sameType)
                            setSelectedPin(null)
                            setLoadOpen(true)
                          } else {
                            message.info(
                              `当前节点类型（${currentNode.type}）暂无固定数据`,
                            )
                          }
                        } else {
                          message.info(
                            '没有已固定的节点数据，请先执行节点并点击 PIN 按钮',
                          )
                        }
                      }}
                    >
                      加载固定
                    </Button>
                    <Button
                      color="danger"
                      variant="outlined"
                      block
                      onClick={() => {
                        deleteCurrentNode()
                      }}
                    >
                      删除
                    </Button>
                  </div>
                  <Modal
                    title="加载固定节点"
                    open={loadOpen}
                    onCancel={() => setLoadOpen(false)}
                    onOk={async () => {
                      if (!selectedPin) {
                        message.warning('请选择一个固定节点')
                        return
                      }
                      const pin = pinnedList.find(
                        (p) => pinKey(p) === selectedPin,
                      )
                      if (!pin) {
                        message.error('固定节点不存在')
                        return
                      }
                      const params = new URLSearchParams({
                        nodeType: pin.nodeType,
                      })
                      params.set('nodeId', pin.nodeId)
                      if (pin.workflowId) params.set('workflowId', pin.workflowId)
                      const res = await fetch(
                        `/api/workflow/pin?${params.toString()}`,
                      )
                      const json = await res.json()
                      if (json.status === 'success') {
                        loadPinnedNode(currentNode.id, json.data)
                        message.success(
                          `已加载固定节点: ${json.data.title || pin.nodeType}`,
                        )
                        setLoadOpen(false)
                      } else {
                        message.error('加载失败')
                      }
                    }}
                  >
                    <Select
                      style={{ width: '100%' }}
                      placeholder="选择要加载的固定节点"
                      value={selectedPin}
                      onChange={setSelectedPin}
                      options={pinOptions}
                    />
                    {selectedPin && (
                      <Button
                        color="danger"
                        variant="link"
                        size="small"
                        style={{ marginTop: 8, padding: 0 }}
                        onClick={async () => {
                          const pin = pinnedList.find(
                            (p) => pinKey(p) === selectedPin,
                          )
                          if (!pin) return
                          await deletePinnedFile(
                            pin.nodeType,
                            pin.nodeId,
                            pin.workflowId,
                          )
                          message.success(`已删除固定文件: ${pin.title}`)
                          // 刷新列表
                          const res = await fetch('/api/workflow/pin')
                          const json = await res.json()
                          if (json.status === 'success') {
                            const sameType = filterSortedPins(json.data)
                            setPinnedList(sameType)
                            if (sameType.length === 0) {
                              setLoadOpen(false)
                            } else {
                              setSelectedPin(null)
                            }
                          }
                        }}
                      >
                        删除该固定文件（不可恢复）
                      </Button>
                    )}
                  </Modal>
                </footer>
              )}
            </>
          )}
        </div>
      ),
    },
    {
      key: 'output',
      label: '输出',
      children: <OutputPanel />,
    },
    {
      key: 'result',
      label: '执行结果',
      children: <ExecutionResult />,
    },
    {
      key: 'history',
      label: '执行历史',
      children: <ExecutionHistory size="small" workflowId={workflowId} />,
    },
  ]

  return (
    <Panel {...props}>
      <ExecutionPanel />
      <div
        className={styles.panel}
        style={{
          height: isShrink ? 'calc(100vh - 120px)' : '48px',
        }}
      >
        <Tabs
          activeKey={activeKey}
          items={items}
          onChange={(k) => setActiveKey(k as ActiveKey)}
          styles={{
            body: { height: '100%', padding: 0 },
            content: { height: '100%' },
            root: { height: '100%' },
          }}
          tabBarExtraContent={
            <Button
              onClick={() => setIsShrink(!isShrink)}
              type="text"
              icon={
                isShrink ? (
                  <Expand height={16} width={16}></Expand>
                ) : (
                  <Shrink height={16} width={16}></Shrink>
                )
              }
            ></Button>
          }
        />
      </div>
    </Panel>
  )
}

const EditHeader = () => {
  const currentNode: AppNode = useNodeStore((state) => state.currentNode)
  const setCurrentNode = useNodeStore((state) => state.setCurrentNode)
  const IconComponent = useMemo(() => {
    if (!currentNode) return null
    return (
      NodeIcons.get(currentNode.type) || NodeIcons.get(NodeTypes.USER_INPUT)
    )
  }, [currentNode])
  if (!currentNode) {
    return null
  }

  return (
    <header className={styles.header}>
      <div className={styles.header_title}>
        {IconComponent && (
          <IconComponent height={24} width={24}></IconComponent>
        )}
        <Input
          value={currentNode.data.title}
          className={styles.header_title_input}
          onChange={(e) => {
            setCurrentNode({
              ...currentNode,
              data: {
                ...currentNode.data,
                title: e.target.value,
              },
            })
          }}
        ></Input>
      </div>
      <div className={styles.line}>
        <Text>描述</Text>
        <Input
          className={styles.description_input}
          value={currentNode.data.description}
          onChange={(e) => {
            setCurrentNode({
              ...currentNode,
              data: {
                ...currentNode.data,
                description: e.target.value,
              },
            })
          }}
        ></Input>
      </div>
    </header>
  )
}
