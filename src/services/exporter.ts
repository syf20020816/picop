/**
 * 工作流导出服务
 *
 * 把平台画布节点/连线翻译为外部可执行格式（Speckit / OpenSpec / Spec / SKILL）。
 *
 * 本文件为薄转发层：全部导出逻辑唯一来源为 `shared/export-core.mjs`，
 * 画布导出与 Runner MCP（runner/mcp.mjs）共用同一套实现，保证产物一致。
 */
export {
  NodeTypes,
  SPEC_STEPS_KEYS,
  toStepId,
  safeSegment,
  isLocalSkillId,
  topologicalSort,
  userInputArtifactPath,
  skillArtifactPath,
  bmadArtifactPath,
  memoryArtifactPath,
  openSpecSchemaDir,
  specChangeDir,
  skillDir,
  resolveLayout,
  joinPath,
  AGENT_ROOT,
  buildSpecKitWorkflow,
  buildOpenSpecWorkflow,
  buildSpecWorkflow,
  buildSkillWorkflow,
  buildWorkflow,
  autoSkillDescription,
  listCollectableArtifacts,
} from '../../shared/export-core.mjs'

export type {
  ExportTarget,
  ExportOptions,
  ExportResult,
  ExportLayout,
  LarkRef,
  CollectablePlan,
} from '../../shared/export-core.mjs'
