import { fetchLocalTools, fetchLocalToolSkills } from '#/services/runner'
import type { LocalToolSkill } from '#/services/runner'
import { Select } from 'antd'
import type { SelectProps } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'

/** 本地 CLI 工具选择器：列表来自 Runner 对本机的探测（claude/codex/deepseek 等），每次打开下拉重新探测 */
export const ToolSelect = ({
  value,
  onChange,
  ...rest
}: Omit<SelectProps, 'onChange'> & {
  onChange?: (value: string) => void
}) => {
  const [tools, setTools] = useState<{ id: string; name: string; available: boolean }[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const list = await fetchLocalTools()
    setTools(list)
    setLoading(false)
  }, [])

  // 首次挂载加载一次（保证已选值能匹配到选项）
  useEffect(() => {
    load()
  }, [load])

  // 每次打开下拉重新探测一次
  const handleDropdownVisibleChange = (open: boolean) => {
    if (open) load()
  }

  return (
    <Select
      allowClear
      loading={loading}
      placeholder="选择本地工具..."
      value={value}
      notFoundContent="Runner 未启动或本机无可用 CLI 工具"
      options={tools.map((t) => ({
        label: t.available ? t.name : `${t.name}（未安装）`,
        value: t.id,
        disabled: !t.available,
      }))}
      onDropdownVisibleChange={handleDropdownVisibleChange}
      onChange={(v) => onChange?.(v)}
      {...rest}
    />
  )
}

/** 平台技能（技能管理中的自定义技能，选项标 (Picop)） */
export interface PicopSkill {
  id: string
  name: string
  description?: string
}

/** 技能选择结果 */
export interface SkillPick {
  /** 技能 ID：平台技能为原始 ID；本机工具技能为 local:<tool>:<skill> 复合 id */
  id: string
  /** 技能名称（不含 (个人)/(Picop) 前缀） */
  name: string
  /** 来源：local=本机工具技能，picop=平台技能 */
  source: 'local' | 'picop'
}

/** 平台技能：直接请求（rescan=true 会先扫描 workflows/skills 目录补索引），不缓存到全局 store */
async function fetchPlatformSkills(): Promise<PicopSkill[]> {
  try {
    const res = await fetch('/api/skill?rescan=true')
    const list = await res.json()
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** 合并加载全部技能（本机 + 平台），供 SkillSelect / PicopSender 复用 */
export async function loadAllSkills(tool?: string): Promise<SkillPick[]> {
  const p = await fetchPlatformSkills()
  const l = tool ? await fetchLocalToolSkills(tool) : []
  return [
    ...l.map((s) => ({
      id: `local:${tool}:${s.id}`,
      name: s.name,
      source: 'local' as const,
    })),
    ...p.map((s) => ({ id: s.id, name: s.name, source: 'picop' as const })),
  ]
}

/**
 * 技能选择器：平台技能 + 本机工具技能
 *  - 平台技能标「(Picop)」，本机工具技能标「(个人)」
 *  - 每次打开下拉都会重新查找一次，不依赖全局 store 缓存
 *  - 本机技能 value 为复合 id（local:<tool>:<skill>），避免与平台技能同名冲突
 */
export const SkillSelect = ({
  value,
  tool,
  onChange,
  ...rest
}: Omit<SelectProps, 'onChange' | 'options'> & {
  /** 本地工具 ID（可选）：传入时额外加载该工具的本机技能 */
  tool?: string
  onChange?: (value: string | undefined, skill?: SkillPick) => void
}) => {
  const [platformSkills, setPlatformSkills] = useState<PicopSkill[]>([])
  const [localSkills, setLocalSkills] = useState<LocalToolSkill[]>([])
  const [loading, setLoading] = useState(false)
  const toolRef = useRef(tool)
  toolRef.current = tool

  const load = useCallback(async () => {
    setLoading(true)
    const [p, l] = await Promise.all([
      fetchPlatformSkills(),
      toolRef.current ? fetchLocalToolSkills(toolRef.current) : Promise.resolve([]),
    ])
    setPlatformSkills(p)
    setLocalSkills(l)
    setLoading(false)
  }, [])

  // 首次挂载加载一次（保证已选值能匹配到选项）
  useEffect(() => {
    load()
  }, [load])

  // 每次打开下拉重新查找一次
  const handleDropdownVisibleChange = (open: boolean) => {
    if (open) load()
  }

  const options = [
    ...localSkills.map((s) => ({
      label: `(个人) ${s.name}${s.description ? ` — ${s.description}` : ''}`,
      value: `local:${tool}:${s.id}`,
    })),
    ...platformSkills.map((s) => ({
      label: `(Picop) ${s.name}${s.description ? ` — ${s.description}` : ''}`,
      value: s.id,
    })),
  ]

  const handleChange = (v: string) => {
    if (!v) {
      onChange?.(undefined)
      return
    }
    if (v.startsWith('local:')) {
      const local = localSkills.find((s) => `local:${tool}:${s.id}` === v)
      onChange?.(v, { id: v, name: local?.name || '', source: 'local' })
    } else {
      const p = platformSkills.find((s) => s.id === v)
      onChange?.(v, { id: v, name: p?.name || '', source: 'picop' })
    }
  }

  return (
    <Select
      allowClear
      loading={loading}
      placeholder="选择技能..."
      value={value || undefined}
      notFoundContent={loading ? '查找技能中...' : '暂无技能，可先在技能管理中创建'}
      options={options}
      onDropdownVisibleChange={handleDropdownVisibleChange}
      onChange={handleChange}
      {...rest}
    />
  )
}
