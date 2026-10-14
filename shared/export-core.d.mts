/**
 * 共享导出核心类型声明（shared/export-core.mjs）
 *
 * 画布侧（src/services/exporter.ts）与 MCP 侧（runner/mcp.mjs）共用同一实现，
 * 本文件为 TS 侧提供类型化签名，保证两处导出行为与接口完全一致。
 */
import type { Node, Edge } from '@xyflow/react'
import type { SpecStepKey } from '../src/constants/spec'

export type ExportTarget = 'speckit' | 'openspec' | 'spec' | 'skill'

export interface ExportOptions {
  /** 工作流/变更名称 */
  name?: string
  /** 是否合并完全相同的并行步骤，默认 false（仅 speckit） */
  mergeParallel?: boolean
  /** SKILL 导出：frontmatter description（留空则按节点自动生成） */
  description?: string
  /** 全量导出：系统提示词以 path 引用（inputs/prompts/*.md）而非内联 */
  full?: boolean
  /** 节点系统提示词内容（key = prompts/ 下文件名），非全量导出时内联 */
  systemPrompts?: Record<string, string>
  /**
   * 单次执行（默认 true）：自包含结构，输入物挂在主文件目录下
   * false：.agent 固定根目录，prompts / memory / bmad 提升到与 skills 同层便于复用
   */
  singleRun?: boolean
}

export interface ExportResult {
  /** workflow.yml / schema.yaml / SKILL.md 文本 */
  yaml: string
  /** 主工作流文件在 zip / 项目内的相对路径 */
  workflowPath: string
}

export interface LarkRef {
  /** 来源节点 id（用于把节点映射到 urls.md 中的段内序号） */
  nodeId: string
  url: string
  kind: 'doc' | 'template'
  /** 该飞书文档在流程中的用途：读取 or 写入（写入的是产物投递目标） */
  direction: 'read' | 'write'
  title: string
  /** 在 urls.md「Lark 文档（读取）」段中的序号（0 基），仅 direction=read 时存在 */
  readIndex?: number
  /** 在 urls.md「Lark 文档（写入）」段中的序号（0 基），仅 direction=write 时存在 */
  writeIndex?: number
}

export interface ProjectRef {
  /** 来源节点 id（用于把节点映射到 urls.md「项目位置」段内序号） */
  nodeId: string
  path: string
  branch?: string
  title: string
  /** 在 urls.md「项目位置」段中的序号（0 基） */
  index: number
}

export interface CollectablePlan {
  userInputNodes: Node[]
  skills: string[]
  bmadNodes: Node[]
  memoryNodes: Node[]
  larkRefs: LarkRef[]
  projectRefs: ProjectRef[]
  /** 需要落盘的系统提示词文件名（prompts/ 下） */
  systemPromptFiles: string[]
}

export declare const URLS_ARTIFACT_PATH: string
export declare const PROJECT_SECTION: string
export declare const SYSTEM_PROMPT_DIR: string
export declare const AGENT_ROOT: string

/** 导出目录布局（决定落盘位置与引用前缀） */
export interface ExportLayout {
  singleRun: boolean
  slug: string
  /** 主文件与 workflow 专属输入物（urls / user-input）所在目录 */
  workflowDir: string
  /** prompts / memory / bmad 所在目录 */
  sharedDir: string
  /** 被引用的其他技能所在目录 */
  skillsDir: string
  /** workflow 专属输入物的引用前缀 */
  wfRef: string
  /** 共享输入物的引用前缀 */
  sharedRef: string
}

export declare function joinPath(dir: string, rel: string): string
export declare function resolveLayout(
  format: ExportTarget | string | undefined,
  workflowName: string | undefined,
  singleRun?: boolean,
): ExportLayout

export declare const NodeTypes: {
  USER_INPUT: 'userInput'
  AGENT: 'agent'
  AI_OUTPUT: 'aiOutput'
  ANSWER: 'answer'
  BMAD_AGENT: 'bmadAgent'
  LARK: 'lark'
  IF: 'if'
  IF_CONDITION: 'ifCondition'
  LOOP: 'loop'
  LOOP_CONDITION: 'loopCondition'
  RETRY: 'retry'
  CODE_AGENT: 'codeAgent'
  SKILL: 'skill'
  LARK_TEMPLATE: 'larkTemplate'
  MEMORY: 'memory'
  KNOWLEDGE_RETRIEVAL: 'knowledgeRetrieval'
  KEYWORD_AGENT: 'keywordAgent'
  TASK_PLANNER: 'taskPlanner'
  SELF_CHECK: 'selfCheck'
  CUSTOM: 'custom'
}

export declare const SPEC_STEPS_KEYS: SpecStepKey[]

export declare function toStepId(raw: string, fallback: string): string
export declare function safeSegment(raw: string, fallback: string): string
export declare function isLocalSkillId(skillId: string): boolean
export declare function topologicalSort(
  nodes: Node[],
  edges: Edge[],
): { sortedIds: string[]; cycles: string[] }

export declare function userInputArtifactPath(node: Node): string
export declare function skillArtifactPath(skillId: string): string
export declare function bmadArtifactPath(node: Node): string
export declare function memoryArtifactPath(node: Node): string
export declare function openSpecSchemaDir(
  workflowName: string,
  singleRun?: boolean,
): string
export declare function specChangeDir(
  workflowName: string,
  singleRun?: boolean,
): string
export declare function skillDir(
  workflowName: string,
  singleRun?: boolean,
): string
export declare function systemPromptFile(node: Node): string | undefined
export declare function systemPromptArtifactPath(
  file: string,
  singleRun?: boolean,
): string

export declare function buildSpecKitWorkflow(
  nodes: Node[],
  edges: Edge[],
  options?: ExportOptions,
): ExportResult
export declare function buildOpenSpecWorkflow(
  nodes: Node[],
  edges: Edge[],
  options?: ExportOptions,
): ExportResult
export declare function buildSpecWorkflow(
  nodes: Node[],
  edges: Edge[],
  options?: ExportOptions,
): ExportResult
export declare function buildSkillWorkflow(
  nodes: Node[],
  edges: Edge[],
  options?: ExportOptions,
): ExportResult
export declare function buildWorkflow(
  target: ExportTarget,
  nodes: Node[],
  edges: Edge[],
  options?: ExportOptions,
): ExportResult

export declare function autoSkillDescription(
  name: string,
  nodes: Node[],
): string
export declare function listCollectableArtifacts(nodes: Node[]): CollectablePlan
