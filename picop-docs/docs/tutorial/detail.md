---
title: 深入指南
order: 3
---

# 深入指南（Detail）

本指南深入讲解平台的节点体系、执行引擎、调试机制与优化策略，帮助你编排更复杂、更高效的工作流。

---

## 一、20 种节点详解

### 1.1 输入与输出

| 节点类型 | 标识        | 用途                                      |
| -------- | ----------- | ----------------------------------------- |
| 用户输入 | `userInput` | 接受用户输入的文本、提示词、文件/URL 路径 |
| 回答     | `answer`    | 工作流暂停，等待用户输入后继续            |
| AI 输出  | `aiOutput`  | 展示最终输出结果                          |

### 1.2 智能体类

| 节点类型     | 标识           | 用途                                                                                                                  |
| ------------ | -------------- | --------------------------------------------------------------------------------------------------------------------- |
| 智能体       | `agent`        | 调用本机 AI CLI 工具（Claude / Codex / DeepSeek）分析和生成，接收上游所有输入 + 全链路累积上下文                      |
| BMad 角色    | `bmadAgent`    | 赋予智能体特定角色指令（分析师/架构师/SM 等），**纯 persona 注入，不调用 AI**；BMad 在上游、Agent 在下游，方向已修正  |
| 代码处理     | `codeAgent`    | 用本机 AI CLI 在项目目录直接编码，支持 `analyze`（只读）/ `batch`（按 tasks.md 分批写代码）双模式                     |
| 任务拆解     | `taskPlanner`  | 把上游概设输出的 plan 拆解为可独立执行的 batch 任务清单，产出 tasks.md                                                |
| 自检 Agent   | `selfCheck`    | 独立会话评审：配置 BMad 角色注入评审身份，材料按 git diff / 上游累积产物自动降级，输出 PASS / CONDITIONAL_PASS / FAIL |
| 关键词智能体 | `keywordAgent` | 从输入中提取关键词列表，供下游使用                                                                                    |

> 所有 AI 类节点（agent / codeAgent / taskPlanner / selfCheck / keywordAgent）都不再配置模型，而是在编辑面板中选择**本地工具**，由本机 Runner 调起对应的 AI CLI 无头模式执行。平台不持有任何模型凭据。

### 1.3 知识库与外部系统

| 节点类型       | 标识                 | 用途                                                                                                                                                                                     |
| -------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 知识库检索     | `knowledgeRetrieval` | 双模式：本地模式用本机 AI CLI（经其配置的 MCP）以自然语言查用户自己的知识库，可选挂一个 SKILL 作为查询指令；远程 API 模式编辑请求（URL / 方法 / Headers / Body）直调用户自己的知识库接口 |
| Lark 文档      | `lark`               | 读取/写入/创建飞书文档，通过 lark-cli 操作                                                                                                                                               |
| Lark 模板      | `larkTemplate`       | 读取飞书文档作为内容模板，传递给下游                                                                                                                                                     |
| Lark Wiki 遍历 | `larkWikiTraversal`  | 遍历飞书知识库节点层级并读取文档内容                                                                                                                                                     |
| 记忆           | `memory`             | 读写持久化记忆文件（markdown 格式），跨工作流传递上下文                                                                                                                                  |
| Skill          | `skill`              | 执行 BMad Skill（分析师/开发者等角色技能）                                                                                                                                               |

### 1.4 流程控制

| 节点类型 | 标识                     | 用途                                               |
| -------- | ------------------------ | -------------------------------------------------- |
| 判断     | `if` / `ifCondition`     | 条件分支，按关键词匹配或 AI 判断选择路径           |
| 循环     | `loop` / `loopCondition` | 循环迭代，支持计数器模式和上游数据驱动模式         |
| 重试     | `retry`                  | 捕获上游错误，支持关键词匹配和 AI 判断两种重试条件 |

---

## 二、执行引擎

### 2.1 引擎流程

1. **拓扑排序** — Kahn 算法确定执行顺序，检测循环依赖
2. **分层并行** — 每层节点用 `Promise.all` 并行执行
3. **上下文累积** — 每个节点执行时 BFS 收集全部上游祖先节点
4. **Checkpoint** — 每层执行完成后把 `PipelineContext` 写盘到 `.pin/exec_state_<workflowId>.json`

### 2.2 内容块优先级与预算截断

agent 节点把上游内容按优先级拼入 system prompt：

| 优先级 | 内容块         |
| ------ | -------------- |
| 10     | 需求分析       |
| 20     | 指令（角色）   |
| 30     | 关键词         |
| 40     | 模板           |
| 50     | 其他内容       |
| 60     | 知识库检索结果 |

- 预算 = `min(tokenMax × 1.2, 150K 字符)`
- 超预算时按优先级保留高价值块的开头（检索结果块整体靠前），而非整块丢弃
- 用户消息兜底 `JSON.stringify` 时排除 `upstreams`，避免与 system prompt 内容块重复打包

### 2.3 按节点类型字段提取（Token 优化）

| 节点类型                 | 累积字段           | 丢弃字段                    |
| ------------------------ | ------------------ | --------------------------- |
| agent / codeAgent        | `response`         | model / usage / passThrough |
| keywordAgent             | `keywords`         | queries / raw               |
| knowledgeRetrieval       | `retrievalContent` | results 数组 / count        |
| userInput                | `text` / `prompt`  | files / urls                |
| larkTemplate             | `templateContent`  | templateUrl                 |
| lark / larkWikiTraversal | `result`           | action / url                |
| memory                   | `content`          | —                           |
| bmadAgent                | `instructions`     | role / agentId              |
| 其他类型                 | 内容类字段回退     | 执行元数据                  |

---

## 三、CodeAgent 节点（双模式）

用本机 AI CLI（Claude Code / Codex / DeepSeek）在项目目录直接编码，CLI 自身就是编码 agent（读写文件、跑命令、git），平台不再维护工具调用循环。

### analyze 模式（默认）

- CLI 在项目目录只读分析，产出技术方案文档（CLI 安全模式，不写文件）

### batch 模式

- 按 tasks.md 批次实现代码（CLI auto 模式，权限放开允许写文件）
- 指令要求 CLI 每完成一个任务在 tasks.md 打勾（`- [ ]` → `- [x]`），重跑自动跳过已完成
- 打勾后的 tasks.md 随输出累积给下游节点（平台不落盘任何产物文件）

### cwd 执行与上游集成

- **cwd** — 编辑面板的「项目路径」经 Runner 校验后作为命令工作目录，CLI 直接访问该项目的代码与 git
- **上游集成** — 接收上游 Agent 输出的需求分析作为执行依据，并可从祖先链（upstreams）回溯 Lark 模板（templateContent）约束输出

---

## 四、自检 Agent 节点（selfCheck）

独立会话 · 独立上下文 · 不共享编码 Agent 记忆（防"自己给自己打分"的确认偏差），由本机 CLI 以独立进程评审：

- **身份注入** — 编辑面板「视角 (BMad)」从 BMad 角色库选择一个角色，直接注入该角色 SKILL 作为评审系统提示词；一个节点一个角色，多视角检验 = 创建多个自检节点
- **材料自动降级**（Runner 在用户本地收集）：
  1. 上游为 codeAgent（编码场景）→ Runner 在项目目录预执行 `git diff HEAD` 附进 prompt（ground truth，CLI 无需执行命令，安全模式即可评审；缺项目路径时报错引导配置）
  2. 其他上游（文档类场景）→ 上游祖先节点的累积产物（原始需求 + 最终交付物）
  3. 节点指令 — 始终追加到评审材料末尾
- **结论** — 从评审报告中宽松提取 PASS / FAIL / NEEDS_ATTENTION，节点显示对应标签 + 视角角色

---

## 五、任务拆解节点（taskPlanner）

把上游概设节点输出的 plan 拆解为可独立执行的 batch 任务清单，由本机 CLI 生成：

- **输出** — tasks.md 全文（`## Batch N` + `- [ ]` 任务），CLI 按系统提示词（prompts/taskPlanner.md）组织；batchCount / taskCount 用正则宽松统计
- **消费** — 供 codeAgent batch 模式按批次实现代码

---

## 六、Spec 标记模式（只标记，不产文件）

- 节点通过脚印按钮（StepMarkNode）手动标记输出属于哪个工作流阶段（spec/plan/tasks/report/…）
- 画布左侧 StepLinePanel 汇总已标记步骤并提示缺失的必选项（spec/plan/tasks）
- 标记随工作流持久化，平台不产出任何 spec 文件——导出 `workflow.yml` 后由 openspec / speckit 等框架生成 `specs/` 目录
- 执行前检测执行范围内至少一个节点被标记，否则中止

---

## 七、PIN 节点输出固定（调试机制）

### 用途

避免重复运行上游节点、节省 Token，支持断点续跑。

### 工作方式

1. 执行节点后点击 📌 保存结果，保存路径 `workflows/result/.pin/<工作流名>/nodeType_nodeId.json`（**按工作流目录隔离**，不同工作流相同 nodeId 不互相覆盖）
2. **上下文随 PIN 保存** — PIN 时从执行记录中提取该节点执行时看到的累积上下文（上游祖先输出）一并保存；从中间 PIN 运行时可恢复完整上下文
3. 执行面板 Select 选择已固定的 PIN 节点（当前工作流的 PIN 排在前面，其他工作流排后面并标注归属）
4. 点击「运行」→ 引擎注入 PIN 输出（并恢复累积上下文），从下游节点继续
5. 未运行过的节点 PIN 无累积上下文 → 直接运行，不累积

### Load 加载

编辑面板可选择已保存的 PIN 数据加载到内存，按 nodeId 精确注入，同一类型不同节点互不干扰。

---

## 八、BMad 集成与角色使用

**策略：只取「多角色」，自建编排，不跑 BMad CLI。**

BMad CLI 把整个 SDLC 固化为交互式会话流程；本项目用可视化 DAG 引擎自编编排，只需要 BMad Method 的**多角色 persona 能力**。因此不把 BMad CLI 作为运行时，只抽取角色定义与角色指令，接入自己的节点体系。

### 角色资产与目录结构

| 路径                               | 内容                                                                               | 用途                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------- |
| `.bmad/_bmad/config.toml`          | 角色注册表（7 个：analyst / pm / ux-designer / architect / dev+tech-writer / tea） | 角色库数据源，`/api/bmad/agents` 解析 |
| `.bmad/agents/<id>/SKILL.md`       | 清洗后的角色 persona 指令（自包含、无运行时协议）                                  | 注入用，规则页可直接编辑              |
| `.bmad/agents/<id>/customize.toml` | 官方 persona 源（role / identity / communication_style / principles）              | 源参考，清洗时提炼                    |
| `.bmad/plan/`                      | 官方 plan 技能（PRD / spec / architecture / ux 等）备份                            | 暂不接入执行，保留作方法论参考        |

### 为什么要「清洗」

官方角色的 SKILL.md 是**运行时协议壳**：包含 `uv run ...`、`config.yaml` 加载、`{agent.menu}` 交互式菜单等，全部依赖 BMad 安装产物。清洗 = 保留 description / Overview + customize.toml 的 persona 字段 + 任务约束，**删除全部运行时协议**，保证角色指令自包含。

### 注入链路

```
config.toml → /api/bmad/agents（解析角色 + 附 skillContent = SKILL.md 全文）
  → 节点选择角色 → roleDescription = skillContent || description
  → bmadExecutor 输出 instructions → 下游智能体以 systemPrompt（优先级 20）注入
```

### 与 BMad CLI 的取舍

| 维度       | 本项目（persona 注入 + 自建编排）                             | BMad CLI（完整框架）                   |
| ---------- | ------------------------------------------------------------- | -------------------------------------- |
| 编排方式   | 可视化 DAG 自由编排，可组合知识库 / Lark / 记忆 / 条件 / 循环 | 内置固定 SDLC 流程，交互式会话驱动     |
| 运行时依赖 | 无：只读 `.bmad/` 配置与指令                                  | 需 install 部署 Core / BMM / TEA / BMB |
| 角色能力   | 提炼 persona 注入为 system prompt                             | 完整交互式 Agent                       |
| 可调试性   | 单节点执行 / PIN / 日志 / 预算可控                            | CLI 交互黑盒                           |
| 维护成本   | 官方更新需手动同步 `.bmad/` 并重新清洗                        | 每次 install 自动拉最新                |

> 注：`/api/execute/bmad` 为早期「CLI 映射」方案的遗留路由，当前主链路不使用，仅保留兼容。

---

## 九、本地工具与提示词管理

- **本地工具** — AI 类节点不再配置模型，编辑面板的「本地工具」下拉由 Runner `GET /tools` 探测本机已安装的 CLI（Claude Code / Codex / DeepSeek），未安装的置灰；异步执行 `POST /agent-cli` + 轮询 `GET /task/:id`
- **权限模式** — 只读场景（analyze / 评审 / 拆解 / 关键词）用 CLI 安全模式；需要写文件的 batch 编码用 auto 模式，`auto` 经 Runner 映射到工具权限参数（claude → `--permission-mode acceptEdits`、codex → `--full-auto`、deepseek → `--auto`）
- **提示词编辑** — 规则页独立编辑 taskPlanner / keywordAgent 等系统提示词模板，持久化到 `prompts/` 目录

### 凭据全留本地

平台前端不持有任何模型凭据、不做 shell 执行、不访问用户文件系统——AI 执行全部经本机 Runner 调起用户本地的 AI CLI，订阅与凭证天然 per-user，工作流 JSON 里也不落任何模型敏感字段。

---

## 十、知识库

平台**不内置任何数据库**（向量库 / 文档库 / 关系型 / 本地 md 目录都不内置），知识库检索节点只负责把查询交给用户自己的数据源，用户无需迁移数据：

- **本地模式** — 选择本机 AI CLI 工具（工具需配置访问你知识库的 MCP），以自然语言查询，可选挂一个 SKILL 作为查询指令上下文；AI CLI 经其 MCP 访问用户自己的知识库并返回检索内容
- **远程 API 模式** — 编辑请求（URL / 方法 / Headers / Body，Body 支持 `{{字段}}` 引用上游输出），由本机 Runner 的 `/http-proxy` 端点在用户本机代理调用其配置的知识库接口（服务端仅作离线回退），返回响应内容

### 导出行为

- 本地模式导出为「使用你的 MCP 连接用户知识库检索」的指令文件，交由外部 AI CLI 执行
- 远程 API 模式导出为 `curl` 命令（GET 自动忽略 Body），直接请求用户配置的接口

---

## 十一、安全与健壮性

- **平台不持有模型凭据** — AI 执行全部走用户本机 CLI，平台侧无 API Key / model.conf，工作流 JSON 不落任何模型敏感字段
- **Runner 本地隔离** — 只绑定 `127.0.0.1`，CORS `Origin` 白名单（默认任意 localhost 端口 + `RUNNER_ALLOWED_ORIGINS` 可配部署域），阻止任意网页指挥本机 Runner
- **命令模板化** — Runner 只按注册表 adapter 拼命令（不接收任意 shell 字符串），并预先收集 git diff / 指定 cwd，CLI 无额外权限需求
- **路径穿越检测** — 文件读写校验 `..` 穿越，确保路径在 workspace 内
- **文档上传限制** — ≤5MB，流式批量处理

---

## 十二、进阶主题 FAQ

| 主题                            | 说明                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 如何做多角色评审？              | 创建多个 selfCheck 节点，各配一个 BMad 角色                                                                         |
| 如何让长链路不丢上下文？        | 引擎自动 BFS 累积上游祖先，无需手动补线；预算截断时高优先级块优先保留                                               |
| 为什么 codeAgent batch 不落盘？ | 平台只做编排验证，产物通过输出累积给下游，最终由用户自己的 Codex / Trae 执行                                        |
| 如何让 AI 节点执行？            | 本机启动 Runner（`node runner/server.mjs`），安装 Claude Code / Codex / DeepSeek 任一，在节点编辑面板选「本地工具」 |
| 平台还需要配置模型吗？          | 不需要。AI 执行全部复用用户本机 CLI，平台不持有任何模型凭据                                                         |
| 文档如何更新？                  | 本指南位于 `docs/` 目录，可直接在「编辑器」页修改，或由工作流生成                                                   |
