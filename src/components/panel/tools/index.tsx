import { useState, useEffect, useMemo } from 'react'
import { useNodeStore } from '#/store/node'
import { useModelStore } from '#/store/model'
import { stripNodesModals, hydrateNodesModals } from '#/services/modal'
import { Panel } from '@xyflow/react'
import type { PanelProps, Node, Edge } from '@xyflow/react'
import {
  Button,
  Tooltip,
  Modal,
  Input,
  AutoComplete,
  Upload,
  message,
  Typography,
  Radio,
  Checkbox,
  Space,
} from 'antd'
import {
  UploadOutlined,
  DownloadOutlined,
  CopyOutlined,
  FileZipOutlined,
} from '@ant-design/icons'
import {
  BrushCleaning,
  Download,
  Save,
  Upload as UploadIcon,
} from 'lucide-react'
import type { RcFile } from 'antd/es/upload'
import {
  SPEC_TARGETS,
  EXPORT_TARGETS,
  parseSpecKitWorkflow,
  parseOpenSpecSchema,
} from '#/services/specMap'
import type { SpecTarget } from '#/services/specMap'
import { buildWorkflow } from '#/services/exporter'
import styles from '../index.module.scss'

// 仅导出单文件（非全量）时内联系统提示词全文；
// 全量导出走 path 引用（inputs/prompts/<file>.md），内容由后端落盘
import codeAgentPrompt from '../../../../prompts/codeAgent.md?raw'
import codeBatchPrompt from '../../../../prompts/codeBatch.md?raw'
import keywordAgentPrompt from '../../../../prompts/keywordAgent.md?raw'
import taskPlannerPrompt from '../../../../prompts/taskPlanner.md?raw'
import selfCheckPrompt from '../../../../prompts/selfCheck.md?raw'

const SYSTEM_PROMPTS: Record<string, string> = {
  'codeAgent.md': codeAgentPrompt,
  'codeBatch.md': codeBatchPrompt,
  'keywordAgent.md': keywordAgentPrompt,
  'taskPlanner.md': taskPlannerPrompt,
  'selfCheck.md': selfCheckPrompt,
}

const { TextArea } = Input
const { Text } = Typography

const iconStyle = {
  height: 16,
  width: 16,
}

interface WorkflowData {
  nodes: Node[]
  edges: Edge[]
}

type ExportMode = 'yml' | 'zip'

export interface ToolsPanelProps extends PanelProps {}

export const ToolsPanel = (props: ToolsPanelProps) => {
  const setNodes = useNodeStore((state) => state.setNodes)
  const setEdges = useNodeStore((state) => state.setEdges)
  const setWorkflowId = useNodeStore((state) => state.setWorkflowId)
  const clearPanel = useNodeStore((state) => state.clearPanel)

  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [workflowList, setWorkflowList] = useState<{ name: string }[]>([])
  const [importJson, setImportJson] = useState('')
  const [importError, setImportError] = useState('')
  const [importTarget, setImportTarget] = useState<SpecTarget>('picop')
  const [exportTarget, setExportTarget] = useState<SpecTarget>('picop')

  // 导出选项
  const [exportMode, setExportMode] = useState<ExportMode>('yml')
  const [exportName, setExportName] = useState('')
  const [exportSkillDescription, setExportSkillDescription] = useState('')
  const [mergeParallel, setMergeParallel] = useState(false)
  // 单次执行（默认勾选）：产物自包含；取消后采用 .agent 共享目录结构
  const [singleRun, setSingleRun] = useState(true)

  /**
   * 导出预览文本（随状态实时派生）：
   * 全部导出选项共同决定内容，避免手动 setState 同步漏掉某个选项导致预览滞后。
   * - Picop 原生 JSON：剥离 modal 敏感字段，只保留模型 ID 引用
   * - 全量导出（zip）：系统提示词以 path 引用（内容随 zip 落盘 inputs/prompts/）
   * - 仅导出单文件：内联系统提示词全文
   */
  const exportPreview = useMemo(() => {
    // 弹窗未打开时不计算；且不订阅 nodes/edges（拖拽时每帧变化会触发重渲染），
    // 需要时通过 getState() 读取。预览仅在导出弹窗内被使用。
    if (!exportOpen) return ''
    const { nodes, edges } = useNodeStore.getState()
    if (exportTarget === 'picop') {
      const data: WorkflowData = { nodes: stripNodesModals(nodes), edges }
      return JSON.stringify(data, null, 2)
    }
    const result = buildWorkflow(exportTarget, nodes, edges, {
      name: exportName,
      mergeParallel,
      description: exportSkillDescription,
      full: exportMode === 'zip',
      singleRun,
      systemPrompts: SYSTEM_PROMPTS,
    })
    return result.yaml
  }, [
    exportOpen,
    exportTarget,
    exportMode,
    exportName,
    exportSkillDescription,
    mergeParallel,
    singleRun,
  ])

  const doImport = async (jsonStr: string) => {
    try {
      const data = JSON.parse(jsonStr)
      if (!data.nodes || !Array.isArray(data.nodes)) {
        setImportError('缺少 nodes 字段')
        return
      }
      if (!data.edges || !Array.isArray(data.edges)) {
        setImportError('缺少 edges 字段')
        return
      }
      for (const n of data.nodes) {
        if (!n.id || !n.type || !n.position) {
          setImportError('节点数据不完整，需要 id/type/position')
          return
        }
      }
      setImportError('')
      // 导入时按模型 ID 还原完整 modal 配置（磁盘/导出文件只存引用）
      let models = useModelStore.getState().models
      if (models.length === 0) {
        await useModelStore.getState().fetchModels()
        models = useModelStore.getState().models
      }
      setNodes(hydrateNodesModals(data.nodes, models))
      setEdges(data.edges)
      setWorkflowId(data.id || data.name || `imported_${Date.now()}`)
      message.success(
        `已导入 ${data.nodes.length} 个节点, ${data.edges.length} 条连线`,
      )
      setImportOpen(false)
      setImportJson('')
    } catch (err: any) {
      setImportError(`JSON 解析错误: ${err.message}`)
    }
  }

  /** 按目标平台导入（Picop 沿用原 JSON 逻辑，其余解析后重建节点） */
  const doImportTarget = async (text: string, target: SpecTarget) => {
    if (target === 'picop') {
      await doImport(text)
      return
    }
    try {
      const parsed =
        target === 'speckit'
          ? parseSpecKitWorkflow(text)
          : parseOpenSpecSchema(text)
      if (!parsed.nodes.length) {
        setImportError('未能解析出节点，请确认内容是否为所选平台格式')
        return
      }
      setImportError('')
      let models = useModelStore.getState().models
      if (models.length === 0) {
        await useModelStore.getState().fetchModels()
        models = useModelStore.getState().models
      }
      setNodes(hydrateNodesModals(parsed.nodes, models))
      setEdges(parsed.edges)
      setWorkflowId(parsed.name || `imported_${Date.now()}`)
      message.success(
        `已导入 ${parsed.nodes.length} 个节点, ${parsed.edges.length} 条连线`,
      )
      setImportOpen(false)
      setImportJson('')
    } catch (err: any) {
      setImportError(`解析失败: ${err.message}`)
    }
  }

  const handleFile = (file: RcFile) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setImportJson(text)
      doImportTarget(text, importTarget)
    }
    reader.readAsText(file)
    return false
  }

  const handleExportDownload = () => {
    if (exportMode === 'zip' && exportTarget !== 'picop') {
      handleZipDownload()
      return
    }

    const text = exportPreview
    const ext =
      EXPORT_TARGETS.find((t) => t.key === exportTarget)?.ext || 'json'
    const mime =
      ext === 'yml'
        ? 'application/yaml'
        : ext === 'md'
          ? 'text/markdown'
          : 'application/json'
    const blob = new Blob([text], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `workflow-${Date.now()}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
    message.success('工作流已下载')
  }

  const handleZipDownload = async () => {
    if (exportTarget === 'picop') {
      message.warning('Picop 原生 JSON 不支持 zip 全量导出')
      return
    }

    try {
      const { nodes, edges } = useNodeStore.getState()
      const res = await fetch('/api/export/zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: stripNodesModals(nodes),
          edges,
          target: exportTarget,
          name: exportName,
          options: {
            name: exportName,
            mergeParallel,
            singleRun,
          },
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: '导出失败' }))
        message.error(data.error || 'zip 导出失败')
        return
      }

      const blob = await res.blob()
      const safeName = (exportName || 'picop-workflow').replace(
        /[^a-zA-Z0-9_-]+/g,
        '-',
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${safeName}.zip`
      a.click()
      URL.revokeObjectURL(url)
      message.success('zip 包已下载')
    } catch (err: any) {
      message.error('zip 导出失败: ' + err.message)
    }
  }

  // 打开保存弹窗时加载已有工作流列表
  useEffect(() => {
    if (saveOpen) {
      fetch('/api/workflows')
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => setWorkflowList(Array.isArray(data) ? data : []))
        .catch(() => setWorkflowList([]))
    }
  }, [saveOpen])

  const handleSaveTemplate = async () => {
    if (!saveName.trim()) {
      message.warning('请输入工作流名称')
      return
    }
    try {
      const { nodes, edges } = useNodeStore.getState()
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: saveName.trim(),
          nodes,
          edges,
        }),
      })
      if (res.ok) {
        message.success(`工作流模板「${saveName}」已保存`)
        setSaveOpen(false)
        setSaveName('')
      } else {
        const err = await res.json()
        message.error('保存失败: ' + (err.error || '未知错误'))
      }
    } catch (err: any) {
      message.error('保存失败: ' + err.message)
    }
  }

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      message.success('已复制到剪贴板')
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      message.success('已复制到剪贴板')
    }
  }

  const openExport = () => {
    setExportOpen(true)
  }

  const btns = [
    {
      key: 'clearPanel',
      label: '清空面板',
      icon: <BrushCleaning style={iconStyle} />,
      onClick: clearPanel,
    },
    {
      key: 'import',
      label: '导入工作流',
      icon: <UploadIcon style={iconStyle} />,
      onClick: () => setImportOpen(true),
    },
    {
      key: 'export',
      label: '导出工作流',
      icon: <Download style={iconStyle} />,
      onClick: openExport,
    },
    {
      key: 'save',
      label: '保存工作流模板',
      icon: <Save style={iconStyle} />,
      onClick: () => setSaveOpen(true),
    },
  ]

  return (
    <>
      <Panel {...props}>
        {btns.map((item) => (
          <Tooltip key={item.key} title={item.label}>
            <Button
              shape="circle"
              icon={item.icon}
              type="default"
              onClick={item.onClick}
              className={styles.toolBtn}
            />
          </Tooltip>
        ))}
      </Panel>

      {/* 导入弹窗 */}
      <Modal
        title="导入工作流"
        open={importOpen}
        onCancel={() => {
          setImportOpen(false)
          setImportJson('')
          setImportError('')
        }}
        footer={null}
        width={560}
      >
        <div style={{ marginBottom: 12 }}>
          <Text strong>选择来源平台</Text>
        </div>
        <Radio.Group
          value={importTarget}
          onChange={(e) => setImportTarget(e.target.value as SpecTarget)}
          optionType="button"
          buttonStyle="solid"
          options={SPEC_TARGETS.map((t) => ({ label: t.label, value: t.key }))}
          style={{ marginBottom: 12 }}
        />
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {SPEC_TARGETS.find((t) => t.key === importTarget)?.description}
          </Text>
        </div>
        <div style={{ marginBottom: 12 }}>
          <Text strong>方式一：粘贴内容</Text>
        </div>
        <TextArea
          rows={8}
          placeholder={
            importTarget === 'picop'
              ? '在此粘贴工作流 JSON...\n格式: { "nodes": [...], "edges": [...] }'
              : importTarget === 'speckit'
                ? '在此粘贴 workflow.yml...\nschema_version / workflow / steps'
                : '在此粘贴 schema.yaml...\nname / artifacts / apply'
          }
          value={importJson}
          onChange={(e) => {
            setImportJson(e.target.value)
            setImportError('')
          }}
        />
        {importError && (
          <Text
            type="danger"
            style={{ fontSize: 12, marginTop: 4, display: 'block' }}
          >
            {importError}
          </Text>
        )}
        <Button
          type="primary"
          style={{ marginTop: 8 }}
          onClick={() => doImportTarget(importJson, importTarget)}
          disabled={!importJson.trim()}
        >
          导入
        </Button>

        <div style={{ margin: '16px 0 8px' }}>
          <Text strong>方式二：上传文件</Text>
        </div>
        <Upload.Dragger
          accept={importTarget === 'picop' ? '.json' : '.yml,.yaml,.json'}
          showUploadList={false}
          beforeUpload={handleFile}
        >
          <p className="ant-upload-drag-icon">
            <UploadOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽文件到此区域</p>
          <p className="ant-upload-hint">
            {importTarget === 'picop'
              ? '支持 .json 格式的工作流文件'
              : '支持 .yml / .yaml 格式的文件'}
          </p>
        </Upload.Dragger>
      </Modal>

      {/* 导出弹窗 */}
      <Modal
        title="导出工作流"
        open={exportOpen}
        onCancel={() => setExportOpen(false)}
        footer={null}
        width={600}
      >
        <div style={{ marginBottom: 12 }}>
          <Text strong>选择目标平台</Text>
        </div>
        <Radio.Group
          value={exportTarget}
          onChange={(e) => setExportTarget(e.target.value as SpecTarget)}
          optionType="button"
          buttonStyle="solid"
          options={EXPORT_TARGETS.map((t) => ({
            label: t.label,
            value: t.key,
          }))}
          style={{ marginBottom: 16 }}
        />

        {exportTarget !== 'picop' && (
          <>
            <div style={{ marginBottom: 8 }}>
              <Text strong>导出模式</Text>
            </div>
            <Radio.Group
              value={exportMode}
              onChange={(e) => setExportMode(e.target.value as ExportMode)}
              style={{ marginBottom: 16 }}
            >
              <Radio value="yml">
                {exportTarget === 'skill'
                  ? '仅导出 SKILL.md'
                  : '仅导出 workflow.yml'}
              </Radio>
              <Radio value="zip">全量导出 zip（含输入物）</Radio>
            </Radio.Group>
          </>
        )}

        <div style={{ marginBottom: 8 }}>
          <Text strong>工作流名称</Text>
        </div>
        <Input
          placeholder={
            exportTarget === 'skill'
              ? 'SKILL 目录名（技能名）'
              : '留空则使用 picop-workflow'
          }
          value={exportName}
          onChange={(e) => setExportName(e.target.value)}
          style={{ marginBottom: 16 }}
        />

        {exportTarget === 'skill' && (
          <>
            <div style={{ marginBottom: 8 }}>
              <Text strong>Skill 描述（description）</Text>
            </div>
            <Input
              placeholder="留空则根据节点自动生成（触发词/作用简介）"
              value={exportSkillDescription}
              onChange={(e) => setExportSkillDescription(e.target.value)}
              style={{ marginBottom: 16 }}
            />
          </>
        )}

        {exportTarget !== 'picop' && (
          <Space
            direction="vertical"
            style={{ width: '100%', marginBottom: 16 }}
          >
            <Checkbox
              checked={mergeParallel}
              onChange={(e) => setMergeParallel(e.target.checked)}
            >
              合并并行步骤（仅当 command / integration / model / input
              完全相同时）
            </Checkbox>

            {exportMode === 'zip' && (
              <Checkbox
                checked={singleRun}
                onChange={(e) => setSingleRun(e.target.checked)}
              >
                单次执行
              </Checkbox>
            )}

            {exportMode === 'zip' && (
              <div>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {singleRun
                    ? '产物自包含（输入物挂在主文件目录下），便于单次执行。'
                    : '采用 .agent 固定根目录结构，prompts / memory / bmad 提升到与 skills 同层，便于跨工作流复用。'}
                </Text>
              </div>
            )}

            {exportMode === 'zip' && (
              <div>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  知识库检索节点在导出后按节点配置运行（本地 MCP 或远程
                  API），不随 zip 携带知识库数据。
                </Text>
              </div>
            )}
          </Space>
        )}

        <div
          style={{
            marginBottom: 8,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Text strong>
            {SPEC_TARGETS.find((t) => t.key === exportTarget)?.label} 内容
          </Text>
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => handleCopy(exportPreview)}
          >
            复制
          </Button>
        </div>
        <TextArea
          rows={10}
          value={exportPreview}
          readOnly
          style={{ fontFamily: 'monospace', fontSize: 11 }}
        />
        <Button
          type="primary"
          icon={
            exportMode === 'zip' && exportTarget !== 'picop' ? (
              <FileZipOutlined />
            ) : (
              <DownloadOutlined />
            )
          }
          style={{ marginTop: 12 }}
          onClick={handleExportDownload}
          block
        >
          {exportMode === 'zip' && exportTarget !== 'picop'
            ? '下载 zip 包'
            : `下载为 ${exportTarget === 'picop' ? 'JSON' : (EXPORT_TARGETS.find((t) => t.key === exportTarget)?.ext || 'YAML').toUpperCase()} 文件`}
        </Button>
      </Modal>

      {/* 保存模板弹窗 */}
      <Modal
        title="保存工作流模板"
        open={saveOpen}
        onCancel={() => {
          setSaveOpen(false)
          setSaveName('')
        }}
        onOk={handleSaveTemplate}
        okText="保存"
        okButtonProps={{ disabled: !saveName.trim() }}
        width={440}
      >
        <div style={{ marginBottom: 8 }}>
          <Text>工作流名称</Text>
        </div>
        <AutoComplete
          placeholder="请输入工作流模板名称"
          value={saveName}
          onChange={(value) => setSaveName(value)}
          onSelect={(value) => setSaveName(value)}
          options={workflowList.map((item) => ({
            value: item.name,
            label: item.name,
          }))}
          style={{ width: '100%' }}
          autoFocus
        />
      </Modal>
    </>
  )
}
