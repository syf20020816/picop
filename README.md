# PICOP — AI 工作流可视化编排工具

基于 [BMad Method](https://bmadcodes.com/) + Lark CLI 构建的轻量化 AI 工作流编排工具，提供可视化节点编排能力，适合需要快速搭建 AI Agent 工作流的场景，避免 Dify 等重型平台的复杂性。

---

## 平台定位：编排 → 验证 → 导出

本项目是一个**设计时（Design-time）编排平台**，不是最终工作流的运行时：

1. **编排** — 用可视化 DAG 画布组合 20 种节点（需求分析 / 概设 / 任务拆解 / 编码 / 自检 / 知识库 / Lark 文档…），并在 Spec 模式下用脚印按钮**标记**每个节点的输出属于哪个工作流阶段（功能规格 / 技术方案 / 任务清单 / 自检报告…）。
2. **验证** — 在画布上运行工作流验证编排是否正确（单节点调试 / PIN 固定 / 断点续跑 / 输出检查）。**AI 类节点的执行交给用户自己本机的 AI CLI 工具**（Claude Code / Codex CLI / DeepSeek Harness），平台不内置也不配置任何模型。
3. **导出** — 编排与验证通过后，把工作流导出为 4 种可执行产物之一（`speckit` / `openspec` / `spec` / `skill`），用户放入自己的 **Codex / Trae / Claude Code** 中执行。

**Spec 分工（边界清晰）**：平台**不生产 specs/ 目录**——那是 openspec / speckit 等专业 spec 框架的职责。平台只做**阶段标记**（`specStep`），让用户在编排时无需手动输入 `/spec` 指令，导出后的 `workflow.yml` 携带标记，spec 框架据此自动生成 `specs/` 目录。

---

## 零编排成本接入：MCP + SKILL

除了画布编排，用户还可以在自己的工具（Claude Code / Codex / Trae 等）中通过 **MCP + SKILL** 直达平台能力：把自然语言描述的工作流程一步转换为可执行产物并写入用户自己的项目目录——**无需打开画布、无需学习编排**。

```
用户工具（SKILL 指导 + MCP Client） → stdio MCP Server（runner/mcp.mjs，依赖本地 shared/export-core.mjs） → 本地 Runner（/agent-cli 生成 + /file-write 落盘） → 用户项目
```

- **`workflow_build`** — 把用户自然语言描述的流程交给本机 AI CLI（Claude Code / Codex / DeepSeek）转换为工作流定义 JSON（复用 `prompts/flowBuilder.md`；入参 `description` / `tool` / `timeoutMs`）
- **`workflow_export`** — 把工作流定义全量导出为目录文件并写入用户项目：主工作流文件 + 各节点引用的输入物（userInput 静态内容 / Skill / Memory / BMad / Lark URL 清单 + lark-cli 技能）+ manifest.json（与画布 zip 同源，非 zip；入参 `workflow` / `name` / `targetDir` / `format` / `full`，`full` 缺省 true）：
- **`workflow_save`** — 把工作流定义保存到 Picop 工作流模板库（与画布「保存工作流模板」共享同一存储，保存后可回画布加载/续编；入参 `workflow` / `name` / `description`）
- **`workflow_list`** — 列出 Picop 已保存的工作流模板（仅名称 + 描述）

| format            | 产物路径                                         | 适用场景                                             |
| ----------------- | ------------------------------------------------ | ---------------------------------------------------- |
| `speckit`（默认） | `specify/workflows/<name>/workflow.yml`          | SpecKit / Codex / Claude 中按命令步骤流水线执行      |
| `openspec`        | `openspec/schemas/<name>/schema.yaml`            | OpenSpec 规范（artifacts 依赖图 + apply 跟踪）       |
| `spec`            | `spec/changes/<name>/specs/<name>/workflow.yaml` | 同构 artifacts、无需安装 OpenSpec，任意 agent 直接读 |
| `skill`           | `skills/<name>/SKILL.md`                         | 作为技能 `/name <prompt>` 触发                       |

**接入方式（一次性）**：

**形态 A：源码运行**（本机有 `ai-workflow` 源码）

```bash
# Claude Code
claude mcp add picop -- node <ai-workflow>/runner/mcp.mjs
# 其他工具（Codex 等）：在 .mcp.json 中注册，args 用绝对路径
# { "mcpServers": { "picop": { "command": "node", "args": ["<ai-workflow>/runner/mcp.mjs"] } } }
```

> `<ai-workflow>` 是占位符，必须替换为本机真实绝对路径；可用 `find ~ -maxdepth 5 -type f -name mcp.mjs -path "*runner*"` 定位。

**形态 B：已安装桌面应用**（只装了 Picop.app，无源码）

打包后 `runner/mcp.mjs` 位于 App 包内，且**不假设机器装有系统 node**——直接复用 App 自带 Node：

```json
{
  "mcpServers": {
    "picop": {
      "command": "/Applications/Picop.app/Contents/MacOS/Picop",
      "args": ["/Applications/Picop.app/Contents/Resources/app/runner/mcp.mjs"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

> Runner 由 App 主进程自动拉起，**保持 Picop 运行**即可（退出 App 会一并停掉 Runner）；`find ~` 搜不到 `/Applications`，形态 B 直接用上面的固定路径。

平台分发技能 [`.skills/picop-mcp/SKILL.md`](.skills/picop-mcp/SKILL.md) 指导工具里的 AI 完成「build → export（或 save）→ 汇报」三步（含路径定位、4 种格式选型、输出物校验），并支持 `-s`/`--save`（保存到 Picop）与 `-l`/`--list`（列出已保存工作流）两个调用参数。四零原则全程保持：MCP server 跑在用户本机、无外部依赖，不存数据、不持凭据、不跑运行时，产物只写入用户指定的项目目录。

画布与 MCP 互为补充：MCP 提供零成本入口，画布负责可视化验证与微调（同一工作流 JSON 可导入回画布）。

> **注意**：MCP Server 是**常驻子进程**，改动 `runner/mcp.mjs` 后需让工具宿主**重新 spawn**（彻底退出工具 / 断开并重连 MCP），仅重开对话不会重启它。
>
> **MCP 入口会对 AI 输出做结构归一化**：flowBuilder 产出的顶层 `title` 归位到 `data.title`、下标式 `edges` 转为节点 id 引用，以对齐 `shared/export-core.mjs` 期望的严格结构（详见 `struct_mcp_skill.md`）。

**进一步阅读**：[MCP + SKILL 零编排接入](picop-docs/docs/tutorial/mcp_skill.md)（使用教程）· [`struct_mcp_skill.md`](struct_mcp_skill.md)（实现原理 / 遇到的问题 / 架构整理）。

---

## 执行架构：控制面 / 执行面分离

平台前端只负责编排，所有节点的"副作用"执行统一交给用户本机的一个轻量 Runner 服务（零依赖 Node 脚本）：

```
┌─────────────┐    HTTP(127.0.0.1:7523)    ┌──────────────────────┐
│  浏览器/前端   │ ─────────────────────────► │  本地 Runner 服务    │
│ （控制面-编排） │                            │  runner/server.mjs    │
└─────────────┘                            └──────────────────────┘
        │                                            │
        │ 只做 DAG 编排 / 状态 / 日志                   │ 子进程（用户本地）
        ▼                                            ▼
  前端渲染执行结果                              lark-cli / claude / codex / deepseek / fs
```

- **平台（前端）** 不持有任何模型凭据、不做 shell 执行、不访问用户文件系统——只通过 Runner 提交请求并接收结果。
- **Runner（本机）** 代用户执行：Lark 节点跑 `lark-cli`、AI 节点跑本机 CLI 工具（Claude Code / Codex / DeepSeek）、文件节点写入本地目录、知识库远程 API 模式代理外部请求。凭据与订阅全留在用户机器。
- **部署不含秘密**：服务器只需托管前端静态产物，无 API Key、无 model.conf、无 lark-cli 授权，天然解决多用户共享凭据与服务器无法访问用户本地文件的问题。

---

## 开发

```bash
# 安装依赖
npm install

# 桌面端开发（Electron 窗口，自动拉起 Runner，不含文档）
npm run dev

# 纯浏览器开发（Web 模式，含 Runner 与文档，端口 3030）
npm run dev:web

# 生成路由（新增 API/页面路由后需要）
npm run generate-routes
```

前端启动时通过 `GET /ping` 探测 Runner 是否在线；离线时 AI / Lark / 文件类节点会给出明确提示（AI 搭建工作流面板会提示启动命令）。Runner 只在 `127.0.0.1` 监听，并校验 `Origin` 白名单（默认允许任意 localhost 端口，可用 `RUNNER_ALLOWED_ORIGINS` 配部署域名），防止其他网页指挥你本机的 Runner。

在 AI 类节点（智能体 / 代码处理 / 任务拆解 / 自检 / 关键词）的编辑面板中选择「本地工具」即可执行，支持工具：`claude-code` / `codex` / `deepseek`。

---

## 已实现功能

### 1. 可视化工作流编辑器

- **[React Flow](https://reactflow.dev/) 画布** — 节点拖拽、连线、缩放、平移，基于 `@xyflow/react` v12
- **MiniMap** + **Controls** — 小地图导航和画布控制
- **暗色主题** — Ant Design darkAlgorithm + React Flow 暗色适配
- **节点选中高亮** — 选中节点蓝色边框

### 2. 19种工作流节点

| 节点类型             | 标识                     | 用途                                                                                                                                                                                     |
| -------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **用户输入节点**     | `userInput`              | 接受用户输入的文本、提示词、文件/URL 路径                                                                                                                                                |
| **智能体节点**       | `agent`                  | 调用本机 AI CLI 工具（Claude / Codex / DeepSeek）进行分析和生成，接收上游所有输入 + 全链路累积上下文                                                                                     |
| **BMad 角色节点**    | `bmadAgent`              | 赋予智能体特定角色指令（分析师/架构师/SM 等），内容同步到智能体（BMad 在上游、Agent 在下游，方向已修正）                                                                                 |
| **代码处理节点**     | `codeAgent`              | 用本机 AI CLI 直接在项目目录编码：`analyze`（只读分析）/ `batch`（按 tasks.md 分批写代码）双模式                                                                                         |
| **任务拆解节点**     | `taskPlanner`            | 把上游概设输出的 plan 拆解为可独立执行的 batch 任务清单，产出 tasks.md                                                                                                                   |
| **自检 Agent 节点**  | `selfCheck`              | 独立会话评审：配置 BMad 角色注入评审身份，材料按 git diff / 上游累积产物自动降级，输出 PASS / CONDITIONAL_PASS / FAIL                                                                    |
| **关键词智能体节点** | `keywordAgent`           | 从输入中提取关键词列表，供下游使用                                                                                                                                                       |
| **知识库检索节点**   | `knowledgeRetrieval`     | 双模式：本地模式用本机 AI CLI（经其配置的 MCP）以自然语言查用户自己的知识库，可选挂一个 SKILL 作为查询指令；远程 API 模式编辑请求（URL / 方法 / Headers / Body）直调用户自己的知识库接口 |
| **Lark 文档节点**    | `lark`                   | 读取/写入/创建飞书文档，通过 lark-cli 操作                                                                                                                                               |
| **Lark 模板节点**    | `larkTemplate`           | 读取飞书文档作为内容模板，传递给下游                                                                                                                                                     |
| **记忆节点**         | `memory`                 | 读写持久化记忆文件（markdown 格式），跨工作流传递上下文                                                                                                                                  |
| **Skill 节点**       | `skill`                  | 执行 BMad Skill（分析师/开发者等角色技能）                                                                                                                                               |
| **回答节点**         | `answer`                 | 工作流暂停，等待用户输入后继续                                                                                                                                                           |
| **AI 输出节点**      | `aiOutput`               | 展示最终输出结果                                                                                                                                                                         |
| **判断节点**         | `if` / `ifCondition`     | 条件分支，根据上游输出匹配关键词或 AI 判断选择路径                                                                                                                                       |
| **循环节点**         | `loop` / `loopCondition` | 循环迭代，支持计数器模式和上游数据驱动模式                                                                                                                                               |
| **重试节点**         | `retry`                  | 捕获上游错误，支持关键词匹配和 AI 判断两种重试条件                                                                                                                                       |

### 3. 节点操作

- **添加节点** — 每个节点右侧的 `+` 按钮，下拉选择节点类型，自动生成连线到新节点
- **删除节点** — 编辑面板底部「删除」按钮，同时清理关联连线
- **节点属性编辑** — 右侧编辑面板，点击节点即切换
- **节点标题/描述编辑** — 编辑面板头部可编辑
- **节点拖拽** — 自由拖拽调整布局

### 4. 执行引擎

- **DAG 执行引擎** — 拓扑排序（Kahn 算法）确定执行顺序，分层并行（`Promise.all`），检测循环依赖
- **Pipeline 数据流** — 上游节点 output 自动传递为下游节点 input
- **上下文累积** — 每个节点执行时 BFS 收集全部上游祖先节点，按节点类型提取"规范摘要"组成 `input.upstreams`，保证线性链路中途不丢数据、无需手动补线
- **按节点类型字段提取** — 累积时只保留关键内容字段（agent→`response`、keywordAgent→`keywords`、knowledgeRetrieval→`retrievalContent` 等），丢弃 model/usage/results 等执行元数据，节省 Token
- **内容块优先级与预算截断** — agent 节点把上游内容按优先级拼入 system prompt，超出上下文预算时保留高优先级块开头而非整块丢弃（codeAgent / keywordAgent / knowledgeRetrieval 共用 `buildUpstreamBlocks`）
- **执行状态 Checkpoint（断点续跑）** — 每层执行完成后把 `PipelineContext` 写盘到 `.pin/exec_state_<workflowId>.json`；上次暂停（如 Answer 节点等待输入）恢复运行时，自动跳过已完成节点从断点继续
- **21 种节点执行器** — 每种节点类型均有独立执行逻辑
- **AI 节点本地工具执行** — 智能体 / 代码处理 / 任务拆解 / 自检 / 关键词节点通过 Runner 调本机 AI CLI（Claude Code / Codex / DeepSeek）无头模式执行，异步任务 + 轮询，凭据全留用户机器
- **CodeAgent 直接在项目目录编码** — `analyze`（只读）/ `batch`（auto 模式按 tasks.md 分批写代码，CLI 自行打勾进度）；支持 `cwd` 指定项目路径、gitDiff 预收集
- **Lark 节点 CLI 调用** — 通过 Runner 子进程执行 `lark-cli` 读/写/创建操作
- **Answer 节点暂停/恢复** — 等待用户输入后继续执行
- **孤立节点过滤** — 无连线参与的节点不执行
- **执行控制** — 运行全部/重置/单节点执行/从 PIN 节点开始，实时状态标签
- **执行日志** — 按节点展示 info/warn/error 日志
- **输出面板** — 独立 Tab 展示各节点输出结果
- **执行信息统计** — 执行结果页展示执行是否成功 / 执行时间 / 总消耗 token
- **节点输出固定（PIN）** — 保存节点执行结果到文件（按工作流分目录），支持从 PIN 节点开始执行，避免重复运行上游节点，并恢复该节点执行时的累积上下文

### 5. 本地工具执行

- **Runner 探测** — 编辑面板的「本地工具」下拉由 Runner `GET /tools` 探测用户本机已安装的 CLI（Claude Code / Codex / DeepSeek），未安装的置灰
- **异步任务** — AI 类节点提交 `POST /agent-cli` 返回任务 ID，前端轮询 `GET /task/:id` 实时拉取日志增量，直到完成/失败/超时
- **权限模式** — 只读场景（analyze / 评审 / 拆解 / 关键词）用安全模式；需要写文件的 batch 编码用 auto 模式（权限放开），`auto` 经 Runner 映射到工具的权限参数（claude → `--permission-mode acceptEdits`、codex → `--full-auto`、deepseek → `--auto`）

### 6. 提示词管理

- **提示词编辑** — 独立 Tab 页面，支持修改 CodeAgent 系统提示词等模板
- **持久化** — 保存到 `prompts/` 目录

### 7. 工作流导入/导出/模板

- **导入** — 弹窗支持粘贴 JSON 或拖拽上传 JSON 文件
- **导出** — 弹窗展示 JSON（可复制）或下载为 `.json` 文件
- **保存模板** — 保存到 `workflows/` 目录，持久化存储
- **工作流管理** — 独立 Tab 页面，列表展示所有已保存模板，支持加载/删除

### 8. 节点输出固定（PIN）

- **PIN 按钮** — 每个节点执行后点击 📌 保存输出到 `workflows/result/.pin/<工作流名>/nodeType_nodeId.json`（按工作流目录隔离，不同工作流相同 nodeId 不互相覆盖）
- **上下文随 PIN 保存** — 对运行过的节点 PIN 时，从执行记录中提取该节点执行时看到的累积上下文（上游祖先输出）一并保存；从中间 PIN 运行时可恢复完整上下文（如原始需求 + 最终交付物的比对）
- **Load 加载** — 编辑面板可选择已保存的 PIN 数据加载到内存，按 nodeId 精确注入，同一类型不同节点互不干扰；当前工作流的 PIN 排在前面，其他工作流排后面并标注归属
- **从 PIN 执行** — 执行面板 Select 选择 PIN 节点后运行，跳过上流节点，从该节点下游开始；未运行过的节点 PIN 无累积上下文，直接运行（不累积）

### 9. 状态管理

- **Zustand** 全局状态管理
- **Immer** 不可变数据更新（`patchCurrentNode`），避免深层 spread
- **NodeBuilder** 工厂模式构建节点，自动生成 UUID 和位置偏移
- **路由树自动生成** — TanStack Router 文件路由，`tsr generate` 自动更新

### 10. BMad集成与角色使用

**策略：只取「多角色」，自建编排，不跑 BMad CLI**

BMad CLI（`npx bmad-method install` 部署的完整框架）定位是 AI IDE 内的交互式多 Agent 协同：Core 后台调度、BMM 定义全流程角色、TEA 提供测试门禁、BMB 用于扩展新 Agent。它把整个 SDLC 固化成一套交互式会话流程（激活 → 人格 → 菜单技能派发）。

本项目用可视化 DAG 引擎**自编编排**，需要的只是 BMad Method 的**多角色 persona 能力**。因此不把 BMad CLI 作为运行时，只抽取角色定义与角色指令，接入自己的节点体系。

**角色资产与目录结构**

| 路径                               | 内容                                                                                 | 用途                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------- |
| `.bmad/_bmad/config.toml`          | 角色注册表（7 个：analyst / pm / ux-designer / architect / dev + tech-writer / tea） | 角色库数据源，`/api/bmad/agents` 解析 |
| `.bmad/agents/<id>/SKILL.md`       | 清洗后的角色 persona 指令（自包含、无运行时协议）                                    | **注入用**，规则页可直接编辑          |
| `.bmad/agents/<id>/customize.toml` | 官方 persona 源（role / identity / communication_style / principles）                | 源参考，清洗时提炼                    |
| `.bmad/plan/`                      | 官方 plan 技能（PRD / spec / architecture / ux 等）备份                              | 暂不接入执行，保留作方法论参考        |

**为什么要「清洗」**

官方角色的 SKILL.md 是**运行时协议壳**：包含 `uv run .../resolve_customization.py`、`_bmad/custom/*.toml` 覆盖合并、`config.yaml` 加载、`{agent.menu}` 交互式菜单等，全部依赖 BMad 安装产物。本项目没有对应脚本/配置，直接注入会引导模型"执行不存在的脚本、展示菜单"。清洗 = 保留 description / Overview + customize.toml 的 persona 字段 + 任务约束，**删除全部运行时协议**。清洗后每个角色的指令完全自包含，可在平台直接编辑。

**注入链路**

```
config.toml → /api/bmad/agents（解析角色 + 附 skillContent = SKILL.md 全文）
  → 节点选择角色 → roleDescription = skillContent || description
  → bmadExecutor 输出 instructions → 下游智能体以 systemPrompt（优先级 20）注入
```

**节点应用**

- **BMad 角色节点** — 纯 persona 注入，不调用 AI，把角色指令传给下游智能体
- **智能体节点** — 下拉选择角色（或连线 BMad 节点），自动同步角色指令 + 模型配置
- **自检节点** — 选择评审视角角色，独立会话以该角色身份评审（一个节点一个角色，多视角 = 多个自检节点）
- **规则页** — 角色库表格 + 「自定义 BMad 角色」（自动生成初始指令文件）+ 「指令」列直达编辑器

**对比 BMad CLI：取舍分析**

| 维度         | 本项目（persona 注入 + 自建编排）                                               | BMad CLI（完整框架）                                                               |
| ------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 编排方式     | 可视化 DAG 自由编排，可组合知识库 / Lark / 记忆 / 条件 / 循环等自有节点         | 内置固定 SDLC 流程（PRD→UX→架构→故事→开发→评审→测试），交互式会话驱动              |
| 运行时依赖   | 无：只读 `.bmad/` 下配置与指令，不需要 install 产物 / python 脚本 / config.yaml | 需 install 部署 Core / BMM / TEA / BMB，依赖 uv / python 脚本                      |
| 角色能力     | 提炼 persona（身份 / 沟通风格 / 行为准则 / 任务约束），注入为 system prompt     | 完整交互式 Agent（激活步骤 / 持久事实 / 菜单技能派发 / 多 Agent 协同）             |
| 流程方法深度 | 目前只注入角色人格；plan 流程模板仅保留未接入                                   | 完整方法论（PRD Discovery/Finalize、架构 spine、Reviewer Gate、测试策略、CI 门禁） |
| 可调试性     | 单节点执行 / PIN / 日志 / 上下文预算可控，所见即所得                            | CLI 交互黑盒，流程不可拆分调试                                                     |
| 可扩展性     | 自定义角色可视化创建 + 指令内编辑，与模型管理（多供应商）集成                   | BMB 元开发可搓新 Agent / 工作流，但仍在框架内                                      |
| 维护成本     | 官方更新需手动同步 `.bmad/` 并重新清洗                                          | 每次 install 自动拉最新，但受框架约束                                              |
| 适用场景     | 把「角色 / 多视角」嵌入自研工作流编排，轻量、本地、可调试                       | 直接采用 BMad Method 完整流程，接受固定编排                                        |

**结论**

核心取舍是**「只要多角色，不要框架」**。BMad Method 最可复用的资产是多年沉淀的角色方法论（分析师 / 产品 / 架构 / 开发 / 测试的职责与准则）；CLI 的价值在于把流程固化为会话。本项目诉求是"自编工作流去执行"，角色提供的是视角与约束（含多角色评审），因此 persona 注入是最小契合面。代价是放弃官方流程模板的方法论深度与自动更新——后续可按需把 `.bmad/plan/` 中的核心流程（如 PRD 方法论）提炼进角色指令或节点模板。

> 注：`/api/execute/bmad` 为早期「CLI 映射」方案的遗留路由（status / skills / map-workflow / execute-skill），当前主链路不使用，仅保留兼容。

---

## 技术栈

- **框架**: React 19 + TypeScript 6 + Vite 8
- **路由**: TanStack Router（文件路由 + API 路由）
- **UI**: Ant Design 6 + Radix UI Icons + Lucide Icons
- **画布**: React Flow 12 (`@xyflow/react`)
- **状态**: Zustand 5 + Immer 11
- **样式**: Sass (SCSS Modules)
- **本地执行**: Node.js + TanStack Router Server Functions（前端侧）；`runner/server.mjs`（零依赖 Node 本地 Runner）

---

## 项目结构

```
runner/
├── server.mjs              # 本地 Runner 服务（127.0.0.1:7523）
│                           #   GET /ping 心跳   GET /tools 探测本机 CLI
│                           #   POST /agent-cli（异步 AI CLI 任务，支持 cwd/gitDiff/auto）
│                           #   GET /task/:id   轮询任务
│                           #   POST /lark      跑 lark-cli    POST /fs/* 文件读写
│                           #   GET /models /model + /agent（遗留模型端点，待下线）
├── mcp.mjs                 # stdio MCP Server（MCP + SKILL 接入入口，仅依赖本地 shared/export-core.mjs）
│                           #   workflow_build：自然语言 → 工作流定义（复用 flowBuilder + /agent-cli）
│                           #   workflow_export：工作流定义 → speckit/openspec/spec/skill 4 种产物
│                           #                    （与画布共用导出核心，/file-write 落盘 + 路径穿越校验）
shared/
└── export-core.mjs         # 导出共享核心（纯 JS）：画布 exporter.ts 与 MCP workflow_export 共用，
                            #   逻辑唯一来源，保证两处产物完全一致（+ export-core.d.mts 类型声明）
.skills/
├── picop-install/          # 分发技能：speckit 安装说明
├── picop-mcp/              # 分发技能：MCP + SKILL 零编排成本接入（build → export → 汇报）
src/
├── engine/
│   ├── workflow.ts           # DAG 执行引擎（拓扑排序 + 分层并行 + 上下文累积）
│   ├── topological.ts        # 拓扑排序 / 分层 / 祖先链（getAncestorIds / getPredecessors）
│   ├── accumulate.ts         # 上下文累积：按节点类型提取关键字段（Token 优化）
│   └── executors/            # 21 种节点执行器
│       ├── index.ts          # 执行器注册表
│       ├── userInput.ts
│       ├── agent.ts          # 智能体（本地 CLI 工具执行）
│       ├── bmad.ts          # BMad 角色（persona 注入，不调用 AI/CLI）
│       ├── lark.ts           # Lark 文档
│       ├── larkTemplate.ts   # Lark 模板
│       ├── larkWikiTraversal.ts  # Lark Wiki 遍历
│       ├── answer.ts         # 回答/暂停
│       ├── aiOutput.ts
│       ├── if.ts             # 条件分支
│       ├── loop.ts           # 循环
│       ├── retry.ts          # 重试
│       ├── codeAgent.ts      # CodeAgent（本机 CLI 直接改代码）
│       ├── taskPlanner.ts    # 任务拆解
│       ├── selfCheck.ts      # 自检 Agent（独立会话评审）
│       ├── keywordAgent.ts   # 关键词提取
│       ├── knowledgeRetrieval.ts  # 知识库检索（本地 MCP / 远程 API 双模式）
│       ├── memory.ts         # 记忆
│       └── skill.ts          # Skill
├── components/
│   ├── flow.tsx              # React Flow 画布
│   ├── node/                 # 节点渲染组件
│   │   ├── index.tsx         # UNode 通用容器
│   │   ├── header/           # 节点标题/图标
│   │   ├── edge/             # 工具栏按钮
│   │   │   ├── add.tsx       # 「+」添加节点
│   │   │   ├── run.tsx       # 运行节点
│   │   │   └── pin-node.tsx  # PIN 固定按钮
│   │   └── ...               # 各类型节点 UI
│   ├── panel/
│   │   ├── edit.tsx          # 编辑面板（Tabs: 编辑/执行/输出/结果）
│   │   └── edit/             # 各节点编辑组件
│   ├── execution/
│   │   ├── panel.tsx         # 执行面板（运行/PIN选择/状态/日志）
│   │   ├── output.tsx        # 输出面板
│   │   ├── result.tsx        # 执行结果
│   │   └── importExport.tsx  # 导入/导出/保存
│   ├── workflow-manager/     # 工作流管理 Tab
│   ├── prompt-manager/       # 提示词管理 Tab
│   └── model/                # 模型管理 Tab
├── services/                # 共享服务（前后端共用）
│   ├── runner.ts            # 前端直连本地 Runner（探测/提交 AI CLI 任务/轮询取日志）
│   ├── upstreamContext.ts   # 上游累积上下文构建（优先级排序 + 预算截断）
│   ├── taskManager.ts       # tasks.md 解析 / 打勾 / 取批次（前后端共用纯函数）
│   ├── modal.ts             # 旧模型配置 serialize/hydrate（向后兼容，主链路不再用）
├── store/
│   └── node.ts               # Zustand 全局状态
├── types/
│   ├── index.ts              # 类型定义 & NodeTypes 常量
│   └── builder.ts            # NodeBuilder 工厂
├── routes/
│   ├── __root.tsx
│   ├── index.tsx             # 首页（画布+编辑+执行面板）
│   └── api/
│       ├── workflows.ts      # 工作流 CRUD（含版本快照）
│       ├── model.ts          # 模型管理
│       ├── prompts.ts        # 提示词管理
│       ├── memory.ts         # 记忆管理
│       ├── skill.ts          # Skill 管理
│       ├── bmad/agents.ts    # BMad 角色库
│       ├── editor/           # 文件编辑器
│       ├── execute/          # 执行 API
│       │   ├── agent.ts          # AI 调用
│       │   ├── codeAgent.ts      # CodeAgent（analyze/batch + App-Desc）
│       │   ├── taskPlanner.ts    # 任务拆解
│       │   ├── selfCheck.ts      # 自检 Agent（材料按 git diff / 上游累积 自动降级）
│       │   ├── keywordAgent.ts   # 关键词提取
│       │   ├── lark.ts           # Lark CLI
│       │   ├── larkWikiTraversal.ts  # Lark Wiki 遍历
│       │   ├── bmad.ts           # BMad（遗留 CLI 路由，已不主用）
│       │   ├── httpProxy.ts      # 外部 HTTP 代理（知识库远程 API 跨域；主路径已迁 Runner /http-proxy）
│       │   ├── fileWrite.ts      # 文件写入（主路径已迁 Runner /file-write）
│       │   └── models.ts         # 模型执行入口
│       └── workflow/
│           ├── pin.ts        # PIN 固定 (GET/POST/DELETE，按工作流分目录)
│           ├── exec-state.ts # 执行状态 Checkpoint（断点续跑）
│           ├── exec-history.ts  # 执行历史
│           └── versions.ts   # 版本快照
├── router.tsx
├── routeTree.gen.ts
└── styles.css
```

---

### 依赖服务

```bash
# 1. 本地 Runner（必要）：AI 类 / Lark / 文件节点的执行都经过它
node runner/server.mjs   # 监听 127.0.0.1:7523

# 2. MCP Server（可选，MCP + SKILL 接入时）：stdio 模式暴露 workflow_build / workflow_export
node runner/mcp.mjs      # 配合分发技能 .skills/picop-mcp/ 使用

# 3. AI CLI 工具（AI 类节点）：任选其一并完成各自登录/配置
#    claude / codex / deepseek（Runner 会自动探测已安装项）

# 4. Lark CLI（仅当工作流含 Lark 节点）
lark-cli auth login

# 5. BMad 无需安装 CLI —— 仅使用 .bmad/ 下的角色配置与指令（见「10. BMad集成与角色使用」）
```

---

## 核心节点详解

### CodeAgent 节点

用本机 AI CLI（Claude Code / Codex / DeepSeek）在项目目录直接编码，CLI 自身就是编码 agent（读写文件、跑命令、git），平台不再维护工具调用循环：

- **analyze 模式（默认）** — CLI 在项目目录只读分析，产出技术方案文档（CLI 安全模式，不写文件）
- **batch 模式** — 按 tasks.md 批次实现代码（CLI auto 模式，权限放开允许写文件），指令中要求 CLI 每完成一个任务在 tasks.md 打勾（`- [ ]` → `- [x]`）
- **配置**：本地工具、项目路径（作为 `cwd` 传给 Runner）、Git 分支、执行指令、模式切换（analyze/batch）
- **上游集成** — 接收上游 Agent 输出的需求分析（response）作为执行依据，并可从祖先链（upstreams）回溯获取 Lark 模板（templateContent）约束输出；模板节点不在直接前驱时也能拿到
- **cwd 执行** — 项目路径经 Runner 校验后作为命令工作目录，CLI 直接访问该项目的代码与 git

### 自检 Agent 节点（selfCheck）

独立会话 · 独立上下文 · 不共享编码 Agent 记忆（防"自己给自己打分"的确认偏差），由本机 CLI 以独立进程评审：

- **身份注入** — 编辑面板「视角 (BMad)」从 BMad 角色库选择一个角色，直接注入该角色 SKILL 作为评审系统提示词；**一个节点一个角色**，多视角检验 = 创建多个自检节点各配一个角色
- **材料自动降级**（Runner 在用户本地收集）：
  1. **上游为 codeAgent（编码场景）** → Runner 在项目目录预执行 `git diff HEAD` 附进 prompt（ground truth，CLI 无需执行任何命令，安全模式即可评审；缺项目路径时报错引导配置）
  2. **其他上游（文档类场景）** → 上游祖先节点的累积产物（原始需求 + 最终交付物，由模型逐条比对打分）
  3. **节点指令** — 始终追加到评审材料末尾
- **结论** — 从评审报告中宽松提取 PASS / FAIL / NEEDS_ATTENTION，节点显示对应的标签 + 视角角色

### 任务拆解节点（taskPlanner）

把上游概设节点输出的 plan（技术方案）拆解为可独立执行的 batch 任务清单，由本机 CLI 生成：

- **输出** — tasks.md 全文（`## Batch N` + `- [ ]` 任务），CLI 按系统提示词（prompts/taskPlanner.md）组织；batchCount / taskCount 用正则宽松统计
- **消费** — 供 codeAgent batch 模式按批次实现代码

### Spec 标记模式（只标记，不产文件）

- 节点通过脚印按钮（StepMarkNode）手动标记输出属于哪个工作流阶段（spec/plan/tasks/report/…），画布左侧 StepLinePanel 汇总已标记步骤并提示缺失的必选项（spec/plan/tasks）
- 标记随工作流持久化，**平台不产出任何 spec 文件**——导出 `workflow.yml` 后由 openspec / speckit 等 spec 框架生成 `specs/` 目录
- 执行前检测执行范围内至少一个节点被标记，否则中止（保证编排携带阶段信息）

### 条件分支（if）

支持两种判断模式：

- **关键词匹配** — 定义多个关键词，上游输出中包含任一关键词则命中
- **AI 判断** — 让 AI 模型判断上游内容是否需要进入改分支

### 循环（loop）

两种循环模式：

- **固定次数** — 指定迭代次数
- **上游数据驱动** — 根据上游节点输出的数据数组长度决定循环次数

### PIN 功能

用于调试场景，避免重复执行上游节点：

1. 执行节点后点击 📌 保存结果（连同该节点执行时看到的累积上下文，按工作流分目录落盘）
2. 执行面板 Select 选择已固定的 PIN 节点（当前工作流的 PIN 排在前面）
3. 点击「运行」→ 引擎注入 PIN 输出（并恢复其累积上下文），从下游节点继续执行
4. 未运行过的节点 PIN 无累积上下文 → 直接运行，不累积

---

## 处理策略与优化手段

### 上下文累积（引擎级）

- 节点输入 = 直接前驱输出合并 + `upstreams`（全部祖先节点的规范摘要，BFS 从近到远收集）
- 保证线性链路中任意位置都能拿到整条链路的上下文，无需手动补线；链路中间节点不丢上游数据

### 按节点类型的字段提取（Token 优化）

| 节点类型                 | 累积字段           | 丢弃字段                                            |
| ------------------------ | ------------------ | --------------------------------------------------- |
| agent / codeAgent        | `response`         | model / usage / passThrough                         |
| keywordAgent             | `keywords`         | queries / raw                                       |
| knowledgeRetrieval       | `retrievalContent` | count / mode / response / statusCode / responseJson |
| userInput                | `text` / `prompt`  | files / urls                                        |
| larkTemplate             | `templateContent`  | templateUrl                                         |
| lark / larkWikiTraversal | `result`           | action / url / success                              |
| memory                   | `content`          | —                                                   |
| bmadAgent                | `instructions`     | role / agentId                                      |
| 其他类型                 | 内容类字段回退     | 执行元数据                                          |

### 内容块优先级与预算截断

- agent 节点把上游内容按优先级拼入 system prompt：需求分析(10) → 指令(20) → 关键词(30) → 模板(40) → 其他内容(50) → 知识库检索结果(60)
- 预算 = `min(tokenMax × 1.2, 150K 字符)`；超预算时按优先级保留高价值块的开头（检索结果块整体靠前），而非整块丢弃
- 用户消息兜底 `JSON.stringify` 时排除 `upstreams`，避免与 system prompt 内容块重复打包

### 安全与健壮性

- **平台不持有模型凭据** — AI 执行全部走用户本机 CLI，平台侧无 API Key / model.conf；工作流 JSON 里也不再落任何模型敏感字段（`modal` 仅保留目录别名等非敏感信息）
- **Runner 本地隔离** — 只绑定 `127.0.0.1`，CORS `Origin` 白名单（默认任意 localhost 端口 + `RUNNER_ALLOWED_ORIGINS` 可配部署域），阻止任意网页指挥本机 Runner
- **命令模板化** — Runner 只按注册表 adapter 拼命令（不接收任意 shell 字符串），并预先收集 git diff / 指定 cwd，CLI 无权限需求
- **路径穿越检测** — 文件读写校验 `..` 穿越
- **知识库去平台化** — 平台不内置任何数据库（向量库 / 文档库 / 关系型 / 本地 md 目录都不内置），知识库检索节点只负责把查询交给用户自己的数据源：本地模式经用户本机 AI CLI 的 MCP 访问，远程 API 模式由本机 Runner 代理（`/http-proxy`，仅 URL / 方法 / Headers / Body，无凭据落库）；用户无需迁移数据
- **文档上传限制** — ≤5MB，避免内存溢出

### PIN 调试机制

- 文件存储 `workflows/result/.pin/<工作流名>/nodeType_nodeId.json`，**按工作流目录隔离**（不同工作流相同 nodeId 不互相覆盖）；注入按 `nodeId` 精确匹配，同一类型不同节点互不干扰
- PIN 保存时记录该节点执行时的累积上下文（`context.upstreams`）；从中间 PIN 部分运行时一并注入，下游节点可恢复完整上下文累积
- 加载列表按"当前工作流优先"排序并标注归属；旧格式（根目录文件）仍兼容读取

---

## 设计哲学

本项目聚焦于 **编排 → 验证 → 导出** 的轻量工作流工具：

- **控制面 / 执行面分离** — 平台只做编排与结果展示，所有执行（AI / Lark / 文件）通过本机 Runner 完成，服务器只托管前端静态产物
- **不再内置 Agent 运行时，也不配置模型** — AI 类节点直接复用用户自己本机的 Claude Code / Codex / DeepSeek，凭据与订阅全留在用户机器
- **不重复造 Spec 框架** — 阶段标记（specStep）由平台负责，specs/ 目录由 openspec / speckit 等专业框架生成，边界清晰
- **编辑器即验证台** — 所见即所得，支持单节点调试、PIN 固定、断点续跑
- **PIN 机制** 满足迭代调试场景，避免重复消耗 Token
- **文件路由 + API 路由一体化**，前后端同仓库，零部署复杂度
