import { useNodeStore } from '#/store/node'
import { useGlobalStore } from '#/store/global'
import { ToolSelect } from '#/components/select'
import styles from './index.module.scss'
import { Button, Select, Tooltip } from 'antd'
import { Play, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

export const ExecutionPanel = () => {
  const runAll = useNodeStore((state) => state.runAll)
  const resetExecution = useNodeStore((state) => state.resetExecution)
  const runFromWithPinned = useNodeStore((state) => state.runFromWithPinned)
  const globalMode = useGlobalStore((state) => state.globalMode)
  const tool = useGlobalStore((state) => state.tool)
  const setTool = useGlobalStore((state) => state.setTool)

  // 只订阅原始值与派生结果：拖拽节点时 nodes 数组每帧变化，
  // 但以下订阅的布尔值/字符串不变，经浅比较跳过重渲染
  const globalStatus = useNodeStore(
    (state) => state.pipelineContext.globalStatus,
  )
  // Spec 模式：执行范围内必须至少有一个节点被标记了阶段，否则禁止运行
  const hasSpecMark = useNodeStore((state) =>
    state.nodes.some(
      (n) => (n.data as { specStep?: string } | undefined)?.specStep,
    ),
  )
  const specDisabled = globalMode === 'spec' && !hasSpecMark

  // 仅显示「已加载到当前工作流」的 PIN（store.pinnedNodes 按节点 id 隔离），
  // 而非磁盘上所有工作流的 PIN 文件；节点删除后自动不显示。
  // 扁平化为「id|label」字符串数组，便于 useShallow 浅比较
  const pinnedOptionStrs = useNodeStore(
    useShallow((state) => {
      const out: string[] = []
      for (const n of state.nodes) {
        if (!state.pinnedNodes[n.id]) continue
        out.push(
          `${n.id}|${(n.data as any)?.title || n.type || n.id}（${n.type || '未知'}）`,
        )
      }
      return out
    }),
  )
  const pinnedOptions = useMemo(
    () =>
      pinnedOptionStrs.map((s) => {
        const i = s.indexOf('|')
        return { value: s.slice(0, i), label: s.slice(i + 1) }
      }),
    [pinnedOptionStrs],
  )

  const [selectedPinnedKey, setSelectedPinnedKey] = useState<string | null>(
    null,
  )

  const handleRun = () => {
    const pinnedNodes = useNodeStore.getState().pinnedNodes
    const pin = selectedPinnedKey ? pinnedNodes[selectedPinnedKey] : undefined
    if (selectedPinnedKey && pin?.output) {
      // 以该节点为起点，注入 { [nodeId]: output } 执行（output 已在内存，无需再读文件；
      // PIN 自带的累积上下文由 store.runFromWithPinned 一并注入）
      runFromWithPinned(selectedPinnedKey, { [selectedPinnedKey]: pin.output })
    } else {
      runAll()
    }
  }

  return (
    <div className={styles.panel} style={{ marginBottom: 8 }}>
      <div className={styles.header}>
        <div style={{ flex: 1, display: 'flex', gap: 8, minWidth: 0 }}>
          <Select
            style={{ flex: 1, minWidth: 0 }}
            placeholder="选择固定节点（仅显示已加载到本工作流的 PIN）"
            value={selectedPinnedKey}
            onChange={setSelectedPinnedKey}
            allowClear
            notFoundContent="当前工作流没有已加载的 PIN（可在节点编辑面板中固定/加载）"
            options={pinnedOptions}
          />
        </div>
        {globalStatus === 'idle' && (
          <Tooltip
            title={
              specDisabled
                ? 'Spec 模式：请先在节点上用脚印按钮标记至少一个阶段'
                : `运行${selectedPinnedKey ? '（用PIN）' : ''}`
            }
          >
            <Button
              type="primary"
              icon={<Play size={14} />}
              onClick={handleRun}
              disabled={specDisabled}
            ></Button>
          </Tooltip>
        )}
        {globalStatus !== 'idle' && (
          <Tooltip title="重置">
            <Button
              icon={<RotateCcw size={14} />}
              onClick={resetExecution}
            ></Button>
          </Tooltip>
        )}
      </div>
      <ToolSelect
        style={{ flex: 1, minWidth: 0 }}
        value={tool}
        onChange={setTool}
      />
    </div>
  )
}
