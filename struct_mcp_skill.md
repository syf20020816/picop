# MCP + SKILL 方案：做什么、遇到什么问题、架构整理

本文件记录本轮「零编排成本接入：MCP + SKILL」方案的完整交付总结，包含三部分：

1. **干了什么** —— 本轮新增/修改的交付物与能力
2. **遇到什么问题** —— 落地过程中暴露的缺陷与修复
3. **架构整理** —— 分层、数据流、模块职责与契约边界

> 面向读者：平台维护者。使用说明请见 [`picop-docs/docs/tutorial/mcp_skill.md`](picop-docs/docs/tutorial/mcp_skill.md) 与 [`.skills/picop-mcp/SKILL.md`](.skills/picop-mcp/SKILL.md)。

---

## 一、干了什么

### 1.1 目标

让用户**不打开画布、不学习编排**，在自己常用的 AI 工具（Claude Code / Codex / Trae 等）里，用一句自然语言把工作流程直接变成**可执行产物**并写进自己的项目目录。

### 1.2 交付物清单

| 交付物       | 路径                                                                                                       | 职责                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| MCP Server   | [`runner/mcp.mjs`](runner/mcp.mjs)                                                                         | stdio MCP 服务，暴露 `workflow_build` / `workflow_export` 两个工具        |
| 导出共享核心 | [`shared/export-core.mjs`](shared/export-core.mjs)                                                         | 纯 JS 导出逻辑唯一来源，画布与 MCP 共用（+ `export-core.d.mts` 类型声明） |
| 薄转发层     | [`src/services/exporter.ts`](src/services/exporter.ts)                                                     | 画布侧仅 re-export 共享核心，不再自带导出逻辑                             |
| 生成契约     | [`prompts/flowBuilder.md`](prompts/flowBuilder.md)                                                         | 自然语言 → 工作流定义的提示词契约（21 种节点类型）                        |
| 分发技能     | [`.skills/picop-mcp/SKILL.md`](.skills/picop-mcp/SKILL.md)                                                 | 指导工具里的 AI 完成「build → export → 汇报」三步                         |
| 启动命令     | `node runner/mcp.mjs`                                                                                      | 启动 stdio MCP Server                                                     |
| 平台文档     | [`README.md`](README.md)、[`picop-docs/docs/tutorial/mcp_skill.md`](picop-docs/docs/tutorial/mcp_skill.md) | 接入说明与使用指南                                                        |

### 1.3 两个 MCP 工具

- **`workflow_build`** —— 入参 `description`（自然语言流程，必填）/ `tool` / `timeoutMs`。
  读取 `prompts/flowBuilder.md` 作为系统提示词，提交给本机 AI CLI（经 Runner `/agent-cli` 异步执行 + 轮询 `/task/:id`），解析返回 JSON 得到 `explanation` + `workflow{nodes,edges}`。未指定 `tool` 时用 Runner `/tools` 自动探测首个已安装的 CLI。
- **`workflow_export`** —— 入参 `workflow`（必填）/ `name`（必填）/ `targetDir`（必填）/ `format` / `description`。
  调用 `buildWorkflow(fmt, nodes, edges, …)` 生成产物文本，经 Runner `/file-write` 落盘到用户项目，返回实际写入的绝对路径列表。

### 1.4 四种导出格式

| format            | 产物路径                                         | 适用场景                                               |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------ |
| `speckit`（默认） | `specify/workflows/<name>/workflow.yml`          | SpecKit / Codex / Claude 中按命令步骤流水线执行        |
| `openspec`        | `openspec/schemas/<name>/schema.yaml`            | 使用 OpenSpec 规范（artifacts 依赖图 + apply 跟踪）    |
| `spec`            | `spec/changes/<name>/specs/<name>/workflow.yaml` | 同构 artifacts、无需安装 OpenSpec，任意 agent 直接执行 |
| `skill`           | `skills/<name>/SKILL.md`                         | 作为技能 `/name <prompt>` 触发                         |

> **一致性保证**：MCP 导出与画布导出共用 `shared/export-core.mjs`，产物完全相同（同为唯一来源）。

### 1.5 保持的四条边界（四零原则）

MCP Server 跑在用户本机、无外部依赖：**不存数据、不持凭据、不跑运行时**，产物只写入用户显式指定的项目目录。凭据与订阅仍全留在用户机器。

---

## 二、遇到什么问题

### 问题 1：flowBuilder 契约与导出核心契约不一致（根因）

**现象**：MCP 导出的产物里，节点标题丢失、边关系失效，退化成一堆 `node4 / node5 / node6` 这类占位名。

**根因**：`prompts/flowBuilder.md` 的「响应格式」与 `shared/export-core.mjs` 期望的节点结构对不上：

| 字段     | flowBuilder 产出                               | export-core 期望   | 后果                                                                |
| -------- | ---------------------------------------------- | ------------------ | ------------------------------------------------------------------- |
| 节点标题 | 顶层 `title`                                   | `data.title`       | 标题取不到 → 用 id 兜底 → `description: node4`                      |
| 连线端点 | `edge.source/target` 是**数组下标**（`0 → 1`） | 节点 **id** 字符串 | 拓扑排序匹配不到节点 → 边被丢弃 → 无 `## 输入上下文`、无 `requires` |

**修复**：在 [`runner/mcp.mjs`](runner/mcp.mjs) 的 `exportWorkflow` 中增加**归一化层**（对齐画布节点结构），不修改 flowBuilder 与 export-core 两侧契约：

- **节点归一化**：校验并补全 `id` / `position` / `data`；把顶层 `title` 归位到 `data.title`；用 `VALID_NODE_TYPES` 校验类型。
- **连线归一化**：下标 → 节点 id；补 `id`；过滤端点不存在的边。

这样 MCP 入口对 AI 输出的宽容度更高，而共享导出核心保持「只认规范结构」的单一职责。

### 问题 2：只改代码仍复现——常驻进程未重启

**现象**：修复 `mcp.mjs` 后，用户侧执行仍否看到旧结果（`node4/node5/node6`），以为修复无效。

**根因**：MCP Server 是**长驻子进程**，由工具宿主在会话启动时拉起。它比修复文件的修改时间更早启动（进程启动 16:43:50 < 文件修改 16:55:42），因此内存里跑的还是旧代码。用户「重启对话」并不会重新 spawn 这个子进程。

**处理**：结束旧的 MCP 子进程（`kill <pid>`），让宿主在下次调用时用新文件重新拉起。

**经验沉淀**：

- MCP Server 是常驻进程，**任何 `mcp.mjs` 改动都必须让宿主重新 spawn**（彻底退出工具 / 断开并重连 MCP，而非仅重开对话）。
- 排查导出异常时，先确认「跑的是哪份代码」，再怀疑逻辑。

### 问题 3：路径与写入安全

- `targetDir` 由用户/AI 传入，存在路径穿越风险 → `safeResolve` 拒绝含 `..` 的路径，并二次校验 `full.startsWith(baseDir + sep)`。
- SKILL 里的 `<ai-workflow>` 是占位符，容易被原样照抄 → SKILL 明确要求先 `find` 定位 `runner/mcp.mjs` 的真实绝对路径再注册，禁止含 `~` 的相对写法。

---

## 三、架构整理

### 3.1 分层视图

```
┌──────────────────────────────────────────────────────────────────────┐
│ 用户工具（Claude Code / Codex / Trae …）                                 │
│   ├─ SKILL：.skills/picop-mcp/SKILL.md    ← 触发判定 + 三步流程 + 选型    │
│   └─ MCP Client：读取 tools/list，调用 tools/call                       │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ stdio（newline-delimited JSON-RPC 2024-11-05）
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ MCP Server：runner/mcp.mjs（本机 node 进程，串行队列按序处理）            │
│   ├─ workflow_build  ──┐                                              │
│   └─ workflow_export ──┤                                              │
└────────────────────────┼──────────────────────────────────────────────┘
                         │ HTTP 127.0.0.1:7523
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 本地 Runner：runner/server.mjs                                        │
│   ├─ POST /agent-cli   → 子进程跑 claude / codex / deepseek（生成）      │
│   ├─ GET  /task/:id    → 轮询任务结果                                   │
│   ├─ POST /file-write  → 写入用户项目目录                               │
│   └─ GET  /tools       → 探测本机已安装 CLI                             │
└──────────────────────────────────────────────────────────────────────┘

共享导出核心（被 MCP 与画布共同依赖）
   shared/export-core.mjs ──► src/services/exporter.ts（画布薄转发）
                          └─► runner/mcp.mjs（MCP workflow_export）
```

### 3.2 数据流：自然语言 → 产物

````
用户自然语言 description
   │  workflow_build
   ▼
prompts/flowBuilder.md（提示词契约）
   │  Runner POST /agent-cli → 本机 AI CLI
   ▼
AI 原始响应（含 ```json 代码块）
   │  parseWorkflowResponse 解析
   ▼
workflow { nodes, edges }  ← 注意：此处为 flowBuilder 的「宽松结构」
   │  workflow_export → 归一化（title→data.title；下标→id）
   ▼
规范 nodes/edges  ← export-core 要求的「严格结构」
   │  buildWorkflow(fmt, …)  共用导出核心
   ▼
产物文本（yaml / SKILL.md）
   │  Runner POST /file-write
   ▼
用户项目目录（4 种合法产物之一）
````

### 3.3 模块职责与边界

| 模块                         | 职责                                              | 边界（不做什么）                            |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------- |
| `runner/mcp.mjs`             | MCP 协议、工具编排、**结构归一化**、路径安全      | 不实现具体导出格式；不持有凭据              |
| `shared/export-core.mjs`     | 导出逻辑唯一来源（拓扑排序、格式映射、yaml 生成） | 不关心调用方（画布 / MCP）                  |
| `src/services/exporter.ts`   | 画布侧薄转发                                      | 不再自带任何导出逻辑                        |
| `runner/server.mjs`          | 本机执行面：跑 CLI、落盘、探测工具                | 不做编排决策                                |
| `prompts/flowBuilder.md`     | 自然语言 → 工作流定义的 AI 契约                   | 不保证输出严格结构（由 mcp.mjs 归一化兜底） |
| `.skills/picop-mcp/SKILL.md` | 分发技能：触发判定、三步流程、格式选型、输出校验  | 不执行用户流程；只产出工作流产物            |

### 3.4 关键契约（改动前必读）

- **节点类型全集**：`NodeTypes`（`shared/export-core.mjs`），MCP 侧用 `VALID_NODE_TYPES` 校验，未知类型直接报错。
- **节点结构**：`{ id, type, position, data }`，标题在 `data.title`。flowBuilder 的顶层 `title` 由 MCP 归一化写入 `data.title`。
- **连线结构**：`{ id, source, target }`，`source/target` 必须是**节点 id**。flowBuilder 的下标写法由 MCP 归一化转换。
- **协议**：MCP `2024-11-05`，stdio 换行分隔 JSON-RPC，串行队列保证按序处理与响应。

### 3.5 相关文件索引

| 主题            | 位置                                                                             |
| --------------- | -------------------------------------------------------------------------------- |
| MCP Server 实现 | [`runner/mcp.mjs`](runner/mcp.mjs)                                               |
| 导出共享核心    | [`shared/export-core.mjs`](shared/export-core.mjs)                               |
| 画布导出转发层  | [`src/services/exporter.ts`](src/services/exporter.ts)                           |
| 生成提示词契约  | [`prompts/flowBuilder.md`](prompts/flowBuilder.md)                               |
| 分发技能        | [`.skills/picop-mcp/SKILL.md`](.skills/picop-mcp/SKILL.md)                       |
| 平台接入说明    | [`README.md`](README.md)                                                         |
| 使用教程文档    | [`picop-docs/docs/tutorial/mcp_skill.md`](picop-docs/docs/tutorial/mcp_skill.md) |
| 本地 Runner     | [`runner/server.mjs`](runner/server.mjs)                                         |
