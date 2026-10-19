import type { NodeExecutionContext, NodeExecutionResult, NodeExecutor } from '#/types/engine'
import { runnerFetch } from '#/services/runner'

/**
 * AI 输出节点执行器
 * 提取上游输出内容，并导出到本地文件（如果配置了 outputPath）。
 */
export const aiOutputExecutor: NodeExecutor = {
  execute: async (ctx: NodeExecutionContext): Promise<NodeExecutionResult> => {
    const { config, input } = ctx
    const outputPath = config.data.outputPath || ''

    const content =
      (input as any).response ||
      (input as any).analysis ||
      (input as any).result ||
      JSON.stringify(input, null, 2)

    const logs: string[] = ['输出节点处理完成']

    if (outputPath) {
      try {
        const res = await runnerFetch('/file-write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: outputPath, content }),
        })
        const result = await res.json()
        if (result.status === 'success') {
          logs.push(`已导出到: ${outputPath}`)
        } else {
          logs.push(`导出失败: ${result.error}`)
        }
      } catch (err: any) {
        logs.push(`导出请求失败: ${err.message}`)
      }
    }

    return {
      nodeId: config.nodeId,
      status: 'success',
      output: {
        content,
        sourceAgent: config.data.sourceAgent || '',
        outputPath,
        ...input,
      },
      logs,
    }
  },
}
