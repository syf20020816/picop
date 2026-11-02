# TECH — Picop 技术说明

面向维护者与二次开发者的技术文档。产品定位、安装与使用见 [README.md](README.md)。

## 目录

- [执行架构：控制面 / 执行面分离](#执行架构控制面--执行面分离)
- [依赖服务](#依赖服务)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [功能实现清单](#功能实现清单)
- [核心节点详解](#核心节点详解)
- [处理策略与优化手段](#处理策略与优化手段)
- [BMad 集成与角色使用](#bmad-集成与角色使用)
- [MCP + SKILL 接入](#mcp--skill-接入)
- [桌面端打包](#桌面端打包)
- [本地开发](#本地开发)

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

桌面端由 Electron 主进程托管 SSR 服务并拉起 Runner：

```
Picop.app（Electron 主进程）
├── electron/ssr-server.mjs   # 托管 dist/server/server.js 为本地 HTTP（127.0.0.1:7610）
│                             #   优先命中 dist/client 静态文件，其余交给 SSR fetch handler
└── electron/runner-manager.mjs # ELECTRON_RUN_AS_NODE=1 + process.execPath 启动 runner/server.mjs
                              #   cwd = DATA_DIR，复用 App 自带 Node（不依赖系统 node）
```

---

## 依赖服务

```bash
# 1. 本地 Runner（必要）：AI 类 / Lark / 文件节点的执行都经过它
node runner/server.mjs   # 监听 127.0.0.1:7523

# 2. MCP Server（可选，MCP + SKILL 接入时）：stdio 模式暴露 workflow_* 四个工具
node runner/mcp.mjs

# 3. AI CLI 工具（AI 类节点）：任选其一并完成各自登录/配置
#    claude / codex / deepseek（Runner 会自动探测已安装项）

# 4. Lark CLI（仅当工作流含 Lark 节点）
lark-cli auth login
```

BMad 无需安装 CLI —— 仅使用 `.bmad/` 下的角色配置与指令（见 [BMad 集成](#bmad-集成与角色使用)）。

前端启动时通过 `GET /ping` 探测 Runner 是否在线；离线时 AI / Lark / 文件类节点会给出明确提示。Runner 只在 `127.0.0.1` 监听，并校验 `Origin` 白名单（默认允许任意 localhost 端口，可用 `RUNNER_ALLOWED_ORIGINS` 配部署域名），防止其他网页指挥你本机的 Runner。

---

## 技术栈

- **框架**: React 19 + TypeScript 6 + Vite 8
- **路由**: TanStack Start / TanStack Router（文件路由 + API 路由 + SSR）
- **UI**: Ant Design 6 + Radix UI Icons + Lucide Icons
- **画布**: React Flow 12 (`@xyflow/react`)
- **状态**: Zustand 5 + Immer 11
- **样式**: Sass (SCSS Modules)
- **桌面**: Electron 44 + electron-builder 26（asar 关闭，SSR 产物以原生 ESM 加载顶层 `node_modules`）
- **本地执行**: `runner/server.mjs`（零依赖 Node 本地 Runner）+ `runner/mcp.mjs`（stdio MCP Server）

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
├── picop-install/          # 分发技能：speckit / openspec / lark-cli 安装说明
└── picop/                  # 分发技能：MCP + SKILL 零编排接入（build → export → 汇报）
electron/
├── main.mjs                # 主进程：窗口创建、SSR 服务与 Runner 生命周期
├── ssr-server.mjs          # dist/server/server.js → 本地 HTTP（静态资源 + SSR）
├── runner-manager.mjs      # Runner 子进程管理（Electron 自带 Node）
└── paths.mjs               # APP_ROOT / DATA_DIR 解析与数据播种
src/
├── engine/
│   ├── workflow.ts           # DAG 执行引擎（拓扑排序 + 分层并行 + 上下文累积）
│   ├── topological.ts        # 拓扑排序 / 分层 / 祖先链（getAncestorIds / getPredecessors）
│   ├── accumulate.ts         # 上下文累积：按节点类型提取关键字段（Token 优化）
│   └── executors/            # 节点执行器
│       ├── index.ts          # 执行器注册表
│       ├── userInput.ts
│       ├── agent.ts          # 智能体（本地 CLI 工具执行）
│       ├── bmad.ts           # BMad 角色（persona 注入，不调用 AI/CLI）
│       ├── lark.ts           # Lark 文档
│       ├── larkTemplate.ts   # Lark 模板
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
│   └── modal.ts             # 旧模型配置 serialize/hydrate（向后兼容，主链路不再用）
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
│       │   ├── bmad.ts           # BMad（遗留 CLI 路由，已不主用）
│       │   ├── httpProxy.ts      # 外部 HTTP 代理（主路径已迁 Runner /http-proxy）
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
workflows/                 # 保存的工作流模板 / PIN 结果 / 版本快照
prompts/                   # 提示词模板
memory/                    # 记忆文件
.bmad/                     # BMad 角色注册表与清洗后的角色指令
picop-docs/                # dumi 文档站点
```

---

## 功能实现清单

### 可视化编辑器

- **React Flow 画布** — 节点拖拽、连线、缩放、平移（`@xyflow/react` v12），MiniMap + Controls
- **暗色主题** — Ant Design darkAlgorithm + React Flow 暗色适配
- **节点操作** — 右侧 `+` 添加节点并自动连线、编辑面板删除节点、节点标题/描述内联编辑
- **Spec 标记** — 脚印按钮标记节点输出所属阶段，左侧 StepLinePanel 汇总并提示缺失项

### 执行引擎

- **DAG 执行** — 拓扑排序（Kahn）确定顺序，分层并行（`Promise.all`），检测循环依赖
- **Pipeline 数据流** — 上游 output 自动传递为下游 input
- **上下文累积** — 每节点 BFS 收集全部祖先，按类型提取规范摘要组成 `input.upstreams`
- **执行 Checkpoint** — 每层完成写盘 `.pin/exec_state_<workflowId>.json`，Answer 等暂停后可从断点续跑
- **执行控制** — 运行全部 / 重置 / 单节点执行 / 从 PIN 节点开始，实时状态标签与 info/warn/error 日志
- **输出与统计** — 独立输出 Tab、执行结果（成功与否 / 耗时 / token 总量）
- **孤立节点过滤** — 无连线参与的节点不执行

### 本地工具执行

- **Runner 探测** — 「本地工具」下拉由 `GET /tools` 探测本机已装 CLI，未安装置灰
- **异步任务** — `POST /agent-cli` 返回任务 ID，前端轮询 `GET /task/:id` 拉取日志增量
- **权限模式** — 只读场景用安全模式；batch 编码用 auto 模式（claude → `--permission-mode acceptEdits`、codex → `--full-auto`、deepseek → `--auto`）

### 工作流资产

- **导入 / 导出** — 粘贴 JSON 或拖拽上传；导出展示 JSON 或下载 `.json`
- **模板库** — 保存到 `workflows/`，独立 Tab 管理（加载 / 删除），带版本快照
- **提示词管理** — 编辑 CodeAgent 等系统提示词，持久化到 `prompts/`
- **PIN** — 节点输出固定到 `workflows/result/.pin/<工作流名>/`，支持从中间节点续跑

### 状态管理

- **Zustand** 全局状态 + **Immer** 不可变更新（`patchCurrentNode`）
- **NodeBuilder** 工厂构建节点，自动生成 UUID 与位置偏移
- **路由树自动生成** — TanStack Router 文件路由，`tsr generate` 自动更新

---

## 核心节点详解

### CodeAgent 节点

用本机 AI CLI（Claude Code / Codex / DeepSeek）在项目目录直接编码，CLI 自身就是编码 agent（读写文件、跑命令、git），平台不再维护工具调用循环：

- **analyze 模式（默认）** — CLI 在项目目录只读分析，产出技术方案文档
- **batch 模式** — 按 tasks.md 批次实现代码（auto 模式），指令要求每完成一个任务打勾（`- [ ]` → `- [x]`）
- **配置**：本地工具、项目路径（作为 `cwd` 传给 Runner）、Git 分支、执行指令、模式切换
- **上游集成** — 接收上游 Agent 的 `response` 作为执行依据，并可从祖先链（`upstreams`）回溯 Lark 模板约束

### 自检 Agent 节点（selfCheck）

独立会话 · 独立上下文 · 不共享编码 Agent 记忆（防"自己给自己打分"的确认偏差）：

- **身份注入** — 编辑面板「视角 (BMad)」从角色库选一个角色，注入其 SKILL 作为评审系统提示词；一个节点一个角色，多视角 = 多个自检节点
- **材料自动降级**（Runner 在本地收集）：
  1. 上游为 codeAgent（编码场景）→ 预执行 `git diff HEAD` 附进 prompt（ground truth，安全模式即可评审；缺项目路径时报错引导配置）
  2. 其他上游（文档场景）→ 上游祖先累积产物（原始需求 + 最终交付物）
  3. 节点指令 — 始终追加到评审材料末尾
- **结论** — 从报告中宽松提取 PASS / FAIL / NEEDS_ATTENTION，节点显示标签 + 视角角色

### 任务拆解节点（taskPlanner）

把上游概设输出的 plan 拆解为可独立执行的 batch 任务清单：

- **输出** — tasks.md 全文（`## Batch N` + `- [ ]` 任务），CLI 按 `prompts/taskPlanner.md` 组织；batchCount / taskCount 正则宽松统计
- **消费** — 供 codeAgent batch 模式按批次实现代码

### Spec 标记模式（只标记，不产文件）

- 节点通过脚印按钮（StepMarkNode）手动标记输出阶段（spec/plan/tasks/report/…），画布左侧 StepLinePanel 汇总并提示缺失必选项（spec/plan/tasks）
- 标记随工作流持久化，**平台不产出任何 spec 文件**——导出 `workflow.yml` 后由 openspec / speckit 等框架生成 `specs/` 目录
- 执行前检测执行范围内至少一个节点被标记，否则中止（保证编排携带阶段信息）

### 条件分支 / 循环 / 重试

- **if** — 关键词匹配（上游输出包含任一关键词即命中）或 AI 判断
- **loop** — 固定次数，或按上游数据数组长度迭代
- **retry** — 捕获上游错误，支持关键词匹配与 AI 判断两种重试条件

### PIN

1. 执行节点后点击 📌 保存结果（连同该节点执行时看到的累积上下文，按工作流分目录落盘）
2. 执行面板 Select 选择已固定的 PIN 节点（当前工作流的 PIN 排在前面）
3. 点击「运行」→ 引擎注入 PIN 输出并恢复其累积上下文，从下游继续
4. 未运行过的节点 PIN 无累积上下文 → 直接运行，不累积

---

## 处理策略与优化手段

### 上下文累积（引擎级）

- 节点输入 = 直接前驱输出合并 + `upstreams`（全部祖先节点的规范摘要，BFS 从近到远收集）
- 保证线性链路中任意位置都能拿到整条链路上下文，无需手动补线；中间节点不丢上游数据

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

- **平台不持有模型凭据** — AI 执行全部走用户本机 CLI，工作流 JSON 不落任何模型敏感字段（`modal` 仅保留目录别名等非敏感信息）
- **Runner 本地隔离** — 只绑定 `127.0.0.1`，CORS `Origin` 白名单（默认任意 localhost 端口 + `RUNNER_ALLOWED_ORIGINS`），阻止任意网页指挥本机 Runner
- **命令模板化** — Runner 只按注册表 adapter 拼命令（不接收任意 shell 字符串），并预先收集 git diff / 指定 cwd
- **路径穿越检测** — 文件读写校验 `..`
- **知识库去平台化** — 平台不内置任何数据库，检索节点只把查询交给用户自己的数据源：本地模式经本机 AI CLI 的 MCP，远程 API 模式由 Runner `/http-proxy` 代理（仅 URL / 方法 / Headers / Body，无凭据落库）
- **文档上传限制** — ≤5MB

### PIN 存储

- 文件存 `workflows/result/.pin/<工作流名>/nodeType_nodeId.json`，**按工作流目录隔离**（不同工作流相同 nodeId 不互相覆盖）；注入按 `nodeId` 精确匹配
- PIN 保存时记录该节点执行时的累积上下文（`context.upstreams`）；从中间 PIN 运行一并注入，下游可恢复完整上下文
- 加载列表按"当前工作流优先"排序并标注归属；旧格式（根目录文件）仍兼容读取

---

## BMad 集成与角色使用

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
- **智能体节点** — 下拉选择角色（或连线 BMad 节点），自动同步角色指令
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
| 可扩展性     | 自定义角色可视化创建 + 指令内编辑                                               | BMB 元开发可搓新 Agent / 工作流，但仍在框架内                                      |
| 维护成本     | 官方更新需手动同步 `.bmad/` 并重新清洗                                          | 每次 install 自动拉最新，但受框架约束                                              |
| 适用场景     | 把「角色 / 多视角」嵌入自研工作流编排，轻量、本地、可调试                       | 直接采用 BMad Method 完整流程，接受固定编排                                        |

**结论**

核心取舍是**「只要多角色，不要框架」**。BMad Method 最可复用的资产是多年沉淀的角色方法论；CLI 的价值在于把流程固化为会话。本项目诉求是"自编工作流去执行"，角色提供的是视角与约束，因此 persona 注入是最小契合面。代价是放弃官方流程模板的方法论深度与自动更新——后续可按需把 `.bmad/plan/` 中的核心流程提炼进角色指令或节点模板。

> 注：`/api/execute/bmad` 为早期「CLI 映射」方案的遗留路由（status / skills / map-workflow / execute-skill），当前主链路不使用，仅保留兼容。

---

## MCP + SKILL 接入

```
用户工具（SKILL 指导 + MCP Client）
  → stdio MCP Server（runner/mcp.mjs，依赖本地 shared/export-core.mjs）
  → 本地 Runner（/agent-cli 生成 + /file-write 落盘）
  → 用户项目
```

- MCP Server 是**常驻子进程**，改动 `runner/mcp.mjs` 后需让工具宿主**重新 spawn**（彻底退出工具 / 断开并重连 MCP），仅重开对话不会重启它。
- **结构归一化**：flowBuilder 产出的顶层 `title` 归位到 `data.title`、下标式 `edges` 转为节点 id 引用，以对齐 `shared/export-core.mjs` 期望的严格结构。
- **导出同源**：画布 `exporter.ts` 与 MCP `workflow_export` 共用 `shared/export-core.mjs`，逻辑唯一来源，保证两处产物完全一致。
- **四零原则**：MCP Server 跑在用户本机、无外部依赖，不存数据、不持凭据、不跑运行时；产物只写入用户显式指定的目录。

使用教程见 [picop-docs/docs/tutorial/mcp_skill.md](picop-docs/docs/tutorial/mcp_skill.md)，实现原理与踩坑记录见 [struct_mcp_skill.md](struct_mcp_skill.md)。

---

## 桌面端打包

```bash
pnpm build     # vite build + electron-builder --publish never
```

产物：`release/Picop-<version>-arm64.dmg`（仅 macOS Apple Silicon）。

约束与取舍（见 `electron-builder.yml`）：

- **`asar: false`** — `dist/server/server.js` 以原生 ESM import 加载顶层 `node_modules` 的外部依赖（react / seroval / h3-v2 / antd / @ant-design/x 等），保留真实文件最稳。
- **仅 arm64** — `mac.target` 只声明 `dmg: arm64`；`electronLanguages` 只保留 `en` / `zh_CN`。
- **剔除构建期依赖** — `@tanstack/*` 已被 `vite.ssr.noExternal` 内联进 server bundle，`vite` / `lightningcss` / `sass` / `prettier` / `typescript` / `eslint` / `vitest` / `@babel/*`（core 系，运行时只用 `@babel/runtime`）等由 `files` 负向 glob 排除；同时排除 `workflows/result`、`.DS_Store`、`*.map`。
- **内部分发不签名** — 未做 Developer ID 签名与公证（`hardenedRuntime: false`、`gatekeeperAssess: false`）。arm64 上主二进制至少保留 Electron 自带的 ad-hoc 签名才能启动，因此不要设为 `null`；跨机分发由使用者自行放行 Gatekeeper。
- **数据播种** — 打包后 `DATA_DIR = ~/Library/Application Support/picop/data`，首次启动从 App 内复制 `workflows` / `memory` / `prompts` / `.bmad` / `.skills` / `.lark`；`model.conf.json` 不随包分发，由使用者自行配置。

---

## 本地开发

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

AI 类节点（智能体 / 代码处理 / 任务拆解 / 自检 / 关键词）在编辑面板选择「本地工具」即可执行，支持 `claude-code` / `codex` / `deepseek`。

仓库使用 pnpm（isolated nodeLinker，`node_modules` 为符号链接布局），安装与构建都请用 pnpm。
