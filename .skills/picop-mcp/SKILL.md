---
name: 'picop-mcp'
description: '把用户自然语言描述的工作流程直接转换为 Picop 工作流产物并导出到项目目录（通过 MCP 连接 Picop 本地 Runner）。Invoke when user says 生成工作流 / 搭建工作流 / 把流程导出到项目 / build a workflow, or asks to convert a described process into an executable workflow.'
metadata:
  author: shengyifei@lizhi.fm
  version: '0.1.0'
---

# Picop MCP：自然语言 → 工作流产物

通过 MCP 连接 Picop 本地能力，把用户用自然语言描述的工作流程，一步转换为可执行产物并写入用户自己的项目目录。用户无需打开画布、无需学习编排。

## ⚠️ 触发判定（先读，放在一切动作之前）

本 skill 的唯一职责是：**把用户描述的工作流程「沉淀为可复用的工作流产物」（workflow.yml / SKILL.md）**。它不是"逐条执行任务"的工具。

- 只有用户意图是「把流程做成可复用产物 / 生成工作流 / 导出流程」时才激活本 skill。
- 若用户给出一**组待办步骤**（例如"先读取 X，再分析，再检索 Y，最后输出 Z"），这些步骤是 `workflow_build` 的 `description` 输入素材，**不是执行清单**。**禁止**逐条执行它们。
- 若用户只是点名 `/picop-mcp`、`Use Skill: picop-mcp` 或说"解析这个流程"而**没有明确要导出产物**，必须先澄清，再决定是否执行。用 `AskUserQuestion`，禁止默认直接执行：
  - "你是要我把这段流程用 picop 生成工作流并导出产物，还是让我直接执行？"
- 若用户明确要"直接执行"而非生成产物，**退出本 skill 逻辑**，按普通任务处理，不要在生成工作流上纠结。

## 前置条件（首次使用检查）

1. 本机已启动 Picop Runner：`node <ai-workflow>/runner/server.mjs`（监听 `127.0.0.1:7523`；`<ai-workflow>` 同样替换为上面定位到的真实目录）。可用 `curl http://127.0.0.1:7523/ping` 验证。
2. 本机已安装任一 AI CLI 工具：Claude Code（`claude`）/ Codex（`codex`）/ DeepSeek Harness（`deepseek`）——`workflow_build` 会用它生成工作流。
3. MCP server 已注册（在用户工具中执行一次）。

   > ⚠️ 路径警告：`<ai-workflow>` 只是占位符，**绝不能原样照抄**。它必须替换为本机真实的 `ai-workflow` 目录绝对路径（该目录内含有 `runner/mcp.mjs`）。
   >
   > 注册前先定位真实路径（推荐让 AI 代为执行）：
   >
   > ```bash
   > find ~ -maxdepth 5 -type f -name mcp.mjs -path "*runner*" 2>/dev/null
   > ```
   >
   > 取结果路径（如 `/Users/lizhi/Desktop/work/workflow/ai-workflow/runner/mcp.mjs`）即可，不要使用含 `~` 的相对写法。
   - **Claude Code**：`claude mcp add picop -- node <上面定位到的 mcp.mjs 绝对路径>`
   - **Codex / 其他**：在 `.mcp.json`（或等价配置）添加，`args` 必须是绝对路径：
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

## 工作流程

> **硬性约束：在调用 `workflow_build` 之前，禁止直接执行用户描述的任何步骤。**
> 用户给的步骤文本统一作为 `description` 传入，执行行为由步数，不由当前对话代跑。

对用户的自然语言流程描述，按以下三步执行：

### 1. 调用 workflow_build

- 入参：`description` = 用户描述的工作流程原文（可先向用户澄清模糊点，再原样或整理后传入）。
- 返回：`explanation`（AI 对流程的理解）+ `workflow`（`{ nodes, edges }` 工作流定义）。
- 把 `explanation` 简洁呈现给用户确认，说明将产出几个节点、大致链路。

### 2. 调用 workflow_export

- **产物与画布导出一致**：MCP 与画布共用同一导出核心（`shared/export-core.mjs`），openspec 的 `generates` / `description` / `instruction`（含「输入上下文」引用）与 tasks 自动补全均与画布导出相同。
- 入参：
  - `workflow`：**必须使用 build 返回的 `workflow` 对象**，不要自行编造或改写节点。
  - `format`：按用户用途选择（见下表）。
  - `name`：工作流名称（简短、语义化，如 `weekly-meeting-report`）。
  - `targetDir`：**用户项目根目录的绝对路径**（向用户确认，不要猜测）。
- 返回：`files`（实际写入的文件绝对路径列表）。

| format            | 产物                                             | 适用场景                                                                 |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| `speckit`（默认） | `specify/workflows/<name>/workflow.yml`          | 用户要在 SpecKit / Codex / Claude 中按命令步骤流水线执行                 |
| `openspec`        | `openspec/schemas/<name>/schema.yaml`            | 用户项目使用 OpenSpec 规范（artifacts 依赖图 + apply 跟踪）              |
| `spec`            | `spec/changes/<name>/specs/<name>/workflow.yaml` | 同构 artifacts、无需安装 OpenSpec 框架，任意 agent 读 workflow.yaml 执行 |
| `skill`           | `skills/<name>/SKILL.md`                         | 用户要把它作为技能 `/name <prompt>` 直接触发                             |

## ✅ 输出物校验

- 本 skill 的**合法输出物仅有以下 4 类**：`specify/workflows/<name>/workflow.yml`、`openspec/schemas/<name>/schema.yaml`、`spec/changes/<name>/specs/<name>/workflow.yaml`、`skills/<name>/SKILL.md`。
- 若最终产出是这两者之外的任何文件（例如分析报告 `xxx.md`、文档摘要等），说明走错了流程，必须回退到 `workflow_build` → `workflow_export`，重新产出合法工作流产物。
- 汇报时明确告诉用户产物文件路径与执行方式（speckit / openspec / spec / skill）。

### 3. 汇报与下一步

- 列出已写入的文件路径。
- 按格式给出执行方式：
  - speckit：提示用户按 `specify/workflows/<name>/workflow.yml` 运行（可参考 picop-install 技能安装 speckit）。
  - openspec：提示用户项目已具备 OpenSpec 目录约定，用 `opsx apply` 按 artifacts 清单实施。
  - spec：无需安装框架，任意 agent 直接读 `spec/changes/<name>/specs/<name>/workflow.yaml` 按 artifacts 顺序执行。
  - skill：提示用户把 `skills/<name>` 目录放入其工具的 skills 目录，即可用 `/name <prompt>` 触发。

## 注意事项

- `targetDir` 必须显式向用户确认，避免写入错误目录；导出逻辑会拒绝包含 `..` 的路径。
- 若 `workflow_build` 报"本机未安装任何 AI CLI 工具"，提示用户安装 Claude Code / Codex / DeepSeek 其一后重试。
- 若 MCP 连接失败（工具不可见），优先检查 Runner 是否已启动、MCP 注册命令是否指向 `runner/mcp.mjs`。
- 用户后续想微调工作流（增删节点、改指令），可让其在 Picop 画布中导入 `workflow_export` 的 JSON 版本后调整，或直接再次描述需求重新生成。
