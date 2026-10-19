import { useNodeStore } from '#/store/node'
import type { NSkill, NSkillData } from '#/types'
import type { NodeProps } from '@xyflow/react'
import { SkillSelect } from '#/components/select'
import { useGlobalStore } from '#/store/global'
import { DynEditKV } from './item'
import type { DynEditKVRow } from './item'
import { EditButton } from '#/components/button'

const d = (
  draft: NonNullable<ReturnType<typeof useNodeStore.getState>['currentNode']>,
) => draft.data as NSkillData

export const EditSkill = () => {
  const currentNode = useNodeStore(
    (state) => state.currentNode,
  ) as NodeProps<NSkill>
  const patchCurrentNode = useNodeStore((state) => state.patchCurrentNode)
  // 全流程统一使用全局本地工具（在执行面板顶部选择），用于加载该工具的本机技能
  const globalTool = useGlobalStore((state) => state.tool)

  const skillId = currentNode.data.skillId || ''

  const rows: DynEditKVRow[] = [
    {
      key: 'skill',
      label: '选择技能',
      value: skillId,
      valueRender: (onChange) => (
        <SkillSelect
          style={{ width: '100%' }}
          placeholder="选择技能..."
          tool={globalTool || undefined}
          value={currentNode.data.skillId || undefined}
          onChange={(value, skill) => {
            patchCurrentNode((draft) => {
              const data = d(draft)
              data.skillId = value || ''
              data.skillName = skill?.name || ''
            })
            onChange(value)
          }}
        />
      ),
      actionRender: (
        <div style={{ display: 'flex', gap: 2 }}>
          <EditButton.To url={`workflows/skills/${skillId}/skill.md`} isEdit />
        </div>
      ),
    },
  ]

  return <DynEditKV rows={rows} onChange={() => {}} />
}
