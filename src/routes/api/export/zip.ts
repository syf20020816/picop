import { createFileRoute } from '@tanstack/react-router'
import type { Node, Edge } from '@xyflow/react'
import { buildWorkflow } from '#/services/exporter'
import type { ExportTarget, ExportOptions } from '#/services/exporter'

/**
 * zip 全量导出 API
 * 动态引入 jszip 与 artifactCollector（含 Node 内置模块），避免 SSR 预加载异常。
 */
export const Route = createFileRoute('/api/export/zip')({
  server: {
    handlers: {
      POST: async (ctx: any) => {
        const body = await ctx.request.json()
        const { nodes, edges, target, name, options } = body as {
          nodes: Node[]
          edges: Edge[]
          target: ExportTarget
          name?: string
          options?: ExportOptions
        }

        const logs: string[] = []
        logs.push(`导出 zip: target=${target}, name=${name || '未命名'}`)

        try {
          // 单次执行（默认 true）：自包含结构；取消勾选则用 .agent 共享结构
          const singleRun = options?.singleRun ?? true

          const exportOptions: ExportOptions = {
            name,
            mergeParallel: options?.mergeParallel ?? false,
            // zip 即全量导出：系统提示词以 path 引用并落盘为 prompts/*.md
            full: true,
            singleRun,
          }

          const { yaml, workflowPath } = buildWorkflow(
            target,
            nodes,
            edges,
            exportOptions,
          )

          const [{ default: JSZip }, { collectArtifacts, AGENT_ROOT }] =
            await Promise.all([
              import('jszip'),
              import('#/services/artifactCollector'),
            ])

          const zip = new JSZip()

          // 1. 写入主工作流文件
          zip.file(workflowPath, yaml)
          logs.push(`已生成 ${workflowPath}`)

          // 2. 收集输入物真实内容（userInput 静态内容 / Skill / Memory / BMad / Lark 引用 / 系统提示词）
          //    路径已按导出目录布局落位（单次执行自包含 / .agent 共享结构）
          const collected = await collectArtifacts(nodes, {
            format: target,
            name,
            singleRun,
          })

          for (const item of collected) {
            zip.file(item.path, item.content)
            if (item.warning) logs.push(`警告: ${item.warning}`)
          }

          // 3. OpenSpec 附加文件：config.yaml（默认 schema）+ changes/archive/ 目录
          if (target === 'openspec') {
            // schema 名与 openspec/schemas/<name>/ 目录名保持一致（同为 toStepId 清洗结果）
            const schemaName =
              workflowPath.split('/').filter(Boolean).slice(-2, -1)[0] ||
              'picop-workflow'
            // 取消单次执行时随 .agent 前缀整体前移
            const agentPrefix = singleRun ? '' : `${AGENT_ROOT}/`
            zip.file(
              `${agentPrefix}openspec/config.yaml`,
              `schema: ${schemaName}\n`,
            )
            zip.file(`${agentPrefix}openspec/changes/archive/.gitkeep`, '')
            logs.push('已生成 openspec/config.yaml')
          }

          // 4. 写入 manifest
          const manifest = {
            name: name || 'picop-workflow',
            target,
            workflowPath,
            artifactCount: collected.length,
            collectedSources: collected.map((c) => c.source),
            logs,
          }
          zip.file('manifest.json', JSON.stringify(manifest, null, 2))

          const content = await zip.generateAsync({ type: 'uint8array' })
          const safeName = (name || 'picop-workflow').replace(
            /[^a-zA-Z0-9_-]+/g,
            '-',
          )

          return new Response(content.buffer as ArrayBuffer, {
            status: 200,
            headers: {
              'Content-Type': 'application/zip',
              'Content-Disposition': `attachment; filename="${safeName}.zip"`,
            },
          })
        } catch (err: any) {
          return Response.json(
            {
              status: 'error',
              error: err.message,
              logs,
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
