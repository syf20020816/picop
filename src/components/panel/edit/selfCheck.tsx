import { useNodeStore } from '#/store/node'
import { useBmadAgentStore } from '#/store/bmad'
import type { NSelfCheck, NSelfCheckData } from '#/types'
import type { NodeProps } from '@xyflow/react'
import { Select, Typography } from 'antd'
import { DynEditKV } from './item'
import type { DynEditKVRow } from './item'
import { useEffect } from 'react'

const { Text } = Typography

const d = (
  draft: NonNullable<ReturnType<typeof useNodeStore.getState>['currentNode']>,
) => draft.data as NSelfCheckData

export const EditSelfCheck = () => {
  const currentNode = useNodeStore(
    (state) => state.currentNode,
  ) as NodeProps<NSelfCheck>
  const patchCurrentNode = useNodeStore((state) => state.patchCurrentNode)

  const agents = useBmadAgentStore((state) => state.agents)
  const fetchAgents = useBmadAgentStore((state) => state.fetchAgents)

  useEffect(() => {
    fetchAgents()
  }, [])

  const rows: DynEditKVRow[] = [
    {
      key: 'role',
      label: '视角 (BMad)',
      valueRender: (onChange) => (
        <Select
          style={{ width: '100%' }}
          placeholder="选择评审视角角色（可选）"
          allowClear
          value={currentNode.data.role || undefined}
          options={agents.map((a) => ({
            label: `${a.icon || '🤖'} ${a.title} (${a.name})`,
            value: a.title,
          }))}
          onChange={(val) => {
            const agent = val ? agents.find((a) => a.title === val) : null
            patchCurrentNode((draft) => {
              const data = d(draft)
              data.role = val || undefined
              data.roleDesc = agent?.skillContent || agent?.description || undefined
            })
            onChange(val)
          }}
        />
      ),
    },
    {
      key: 'projectPath',
      label: '项目路径',
      value: currentNode.data.projectPath || '',
      placeholder: '项目绝对路径（用于读取 git diff，可选）',
    },
    {
      key: 'instruction',
      label: '评审指令',
      value: currentNode.data.instruction || '',
      inputType: 'textArea',
      rows: 4,
      placeholder: '可选，补充本次自检的关注点（追加到评审材料之后）',
    },
  ]

  return (
    <div>
      <DynEditKV
        rows={rows}
        onChange={(key, value) => {
          patchCurrentNode((draft) => {
            const data = d(draft)
            if (key === 'projectPath') data.projectPath = (value || '') as string
            else if (key === 'instruction') data.instruction = (value || '') as string
            // model 与 role 的变更已在 valueRender 中处理
          })
        }}
      />
      <div
        style={{
          fontSize: 11,
          color: '#888',
          marginTop: 12,
          padding: '8px 12px',
          background: 'var(--xy-node-selected)',
          borderRadius: 4,
        }}
      >
        <Text type="secondary">
          自检节点以所选 BMad 角色的身份对交付物做独立评审（不继承编码 Agent 的记忆）。
          BMad 自带视角，一个节点一个角色；需要多视角检验时创建多个自检节点即可。
        </Text>
      </div>
    </div>
  )
}
