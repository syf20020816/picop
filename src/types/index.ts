import type { Node, NodeProps } from '@xyflow/react'
import type { SpecStepKey } from '#/constants/spec'

export const NodeTypes = {
  USER_INPUT: 'userInput',
  AGENT: 'agent',
  AI_OUTPUT: 'aiOutput',
  ANSWER: 'answer',
  BMAD_AGENT: 'bmadAgent',
  LARK: 'lark',
  IF: 'if',
  IF_CONDITION: 'ifCondition',
  LOOP: 'loop',
  LOOP_CONDITION: 'loopCondition',
  RETRY: 'retry',
  CODE_AGENT: 'codeAgent',
  SKILL: 'skill',
  LARK_TEMPLATE: 'larkTemplate',
  MEMORY: 'memory',
  KNOWLEDGE_RETRIEVAL: 'knowledgeRetrieval',
  KEYWORD_AGENT: 'keywordAgent',
  TASK_PLANNER: 'taskPlanner',
  SELF_CHECK: 'selfCheck',
} as const

export type NodeType = (typeof NodeTypes)[keyof typeof NodeTypes]

export type NNode = {
  /** 节点名称 */
  title: string
  /** 节点描述 */
  description?: string
  /** Spec 阶段标记（Spec 模式专用）：该节点输出属于工作流的哪个阶段，由使用者手动标记 */
  specStep?: SpecStepKey
}

export const InputKinds = {
  text: 'text',
  file: 'file',
  url: 'url',
  prompt: 'prompt',
}

export type InputKind = (typeof InputKinds)[keyof typeof InputKinds]

export type NUserInputData = {
  input?: {
    /** 提示词 */
    prompt?: string
    /** 关联的技能 ID（平台技能为原始 ID；本机技能为 local:<tool>:<skill> 复合 id） */
    skillId?: string
    /** 技能名称（展示用） */
    skillName?: string
  }
} & NNode

export type NUserInput = Node<NUserInputData, typeof NodeTypes.USER_INPUT>

export type NAgentData = NNode & {
  /** 本地 CLI 工具 ID（如 claude-code/codex/deepseek），
   *  节点由用户本机的 AI CLI 无头模式执行，平台不再持有模型配置 */
  tool?: string
  /** 智能体元信息（模型配置已下线，仅保留别名等非敏感字段） */
  modal?: {
    /** 智能体别名 */
    alias?: string
  }
  input?: Pick<NUserInputData, 'input'>
  /** 输出结果 */
  output?: string
}

export type NAgent = Node<NAgentData, typeof NodeTypes.AGENT>

export type NAIOutputData = NNode & {
  /** 输出内容 */
  content?: string
  /** 来源智能体 */
  sourceAgent?: string
  /** 导出文件路径 */
  outputPath?: string
}

export type NAIOutput = Node<NAIOutputData, typeof NodeTypes.AI_OUTPUT>

/** Answer节点：在智能体执行过程中暂停等待用户输入 */
export type NAnswerData = NNode & {
  /** 向用户提出的问题/说明 */
  question?: string
  /** 用户回复内容 */
  reply?: string
  /** 回复选项（如果限定选择） */
  options?: string[]
}

export type NAnswer = Node<NAnswerData, typeof NodeTypes.ANSWER>

/** BMad子节点：为智能体节点提供角色指令（如 Skill） */
export type NBMadAgentData = NNode & {
  /** 智能体角色 */
  role?: string
  /** 角色描述/职责说明 */
  roleDescription?: string
  /** BMad Agent ID (如 bmad-agent-analyst) */
  agentId?: string
  /** 系统提示词 */
  systemPrompt?: string
}

export type NBMadAgent = Node<NBMadAgentData, typeof NodeTypes.BMAD_AGENT>

/** Lark节点：与Lark CLI交互 */
export type NLarkData = NNode & {
  /** 操作类型 */
  action?: 'read' | 'write' | 'create'
  /** 飞书文档URL/Token */
  url?: string
  /** 写入/创建的内容 */
  content?: string
  /** 操作结果 */
  result?: string
}

export type NLark = Node<NLarkData, typeof NodeTypes.LARK>

// ======== 控制节点 ========

/** ifNode：判断节点，根据条件选择不同分支 */
export type NIfData = NNode & {
  /** 判断表达式（描述性文本） */
  expression?: string
}

export type NIf = Node<NIfData, typeof NodeTypes.IF>

/** ifConditionNode：if 分支条件节点 */
export type NIfConditionData = NNode & {
  /** 条件表达式/描述 */
  condition?: string
  /** 分支描述，如 "条件A", "条件B" */
  label?: string
}

export type NIfCondition = Node<NIfConditionData, typeof NodeTypes.IF_CONDITION>

/** loopNode：循环节点 */
export type NLoopData = NNode & {
  /** 最大循环次数，默认 5 */
  maxLoopCount: number
  /** 当前循环次数（运行时） */
  currentLoopCount?: number
  /** 循环条件描述 */
  condition?: string
}

export type NLoop = Node<NLoopData, typeof NodeTypes.LOOP>

/** loopConditionNode：循环条件判断节点 */
export type NLoopConditionData = NNode & {
  /** 循环条件表达式 */
  condition?: string
}

export type NLoopCondition = Node<NLoopConditionData, typeof NodeTypes.LOOP_CONDITION>

/** retryNode：错误重试节点 */
export type NRetryData = NNode & {
  /** 重试间隔（秒），默认 1 */
  retryDelay: number
  /** 最大重试次数，默认 5 */
  maxRetryCount: number
  /** 判断模式：manual | ai */
  judgmentMode: 'manual' | 'ai'
  /** 人工判断：用于匹配错误状态的关键词/标识 */
  errorKeywords?: string
  /** AI 判断：连接的 AgentNode ID */
  agentNodeId?: string
}

export type NRetry = Node<NRetryData, typeof NodeTypes.RETRY>

/** codeAgentNode：代码自主探索节点 — AI 通过 Tool Calling 自主分析项目 */
export type NCodeAgentData = NNode & {
  /** 执行模式：analyze（代码分析，默认）/ batch（按 tasks.md 分批写代码） */
  mode?: 'analyze' | 'batch'
  /** 项目路径（本地目录或 Git 仓库 URL） */
  projectPath?: string
  /** Git 分支 */
  branch?: string
  /** AI 分析目标/指令 */
  instruction?: string
  /** 最大迭代次数（防止死循环） */
  maxIterations?: number
  /** 应用地图（App-Desc）文件路径：由使用者自行生成并提供（相对项目根目录或绝对路径），平台只读取注入，不自动生成 */
  appMapPath?: string
  /** 本地 CLI 工具 ID（如 claude-code/codex/deepseek），CLI 直接在项目目录执行 */
  tool?: string
  /** 执行输出 - batch 模式已完成的批次号 */
  completedBatches?: number[]
  /** 执行输出 - batch 模式总批次 */
  totalBatches?: number
}

export type NCodeAgent = Node<NCodeAgentData, typeof NodeTypes.CODE_AGENT>

/** Skill节点：加载技能指令并传递到下游 */
export type NSkillData = NNode & {
  /** 本地 CLI 工具 ID（可选）：选择后技能可来自该工具的本机 skills */
  tool?: string
  /** 关联的技能ID（平台技能为原始 ID；本机技能为 local:<tool>:<skill> 复合 id） */
  skillId?: string
  /** 技能名称（展示用） */
  skillName?: string
  /** 技能指令内容（执行时加载） */
  instructions?: string
}

export type NSkill = Node<NSkillData, typeof NodeTypes.SKILL>

/** Memory节点：读取记忆文件并传递到下游工作流 */
export type NMemoryData = NNode & {
  /** 记忆文件路径（相对于项目根目录） */
  memoryPath?: string
}

export type NMemory = Node<NMemoryData, typeof NodeTypes.MEMORY>

/** LarkTemplate节点：获取 Lark 文档作为输出模板 */
export type NLarkTemplateData = NNode & {
  /** Lark 文档 URL */
  templateUrl?: string
  /** 模板内容（执行时获取） */
  templateContent?: string
}

export type NLarkTemplate = Node<NLarkTemplateData, typeof NodeTypes.LARK_TEMPLATE>

/** 知识库检索节点：查询用户自己的外部知识库，不依赖平台数据库（双模式） */
export type NKnowledgeRetrievalData = NNode & {
  /** 检索模式：local=本地工具（用户配置 MCP 的 agent 查自己的库），api=远程 API 请求 */
  mode?: 'local' | 'api'
  // ---- local 模式 ----
  /** 自然语言查询（留空则使用上游输入） */
  query?: string
  /** 本地 CLI 工具 ID（claude/codex 等，通过 Runner 调用） */
  tool?: string
  /** 可选 SKILL ID：作为查询指令上下文 */
  skillId?: string
  /** SKILL 名称（展示用） */
  skillName?: string
  // ---- api 模式 ----
  /** 请求 URL */
  url?: string
  /** 请求方法 */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  /** 请求头（键值对） */
  headers?: Array<{ key: string; value: string }>
  /** 请求体（JSON 文本，支持 {{field}} 占位符引用上游输出） */
  body?: string
  /** 执行结果 */
  result?: {
    retrievalContent: string
    count: number
    mode?: 'local' | 'api'
  }
}

export type NKnowledgeRetrieval = Node<NKnowledgeRetrievalData, typeof NodeTypes.KNOWLEDGE_RETRIEVAL>

/** 关键词提取节点：调用本地 AI 工具从上游内容中提取关键词列表 */
export type NKeywordAgentData = NNode & {
  /** 本地 CLI 工具 ID（如 claude-code/codex/deepseek） */
  tool?: string
  /** 关键词输出格式（JSON 模板） */
  format?: string
  /** 执行结果 - 提取到的关键词数组 */
  keywords?: string[]
  /** 执行输出 */
  output?: string
}

export type NKeywordAgent = Node<NKeywordAgentData, typeof NodeTypes.KEYWORD_AGENT>

/** 任务拆解节点：把 plan.md + 现有 spec 骨架拆解为可独立执行的 batch 任务清单（不直接写代码） */
export type NTaskPlannerData = NNode & {
  /** 本地 CLI 工具 ID（如 claude-code/codex/deepseek） */
  tool?: string
  /** 自定义拆解指令（追加到系统提示词之后，如限定批次粒度/技术栈） */
  instruction?: string
  /** 执行输出 - 批次数量 */
  batchCount?: number
  /** 执行输出 - 任务总数 */
  taskCount?: number
  /** 执行输出 - 校验警告 */
  warnings?: string[]
  /** 执行输出（tasks.md 全文，供下游按文本累积） */
  response?: string
}

export type NTaskPlanner = Node<NTaskPlannerData, typeof NodeTypes.TASK_PLANNER>

export type NSelfCheckData = NNode & {
  /** 本地 CLI 工具 ID（如 claude-code/codex/deepseek），独立会话评审 */
  tool?: string
  /** 项目路径（用于读取 git diff 前后对比） */
  projectPath?: string
  /** 自检指令（可选，追加到系统提示词之后） */
  instruction?: string
  /** 视角（BMad 角色）：直接注入该角色的 SKILL 作为评审身份，BMad 自带视角，无需手写 */
  role?: string
  /** 视角角色的 SKILL 描述（选中 BMad 角色时自动写入） */
  roleDesc?: string
  /** 执行输出 - 总体结论（PASS / CONDITIONAL_PASS / FAIL） */
  overallResult?: string
  /** 执行输出 - 报告目录（check_reports/ 绝对路径） */
  checkDir?: string
  /** 执行输出 - 评审报告全文 */
  response?: string
}

export type NSelfCheck = Node<NSelfCheckData, typeof NodeTypes.SELF_CHECK>

export type AppNode = NodeProps<
  | NUserInput | NAgent | NAIOutput | NAnswer | NBMadAgent | NLark
  | NIf | NIfCondition | NLoop | NLoopCondition | NRetry | NCodeAgent
  | NSkill | NLarkTemplate | NMemory | NKnowledgeRetrieval
  | NKeywordAgent | NTaskPlanner | NSelfCheck
> | null
