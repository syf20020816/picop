import { useNodeStore } from '#/store/node'
import type { NUserInput } from '#/types'
import type { NodeProps } from '@xyflow/react'
import { Typography } from 'antd'
import { useState } from 'react'
import { SkillSelect } from '#/components/select'
import { PicopSender } from '#/components/picop-sender'
import { useGlobalStore } from '#/store/global'

const { Text } = Typography

export const EditUserInput = () => {
  const currentNode = useNodeStore(
    (state) => state.currentNode,
  ) as NodeProps<NUserInput>
  const patchCurrentNode = useNodeStore((state) => state.patchCurrentNode)
  const syncSkillForCurrent = useNodeStore((state) => state.syncSkillForCurrent)
  // 全流程统一本地工具（在执行面板顶部选择）
  const tool = useGlobalStore((state) => state.tool)

  const input = currentNode.data.input || {}
  const [prompt, setPrompt] = useState(input.prompt || '')
  const [skillId, setSkillId] = useState<string | undefined>(input.skillId)
  const [skillName, setSkillName] = useState<string | undefined>(input.skillName)

  /** 技能统一变更入口：同步 SkillSelect/PicopSender 与输入节点数据，并创建/更新相连 SKILL 节点 */
  const applySkill = (value: string | undefined, name?: string) => {
    setSkillId(value)
    setSkillName(name)
    patchCurrentNode((draft) => {
      const data = draft.data as NUserInput['data']
      data.input ??= {}
      data.input.skillId = value
      data.input.skillName = value ? name : undefined
    })
    syncSkillForCurrent({ id: value, name })
  }

  const handlePromptChange = (v: string) => {
    setPrompt(v)
    patchCurrentNode((draft) => {
      const data = draft.data as NUserInput['data']
      data.input ??= {}
      data.input.prompt = v
    })
  }

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 11 }}>
          输入节点的提示词作为下游的初始上下文。可使用{' '}
          <Text code style={{ fontSize: 11 }}> / 技能名</Text>{' '}
          快速选择技能，选中后会自动生成并连接一个 SKILL 节点。
        </Text>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13 }}>
          选择技能
        </Text>
        <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
          （可选）
        </Text>
        <div style={{ marginTop: 4 }}>
          <SkillSelect
            style={{ width: '100%' }}
            tool={tool || undefined}
            placeholder="选择技能（生成关联 SKILL 节点）..."
            value={skillId || undefined}
            onChange={(value, skill) => applySkill(value, skill?.name)}
          />
        </div>
      </div>

      <Text strong style={{ fontSize: 13 }}>
        提示词
      </Text>
      <div style={{ marginTop: 4 }}>
        <PicopSender
          value={prompt}
          onChange={handlePromptChange}
          skillId={skillId}
          skillName={skillName}
          onSkillChange={applySkill}
          tool={tool || undefined}
          placeholder="输入提示词，如：帮我用 TypeScript 实现一个去重函数..."
        />
      </div>
    </>
  )
}