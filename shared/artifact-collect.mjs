/**
 * 导出输入物收集器（后端专用，零依赖 ESM）
 *
 * 与画布 zip 导出（src/routes/api/export/zip.ts → src/services/artifactCollector.ts）
 * 共用同一实现：收集各节点引用的真实内容，供「全量导出」落盘为目录文件。
 * - userInput / agent 静态输入（文字/提示词/URL 清单）
 * - Skill 文件（<baseDir>/workflows/skills/<id>/SKILL.md）
 * - BMad 角色文件（内容内联在节点 data，生成文件）
 * - Memory 文件（<baseDir>/memory/memory.md）
 * - Lark 文档：不拉取全文，导出 URL 清单 + lark-cli 使用技能
 *
 * 本文件使用 Node.js fs/path，只能被后端代码（zip 路由 / Runner / MCP）导入。
 * baseDir 默认 process.cwd()（画布场景），MCP 场景显式传入 PICOP_DIR。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  listCollectableArtifacts,
  userInputArtifactPath,
  skillArtifactPath,
  bmadArtifactPath,
  memoryArtifactPath,
  safeSegment,
  openSpecSchemaDir,
  specChangeDir,
} from './export-core.mjs'

// re-export：zip 导出 API 经动态 import 从本模块取用
export { openSpecSchemaDir, specChangeDir }

/** 读取文件，不存在返回 null */
async function readFileSafe(filePath) {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

// ==================== userInput / agent 静态输入 ====================

/** 收集 userInput / agent 节点的静态输入内容（label/prompt/files/urls） */
async function collectUserInputs(nodes, larkUrls, baseDir) {
  const results = []
  const userUrls = []

  for (const node of nodes) {
    const data = node.data || {}
    const input = data.input || {}
    const mdPath = userInputArtifactPath(node)
    const filesDir = path.posix.dirname(mdPath) + '/files'
    const parts = [`# ${data.title || '用户输入'}`]

    if (input.label) parts.push(`## 输入内容\n\n${input.label}`)
    if (input.prompt) parts.push(`## 提示词\n\n${input.prompt}`)

    // 上传文件：File 对象经 JSON 序列化后无法读取内容，仅能检测存在性
    const files = Array.isArray(input.files) ? input.files : []
    files.forEach((file, i) => {
      if (file && typeof file === 'object' && typeof file.text === 'function') {
        // 仅前端直调（非 JSON 请求）时可读到内容，后端通常走不到
        results.push({
          path: `${filesDir}/${safeSegment(file.name, `file-${i + 1}`)}`,
          content: `<!-- 文件内容见运行时上传，此处为占位 -->\n`,
          source: `user-input-file:${node.id}`,
        })
      } else {
        results.push({
          path: `${filesDir}/file-${i + 1}.md`,
          content: `<!-- 文件内容未持久化，无法随导出携带 -->\n`,
          source: `user-input-file:${node.id}`,
          warning: `节点 "${data.title || node.id}" 的第 ${i + 1} 个上传文件内容未持久化，导出为占位`,
        })
      }
    })

    if (Array.isArray(input.urls)) {
      for (const url of input.urls) {
        if (typeof url === 'string' && url) userUrls.push(url)
      }
    }

    results.push({
      path: mdPath,
      content: parts.join('\n\n') + '\n',
      source: `user-input:${node.id}`,
    })
  }

  // URL 清单（Lark 引用 + 用户输入链接），有内容才生成
  if (larkUrls.length > 0 || userUrls.length > 0) {
    const lines = ['# 输入 URL 清单', '']
    if (larkUrls.length > 0) {
      lines.push(
        '## Lark 文档（lark-cli 读取，见 skills/lark-cli/SKILL.md）',
        '',
      )
      for (const ref of larkUrls) {
        lines.push(
          `- [${ref.title}](${ref.url})${ref.kind === 'template' ? '（模板）' : ''}`,
        )
      }
      lines.push('')
    }
    if (userUrls.length > 0) {
      lines.push('## 用户输入链接', '')
      for (const url of userUrls) lines.push(`- ${url}`)
      lines.push('')
    }
    results.push({
      path: 'inputs/urls.md',
      content: lines.join('\n'),
      source: 'urls',
    })
  }

  return results
}

// ==================== Skill ====================

/** 收集所有 Skill 文件内容（磁盘统一为 SKILL.md，大小写敏感系统同样命中） */
async function collectSkills(ids, baseDir) {
  const results = []
  for (const id of ids) {
    const zipPath = skillArtifactPath(id)
    if (zipPath.includes('..')) {
      results.push({
        path: zipPath,
        content: `<!-- 非法 skillId: ${id} -->\n`,
        source: `skill:${id}`,
        warning: `skillId 含非法路径段: ${id}`,
      })
      continue
    }
    const diskPath = path.join(
      baseDir,
      'workflows',
      'skills',
      safeSegment(id, 'skill'),
      'SKILL.md',
    )
    const content = await readFileSafe(diskPath)
    if (content !== null) {
      results.push({ path: zipPath, content, source: `skill:${id}` })
    } else {
      results.push({
        path: zipPath,
        content: `<!-- SKILL ${id} 文件未找到 -->\n`,
        source: `skill:${id}`,
        warning: `未找到 ${diskPath}`,
      })
    }
  }
  return results
}

// ==================== BMad 角色 ====================

/** 从节点 data 生成 BMad 角色定义文件 */
function collectBMadAgents(nodes) {
  const results = []
  for (const node of nodes) {
    const data = node.data || {}
    const role = data.role || 'bmad-agent'
    const parts = [`# ${role}`, '']
    if (data.agentId) parts.push(`Agent ID: ${data.agentId}`)
    if (data.roleDescription)
      parts.push(`## 角色职责\n\n${data.roleDescription}`)
    if (data.systemPrompt) parts.push(`## 系统提示词\n\n${data.systemPrompt}`)
    results.push({
      path: bmadArtifactPath(node),
      content: parts.join('\n\n') + '\n',
      source: `bmad:${node.id}`,
    })
  }
  return results
}

// ==================== Memory ====================

/** 收集 memory 文件 */
async function collectMemories(nodes, baseDir) {
  const results = []
  const seen = new Set()
  for (const node of nodes) {
    const zipPath = memoryArtifactPath(node)
    if (seen.has(zipPath)) continue
    seen.add(zipPath)
    if (zipPath.includes('..')) {
      results.push({
        path: 'memory/memory.md',
        content: `<!-- 非法 memoryPath，回退默认 -->\n`,
        source: `memory:${node.id}`,
        warning: `memoryPath 含非法路径段`,
      })
      continue
    }
    const content =
      zipPath === 'memory/memory.md'
        ? await readFileSafe(path.join(baseDir, 'memory', 'memory.md'))
        : await readFileSafe(path.resolve(baseDir, zipPath))
    if (content !== null) {
      results.push({ path: zipPath, content, source: `memory:${node.id}` })
    } else {
      results.push({
        path: zipPath,
        content: `<!-- memory 文件未找到: ${zipPath} -->\n`,
        source: `memory:${node.id}`,
        warning: `未找到 ${zipPath}`,
      })
    }
  }
  return results
}

// ==================== Lark：URL 引用模式（不拉取全文） ====================

/** lark-cli 使用技能（静态内容，本地 agent 按指引自行读取文档） */
const LARK_CLI_SKILL = `---
name: lark-cli
description: 使用 lark-cli 读取本工作流引用的飞书文档
---

# 使用 lark-cli 读取飞书文档

本工作流引用的飞书文档 URL 清单见 \`inputs/urls.md\`。

读取文档内容（markdown）：

\`\`\`bash
lark-cli docs +fetch --doc "<文档URL>" --doc-format markdown --jq '.data.document.content'
\`\`\`

完整用法与安全约束参考：\`lark-cli skills read lark-doc\`。
`

/** Lark 文档引用模式：导出 URL 清单（在 collectUserInputs 中合并生成）+ lark-cli 技能文件 */
function collectLarkRefs(refs) {
  if (refs.length === 0) return []
  return [
    {
      path: 'skills/lark-cli/SKILL.md',
      content: LARK_CLI_SKILL,
      source: 'lark-cli-skill',
    },
  ]
}

// ==================== 汇总入口 ====================

/**
 * 收集所有需要真实内容的输入物
 * @param {Array} nodes 工作流节点
 * @param {{ baseDir?: string }} [opts] baseDir：Skill/Memory 文件所在的运行数据根目录
 * @returns {Promise<Array<{ path: string, content: string, source: string, warning?: string }>>}
 */
export async function collectArtifacts(nodes, opts = {}) {
  const baseDir = opts.baseDir || process.cwd()
  const plan = listCollectableArtifacts(nodes)

  const results = []
  results.push(
    ...(await collectUserInputs(plan.userInputNodes, plan.larkRefs, baseDir)),
  )
  results.push(...collectBMadAgents(plan.bmadNodes))
  results.push(...collectLarkRefs(plan.larkRefs))
  results.push(...(await collectSkills(plan.skills, baseDir)))
  results.push(...(await collectMemories(plan.memoryNodes, baseDir)))

  return results
}
