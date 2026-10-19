// 输入节点
// 用于获取用户输入的内容，仅保留提示词

import type { NodeProps } from '@xyflow/react'
import { InputKinds } from '#/types'
import type { InputKind, NUserInput } from '#/types'
import styles from '../index.module.scss'
import { ScrollText, Link, Type, FileTextIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { UNode } from '..'

/**
 * # 输入节点
 * 用于获取用户输入的内容，输入必须包含**用户的意图提示词**。
 * 可与技能联动：选中技能后会在下游自动生成一个已选好技能的 SKILL 节点。
 */
export const UserInputNode = (props: NodeProps<NUserInput>) => {
  const prompt = props.data.input?.prompt

  return (
    <UNode node={props}>
      {prompt && (
        <div className={styles.line}>
          <InputItem kind={InputKinds.prompt} label={prompt} />
        </div>
      )}
    </UNode>
  )
}

export interface InputItemProps {
  kind: InputKind
  label: string
}

const iconAttrs = {
  width: 10,
  height: 10,
  color: '#1890ff',
}

const Icons = new Map<InputKind, ReactNode>([
  [InputKinds.text, <Type size={10} color="#1890ff" />],
  [InputKinds.file, <FileTextIcon {...iconAttrs} />],
  [InputKinds.prompt, <ScrollText size={10} color="#1890ff" />],
  [InputKinds.url, <Link size={10} color="#1890ff" />],
])

export const InputItem = ({ kind, label }: InputItemProps) => {
  return (
    <div className={`${styles.row} ${styles.row_sub}`}>
      {Icons.get(kind)}
      <span className={styles.row_weak}>
        {label.length >= 20 ? `${label.substring(0, 20)}...` : label}
      </span>
    </div>
  )
}