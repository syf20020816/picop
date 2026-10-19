import { useGlobalStore } from '#/store/global'
import { useNodeStore } from '#/store/node'
import { Check, Footprints } from 'lucide-react'
import { useState } from 'react'
import { SPEC_STEPS } from '#/constants/spec'
import type { SpecStepKey } from '#/constants/spec'
import { Button } from 'antd'
import styles from '../index.module.scss'

/**
 * 阶段标记按钮，用于在 Spec 模式下标记当前节点的输出属于工作流的哪个阶段。
 * 平台本身不产出 spec 文件，标记仅用于编排验证与导出 workflow.yml 时携带阶段信息，
 * 最终由 openspec / speckit 等 spec 框架生成 specs/ 目录。
 *
 * 注意：这里刻意不用 antd 的 Tooltip/Dropdown——它们的 hover/对齐触发器（onMouseEnter ->
 * setMousePos）在节点被 React Flow 拖动、每帧重渲染时会与 setNodes 叠加成
 * "Maximum update depth exceeded" 无限循环。本组件用原生 button + 自绘菜单实现，
 * 所有事件 stopPropagation（既防止冒泡覆盖 specStep，也防止在按钮上按下触发节点拖拽）。
 */
export const StepMarkNode = ({
  node,
}: {
  node: { id: string; data?: { specStep?: string } }
}) => {
  const globalMode = useGlobalStore((state) => state.globalMode)
  // 只订阅本节点的 specStep 原始值：拖动任意节点时 nodes 数组每帧生成新引用，
  // 但这里返回的字符串不变，避免每个节点每帧重渲染；setNodes 通过 getState 取，
  // 同样不建立订阅。
  const current = useNodeStore(
    (state) => state.nodes.find((n) => n.id === node.id)?.data?.specStep,
  ) as string | undefined
  const [open, setOpen] = useState(false)

  if (globalMode !== 'spec') {
    return null
  }

  const select = (key: string) => {
    const next = key === current ? undefined : (key as SpecStepKey)
    const { nodes, setNodes } = useNodeStore.getState()
    const updated = nodes.map((n) =>
      n.id === node.id ? { ...n, data: { ...n.data, specStep: next } } : n,
    )
    setNodes(updated)
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <Button
        size="small"
        color={current ? 'green' : 'red'}
        variant={'solid'}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        styles={{
          root: {
            height: 12,
            width: 12,
            padding: 0,
          },
        }}
      >
        <Footprints height={8} width={8} />
      </Button>

      {open && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className={styles.step_mark_menu}
        >
          {SPEC_STEPS.map((s) => {
            const active = current === s.key
            return (
              <div
                key={s.key}
                onClick={(e) => {
                  e.stopPropagation()
                  select(s.key)
                }}
                className={styles.step_mark_item}
                style={{
                  color: active ? '#1677ff' : '#fff',
                  background: active ? 'rgba(22,119,255,0.08)' : 'transparent',
                }}
              >
                <span>{s.required ? `*${s.label}` : s.label}</span>
                {active && <Check size={8} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
