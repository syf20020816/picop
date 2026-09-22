/**
 * 共享输入物收集器类型声明（shared/artifact-collect.mjs）
 *
 * 画布侧（src/services/artifactCollector.ts → zip 路由）与 MCP 侧（runner/mcp.mjs）
 * 共用同一实现，本文件为 TS 侧提供类型化签名，保证两处导出行为与接口完全一致。
 */
import type { Node } from '@xyflow/react'

// re-export：zip 导出 API 经动态 import 从本模块取用
export { openSpecSchemaDir, specChangeDir } from './export-core.mjs'

/** 导出包内的一项输入物 */
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

export interface CollectArtifactsOptions {
  /** Skill/Memory 文件所在的运行数据根目录（缺省 process.cwd()） */
  baseDir?: string
}

export declare function collectArtifacts(
  nodes: Node[],
  options?: CollectArtifactsOptions,
): Promise<CollectedArtifact[]>
