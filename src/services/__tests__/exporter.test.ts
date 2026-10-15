import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Node, Edge } from '@xyflow/react'
import {
  buildSpecKitWorkflow,
  buildOpenSpecWorkflow,
  buildSpecWorkflow,
  buildSkillWorkflow,
  listCollectableArtifacts,
} from '#/services/exporter'
import { collectArtifacts } from '#/services/artifactCollector'

/** 构造测试节点 */
function makeNode(
  id: string,
  type: string,
  data: Record<string, unknown>,
): Node {
  return { id, type, position: { x: 0, y: 0 }, data: { title: id, ...data } }
}

function makeEdge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target, type: 'nodeEdge' }
}

describe('导出物管理', () => {
  const nodes = [
    makeNode('lark-1', 'lark', {
      url: 'https://x.feishu.cn/docx/abc',
      specStep: 'plan',
    }),
    makeNode('agent-1', 'agent', { specStep: 'plan' }),
    makeNode('task-1', 'taskPlanner', { specStep: 'tasks' }),
    makeNode('skill-1', 'skill', { skillId: '前端技术文档编写指南' }),
    makeNode('input-1', 'userInput', {
      input: { label: '需求描述', prompt: '写一个登录页' },
      specStep: 'spec',
    }),
  ]
  const edges = [
    makeEdge('lark-1', 'agent-1'),
    makeEdge('agent-1', 'task-1'),
    makeEdge('skill-1', 'task-1'),
    makeEdge('input-1', 'lark-1'),
  ]

  it('speckit：lark+plan 生成 shell 拉取步骤，agent+plan 被跳过', () => {
    const { yaml } = buildSpecKitWorkflow(nodes, edges, { name: '测试' })
    expect(yaml).toContain('type: shell')
    // URL 不内联：运行时从 inputs/urls.md 的「读取」段取值
    expect(yaml).toContain('+fetch')
    expect(yaml).toContain('inputs/urls.md')
    expect(yaml).not.toContain('https://x.feishu.cn/docx/abc')
    // agent-1 (specStep: plan) 的产物已由 lark-1 提供，应被跳过
    expect(yaml).not.toContain('speckit.plan')
    // taskPlanner 正常导出
    expect(yaml).toContain('speckit.tasks')
    // 跳过注释
    expect(yaml).toContain('已由输入节点')
    // userInput gate + cp 步骤
    expect(yaml).toContain('cp inputs/user-input/')
    // 不生成 spec 占位文件说明（无 plan.md 模板内容）
    expect(yaml).not.toContain('由平台 plan 节点生成')
  })

  it('speckit：无 specStep 的输入节点不导出为 command 步骤', () => {
    const { yaml } = buildSpecKitWorkflow(
      [makeNode('skill-2', 'skill', { skillId: 's' })],
      [],
    )
    // skill 无 specStep：无 step、也不计入控制节点跳过注释
    expect(yaml).not.toContain('control node')
    expect(yaml).not.toContain('speckit.plan')
  })

  it('openspec：输入节点生成拉取指引，生成节点同名 artifact 跳过', () => {
    const { yaml, workflowPath } = buildOpenSpecWorkflow(nodes, edges, {
      name: '测试',
    })
    expect(yaml).toContain('lark-cli')
    expect(yaml).toContain('design.md')
    // design artifact 只出现一次（agent 的 plan→design 被 lark 覆盖）
    const designCount = (yaml.match(/- id: design/g) || []).length
    expect(designCount).toBe(1)
    // userInput + specStep 产出拉取型 artifact（静态内容作为产物）
    expect(yaml).toMatch(/- id: proposal[\s\S]*?inputs\/user-input\//)
    // schema 路径为 openspec/schemas/<name>/schema.yaml
    expect(workflowPath).toBe('openspec/schemas/测试/schema.yaml')
    // apply 跟踪 tasks.md
    expect(yaml).toContain('tracks: tasks.md')
  })

  it('openspec：处理节点产出生成型 artifact + lark write 反向挂接 + tasks 自动补全', () => {
    // singer-center 结构复刻：userInput → lark read → agent → codeAgent → lark write(specStep=plan)
    const scNodes = [
      makeNode('input-1', 'userInput', { input: { prompt: '需求描述' } }),
      makeNode('lark-read', 'lark', { url: 'https://x.feishu.cn/wiki/read' }),
      makeNode('memory-1', 'memory', { memoryPath: 'memory/memory.md' }),
      makeNode('agent-1', 'agent', { title: '需求文档梳理' }),
      makeNode('bmad-1', 'bmadAgent', {
        role: 'Senior Software Engineer',
        agentId: 'Amelia',
        roleDescription: 'Test-first discipline',
      }),
      makeNode('skill-1', 'skill', { skillId: '前端技术文档编写指南' }),
      makeNode('code-1', 'codeAgent', {
        title: '代码分析',
        instruction: '分析项目代码输出技术文档',
        projectPath: '/path/to/singer-center',
        branch: 'master',
      }),
      makeNode('lark-write', 'lark', {
        action: 'write',
        url: 'https://x.feishu.cn/wiki/target',
        specStep: 'plan',
      }),
    ]
    const scEdges = [
      makeEdge('input-1', 'lark-read'),
      makeEdge('lark-read', 'agent-1'),
      makeEdge('memory-1', 'agent-1'),
      makeEdge('agent-1', 'code-1'),
      makeEdge('bmad-1', 'code-1'),
      makeEdge('skill-1', 'code-1'),
      makeEdge('code-1', 'lark-write'),
    ]

    const { yaml } = buildOpenSpecWorkflow(scNodes, scEdges, {
      name: '音乐人中心',
    })

    // agent → proposal artifact（类型兜底），instruction 含输入上下文引用
    expect(yaml).toContain('- id: proposal')
    expect(yaml).toContain('## 输入上下文')
    expect(yaml).toContain('inputs/user-input/')
    // lark read 引用 urls.md（不内联 URL、不内联取数命令）
    expect(yaml).toContain(
      'openspec/schemas/音乐人中心/inputs/urls.md 的「Lark 文档（读取）」第 1 条',
    )
    expect(yaml).toContain('memory/memory.md')

    // codeAgent 经 lark write 反向挂接获得 design artifact，instruction 含角色/路径/投递
    expect(yaml).toContain('- id: design')
    expect(yaml).toContain('## 角色')
    expect(yaml).toContain('Amelia')
    // 项目路径不内联：引用 urls.md 的「项目位置」段
    expect(yaml).toContain(
      '项目路径：见 openspec/schemas/音乐人中心/inputs/urls.md 的「项目位置」第 1 条',
    )
    expect(yaml).not.toContain('/path/to/singer-center')
    expect(yaml).toContain(
      '使用 lark-cli 将 design.md 全文写入飞书文档（URL 见 openspec/schemas/音乐人中心/inputs/urls.md 的「Lark 文档（写入）」第 1 条）',
    )
    expect(yaml).not.toContain('https://x.feishu.cn/wiki/target')
    expect(yaml).toContain('@design.md')

    // skill 引用注入 codeAgent 上下文
    expect(yaml).toContain('skills/前端技术文档编写指南/SKILL.md')

    // lark write 不产出独立 artifact、不被当作输入源
    expect(yaml).not.toContain('- id: deliver')

    // tasks 自动补全 + apply 跟踪
    expect(yaml).toContain('自动补全')
    expect(yaml).toContain('tracks: tasks.md')
    expect(yaml).toContain(
      'apply:\n  requires:\n    - tasks\n  tracks: tasks.md',
    )
  })

  it('speckit：lark write 生成投递 shell 步骤（不生成拉取步骤）', () => {
    const scNodes = [
      makeNode('code-1', 'codeAgent', { instruction: '分析代码' }),
      makeNode('lark-write', 'lark', {
        action: 'write',
        url: 'https://x.feishu.cn/wiki/target',
        specStep: 'plan',
      }),
    ]
    const { yaml } = buildSpecKitWorkflow(
      scNodes,
      [makeEdge('code-1', 'lark-write')],
      { name: '测试' },
    )
    expect(yaml).toContain('+update')
    expect(yaml).toContain('--content @plan.md')
    expect(yaml).toContain('inputs/urls.md')
    expect(yaml).not.toContain('https://x.feishu.cn/wiki/target')
    // write 节点不被当作输入源拉取
    expect(yaml).not.toContain('+fetch')
  })

  it('spec：只认手动标注，artifact id 用 specStep key，无 tasks 自动补全', () => {
    const scNodes = [
      makeNode('input-1', 'userInput', { input: { prompt: '需求描述' } }),
      makeNode('lark-read', 'lark', {
        url: 'https://x.feishu.cn/wiki/read',
        specStep: 'spec',
      }),
      makeNode('agent-1', 'agent', { title: '需求文档梳理', specStep: 'spec' }),
      makeNode('agent-unmarked', 'agent', { title: '未标注节点' }),
      makeNode('code-1', 'codeAgent', {
        title: '代码分析',
        instruction: '分析项目代码输出技术文档',
        projectPath: '/path/to/singer-center',
      }),
      makeNode('lark-write', 'lark', {
        action: 'write',
        url: 'https://x.feishu.cn/wiki/target',
        specStep: 'plan',
      }),
    ]
    const scEdges = [
      makeEdge('input-1', 'lark-read'),
      makeEdge('lark-read', 'agent-1'),
      makeEdge('agent-1', 'code-1'),
      makeEdge('agent-unmarked', 'code-1'),
      makeEdge('code-1', 'lark-write'),
    ]

    const { yaml, workflowPath } = buildSpecWorkflow(scNodes, scEdges, {
      name: '音乐人中心',
    })

    // lark read + spec → spec.md 拉取 artifact（输入节点优先，agent+spec 跳过）
    expect(yaml).toContain('- id: spec')
    expect(yaml).toContain('spec.md')
    // lark write + plan 反向挂接到 codeAgent → plan.md（非 design.md）
    expect(yaml).toContain('- id: plan')
    expect(yaml).not.toContain('- id: design')
    expect(yaml).toContain('@plan.md')
    expect(yaml).toContain(
      '使用 lark-cli 将 plan.md 全文写入飞书文档（URL 见 spec/changes/音乐人中心/inputs/urls.md 的「Lark 文档（写入）」第 1 条）',
    )
    expect(yaml).not.toContain('https://x.feishu.cn/wiki/target')

    // 未标注的处理节点不产出 artifact、无类型兜底、无 tasks 自动补全、无 apply 段
    expect(yaml).not.toContain('- id: proposal')
    expect(yaml).not.toContain('未标注节点')
    expect(yaml).not.toContain('- id: tasks')
    expect(yaml).not.toContain('自动补全')
    expect(yaml).not.toContain('apply:')

    // 输入物引用带 spec/changes/<name>/ 前缀
    expect(yaml).toContain('spec/changes/音乐人中心/inputs/user-input/')

    // workflow.yaml 路径：spec/changes/<name>/specs/<name>/workflow.yaml
    expect(workflowPath).toBe(
      'spec/changes/音乐人中心/specs/音乐人中心/workflow.yaml',
    )
  })

  it('speckit：knowledgeRetrieval 双模式生成运行时步骤（api→curl / local→指令文件）', () => {
    // api 模式：curl 直调远程知识库接口
    const apiNodes = [
      makeNode('kb-api', 'knowledgeRetrieval', {
        mode: 'api',
        url: 'https://kb.example.com/search',
        method: 'POST',
        headers: [{ key: 'Authorization', value: 'Bearer x' }],
        body: '{"query":"{{content}}"}',
      }),
    ]
    const { yaml: apiYaml } = buildSpecKitWorkflow(apiNodes, [], {
      name: '测试',
    })
    // run 值在 YAML 中用单引号包裹，内部单引号会被转义为 ''
    expect(apiYaml).toContain('curl -sS -X POST')
    expect(apiYaml).toContain("''https://kb.example.com/search''")
    expect(apiYaml).toContain('-H "Authorization: Bearer x"')
    expect(apiYaml).toContain('\'\'{"query":"{{content}}"}\'\'')
    expect(apiYaml).toContain('> knowledge-retrieval.md')

    // local 模式：heredoc 写入 MCP 检索指令文件
    const localNodes = [
      makeNode('kb-local', 'knowledgeRetrieval', {
        mode: 'local',
        tool: 'claude',
        skillId: 'kb-skill',
        skillName: '知识库检索指南',
        query: '最近的发布计划',
      }),
    ]
    const { yaml: localYaml } = buildSpecKitWorkflow(localNodes, [], {
      name: '测试',
    })
    expect(localYaml).toContain(
      '使用你的 MCP 连接用户知识库（技能：知识库检索指南）检索：最近的发布计划',
    )

    // 不再产出 knowledge/*.md 快照引用
    expect(apiYaml + localYaml).not.toContain('knowledge/*.md')
  })

  it('openspec：knowledgeRetrieval 作为处理节点产出双模式 instruction，不再引用 knowledge/*.md', () => {
    const nodes = [
      makeNode('input-1', 'userInput', { input: { prompt: '需求描述' } }),
      makeNode('kb-local', 'knowledgeRetrieval', {
        mode: 'local',
        skillId: 'kb-skill',
        skillName: '知识库检索指南',
        query: '最近发布计划',
      }),
      makeNode('kb-api', 'knowledgeRetrieval', {
        mode: 'api',
        url: 'https://kb.example.com/search',
        method: 'POST',
        body: '{"query":"{{content}}"}',
      }),
      makeNode('agent-1', 'agent', { title: '汇总' }),
    ]
    const edges = [
      makeEdge('input-1', 'kb-local'),
      makeEdge('kb-local', 'kb-api'),
      makeEdge('kb-api', 'agent-1'),
    ]
    const { yaml } = buildOpenSpecWorkflow(nodes, edges, { name: '测试' })

    // local → MCP 检索指令；api → curl 命令
    expect(yaml).toContain(
      '使用你的 MCP 连接用户知识库（技能：知识库检索指南）检索：最近发布计划',
    )
    expect(yaml).toContain("curl -sS -X POST 'https://kb.example.com/search'")
    expect(yaml).not.toContain('knowledge/*.md')
  })

  it('speckit：skill 节点本机技能生成指令文件，平台技能仍 cp 导出文件', () => {
    // 本机工具技能（local: 前缀）：写指令文件，不产出生效的 cp 路径
    const localSkill = [
      makeNode('skill-local', 'skill', {
        specStep: 'plan',
        tool: 'codex',
        skillId: 'local:codex:viki',
        skillName: 'viki',
      }),
    ]
    const { yaml: localYaml } = buildSpecKitWorkflow(localSkill, [], {
      name: '测试',
    })
    expect(localYaml).toContain(
      '使用你本机工具的本机技能「viki」完成对应工作。',
    )
    expect(localYaml).not.toContain('skills/local:codex:viki/SKILL.md')

    // 平台技能：行为不变，仍 cp 随 zip 导出的技能文件
    const platformSkill = [
      makeNode('skill-p', 'skill', {
        specStep: 'plan',
        skillId: '前端技术文档编写指南',
      }),
    ]
    const { yaml: pYaml } = buildSpecKitWorkflow(platformSkill, [], {
      name: '测试',
    })
    expect(pYaml).toContain('cp skills/前端技术文档编写指南/SKILL.md plan.md')
  })

  it('openspec：skill 节点本机技能引用本机技能指令，不引用 skills/ 导出路径', () => {
    const nodes = [
      makeNode('input-1', 'userInput', { input: { prompt: '需求' } }),
      makeNode('skill-local', 'skill', {
        specStep: 'plan',
        tool: 'codex',
        skillId: 'local:codex:viki',
        skillName: 'viki',
      }),
      makeNode('agent-1', 'agent', { title: '汇总' }),
    ]
    const edges = [
      makeEdge('input-1', 'skill-local'),
      makeEdge('skill-local', 'agent-1'),
    ]
    const { yaml } = buildOpenSpecWorkflow(nodes, edges, { name: '测试' })
    expect(yaml).toContain('本机工具技能「viki」')
    expect(yaml).not.toContain('skills/local:codex:viki')
  })

  it('skill：常规工程导出为 SKILL.md，无需 specStep，prompt 注入首个输入节点', () => {
    const nodes = [
      makeNode('input-1', 'userInput', { input: { prompt: '附加提示词' } }),
      makeNode('kb-local', 'knowledgeRetrieval', {
        mode: 'local',
        skillName: '知识库检索指南',
        query: '最近发布计划',
      }),
      makeNode('code-1', 'codeAgent', {
        instruction: '分析项目代码',
        projectPath: '/path/to/singer-center',
        branch: 'master',
      }),
      makeNode('skill-1', 'skill', {
        skillId: '前端技术文档编写指南',
        skillName: '前端技术文档编写指南',
      }),
      makeNode('output-1', 'aiOutput', { outputPath: 'docs/report.md' }),
    ]
    const edges = [
      makeEdge('input-1', 'kb-local'),
      makeEdge('kb-local', 'code-1'),
      makeEdge('skill-1', 'code-1'),
      makeEdge('code-1', 'output-1'),
    ]
    const { yaml, workflowPath } = buildSkillWorkflow(nodes, edges, {
      name: '技术文档工作流',
    })

    // 路径：skills/<name>/SKILL.md
    expect(workflowPath).toBe('skills/技术文档工作流/SKILL.md')

    // frontmatter：name + description（自动生成）
    expect(yaml.startsWith('---\nname: 技术文档工作流\n')).toBe(true)
    expect(yaml).toContain('description: >-')

    // 首个 userInput → <prompt> 注入
    expect(yaml).toContain('## 执行步骤')
    expect(yaml).toContain('用户输入 <prompt>')
    expect(yaml).toContain('取调用 /技术文档工作流 <prompt> 时的 prompt 内容')
    // 静态输入不内联进 SKILL 正文，改为引用随全量导出落盘的文件（与 SKILL.md 同级）
    expect(yaml).toContain('附加提示词：见inputs/user-input/')
    expect(yaml).not.toContain('附加提示词：附加提示词')

    // 各节点按拓扑序映射为自然语言步骤，不产出 command/step/spec 结构
    expect(yaml).toContain(
      '使用你的 MCP 连接用户知识库检索：查询内容：最近发布计划',
    )
    // 项目路径不内联：引用 urls.md 的「项目位置」段
    expect(yaml).toContain(
      '在项目（位置见 inputs/urls.md 的「项目位置」第 1 条）执行：分析项目代码',
    )
    expect(yaml).not.toContain('/path/to/singer-center')
    expect(yaml).toContain('使用技能「前端技术文档编写指南」')
    expect(yaml).toContain('最终产物输出保存到 docs/report.md')
    expect(yaml).not.toContain('command:')
    expect(yaml).not.toContain('speckit.')
  })

  it('skill：Agent 节点按连线推导输入 / 输出定义', () => {
    const nodes = [
      makeNode('draft', 'agent', {
        title: '技术文档草稿',
        instruction: '撰写技术文档初稿',
      }),
      makeNode('kb', 'knowledgeRetrieval', {
        title: '知识库检索结果',
        mode: 'local',
        query: '历史方案',
      }),
      makeNode('merge', 'agent', {
        title: '融合修订',
        instruction: '将检索结果中的相关信息融合进技术文档',
      }),
      makeNode('write', 'lark', {
        title: '目标文档',
        action: 'write',
        url: 'https://x.feishu.cn/wiki/WRITE',
      }),
    ]
    const edges = [
      makeEdge('draft', 'merge'),
      makeEdge('kb', 'merge'),
      makeEdge('merge', 'write'),
    ]
    const { yaml } = buildSkillWorkflow(nodes, edges, {
      name: '技术文档工作流',
    })

    // 上游连线 → 输入清单（步骤号 + 节点标题）
    expect(yaml).toContain(
      '输入：步骤 1 的技术文档草稿、步骤 2 的知识库检索结果。',
    )
    // 下游连线 + 节点类型 → 输出与去向
    expect(yaml).toContain(
      '将检索结果中的相关信息融合进技术文档，输出本步骤产物，供步骤 4 的目标文档写入飞书文档。',
    )
    // 不再输出含糊占位
    expect(yaml).not.toContain('调用 AI 完成本步骤')
  })

  it('skill：用户提供 description 时使用其值，否则自动生成', () => {
    const nodes = [
      makeNode('input-1', 'userInput', {}),
      makeNode('agent-1', 'agent', { instruction: '分析需求' }),
    ]
    const edges = [makeEdge('input-1', 'agent-1')]
    const auto = buildSkillWorkflow(nodes, edges, { name: 'demo' })
    expect(auto.yaml).toContain('用 /demo <prompt> 触发')

    const custom = buildSkillWorkflow(nodes, edges, {
      name: 'demo',
      description: '用户自定义描述',
    })
    expect(custom.yaml).toContain('用户自定义描述')
    expect(custom.yaml).not.toContain('用 /demo <prompt> 触发')
  })

  it('skill：飞书读/写节点的 URL 不内联，改为引用 inputs/urls.md', () => {
    const nodes = [
      makeNode('input-1', 'userInput', {}),
      makeNode('lark-read', 'lark', {
        action: 'read',
        url: 'https://x.feishu.cn/wiki/AAA',
      }),
      makeNode('lark-write', 'lark', {
        action: 'write',
        url: 'https://x.feishu.cn/wiki/BBB',
      }),
    ]
    const edges = [
      makeEdge('input-1', 'lark-read'),
      makeEdge('lark-read', 'lark-write'),
    ]
    const { yaml } = buildSkillWorkflow(nodes, edges, { name: 'lark-demo' })

    expect(yaml).toContain(
      '读取飞书文档（URL 见 inputs/urls.md 的「Lark 文档（读取）」）',
    )
    expect(yaml).toContain(
      '将产物写入飞书文档（URL 见 inputs/urls.md 的「Lark 文档（写入）」）',
    )
    expect(yaml).not.toContain('https://x.feishu.cn/wiki/AAA')
    expect(yaml).not.toContain('https://x.feishu.cn/wiki/BBB')
  })

  it('skill：系统提示词非全量导出内联全文，全量导出改为 path 引用', () => {
    const nodes = [
      makeNode('kw', 'keywordAgent', { title: '关键词提取' }),
      makeNode('code', 'codeAgent', { title: '代码分析', mode: 'batch' }),
    ]
    const edges = [makeEdge('kw', 'code')]

    // 非全量：内联全文（内容由调用方注入，避免 SKILL.md 丢提示词）
    const inline = buildSkillWorkflow(nodes, edges, {
      name: 'demo',
      full: false,
      systemPrompts: {
        'keywordAgent.md': 'INLINE-KEYWORD-PROMPT',
        'codeBatch.md': 'INLINE-CODE-BATCH-PROMPT',
      },
    })
    expect(inline.yaml).toContain('## 系统提示词')
    expect(inline.yaml).toContain('INLINE-KEYWORD-PROMPT')
    expect(inline.yaml).toContain('INLINE-CODE-BATCH-PROMPT')

    // 全量：path 引用（真实文件随全量导出落盘 inputs/prompts/），格式为单行加粗
    const full = buildSkillWorkflow(nodes, edges, { name: 'demo', full: true })
    expect(full.yaml).toContain(
      '**系统提示词：请严格遵循 inputs/prompts/keywordAgent.md 中的系统提示词执行本步骤。**',
    )
    // codeAgent batch 模式 → codeBatch.md
    expect(full.yaml).toContain(
      '**系统提示词：请严格遵循 inputs/prompts/codeBatch.md 中的系统提示词执行本步骤。**',
    )
    expect(full.yaml).not.toContain('INLINE-KEYWORD-PROMPT')

    // 未传 systemPrompts 的非全量导出不产出空标题（向后兼容）
    const bare = buildSkillWorkflow(nodes, edges, { name: 'demo' })
    expect(bare.yaml).not.toContain('## 系统提示词')
  })

  it('openspec：全量导出系统提示词以 schemaDir 前缀 path 引用', () => {
    const nodes = [
      makeNode('input-1', 'userInput', { input: { prompt: '需求' } }),
      makeNode('code-1', 'codeAgent', {
        title: '代码分析',
        instruction: '分析项目代码',
      }),
    ]
    const edges = [makeEdge('input-1', 'code-1')]
    const { yaml } = buildOpenSpecWorkflow(nodes, edges, {
      name: '音乐人中心',
      full: true,
    })
    expect(yaml).toContain(
      '**系统提示词：请严格遵循 openspec/schemas/音乐人中心/inputs/prompts/codeAgent.md 中的系统提示词执行本步骤。**',
    )
  })

  it('listCollectableArtifacts：收集需落盘的系统提示词文件（按类型去重）', () => {
    const plan = listCollectableArtifacts([
      makeNode('kw', 'keywordAgent', {}),
      makeNode('code-1', 'codeAgent', {}),
      makeNode('code-2', 'codeAgent', {}),
      makeNode('tp', 'taskPlanner', {}),
      makeNode('sc', 'selfCheck', {}),
      makeNode('agent-1', 'agent', {}),
    ])
    expect([...plan.systemPromptFiles].sort()).toEqual([
      'codeAgent.md',
      'keywordAgent.md',
      'selfCheck.md',
      'taskPlanner.md',
    ])
  })

  it('skill：取消单次执行 → .agent 共享结构，prompts/memory/bmad 与 skills 同层', () => {
    const nodes = [
      makeNode('input-1', 'userInput', { input: { prompt: '需求' } }),
      makeNode('kw', 'keywordAgent', { title: '关键词提取' }),
      makeNode('mem', 'memory', {}),
      makeNode('bmad', 'bmadAgent', {
        role: 'Tester',
        agentId: 'Quinn',
        roleDescription: 'x',
      }),
      makeNode('lark-read', 'lark', {
        url: 'https://x.feishu.cn/wiki/AAA',
      }),
    ]
    const edges = [
      makeEdge('input-1', 'kw'),
      makeEdge('kw', 'mem'),
      makeEdge('mem', 'lark-read'),
    ]
    const { yaml, workflowPath } = buildSkillWorkflow(nodes, edges, {
      name: '技术文档工作流',
      full: true,
      singleRun: false,
    })

    // 主文件：.agent/skills/<name>/SKILL.md
    expect(workflowPath).toBe('.agent/skills/技术文档工作流/SKILL.md')
    // 系统提示词提升到 .agent/prompts/
    expect(yaml).toContain(
      '**系统提示词：请严格遵循 .agent/prompts/keywordAgent.md 中的系统提示词执行本步骤。**',
    )
    // memory / bmad 提升到 .agent 顶层
    expect(yaml).toContain('读取项目记忆文件 .agent/memory/memory.md')
    expect(yaml).toContain('完整角色定义见 .agent/bmad/agents/Quinn.md')
    // urls / user-input 仍在 workflow 目录下
    expect(yaml).toContain(
      'URL 见 .agent/skills/技术文档工作流/inputs/urls.md 的「Lark 文档（读取）」',
    )
    expect(yaml).toContain(
      '附加提示词：见.agent/skills/技术文档工作流/inputs/user-input/',
    )
  })

  it('openspec：取消单次执行 → .agent/openspec/schemas/<name>，各输入物引用带前缀', () => {
    const scNodes = [
      makeNode('input-1', 'userInput', { input: { prompt: '需求描述' } }),
      makeNode('lark-read', 'lark', { url: 'https://x.feishu.cn/wiki/read' }),
      makeNode('memory-1', 'memory', { memoryPath: 'memory/memory.md' }),
      makeNode('agent-1', 'agent', { title: '需求文档梳理' }),
      makeNode('bmad-1', 'bmadAgent', {
        role: 'Senior Software Engineer',
        agentId: 'Amelia',
        roleDescription: 'Test-first discipline',
      }),
      makeNode('skill-1', 'skill', { skillId: '前端技术文档编写指南' }),
      makeNode('code-1', 'codeAgent', {
        title: '代码分析',
        instruction: '分析项目代码输出技术文档',
        projectPath: '/path/to/singer-center',
        branch: 'master',
      }),
      makeNode('lark-write', 'lark', {
        action: 'write',
        url: 'https://x.feishu.cn/wiki/target',
        specStep: 'plan',
      }),
    ]
    const scEdges = [
      makeEdge('input-1', 'lark-read'),
      makeEdge('lark-read', 'agent-1'),
      makeEdge('memory-1', 'agent-1'),
      makeEdge('agent-1', 'code-1'),
      makeEdge('bmad-1', 'code-1'),
      makeEdge('skill-1', 'code-1'),
      makeEdge('code-1', 'lark-write'),
    ]
    const { yaml, workflowPath } = buildOpenSpecWorkflow(scNodes, scEdges, {
      name: '音乐人中心',
      full: true,
      singleRun: false,
    })

    expect(workflowPath).toBe('.agent/openspec/schemas/音乐人中心/schema.yaml')
    // workflow 专属输入物：workflow 目录下
    expect(yaml).toContain(
      '.agent/openspec/schemas/音乐人中心/inputs/urls.md 的「Lark 文档（读取）」第 1 条',
    )
    expect(yaml).toContain(
      '项目路径：见 .agent/openspec/schemas/音乐人中心/inputs/urls.md 的「项目位置」第 1 条',
    )
    // 共享输入物：.agent 顶层
    expect(yaml).toContain(
      '**系统提示词：请严格遵循 .agent/prompts/codeAgent.md 中的系统提示词执行本步骤。**',
    )
    expect(yaml).toContain('完整角色定义见 .agent/bmad/agents/Amelia.md')
    expect(yaml).toContain('.agent/memory/memory.md')
    expect(yaml).toContain('.agent/skills/前端技术文档编写指南/SKILL.md')
  })

  it('skill：控制流节点（retry/if/loop）并入上游步骤，不生成独立步骤', () => {
    const nodes = [
      makeNode('input-1', 'userInput', { input: { prompt: '开始' } }),
      makeNode('diff', 'agent', {
        title: '拉取主分支Diff',
        instruction: '拉取主分支最新代码并输出 diff',
      }),
      makeNode('retry-1', 'retry', {
        title: 'Diff获取失败重试',
        retryDelay: 2,
        maxRetryCount: 3,
        judgmentMode: 'manual',
        errorKeywords: 'timeout',
      }),
      makeNode('review', 'agent', {
        title: 'Code Review分析',
        instruction: '逐文件逐行审查 diff',
      }),
      makeNode('if-1', 'if', { title: '是否通过', expression: 'review 通过' }),
      makeNode('cond-a', 'ifCondition', {
        title: '条件A',
        label: '条件A',
        condition: '无阻断问题',
      }),
    ]
    const edges = [
      makeEdge('input-1', 'diff'),
      makeEdge('diff', 'retry-1'),
      makeEdge('retry-1', 'review'),
      makeEdge('review', 'if-1'),
      makeEdge('if-1', 'cond-a'),
    ]
    const { yaml } = buildSkillWorkflow(nodes, edges, { name: '测试' })

    // 控制节点不生成独立步骤
    expect(yaml).not.toContain('Diff获取失败重试\n')
    expect(yaml).not.toMatch(/^### \d+\. (Diff获取失败重试|是否通过|条件A)$/m)
    // 步骤号只数可见节点：input=1, diff=2, review=3
    expect(yaml).toContain('### 2. 拉取主分支Diff')
    expect(yaml).toContain('### 3. Code Review分析')
    // retry 编排说明并入上游 diff 步骤
    expect(yaml).toContain(
      '控制编排「Diff获取失败重试」（重试）：本步骤执行失败时（按关键词匹配失败（timeout）），等待 2 秒后重试，最多 3 次。',
    )
    // if 编排说明并入上游 review 步骤，条件子节点并入父节点
    expect(yaml).toContain(
      '控制编排「是否通过」（条件分支）：本步骤完成后按条件选择分支，判断依据：review 通过。',
    )
    expect(yaml).toContain('- 分支「条件A」：无阻断问题')
    // 下游引用穿透控制节点：review 的输入指向 diff（步骤 2），而非 retry
    expect(yaml).toContain('输入：步骤 2 的拉取主分支Diff。')
    // 上游输出穿透控制节点：diff 的输出指向 review（步骤 3）
    expect(yaml).toContain('供步骤 3 的Code Review分析使用')
  })

  it('skill：loop 循环节点并入上游步骤，loopCondition 条件并入父节点', () => {
    const nodes = [
      makeNode('input-1', 'userInput', { input: { prompt: '开始' } }),
      makeNode('fetch', 'agent', {
        title: '拉取数据',
        instruction: '拉取数据',
      }),
      makeNode('loop-1', 'loop', {
        title: '批量循环',
        maxLoopCount: 8,
        condition: '还有未处理数据',
      }),
      makeNode('loop-cond', 'loopCondition', {
        title: '循环条件',
        condition: '全部处理完成',
      }),
    ]
    const edges = [
      makeEdge('input-1', 'fetch'),
      makeEdge('fetch', 'loop-1'),
      makeEdge('loop-1', 'loop-cond'),
    ]
    const { yaml } = buildSkillWorkflow(nodes, edges, { name: '测试' })

    expect(yaml).not.toMatch(/^### \d+\. (批量循环|循环条件)$/m)
    expect(yaml).toContain('### 2. 拉取数据')
    expect(yaml).toContain(
      '控制编排「批量循环」（循环）：本步骤循环执行，最多 8 次，继续条件：还有未处理数据。',
    )
  })

  it('openspec：控制节点不产 artifact，编排说明并入最近上游处理节点', () => {
    const nodes = [
      makeNode('input-1', 'userInput', {
        input: { prompt: '需求' },
        specStep: 'spec',
      }),
      makeNode('diff', 'agent', {
        title: '拉取主分支Diff',
        instruction: '拉取 diff',
        specStep: 'research',
      }),
      makeNode('retry-1', 'retry', {
        title: 'Diff获取失败重试',
        maxRetryCount: 3,
      }),
      makeNode('review', 'agent', {
        title: 'Code Review分析',
        instruction: '审查 diff',
        specStep: 'plan',
      }),
    ]
    const edges = [
      makeEdge('input-1', 'diff'),
      makeEdge('diff', 'retry-1'),
      makeEdge('retry-1', 'review'),
    ]
    const { yaml } = buildOpenSpecWorkflow(nodes, edges, { name: '测试' })

    // 控制节点不生成独立 artifact（仅以编排说明出现）
    expect(yaml).not.toContain('description: Diff获取失败重试')
    expect(yaml).not.toMatch(/- id: diff-获取失败重试/)
    // retry 编排说明挂在 diff（research）的 instruction 里
    expect(yaml).toMatch(
      /控制编排「Diff获取失败重试」（重试）：[\s\S]*最多 3 次/,
    )
  })

  it('spec / speckit：取消单次执行 → 主文件与 shell 引用带 .agent 前缀', () => {
    const nodes = [
      makeNode('input-1', 'userInput', {
        input: { prompt: '需求' },
        specStep: 'spec',
      }),
      makeNode('code-1', 'codeAgent', {
        title: '代码分析',
        instruction: '分析项目代码',
      }),
    ]
    const edges = [makeEdge('input-1', 'code-1')]

    const spec = buildSpecWorkflow(nodes, edges, {
      name: '音乐人中心',
      singleRun: false,
    })
    expect(spec.workflowPath).toBe(
      '.agent/spec/changes/音乐人中心/specs/音乐人中心/workflow.yaml',
    )

    const speckit = buildSpecKitWorkflow(nodes, edges, {
      name: '测试',
      singleRun: false,
    })
    expect(speckit.workflowPath).toBe(
      '.agent/specify/workflows/测试/workflow.yml',
    )
    // userInput gate + fetch 步骤引用 .agent 前缀
    expect(speckit.yaml).toContain('cp .agent/inputs/user-input/')
  })

  it('collectArtifacts：取消单次执行 → 各输入物落盘位置符合 .agent 布局', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'picop-collect-'))
    try {
      await fs.mkdir(path.join(baseDir, 'prompts'), { recursive: true })
      await fs.mkdir(path.join(baseDir, 'memory'), { recursive: true })
      await fs.mkdir(
        path.join(baseDir, 'workflows', 'skills', '前端技术文档编写指南'),
        { recursive: true },
      )
      await fs.writeFile(path.join(baseDir, 'prompts', 'keywordAgent.md'), 'KW')
      await fs.writeFile(path.join(baseDir, 'memory', 'memory.md'), 'MEM')
      await fs.writeFile(
        path.join(
          baseDir,
          'workflows',
          'skills',
          '前端技术文档编写指南',
          'SKILL.md',
        ),
        'SK',
      )

      const nodes = [
        makeNode('input-1', 'userInput', { input: { prompt: '需求' } }),
        makeNode('kw', 'keywordAgent', {}),
        makeNode('mem', 'memory', {}),
        makeNode('bmad', 'bmadAgent', { role: 'Tester', agentId: 'Quinn' }),
        makeNode('skill-1', 'skill', { skillId: '前端技术文档编写指南' }),
        makeNode('lark-read', 'lark', { url: 'https://x.feishu.cn/wiki/AAA' }),
      ]
      const collected = await collectArtifacts(nodes, {
        baseDir,
        format: 'skill',
        name: '技术文档工作流',
        singleRun: false,
      })
      const paths = collected.map((c) => c.path)

      expect(paths).toContain('.agent/prompts/keywordAgent.md')
      expect(paths).toContain('.agent/memory/memory.md')
      expect(paths).toContain('.agent/bmad/agents/Quinn.md')
      expect(paths).toContain('.agent/skills/前端技术文档编写指南/SKILL.md')
      expect(paths).toContain('.agent/skills/lark-cli/SKILL.md')
      expect(paths).toContain('.agent/skills/技术文档工作流/inputs/urls.md')
      expect(
        paths.some((p) =>
          p.startsWith('.agent/skills/技术文档工作流/inputs/user-input/'),
        ),
      ).toBe(true)
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true })
    }
  })
})
