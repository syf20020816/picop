import type { NodeExecutionContext, NodeExecutionResult, NodeExecutor } from '#/types/engine'

/**
 * 用户输入节点执行器
 * 直接将自身的 input 数据作为 output 传递给下游。
 */
export const userInputExecutor: NodeExecutor = {
  execute: async (ctx: NodeExecutionContext): Promise<NodeExecutionResult> => {
    const { config, input } = ctx
    const data = config.data

    return {
      nodeId: config.nodeId,
      status: 'success',
      output: {
        text: data.input?.prompt || input.text || '',
        prompt: data.input?.prompt || input.prompt || '',
        // 透传所有上游输入
        ...input,
      },
      logs: ['输入节点处理完成'],
    }
  },
}
