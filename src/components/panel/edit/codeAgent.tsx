import { useNodeStore } from '#/store/node'
import type { NCodeAgent, NCodeAgentData } from '#/types'
import type { NodeProps } from '@xyflow/react'
import { Select, Typography } from 'antd'
import { DynEditKV, DynEditKey } from './item'
import type { DynEditKVRow } from './item'
const { Text } = Typography

const d = (
  draft: NonNullable<ReturnType<typeof useNodeStore.getState>['currentNode']>,
) => draft.data as NCodeAgentData

export const EditCodeAgent = () => {
  const currentNode = useNodeStore(
    (state) => state.currentNode,
  ) as NodeProps<NCodeAgent>
  const patchCurrentNode = useNodeStore((state) => state.patchCurrentNode)

  const mode = currentNode.data.mode ?? 'analyze'

  const rows: DynEditKVRow[] = [
    {
      key: 'projectPath',
      label: '项目路径',
      value: currentNode.data.projectPath,
      placeholder: '如：/Users/xxx/project 或 ./src',
    },
    {
      key: 'branch',
      label: 'Git 分支',
      value: currentNode.data.branch,
      placeholder: '留空使用当前分支，如：main、develop',
    },
    {
      key: 'appMapPath',
      label: (
        <DynEditKey
          title="应用地图"
          info={'应用映射表（App-Desc）文件路径，由使用者自行生成；留空则不使用'}
        />
      ),
      value: currentNode.data.appMapPath,
      placeholder: '如：app-desc.json（相对项目根目录）或绝对路径',
    },
    {
      key: 'instruction',
      label: mode === 'batch' ? '编码指令' : '分析指令',
      value: currentNode.data.instruction,
      placeholder:
        mode === 'batch'
          ? '如：保持现有代码风格，不引入新依赖'
          : '如：请分析这个项目的结构和功能',
      inputType: 'textArea',
      rows: 3,
    },
    {
      key: 'maxIterations',
      label: '最大迭代次数',
      value: currentNode.data.maxIterations ?? 20,
      inputType: 'number',
      min: 1,
      max: 100,
    },
  ]

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {mode === 'batch'
            ? '按上游「任务拆解」产出的 tasks.md 逐批实现代码：每批完成后任务打勾（可续跑）、diff 记录到 session/。'
            : 'AI 将通过 Tool Calling 自主探索和分析项目代码。只需配置项目路径和分析目标，AI 会自主决定查看哪些文件。'}
        </Text>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ fontSize: 11, marginRight: 8 }}>
          执行模式
        </Text>
        <Select
          style={{ width: '100%' }}
          value={mode}
          options={[
            {
              value: 'analyze',
              label: 'analyze · 代码分析（只读探索，产出技术方案）',
            },
            {
              value: 'batch',
              label: 'batch · 分批编码（按 tasks.md 批次写代码）',
            },
          ]}
          onChange={(value) => {
            patchCurrentNode((draft) => {
              d(draft).mode = value
            })
          }}
        />
      </div>

      <DynEditKV
        rows={rows}
        onChange={(key, value) => {
          patchCurrentNode((draft) => {
            const data = d(draft)
            if (key === 'projectPath') {
              data.projectPath = value || ''
            } else if (key === 'branch') {
              data.branch = (value || '') as string
            } else if (key === 'instruction') {
              data.instruction = (value || '') as string
            } else if (key === 'maxIterations') {
              data.maxIterations = typeof value === 'number' ? value : 20
            } else if (key === 'appMapPath') {
              data.appMapPath = (value || '') as string
            }
          })
        }}
      />
    </>
  )
}
