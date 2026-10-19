import { createFileRoute } from '@tanstack/react-router'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Node, Edge } from '@xyflow/react'
import { parseBmadSkillsCsv, parseBmadAgents, groupSkillsByPhase } from '#/engine/bmad/parser'
import { mapWorkflowToBmad, analyzeWorkflowPhase } from '#/engine/bmad/mapper'

/**
 * BMad 执行 API
 * - status: 检查 BMad 安装状态
 * - skills: 获取 BMad 技能列表
 * - map-workflow: 映射工作流节点到 BMad Method
 */

// 获取项目根目录（从当前文件往上找）
function findProjectRoot(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const dir = resolve(__dirname, '../../../../')
  // 尝试找 .bmad/_bmad 目录
  const bmadDir = resolve(dir, '.bmad/_bmad')
  try {
    readFileSync(resolve(bmadDir, 'config.toml'), 'utf-8')
    return dir
  } catch {
    // 回退到当前工作目录
    return process.cwd()
  }
}

function getBmadRoot(): string {
  return resolve(findProjectRoot(), '.bmad')
}

/**
 * 读取 BMad CSV 技能文件
 */
function readBmadSkillsCsv(): string {
  const bmadRoot = getBmadRoot()
  const csvPaths = [
    resolve(bmadRoot, '_bmad/_config/bmad-help.csv'),
    resolve(bmadRoot, '_bmad/bmm/module-help.csv'),
    resolve(bmadRoot, '_bmad/core/module-help.csv'),
    resolve(bmadRoot, '_bmad/bmb/module-help.csv'),
    resolve(bmadRoot, '_bmad/tea/module-help.csv'),
  ]

  const parts: string[] = []
  for (const p of csvPaths) {
    try {
      const content = readFileSync(p, 'utf-8')
      // 跳过空行和注释（如果有）
      const lines = content.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))
      if (lines.length > 1) {
        // 添加表头（只加一次）
        if (parts.length === 0) {
          parts.push(lines[0])
        }
        parts.push(...lines.slice(1))
      }
    } catch {
      // 文件可能不存在，跳过
    }
  }

  return parts.join('\n')
}

/**
 * 读取 BMad config.toml
 */
function readBmadConfigToml(): string {
  const bmadRoot = getBmadRoot()
  try {
    return readFileSync(resolve(bmadRoot, '_bmad/config.toml'), 'utf-8')
  } catch {
    return ''
  }
}

/**
 * 运行 bmad-method CLI 命令
 */
function runBmadCli(args: string): { stdout: string; stderr: string } {
  const bmadRoot = getBmadRoot()
  const cmd = `npx bmad-method ${args}`
  try {
    const stdout = execSync(cmd, {
      cwd: bmadRoot,
      encoding: 'utf-8',
      timeout: 30000,
    })
    return { stdout, stderr: '' }
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() || '',
      stderr: err.stderr?.toString() || err.message || '',
    }
  }
}

export const Route = createFileRoute('/api/execute/bmad')({
  server: {
    handlers: {
      POST: async (ctx: any) => {
        const body = await ctx.request.json()
        const { action, nodes, edges, intent } = body

        const logs: string[] = []
        logs.push(`BMad 操作: ${action}`)

        try {
          // === status: 检查 BMad 安装状态 ===
          if (action === 'status') {
            const { stdout, stderr } = runBmadCli('status')
            const installed = !stderr && stdout.includes('Version:')

            // 读取配置
            const tomlContent = readBmadConfigToml()
            const agents = tomlContent ? parseBmadAgents(tomlContent) : []

            logs.push(installed ? 'BMad 已安装' : 'BMad 未安装')

            return Response.json({
              status: installed ? 'success' : 'error',
              output: {
                installed,
                statusOutput: stdout || stderr,
                agentsCount: agents.length,
                bmadRoot: getBmadRoot(),
              },
              logs,
              error: installed ? undefined : 'BMad 未安装或无法访问',
            })
          }

          // === skills: 获取 BMad 技能列表 ===
          if (action === 'skills') {
            const csvContent = readBmadSkillsCsv()
            const skills = parseBmadSkillsCsv(csvContent)
            const grouped = groupSkillsByPhase(skills)

            logs.push(`加载 ${skills.length} 个 BMad Skills`)

            return Response.json({
              status: 'success',
              output: {
                skills,
                grouped,
                total: skills.length,
              },
              logs,
            })
          }

          // === agents: 获取 BMad 角色列表 ===
          if (action === 'agents') {
            const tomlContent = readBmadConfigToml()
            const agents = tomlContent ? parseBmadAgents(tomlContent) : []

            logs.push(`加载 ${agents.length} 个 BMad Agents`)

            return Response.json({
              status: 'success',
              output: {
                agents,
                total: agents.length,
              },
              logs,
            })
          }

          // === map-workflow: 映射工作流节点到 BMad Method ===
          if (action === 'map-workflow') {
            if (!nodes || !Array.isArray(nodes)) {
              return Response.json({
                status: 'error',
                output: {},
                logs: [...logs, '缺少 nodes 参数'],
                error: '请提供工作流节点 (nodes)',
              })
            }

            // 读取技能列表
            const csvContent = readBmadSkillsCsv()
            const skills = parseBmadSkillsCsv(csvContent)

            // 执行映射
            const result = mapWorkflowToBmad(
              {
                nodes: nodes as Node[],
                edges: (edges || []) as Edge[],
                intent: intent || '',
                bmadRoot: getBmadRoot(),
              },
              skills,
            )

            logs.push(`映射完成: ${result.phaseLabel}`)
            logs.push(`推荐 ${result.recommendedSkills.length} 个 Skills`)

            return Response.json({
              status: 'success',
              output: result,
              logs,
            })
          }

          // === analyze-phase: 仅分析工作流阶段 ===
          if (action === 'analyze-phase') {
            if (!nodes || !Array.isArray(nodes)) {
              return Response.json({
                status: 'error',
                output: {},
                logs: [...logs, '缺少 nodes 参数'],
                error: '请提供工作流节点 (nodes)',
              })
            }

            const result = analyzeWorkflowPhase(nodes as Node[], (edges || []) as Edge[])

            logs.push(`阶段分析: ${result.phaseLabel} (置信度: ${Math.round(result.confidence * 100)}%)`)

            return Response.json({
              status: 'success',
              output: result,
              logs,
            })
          }

          // === 未知操作 ===
          return Response.json({
            status: 'error',
            output: {},
            logs: [...logs, `未知操作: ${action}`],
            error: `未知操作类型: ${action}。支持: status, skills, agents, map-workflow, analyze-phase`,
          })
        } catch (err: any) {
          logs.push(`操作失败: ${err.message}`)
          return Response.json({
            status: 'error',
            output: {},
            logs,
            error: `BMad 操作失败: ${err.message}`,
          })
        }
      },
    },
  },
})
