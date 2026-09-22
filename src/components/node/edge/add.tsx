import { Button, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import styles from '../index.module.scss'
import { CirclePlus } from 'lucide-react'
import { NodeTypes } from '#/types'
import type { NodeType, AppNode } from '#/types'
import { NodeHeader } from '../header'
import { useNodeStore } from '#/store/node'
import { NodeBuilder } from '#/types/builder'
import type { ReactNode } from 'react'

export interface AddNodeBtnProps {
  kind?: NodeType
  children?: ReactNode
  trigger?: ('click' | 'contextMenu' | 'hover')[]
}

const isDisabledNode = (parent: NodeType | undefined, child: NodeType) => {
  if (!parent) {
    return false
  }
  // // 用户输入节点只能连接 智能体节点
  // if (parent === NodeTypes.USER_INPUT) {
  //   return child !== NodeTypes.AGENT
  // }
  // 智能体节点不能连接 自身
  if (parent === NodeTypes.AGENT) {
    return child === NodeTypes.AGENT
  }

  // codeNode 必须连接在 AgentNode 或 BMadNode 之后
  // if (child === NodeTypes.CODE) {
  //   return parent === NodeTypes.AGENT || parent === NodeTypes.BMAD_AGENT || parent === NodeTypes.USER_INPUT
  // }

  // ifConditionNode 只能跟在 ifNode 之后
  if (child === NodeTypes.IF_CONDITION) {
    return parent !== NodeTypes.IF
  }

  // loopConditionNode 只能跟在 loopNode 之后
  if (child === NodeTypes.LOOP_CONDITION) {
    return parent !== NodeTypes.LOOP
  }

  return false
}

export const AddNodeBtn = ({
  kind,
  children,
  trigger = ['click'],
}: AddNodeBtnProps) => {
  const currentNode = useNodeStore((state) => state.currentNode)
  const addConnectNode = useNodeStore((state) => state.addConnectNode)
  const addUnConnectNode = useNodeStore((state) => state.addUnConnectNode)
  const addPos = useNodeStore((state) => state.addPos)
  const clearAddPos = useNodeStore((state) => state.clearAddPos)

  const addNode = (builderFn: (pos: { x: number; y: number }) => AppNode) => {
    // 右键空白画布创建的节点落在右键位置；否则锚定当前节点（或 0,0）
    const pos = addPos
      ? { x: addPos.x, y: addPos.y }
      : currentNode
        ? {
            x: currentNode.positionAbsoluteX,
            y: currentNode.positionAbsoluteY,
          }
        : { x: 0, y: 0 }
    const node = builderFn(pos)

    if (!node) {
      return
    }

    if (addPos) {
      clearAddPos()
    }

    if (!kind) {
      addUnConnectNode(node)
    } else {
      addConnectNode(node)
    }
  }

  const menuItems: MenuProps['items'] = [
    {
      key: 'input',
      label: '输入节点',
      type: 'group',
      children: [
        {
          label: <NodeHeader kind={NodeTypes.USER_INPUT} title="输入节点" />,
          key: NodeTypes.USER_INPUT,
          disabled: isDisabledNode(kind, NodeTypes.USER_INPUT),
          onClick: () => addNode(NodeBuilder.userInput),
        },
        {
          label: <NodeHeader kind={NodeTypes.ANSWER} title="回答节点" />,
          key: NodeTypes.ANSWER,
          disabled: isDisabledNode(kind, NodeTypes.ANSWER),
          onClick: () => addNode(NodeBuilder.answer),
        },
        {
          label: <NodeHeader kind={NodeTypes.MEMORY} title="记忆节点" />,
          key: NodeTypes.MEMORY,
          disabled: isDisabledNode(kind, NodeTypes.MEMORY),
          onClick: () => addNode(NodeBuilder.memory),
        },
        {
          label: <NodeHeader kind={NodeTypes.SKILL} title="Skill节点" />,
          key: NodeTypes.SKILL,
          disabled: isDisabledNode(kind, NodeTypes.SKILL),
          onClick: () => addNode(NodeBuilder.skill),
        },
        {
          label: (
            <NodeHeader kind={NodeTypes.BMAD_AGENT} title="BMad角色节点" />
          ),
          key: NodeTypes.BMAD_AGENT,
          disabled: isDisabledNode(kind, NodeTypes.BMAD_AGENT),
          onClick: () => addNode(NodeBuilder.bmadAgent),
        },
      ],
    },
    {
      key: 'plugin',
      label: '插件节点',
      type: 'group',
      children: [
        {
          label: <NodeHeader kind={NodeTypes.LARK} title="Lark文档节点" />,
          key: NodeTypes.LARK,
          disabled: isDisabledNode(kind, NodeTypes.LARK),
          onClick: () => addNode(NodeBuilder.lark),
        },
        {
          label: (
            <NodeHeader kind={NodeTypes.LARK_TEMPLATE} title="Lark模板节点" />
          ),
          key: NodeTypes.LARK_TEMPLATE,
          disabled: isDisabledNode(kind, NodeTypes.LARK_TEMPLATE),
          onClick: () => addNode(NodeBuilder.larkTemplate),
        },
        {
          label: (
            <NodeHeader
              kind={NodeTypes.KNOWLEDGE_RETRIEVAL}
              title="知识库检索节点"
            />
          ),
          key: NodeTypes.KNOWLEDGE_RETRIEVAL,
          disabled: isDisabledNode(kind, NodeTypes.KNOWLEDGE_RETRIEVAL),
          onClick: () => addNode(NodeBuilder.knowledgeRetrieval),
        },
      ],
    },
    {
      key: 'process',
      label: '智能体节点',
      type: 'group',
      children: [
        {
          label: <NodeHeader kind={NodeTypes.AGENT} title="智能体节点" />,
          key: NodeTypes.AGENT,
          disabled: isDisabledNode(kind, NodeTypes.AGENT),
          onClick: () => addNode(NodeBuilder.agent),
        },
        {
          label: (
            <NodeHeader kind={NodeTypes.CODE_AGENT} title="代码处理节点" />
          ),
          key: NodeTypes.CODE_AGENT,
          disabled: isDisabledNode(kind, NodeTypes.CODE_AGENT),
          onClick: () => addNode(NodeBuilder.codeAgent),
        },
        {
          label: (
            <NodeHeader kind={NodeTypes.KEYWORD_AGENT} title="关键词提取节点" />
          ),
          key: NodeTypes.KEYWORD_AGENT,
          disabled: isDisabledNode(kind, NodeTypes.KEYWORD_AGENT),
          onClick: () => addNode(NodeBuilder.keywordAgent),
        },
        {
          label: (
            <NodeHeader kind={NodeTypes.TASK_PLANNER} title="任务拆解节点" />
          ),
          key: NodeTypes.TASK_PLANNER,
          disabled: isDisabledNode(kind, NodeTypes.TASK_PLANNER),
          onClick: () => addNode(NodeBuilder.taskPlanner),
        },
        {
          label: (
            <NodeHeader kind={NodeTypes.SELF_CHECK} title="自检Agent节点" />
          ),
          key: NodeTypes.SELF_CHECK,
          disabled: isDisabledNode(kind, NodeTypes.SELF_CHECK),
          onClick: () => addNode(NodeBuilder.selfCheck),
        },
      ],
    },
    {
      key: 'output',
      label: '输出节点',
      type: 'group',
      children: [
        {
          label: <NodeHeader kind={NodeTypes.AI_OUTPUT} title="AI输出节点" />,
          key: NodeTypes.AI_OUTPUT,
          disabled: isDisabledNode(kind, NodeTypes.AI_OUTPUT),
          onClick: () => addNode(NodeBuilder.aiOutput),
        },
      ],
    },

    {
      key: 'control',
      label: '控制节点',
      children: [
        {
          label: <NodeHeader kind={NodeTypes.IF} title="判断节点" />,
          key: NodeTypes.IF,
          disabled: isDisabledNode(kind, NodeTypes.IF),
          onClick: () => addNode(NodeBuilder.ifNode),
        },
        {
          label: (
            <NodeHeader kind={NodeTypes.IF_CONDITION} title="条件分支节点" />
          ),
          key: NodeTypes.IF_CONDITION,
          disabled: isDisabledNode(kind, NodeTypes.IF_CONDITION),
          onClick: () => addNode(NodeBuilder.ifCondition),
        },
        {
          label: <NodeHeader kind={NodeTypes.LOOP} title="循环节点" />,
          key: NodeTypes.LOOP,
          disabled: isDisabledNode(kind, NodeTypes.LOOP),
          onClick: () => addNode(NodeBuilder.loop),
        },
        {
          label: (
            <NodeHeader kind={NodeTypes.LOOP_CONDITION} title="循环条件节点" />
          ),
          key: NodeTypes.LOOP_CONDITION,
          disabled: isDisabledNode(kind, NodeTypes.LOOP_CONDITION),
          onClick: () => addNode(NodeBuilder.loopCondition),
        },
        {
          label: <NodeHeader kind={NodeTypes.RETRY} title="重试节点" />,
          key: NodeTypes.RETRY,
          disabled: isDisabledNode(kind, NodeTypes.RETRY),
          onClick: () => addNode(NodeBuilder.retry),
        },
      ],
    },
  ]

  return (
    <Dropdown menu={{ items: menuItems }} trigger={trigger}>
      {children ?? (
        <Button
          type="primary"
          size="small"
          className={styles.add_button}
          styles={{
            root: {
              height: 12,
              width: 12,
              padding: 0,
            },
          }}
        >
          <CirclePlus size={8}></CirclePlus>
        </Button>
      )}
    </Dropdown>
  )
}
