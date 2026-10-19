---
title: 项目概览
order: 1
---

# 项目概览（Overview）

## 这是什么

AI Workflow 是一个基于 **BMad Method** + **Lark CLI** 构建的轻量化 **AI 工作流可视化编排工具**。它用可视化 DAG 画布组合多种节点（需求分析 / 概设 / 任务拆解 / 编码 / 自检 / 知识库 / Lark 文档…），适合需要快速搭建 AI Agent 工作流的场景，避免了 Dify 等重型平台的复杂性。

## 平台定位：编排 → 验证 → 导出

本项目是一个**设计时（Design-time）编排平台**，不是最终工作流的运行时：

1. **编排** — 用可视化 DAG 画布组合 20 种节点，并在 Spec 模式下用脚印按钮标记每个节点的输出属于哪个工作流阶段（功能规格 / 技术方案 / 任务清单 / 自检报告…）。
2. **验证** — 在画布上运行工作流验证编排是否正确（单节点调试 / PIN 固定 / 断点续跑 / 输出检查）。AI 类节点的执行由用户本机上的 AI CLI 工具（Claude Code / Codex / DeepSeek）完成，平台不内置也不配置模型。
3. **导出** — 编排与验证通过后，把工作流导出为 4 种可执行产物之一（`speckit` / `openspec` / `spec` / `skill`），放入自己的 **Codex / Trae / Claude Code** 中执行。此外还提供 **MCP + SKILL** 零编排成本入口：在自己的工具里用自然语言直接生成并导出产物（见 [MCP + SKILL 零编排接入](../tutorial/mcp_skill.md)）。

> **Spec 分工（边界清晰）**：平台**不生产 `specs/` 目录**——那是 openspec / speckit 等专业 spec 框架的职责。平台只做**阶段标记**（`specStep`），导出后的 `workflow.yml` 携带标记，spec 框架据此自动生成 `specs/` 目录。

### 执行架构：本地 Runner

平台前端只做编排，所有"副作用"执行（AI / Lark / 文件）通过本机一个零依赖的 Runner 服务（`runner/server.mjs`，监听 `127.0.0.1:7523`）：

```
浏览器/前端（控制面-编排）──HTTP(127.0.0.1:7523)──► 本地 Runner 服务
                                                    │
                                                    ├─ 子进程跑 lark-cli / claude / codex / deepseek
                                                    ├─ 写入用户本地文件（AI 输出落盘 /file-write）
                                                    └─ 代理知识库远程 API 请求（/http-proxy）
```

- 平台不持有任何模型凭据、不做 shell 执行、不访问用户文件系统——凭据与订阅全留在用户机器
- 服务器部署只需托管前端静态产物，无 API Key、无 model.conf，天然解决多用户共享凭据与服务器无法访问用户本地文件的问题
- 使用前需本机启动 Runner：在 `ai-workflow` 目录执行 `node runner/server.mjs`

## 设计哲学

| 原则                | 说明                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 控制面 / 执行面分离 | 平台只做编排与结果展示，执行统一走本机 Runner                                                                        |
| 不配置模型          | AI 类节点复用用户本机的 Claude Code / Codex / DeepSeek，凭据全留本地                                                 |
| 不存储用户数据      | 平台只保存用户的**工作流定义**（`workflows/` 目录，视为随仓库的本地工程配置），不持有任何业务数据 / API Key / 登录态 |
| 不重复造 Spec 框架  | 阶段标记（specStep）由平台负责，specs/ 目录由 openspec / speckit 等专业框架生成                                      |
| 编辑器即验证台      | 所见即所得，支持单节点调试、PIN 固定、断点续跑                                                                       |
| PIN 机制            | 满足迭代调试场景，避免重复消耗 Token                                                                                 |
| 前后端同仓库        | 文件路由 + API 路由一体化，零部署复杂度                                                                              |

## 技术栈

- **框架**: React 19 + TypeScript 6 + Vite 8
- **路由**: TanStack Router（文件路由 + API 路由）
- **UI**: Ant Design 6 + Radix UI Icons + Lucide Icons
- **画布**: React Flow 12 (`@xyflow/react`)
- **状态**: Zustand 5 + Immer 11
- **样式**: Sass (SCSS Modules)
- **服务端**: Node.js + TanStack Router Server Functions（前端侧）
- **本地执行**: `runner/server.mjs`（零依赖 Node 本地 Runner）

## 项目结构

```
runner/
├── server.mjs               # 本地 Runner 服务（127.0.0.1:7523）
│                            #   /ping /tools /agent-cli /task/:id /lark /fs/*
└── mcp.mjs                  # stdio MCP Server（MCP + SKILL 接入入口）
                             #   workflow_build / workflow_export（共用 shared/export-core.mjs）
shared/
└── export-core.mjs          # 导出共享核心：画布 exporter.ts 与 MCP workflow_export 共用，逻辑唯一来源
.skills/
├── picop-install/           # 分发技能：speckit 安装说明
└── picop-mcp/               # 分发技能：MCP + SKILL 零编排成本接入
src/
├── engine/
│   ├── workflow.ts           # DAG 执行引擎（拓扑排序 + 分层并行 + 上下文累积）
│   ├── topological.ts        # 拓扑排序 / 分层 / 祖先链
│   ├── accumulate.ts         # 上下文累积：按节点类型提取关键字段（Token 优化）
│   └── executors/            # 20 种节点执行器
├── components/
│   ├── flow.tsx              # React Flow 画布
│   ├── node/                 # 节点渲染组件
│   ├── panel/                # 编辑面板（编辑/执行/输出/结果）
│   ├── execution/            # 执行面板
│   ├── wiki/                 # 文档阅读（Docs）
│   ├── file-editor/          # 文件编辑器（含 CodeEditor / MdPreview）
│   └── ...
├── services/                # 共享服务（前后端共用）
│   ├── runner.ts            # 前端直连本地 Runner（探测/提交 AI 任务/轮询日志）
│   ├── upstreamContext.ts   # 上游累积上下文构建
│   └── ...
├── store/                   # Zustand 全局状态
├── types/                   # 类型定义 & NodeBuilder 工厂
└── routes/
    ├── index.tsx             # 首页（画布+编辑+执行面板）
    └── api/                  # 后端 API 路由
docs/                        # 平台使用与学习文档（本目录）
workflows/                   # 保存的工作流模板 / PIN 结果 / 技能
prompts/                     # 提示词模板
memory/                      # 记忆文件
```

## 核心概念速览

| 概念         | 说明                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| 节点（Node） | 工作流的最小单元，共 20 种类型（输入 / 智能体 / 角色 / 编码 / 拆解 / 自检 / 知识库 / Lark / 条件 / 循环 / 重试…） |
| 连线（Edge） | 节点间的数据流，上游 output 自动传递为下游 input                                                                  |
| 上下文累积   | 每个节点执行时 BFS 收集全部上游祖先节点，按类型提取"规范摘要"，保证线性链路不丢数据                               |
| PIN          | 节点输出固定：保存执行结果到文件，支持从中间节点断点续跑                                                          |
| specStep     | 阶段标记：标记节点输出属于工作流的哪个阶段（spec/plan/tasks/report…）                                             |
| BMad 角色    | 从 `.bmad/` 提取的多角色 persona 指令，注入智能体作为 system prompt                                               |

## 下一步

- [快速上手](2.quickstart.md) — 5 分钟跑通第一个工作流
- [深入指南](3.detail.md) — 节点、引擎、PIN、BMad 等原理详解
- [MCP + SKILL 零编排接入](../tutorial/mcp_skill.md) — 在自己的工具里用自然语言直接生成并导出工作流产物
