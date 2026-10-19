// PicopSender：基于 @ant-design/x Sender + Suggestion 的提示词编辑器
// - 输入框内输入 `/keyword` 通过 Suggestion 弹出技能建议（类 codex 的 / 命令）
// - 选中的技能以顶部 chip 体现，可通过 onSkillChange 双向同步外部 SkillSelect
// - 输入文本本身保持纯净（不含技能记号）

import { useEffect, useMemo, useState } from 'react'
import { Sender, Suggestion } from '@ant-design/x'
import { CloseOutlined } from '@ant-design/icons'
import { loadAllSkills } from '#/components/select'
import type { SkillPick } from '#/components/select'
import styles from './index.module.scss'

export interface PicopSenderProps {
  value?: string
  onChange?: (value: string) => void
  onSubmit?: (content: string) => void
  /** 当前技能 ID（外部 SkillSelect 同步源） */
  skillId?: string
  /** 当前技能名称（chip 展示用） */
  skillName?: string
  /** 技能变更回调（undefined 表示清除） */
  onSkillChange?: (value: string | undefined, name?: string) => void
  /** 本地工具 ID（加载该工具的本机技能） */
  tool?: string
  placeholder?: string
  style?: React.CSSProperties
}

/** 匹配输入文本框尾部的 `/keyword` 片断（出现在行首或空白之后） */
const SLASH_RE = /(?:^|\s)\/([\w-]*)$/

export const PicopSender = ({
  value = '',
  onChange,
  onSubmit,
  skillId,
  skillName,
  onSkillChange,
  tool,
  placeholder,
  style,
}: PicopSenderProps) => {
  const [skills, setSkills] = useState<SkillPick[]>([])

  // 全局技能列表（platform + 本机），tool 变化时重新加载
  useEffect(() => {
    let alive = true
    loadAllSkills(tool).then((list) => {
      if (alive) setSkills(list)
    })
    return () => {
      alive = false
    }
  }, [tool])

  // 由 value 推导当前是否命中 / 命令及其关键字，并过滤建议列表
  const slashMatch = useMemo(() => value.match(SLASH_RE), [value])
  const query = (slashMatch?.[1] || '').toLowerCase()
  const items = useMemo(() => {
    const list = query
      ? skills.filter((s) => s.name.toLowerCase().includes(query))
      : skills
    return list.map((s) => ({
      label: `${s.source === 'local' ? '(个人)' : '(Picop)'} ${s.name}`,
      value: s.id,
    }))
  }, [skills, query])

  // 选中技能：剔除 / 片断并回调
  const handleSelect = (val: string) => {
    const skill = skills.find((s) => s.id === val)
    if (!skill) return
    const next = value.replace(SLASH_RE, '').replace(/\s+$/, '')
    onChange?.(next)
    onSkillChange?.(skill.id, skill.name)
  }

  const prefix = skillId && skillName ? (
    <span className={styles.chip}>
      <span className={styles.chipText}>{skillName}</span>
      <CloseOutlined
        className={styles.chipClose}
        onClick={() => onSkillChange?.(undefined)}
      />
    </span>
  ) : null

  return (
    <div className={styles.root} style={style}>
      <Suggestion block items={items} onSelect={handleSelect}>
        {({ onTrigger, onKeyDown }) => (
          <Sender
            value={value}
            prefix={prefix}
            onChange={(v) => {
              // 命中尾部 / 则打开建议面板，否则关闭
              if (v.match(SLASH_RE)) onTrigger()
              else onTrigger(false)
              onChange?.(v)
            }}
            onSubmit={(c) => onSubmit?.(c)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            autoSize={{ minRows: 2, maxRows: 6 }}
            suffix={false}
            styles={{content: {alignItems: "flex-start"}}}
          />
        )}
      </Suggestion>
    </div>
  )
}