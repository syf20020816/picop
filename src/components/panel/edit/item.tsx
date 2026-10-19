import React, { useState, useEffect } from 'react'
import { InputKinds } from '#/types'
import type { InputKind } from '#/types'
import {
  Type,
  ScrollText,
  FileText,
  Link,
  XCircle,
  Plus,
  Info,
} from 'lucide-react'
import styles from '../index.module.scss'
import {
  Button,
  Input,
  InputNumber,
  Typography,
  Modal,
  Tree,
  Table,
  Tooltip,
} from 'antd'
import type { TableProps } from 'antd'
import type { ReactNode, Key } from 'react'
import { useNodeStore } from '#/store/node'
import { getPredecessors } from '#/engine/topological'

const { Text } = Typography

export interface EditItemProps {
  /** 字段标签 */
  label?: string
  /** 占位符（当使用 kind 时自动派生默认值） */
  placeholder?: string
  /** 输入值 */
  value?: string | number | File
  /** 值变更回调 */
  onChange?: (value: string | number | undefined) => void
  /** 删除回调 */
  onDelete?: () => void
  /** 输入控件类型 */
  inputType?: 'text' | 'textArea' | 'password' | 'number'
  /** 只读 */
  readOnly?: boolean
  /** textArea 行数 */
  rows?: number
  /** number 最小值 */
  min?: number
  /** number 最大值 */
  max?: number
  /** number 步长 */
  step?: number
  /** 是否显示获取按钮（从上游节点获取数据） */
  showPickButton?: boolean

  // ---- 以下为 InputKinds 兼容模式 ----
  /** 输入种类（兼容旧用法，设置后自动派生 label/placeholder/icon） */
  kind?: InputKind
}

const EditTextMapper = new Map<
  InputKind,
  {
    label: string
    placeholder: string
    icon: ReactNode
  }
>([
  [
    InputKinds.text,
    {
      label: '用户文本输入',
      placeholder: '输入用户文本',
      icon: <Type size={12} color="#1890ff" />,
    },
  ],
  [
    InputKinds.prompt,
    {
      label: '提示词',
      placeholder: '输入提示词',
      icon: <ScrollText size={12} color="#1890ff" />,
    },
  ],
  [
    InputKinds.file,
    {
      label: '文件',
      placeholder: '上传文件',
      icon: <FileText size={12} color="#1890ff" />,
    },
  ],
  [
    InputKinds.url,
    {
      label: '链接',
      placeholder: '输入链接',
      icon: <Link size={12} color="#1890ff" />,
    },
  ],
])

function buildTree(
  data: Record<string, any>,
  prefix: string = '',
): { key: Key; title: string; children?: any[] }[] {
  const result: { key: Key; title: string; children?: any[] }[] = []
  for (const [key, val] of Object.entries(data)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (val === null || val === undefined) {
      result.push({ key: fullKey, title: `${key}: ${val}` })
    } else if (typeof val === 'object') {
      const children = buildTree(val, fullKey)
      result.push({
        key: fullKey,
        title: `${key}`,
        children: children.length > 0 ? children : undefined,
      })
    } else {
      result.push({ key: fullKey, title: `${key}: ${val}` })
    }
  }
  return result
}

export interface DynEditKVRow {
  key: string
  label: React.ReactNode
  value?: string | number | File
  inputType?: 'text' | 'textArea' | 'password' | 'number'
  placeholder?: string
  rows?: number
  min?: number
  max?: number
  step?: number
  readOnly?: boolean
  /** 自定义值渲染，覆盖默认的 EditItem */
  valueRender?: (onChange: (v: any) => void) => React.ReactNode
  /** 自定义操作按钮，覆盖默认的获取上游数据按钮 */
  actionRender?: React.ReactNode
  /** 删除回调 */
  onDelete?: () => void
}

export interface DynEditKVProps {
  rows: DynEditKVRow[]
  onChange: (key: string, value: any) => void
  /** 缺少上游数据时的提示 */
  emptyText?: string
}

export const DynEditKV = ({ rows, onChange, emptyText }: DynEditKVProps) => {
  const currentNode = useNodeStore((state) => state.currentNode)
  const [modalVisible, setModalVisible] = React.useState(false)

  // 只订阅「是否有上游」布尔结果，避免订阅 edges 数组（拖拽每帧变化）
  const hasPredecessors = useNodeStore((state) =>
    currentNode ? getPredecessors(currentNode.id, state.edges).length > 0 : false,
  )

  // 上游取值树序列化为字符串订阅，且仅在弹窗打开时才计算：拖拽节点时
  // nodes/edges 每帧变化，关闭状态下恒返回 '[]'，避免每帧重渲染整个表格
  const treeDataJson = useNodeStore((state) => {
    if (!modalVisible || !currentNode) return '[]'
    const predecessors = getPredecessors(currentNode.id, state.edges)
    const result: { key: Key; title: string; children?: any[] }[] = []
    for (const predId of predecessors) {
      const node = state.nodes.find((n) => n.id === predId)
      if (node) {
        const nodeTitle = node.data.title || predId
        const children = buildTree(node.data, predId)
        result.push({
          key: predId,
          title: `${nodeTitle} (${predId})`,
          children: children.length > 0 ? children : undefined,
        })
      }
    }
    return JSON.stringify(result)
  })
  const treeData = React.useMemo<any[]>(
    () => JSON.parse(treeDataJson),
    [treeDataJson],
  )

  const handlePick = (keys: Key[], rowKey: string) => {
    if (keys.length > 0) {
      const selectedKey = keys[0] as string
      const [nodeId, ...pathParts] = selectedKey.split('.')
      const node = useNodeStore
        .getState()
        .nodes.find((n) => n.id === nodeId)
      if (node) {
        let current: any = node.data
        for (const part of pathParts) {
          current = current?.[part]
        }
        if (current !== undefined && current !== null) {
          onChange(
            rowKey,
            typeof current === 'string' ? current : JSON.stringify(current),
          )
        }
      }
    }
    setModalVisible(false)
  }

  const columns: TableProps<DynEditKVRow>['columns'] = [
    {
      title: '键',
      dataIndex: 'label',
      key: 'label',
      width: 100,
      render: (text) => <strong style={{ fontSize: 12 }}>{text}</strong>,
    },
    {
      title: '值',
      dataIndex: 'value',
      key: 'value',
      render: (_, record) => {
        if (record.valueRender) {
          return record.valueRender((v: any) => onChange(record.key, v))
        }
        return (
          <EditItem
            inputType={record.inputType}
            placeholder={record.placeholder}
            rows={record.rows}
            min={record.min}
            max={record.max}
            step={record.step}
            readOnly={record.readOnly}
            value={record.value}
            onChange={(v) => onChange(record.key, v)}
          />
        )
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_, record) => {
        if (record.actionRender !== undefined) {
          return record.actionRender
        }
        if (record.readOnly) return null
        return (
          <div style={{ display: 'flex', gap: 2 }}>
            {record.onDelete && (
              <Button
                type="text"
                size="small"
                danger
                icon={<XCircle size={12} />}
                onClick={(e) => {
                  e.stopPropagation()
                  record.onDelete?.()
                }}
              />
            )}
            {hasPredecessors ? (
              <Button
                type="text"
                size="small"
                icon={<Plus width={12} height={12} />}
                onClick={(e) => {
                  e.stopPropagation()
                  setPickTargetKey(record.key)
                  setModalVisible(true)
                }}
              />
            ) : null}
          </div>
        )
      },
    },
  ]

  const [pickTargetKey, setPickTargetKey] = React.useState<string | null>(null)

  return (
    <>
      <Table<DynEditKVRow>
        columns={columns}
        dataSource={rows}
        rowKey="key"
        pagination={false}
        showHeader={true}
        size="small"
        bordered
        components={{
          table: (tableProps: any) => (
            <table
              {...tableProps}
              style={{ ...tableProps?.style, tableLayout: 'fixed' }}
            />
          ),
        }}
        styles={{ root: { marginTop: 8 } }}
      />
      <Modal
        title="选择上游数据"
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false)
          setPickTargetKey(null)
        }}
        footer={null}
        width={600}
        styles={{
          body: { overflow: 'auto', scrollbarWidth: 'thin' },
        }}
      >
        {treeData.length > 0 ? (
          <Tree
            treeData={treeData}
            defaultExpandAll
            showLine
            onSelect={(keys) =>
              pickTargetKey && handlePick(keys, pickTargetKey)
            }
          />
        ) : (
          <Text type="secondary">
            {emptyText || '暂无上游节点，请先连接上游节点'}
          </Text>
        )}
      </Modal>
    </>
  )
}

export const EditItem = ({
  label: explicitLabel,
  placeholder: explicitPlaceholder,
  value,
  onChange,
  onDelete,
  inputType = 'text',
  readOnly,
  rows = 3,
  min,
  max,
  step,
  kind,
}: EditItemProps) => {
  const kindMeta = kind ? EditTextMapper.get(kind) : undefined
  const label = explicitLabel ?? kindMeta?.label ?? ''
  const placeholder = explicitPlaceholder ?? kindMeta?.placeholder ?? ''
  const prefix = kindMeta?.icon

  // 本地 state，避免每次按键触发父组件重渲染导致失焦
  const [localValue, setLocalValue] = useState<string | number>(
    (value ?? '') as string | number,
  )
  const [isFocused, setIsFocused] = useState(false)

  // 外部 value 变化时同步到本地（仅当 input 未聚焦时，避免打断打字）
  useEffect(() => {
    if (!isFocused) {
      setLocalValue((value ?? '') as string | number)
    }
  }, [value, isFocused])

  const handleFocus = () => setIsFocused(true)
  const handleBlur = () => {
    setIsFocused(false)
    onChange?.(localValue)
  }

  const handleChange = (v: string | number | null | undefined) => {
    setLocalValue(v ?? '')
  }

  if (inputType === 'textArea') {
    return (
      <div className={styles.line}>
        <div className={styles.line_row}>
          <Text>{label}</Text>
          {onDelete && (
            <Button
              type="text"
              size="small"
              danger
              icon={<XCircle size={14} />}
              onClick={onDelete}
            />
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, width: '100%' }}>
          <Input.TextArea
            rows={rows}
            value={localValue}
            placeholder={placeholder}
            readOnly={readOnly}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            style={{ flex: 1 }}
          />
        </div>
      </div>
    )
  }

  if (inputType === 'password') {
    return (
      <div className={styles.line}>
        <div className={styles.line_row}>
          <Text>{label}</Text>
          {onDelete && (
            <Button
              type="text"
              size="small"
              danger
              icon={<XCircle size={14} />}
              onClick={onDelete}
            />
          )}
        </div>
        <Input.Password
          prefix={prefix}
          value={localValue}
          placeholder={placeholder}
          readOnly={readOnly}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
      </div>
    )
  }

  if (inputType === 'number') {
    return (
      <div className={styles.line}>
        <div className={styles.line_row}>
          <Text>{label}</Text>
          {onDelete && (
            <Button
              type="text"
              size="small"
              danger
              icon={<XCircle size={14} />}
              onClick={onDelete}
            />
          )}
        </div>
        <InputNumber
          style={{ width: '100%' }}
          min={min}
          max={max}
          step={step}
          value={localValue}
          placeholder={placeholder}
          readOnly={readOnly}
          onChange={(v) => handleChange(v)}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
      </div>
    )
  }

  return (
    <div className={styles.line}>
      <div className={styles.line_row}>
        <Text>{label}</Text>
        {onDelete && (
          <Button
            type="text"
            size="small"
            danger
            icon={<XCircle size={14} />}
            onClick={onDelete}
          />
        )}
      </div>
      <Input
        prefix={prefix}
        value={localValue}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
    </div>
  )
}

export interface DynEditKeyProps {
  title: string
  info?: string
}

export const DynEditKey = ({ title, info }: DynEditKeyProps) => {
  return (
    <div className={styles.dyn_edit_key}>
      {title}
      {info && (
        <Tooltip
          title={
            <Text type="secondary" style={{ fontSize: 12 }}>
              {info}
            </Text>
          }
        >
          <Info height={14} width={14}></Info>
        </Tooltip>
      )}
    </div>
  )
}
