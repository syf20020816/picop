import { useGlobalStore } from '#/store/global'
import { useNodeStore } from '#/store/node'
import { Panel } from '@xyflow/react'
import type { PanelProps } from '@xyflow/react'
import { Checkbox, Tooltip } from 'antd'
import { SPEC_STEPS } from '#/constants/spec'
import styles from '../index.module.scss'
import { PanelLeftClose, PanelRightClose } from 'lucide-react'

/**
 * Spec 阶段标记总览面板（Spec 模式下显示在画布左侧）。
 * 汇总当前工作流中所有节点已标记的阶段，必选项以 * 标注，并提示缺失的必选项。
 * 标记仅用于编排验证，不产出任何 spec 文件。
 */
/** 普通模式下的占位空数组：模块级常量保证引用稳定。
 * 选择器若每次返回新 []，useSyncExternalStore 会判定状态变化 → 无限重渲染
 * （Maximum update depth exceeded）。 */
const EMPTY_NODES: ReturnType<typeof useNodeStore.getState>['nodes'] = []

export const StepLinePanel = (props: PanelProps) => {
  const globalMode = useGlobalStore((state) => state.globalMode)
  // 仅 Spec 模式才订阅 nodes：普通模式下返回常量空数组，拖拽不触发重渲染
  const nodes = useNodeStore((state) =>
    globalMode === 'spec' ? state.nodes : EMPTY_NODES,
  )
  const isOpen = useGlobalStore((state) => state.isStepMenuOpen)
  const setIsOpen = useGlobalStore((state) => state.setIsStepMenuOpen)

  if (globalMode !== 'spec') {
    return null
  }

  // 汇总所有已标记的 step（去重，按 SPEC_STEPS 定义顺序展示）
  const marked = new Set<string>()
  for (const n of nodes) {
    const s = (n.data as { specStep?: string } | undefined)?.specStep
    if (s) marked.add(s)
  }

  const markedList = SPEC_STEPS.filter((s) => marked.has(s.key))

  return (
    <Panel {...props}>
      <div
        className={`${styles.stepLine} ${!isOpen && styles.stepLine_startCenter}`}
        style={{
          width: isOpen ? '140px' : '32px',
          padding: isOpen ? '12px' : '12px 0',
        }}
      >
        <div
          className={`${styles.stepLine_title} ${!isOpen && styles.stepLine_center}`}
        >
          {isOpen ? (
            <>
              Spec 阶段标记{' '}
              <PanelLeftClose
                style={{ cursor: 'pointer' }}
                height={16}
                onClick={() => setIsOpen(!isOpen)}
              >
                {' '}
              </PanelLeftClose>
            </>
          ) : (
            <PanelRightClose
              style={{ cursor: 'pointer' }}
              height={16}
              width={16}
              onClick={() => setIsOpen(!isOpen)}
            >
              {' '}
            </PanelRightClose>
          )}
        </div>
        {markedList.length >= 1 && (
          <Checkbox.Group
            disabled
            className={styles.stepLine_group}
            value={markedList.map((s) => s.key)}
          >
            {markedList.map((s) => (
              <Tooltip title={!isOpen ? s.label : ''} placement="right">
                <Checkbox key={s.key} value={s.key}>
                  {isOpen ? (s.required ? `*${s.label}` : s.label) : ''}
                </Checkbox>
              </Tooltip>
            ))}
          </Checkbox.Group>
        )}
      </div>
    </Panel>
  )
}
