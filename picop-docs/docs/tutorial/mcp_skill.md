---
title: MCP + SKILL 零编排接入
order: 4
---

# MCP + SKILL 零编排接入

> 除了在画布上拖拽编排，你还可以在**自己的 AI 工具**（Claude Code / Codex / Trae 等）里，用一句自然语言把工作流程直接变成**可执行产物**并写进你自己的项目目录——**无需打开画布、无需学习编排**。
>
> 若你想了解这一能力的实现原理、遇到的问题与架构细节，请阅读项目根目录的 `struct_mcp_skill.md`。

---

## 一、它是什么

Picop 通过 **MCP（Model Context Protocol）+ SKILL** 把平台能力直连到你的工具中，形成一条零编排成本的接入链路：

```
你的工具（SKILL 指导 + MCP Client）
   → stdio MCP Server（runner/mcp.mjs，依赖本地 shared/export-core.mjs）
   → 本地 Runner（/agent-cli 生成 + /file-write 落盘）
   → 你的项目目录
```

它暴露两个 MCP 工具：

| 工具              | 作用                                                             | 关键入参                                            |
| ----------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `workflow_build`  | 把自然语言描述的工作流程，交给本机 AI CLI 生成工作流定义（JSON） | `description`（必填）、`tool`、`timeoutMs`          |
| `workflow_export` | 把工作流定义导出为 4 种产物之一并写入你的项目                    | `workflow`、`name`、`targetDir`（均必填）、`format` |

**四零原则全程保持**：MCP Server 跑在你本机、无外部依赖，不存数据、不持凭据、不跑运行时；产物只写入你显式指定的项目目录。

---

## 二、前置条件

首次使用前，请确认以下三项：

1. **本机已启动 Picop Runner**（`127.0.0.1:7523`）。在 `ai-workflow` 目录执行：

   ```bash
   node runner/server.mjs
   ```

   可用以下命令验证：

   ```bash
   curl http://127.0.0.1:7523/ping
   ```

2. **本机已安装任一 AI CLI 工具**：Claude Code（`claude`）/ Codex（`codex`）/ DeepSeek Harness（`deepseek`）——`workflow_build` 会用它生成工作流。

3. **MCP Server 已在你的工具中注册**（见下一节，执行一次即可）。

---

## 三、注册 MCP Server（一次性）

> **路径提示**：`<ai-workflow>` 只是占位符，**必须替换为你本机 `ai-workflow` 的真实绝对路径**（该目录内含 `runner/mcp.mjs`），不要使用含 `~` 的相对写法。
>
> 推荐先定位真实路径：

```bash
find ~ -maxdepth 5 -type f -name mcp.mjs -path "*runner*" 2>/dev/null
```

**Claude Code**：

```bash
claude mcp add picop -- node <上面定位到的 mcp.mjs 绝对路径>
```

**Codex / 其他工具**：在其 MCP 配置文件（如 `.mcp.json`）中添加，`args` 必须是绝对路径：

```json
{
  "mcpServers": {
    "picop": {
      "command": "node",
      "args": ["/绝对路径/ai-workflow/runner/mcp.mjs"]
    }
  }
}
```

---

## 四、使用流程

把「生成工作流 / 搭建工作流 / 把流程导出到项目」的意图交给工具里的 AI，分发技能 `.skills/picop-mcp/SKILL.md` 会指导它完成三步。

> **重要**：本能力的唯一职责是**把流程沉淀为可复用的工作流产物**。你给出的一组步骤（例如「先读取 X，再分析，再检索 Y，最后输出 Z」）是 `workflow_build` 的 `description` 输入素材，**不是执行清单**。

### 1. 生成工作流定义（workflow_build）

AI 把你的自然语言描述交给本机 AI CLI 转换成工作流定义，并返回 `explanation`（对流程的理解）+ `workflow`（`{ nodes, edges }`）。请先确认 `explanation` 与你的预期一致。

### 2. 导出产物（workflow_export）

选择导出格式与名称，指定**你项目根目录的绝对路径**作为 `targetDir`，即可写入产物。

> `workflow` 必须使用 build 返回的对象，不要自行编造或改写节点。

### 3. 汇报与执行

AI 会列出实际写入的文件路径，并按格式告诉你执行方式。

---

## 五、四种导出格式

| format            | 产物路径                                         | 适用场景                                                | 执行方式                                                            |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------- |
| `speckit`（默认） | `specify/workflows/<name>/workflow.yml`          | 在 SpecKit / Codex / Claude 中按命令步骤流水线执行      | 按 `workflow.yml` 运行（可用 `picop-install` 技能安装 speckit）     |
| `openspec`        | `openspec/schemas/<name>/schema.yaml`            | 项目使用 OpenSpec 规范（artifacts 依赖图 + apply 跟踪） | 用 `opsx apply` 按 artifacts 清单实施                               |
| `spec`            | `spec/changes/<name>/specs/<name>/workflow.yaml` | 同构 artifacts、无需安装 OpenSpec，任意 agent 直接读    | 任意 agent 读 `workflow.yaml` 按 artifacts 顺序执行                 |
| `skill`           | `skills/<name>/SKILL.md`                         | 作为技能直接触发                                        | 把 `skills/<name>` 放入工具的 skills 目录，用 `/name <prompt>` 触发 |

> **产物与画布导出一致**：MCP 与画布共用同一导出核心（`shared/export-core.mjs`），openspec 的 `generates` / `description` / `instruction`（含「输入上下文」引用）与 tasks 自动补全均与画布导出相同。

---

## 六、输出物校验

- 本能力的**合法输出物仅有以下 4 类**：
  - `specify/workflows/<name>/workflow.yml`
  - `openspec/schemas/<name>/schema.yaml`
  - `spec/changes/<name>/specs/<name>/workflow.yaml`
  - `skills/<name>/SKILL.md`
- 若最终产出是这 4 类之外的任何文件（例如分析报告 `xxx.md`、文档摘要等），说明走错了流程，应回退到 `workflow_build` → `workflow_export` 重新产出合法产物。

---

## 七、常见问题

| 问题                                   | 处理                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| MCP 工具不可见 / 连接失败              | 优先检查 Runner 是否已启动（`curl http://127.0.0.1:7523/ping`），以及 MCP 注册命令是否指向 `runner/mcp.mjs` 的绝对路径 |
| 改了 `runner/mcp.mjs` 后行为没变       | MCP Server 是常驻子进程，需让工具宿主**重新 spawn**（彻底退出工具 / 断开并重连 MCP），仅重开对话不会重启它             |
| 报「本机未安装任何 AI CLI 工具」       | 安装 Claude Code / Codex / DeepSeek 其一后重试                                                                         |
| 产物里节点标题变成 `node4/node5/node6` | 通常是旧进程在跑旧代码（见上一条）；正常路径下 MCP 会做节点/连线归一化                                                 |
| 导出到了错误的目录                     | `targetDir` 必须显式确认为项目根目录的绝对路径；导出逻辑会拒绝包含 `..` 的路径                                         |
| 想微调生成的工作流                     | 在 Picop 画布中导入工作流 JSON 后调整，或直接再次描述需求重新生成                                                      |

---

## 下一步

- [深入指南](detail.md) — 节点、引擎、PIN、BMad 等原理详解
- [工作流执行](../run/index.md) — 导出后如何在不同工具中运行
- [项目概览](../overview/index.md) — 平台定位与架构
