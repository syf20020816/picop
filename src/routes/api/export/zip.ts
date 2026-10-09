import { createFileRoute } from '@tanstack/react-router'
import type { Node, Edge } from '@xyflow/react'
import { buildWorkflow, skillDir } from '#/services/exporter'
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
          const exportOptions: ExportOptions = {
            name,
            mergeParallel: options?.mergeParallel ?? false,
          }

          const { yaml, workflowPath } = buildWorkflow(
            target,
            nodes,
            edges,
            exportOptions,
          )

          const [
            { default: JSZip },
            { collectArtifacts, openSpecSchemaDir, specChangeDir },
          ] = await Promise.all([
            import('jszip'),
            import('#/services/artifactCollector'),
          ])

          const zip = new JSZip()

          // 1. 写入主工作流文件
          zip.file(workflowPath, yaml)
          logs.push(`已生成 ${workflowPath}`)

          // 2. 收集输入物真实内容（userInput 静态内容 / Skill / Memory / BMad / Lark 引用 / Wiki 快照）
          const collected = await collectArtifacts(nodes)

          // OpenSpec：输入物与 schema.yaml 同级（openspec/schemas/<name>/ 下）
          // Spec：输入物在变更目录（spec/changes/<name>/ 下，md 产物同级）
          // Skill：输入物与 SKILL.md 同级（skills/<name>/ 下）
          // Speckit：输入物保持 zip 根目录（shell 步骤相对执行目录引用）
          const workflowName = name || 'picop-workflow'
          const prefix =
            target === 'openspec'
              ? `${openSpecSchemaDir(workflowName)}/`
              : target === 'spec'
                ? `${specChangeDir(workflowName)}/`
                : target === 'skill'
                  ? `${skillDir(workflowName)}/`
                  : ''

          for (const item of collected) {
            // Skill 形态：被引用的其他技能落盘为 `skills/<id>/SKILL.md`，
            // 与主技能目录同级，而不是嵌套进主技能目录内部
            const nested = target === 'skill' && item.path.startsWith('skills/')
            zip.file((nested ? '' : prefix) + item.path, item.content)
            if (item.warning) logs.push(`警告: ${item.warning}`)
          }

          // 3. OpenSpec 附加文件：config.yaml（默认 schema）+ changes/archive/ 目录
          if (target === 'openspec') {
            // schema 名与 openspec/schemas/<name>/ 目录名保持一致（同为 toStepId 清洗结果）
            const schemaName =
              prefix.split('/').filter(Boolean).pop() || 'picop-workflow'
            zip.file('openspec/config.yaml', `schema: ${schemaName}\n`)
            zip.file('openspec/changes/archive/.gitkeep', '')
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
