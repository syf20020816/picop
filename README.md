# PICOP — AI 工作流可视化编排工具

基于 [BMad Method](https://bmadcodes.com/) + Lark CLI 构建的轻量化 AI 工作流编排工具，用可视化节点编排 AI Agent 工作流，避免 Dify 等重型平台的复杂性。

## 平台定位：编排 → 验证 → 导出

Picop 是**设计时（Design-time）编排平台**，不是最终工作流的运行时：

1. **编排** — 用可视化 DAG 画布组合 19 种节点（需求分析 / 概设 / 任务拆解 / 编码 / 自检 / 知识库 / Lark 文档…），并用脚印按钮**标记**每个节点的输出属于哪个工作流阶段。
2. **验证** — 在画布上运行工作流验证编排是否正确（单节点调试 / PIN 固定 / 断点续跑 / 输出检查）。AI 类节点交给用户本机的 AI CLI（Claude Code / Codex / DeepSeek）执行，平台不内置也不配置任何模型。
3. **导出** — 把验证通过的工作流导出为 `speckit` / `openspec` / `spec` / `skill` 之一，放进自己的 Codex / Trae / Claude Code 中执行。

**Spec 分工**：平台**不生产 `specs/` 目录**（那是 openspec / speckit 等框架的职责），只做**阶段标记**（`specStep`），导出后的 `workflow.yml` 携带标记供框架使用。

---

## QuickStart

> 目标：装好 Picop，在你的 AI 工具里说一句话就能生成并导出工作流。全程约 5 分钟。

### 1. 安装 Picop

打开 `Picop-<version>-arm64.dmg`，把 Picop 拖进「应用程序」。仅支持 Apple Silicon（M 系列）。

内部包未做 Apple 公证，首次打开会被 Gatekeeper 拦截，任选一种方式放行：

```bash
xattr -dr com.apple.quarantine /Applications/Picop.app
```

或右键 App →「打开」→ 再次确认打开。

首次启动会在 `~/Library/Application Support/picop/data` 初始化数据目录（工作流模板 / 记忆 / 提示词 / BMad 角色 / 技能），后续都在这里读写。

### 2. 保持 Picop 运行

Picop 打开后会自动在本机拉起 Runner（`127.0.0.1:7523`），MCP 与画布执行都依赖它。**退出 App 会一并停掉 Runner**，用之前确认：

```bash
curl http://127.0.0.1:7523/ping
```

另外本机需装有任一 AI CLI（`claude` / `codex` / `deepseek`）——生成工作流与 AI 节点执行都用它，凭据留在你自己的机器。

### 3. 复制 MCP 服务配置

把下面这段加到你的 AI 工具里（Claude Code / Codex / Trae / Cursor 均可）。路径固定，直接用：

```json
{
  "mcpServers": {
    "picop": {
      "command": "/Applications/Picop.app/Contents/MacOS/Picop",
      "args": [
        "/Applications/Picop.app/Contents/Resources/app/runner/mcp.mjs"
      ],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

Claude Code 也可以一条命令注册：

```bash
claude mcp add picop -e ELECTRON_RUN_AS_NODE=1 -- \
  "/Applications/Picop.app/Contents/MacOS/Picop" \
  "/Applications/Picop.app/Contents/Resources/app/runner/mcp.mjs"
```

> 这里用 App 自带的 Node（`ELECTRON_RUN_AS_NODE=1`）执行 MCP Server，**不要求系统装 node**。App 没装在 `/Applications` 时替换成实际路径。

### 4. 安装 Picop SKILL

把 App 内置的分发技能复制到你的工具 skills 目录（按你用的工具选一条）：

```bash
# Claude Code
mkdir -p ~/.claude/skills && cp -R "/Applications/Picop.app/Contents/Resources/app/.skills/picop" ~/.claude/skills/

# Codex
mkdir -p ~/.codex/skills && cp -R "/Applications/Picop.app/Contents/Resources/app/.skills/picop" ~/.codex/skills/

# Trae
mkdir -p ~/.trae-cn/skills && cp -R "/Applications/Picop.app/Contents/Resources/app/.skills/picop" ~/.trae-cn/skills/
```

装完在工具里执行 `/picop`（或直接说「生成一个 … 工作流」）即可触发。技能负责「build → export → 汇报」三步，并支持：

| 参数                        | 作用                                          |
| --------------------------- | --------------------------------------------- |
| `-o speckit/openspec/spec/skill` | 指定导出格式（默认 `speckit`）           |
| `-s` / `--save`             | 生成后只保存到 Picop 模板库，不写项目目录     |
| `-l` / `--list`             | 只列出 Picop 已保存的工作流名称与描述         |

### 5. 跑通第一条

```text
把这段流程做成工作流并导出到 /Users/me/project：读取飞书需求文档 → 分析需求 → 输出技术方案
```

AI 会返回对流程的理解，确认后写入 `specify/workflows/<name>/workflow.yml`（含各节点输入物与 `manifest.json`）。需要换格式时加 `-o`，先看看生成效果可加 `-s` 存到 Picop，回画布打开继续调整。

> 若工作流要按 speckit / openspec 执行，或包含 Lark 节点，再装运行时：复制 `.skills/picop-install` 到同一 skills 目录，然后执行 `/picop-install`（详见 [工作流执行](picop-docs/docs/run/index.md)）。

---

## 两种使用方式

| 方式 | 入口 | 适合 |
| --- | --- | --- |
| **MCP + SKILL 零编排** | 在你自己的 AI 工具里用自然语言描述流程 | 已有明确流程，想直接拿到产物，不学编排 |
| **画布编排** | 打开 Picop 拖拽节点、连线、运行验证 | 需要可视化验证、微调、多分支/循环/自检 |

两者共用同一份工作流定义：MCP 生成的工作流可以存进 Picop 模板库回画布继续编排，画布也能导出 JSON 交给工具执行。

### MCP 工具

| 工具              | 作用                                                     | 关键入参                                                                 |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `workflow_build`  | 自然语言描述 → 工作流定义 JSON                            | `description`（必填）、`tool`、`timeoutMs`                               |
| `workflow_export` | 工作流定义 → 目录文件（主文件 + 输入物 + manifest）        | `workflow`、`name`、`targetDir`（必填）、`format`、`full`（默认 true）   |
| `workflow_save`   | 把工作流保存到 Picop 模板库（与画布保存同源）              | `workflow`、`name`（必填）、`description`                                |
| `workflow_list`   | 列出 Picop 已保存的工作流模板                              | 无                                                                       |

### 导出格式

| format            | 产物路径                                         | 执行方式                                      |
| ----------------- | ------------------------------------------------ | --------------------------------------------- |
| `speckit`（默认） | `specify/workflows/<name>/workflow.yml`          | `specify` 流水线执行                          |
| `openspec`        | `openspec/schemas/<name>/schema.yaml`            | `opsx apply` 按 artifacts 实施                |
| `spec`            | `spec/changes/<name>/specs/<name>/workflow.yaml` | 无需框架，任意 agent 读 yaml 执行             |
| `skill`           | `skills/<name>/SKILL.md`                         | 放入 skills 目录后 `/name <prompt>` 触发      |

---

## 节点能力

| 分类     | 节点                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| 输入输出 | 用户输入 `userInput`、回答 `answer`、AI 输出 `aiOutput`                                  |
| 智能体   | 智能体 `agent`、BMad 角色 `bmadAgent`、代码处理 `codeAgent`、任务拆解 `taskPlanner`、自检 `selfCheck`、关键词 `keywordAgent` |
| 外部系统 | 知识库检索 `knowledgeRetrieval`、Lark 文档 `lark`、Lark 模板 `larkTemplate`、记忆 `memory`、Skill `skill` |
| 流程控制 | 判断 `if` / `ifCondition`、循环 `loop` / `loopCondition`、重试 `retry`                    |

节点细节（各节点配置、执行语义、Spec 标记模式）见 [TECH.md](TECH.md#核心节点详解)。

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [TECH.md](TECH.md) | 执行架构、技术栈、项目结构、节点实现、上下文优化、BMad 集成、打包 |
| [picop-docs](picop-docs/docs/index.md) | 使用文档站点：快速上手 / 深入指南 / 执行指南 |
| [MCP + SKILL 零编排接入](picop-docs/docs/tutorial/mcp_skill.md) | MCP 接入的完整教程与常见问题 |
| [struct_mcp_skill.md](struct_mcp_skill.md) | MCP + SKILL 的实现原理与架构整理（维护者视角） |
| [工作流执行](picop-docs/docs/run/index.md) | speckit / openspec / spec 三种产物的本地执行方式 |

---

## 开发

```bash
npm install          # 依赖安装

npm run dev          # 桌面端开发（Electron 窗口，自动拉起 Runner）
npm run dev:web      # 纯浏览器开发（含 Runner 与文档，端口 3030）
npm run build        # 构建 + 打包 macOS dmg
```

详细的环境要求、架构、打包约束见 [TECH.md](TECH.md)。
