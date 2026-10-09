import { describe, expect, it } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import {
  buildSpecKitWorkflow,
  buildOpenSpecWorkflow,
  buildSpecWorkflow,
  buildSkillWorkflow,
} from '#/services/exporter'

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
})
