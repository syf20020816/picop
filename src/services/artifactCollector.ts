/**
 * 导出输入物收集器（后端专用）— 薄转发
 *
 * 实现已下沉到 shared/artifact-collect.mjs（零依赖 ESM），
 * 画布 zip 导出与 MCP 全量导出共用同一份收集逻辑，保证产物完全一致。
 * 本文件仅保留 TS 接口定义，供 zip 路由类型引用。
 */
export {
  collectArtifacts,
  openSpecSchemaDir,
  specChangeDir,
  resolveLayout,
  joinPath,
  AGENT_ROOT,
} from '../../shared/artifact-collect.mjs'

export interface CollectedArtifact {
  /** 导出包内相对路径 */
  path: string
  /** 文件内容 */
  content: string
  /** 来源标识（skill:<id> / memory:<path> / lark:<url> ...） */
  source: string
  /** 收集过程中的警告（不影响导出，写入 manifest 日志） */
  warning?: string
}

export interface CollectOptions {
  /** Skill / Memory 文件所在的运行数据根目录 */
  baseDir?: string
  /** 导出格式（决定目录布局）：skill / openspec / spec / speckit */
  format?: string
  /** 工作流名称（决定 skill / 变更目录名） */
  name?: string
  /** 单次执行（默认 true）：自包含结构；false：.agent 共享结构 */
  singleRun?: boolean
}
