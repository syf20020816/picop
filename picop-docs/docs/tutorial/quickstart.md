---
title: 快速上手
order: 2
---

# 快速上手（Quickstart）

> Picop 有两种用法：**MCP + SKILL 零编排**（推荐先跑通，5 分钟拿到产物）和**画布编排**（可视化验证与微调）。
>
> 本页从安装开始，先带你跑通零编排链路，再介绍画布。更细的节点与引擎说明见 [深入指南](./detail)。

---

## 1. 安装 Picop

打开 `Picop-<version>-arm64.dmg`，把 Picop 拖进「应用程序」。仅支持 Apple Silicon（M 系列）。

内部包未做 Apple 公证，首次打开会被 Gatekeeper 拦截，任选一种方式放行：

```bash
xattr -dr com.apple.quarantine /Applications/Picop.app
```

或右键 App →「打开」→ 再次确认打开。

首次启动会在 `~/Library/Application Support/picop/data` 初始化数据目录（工作流模板 / 记忆 / 提示词 / BMad 角色 / 技能），后续读写都在这里。

## 2. 注册 MCP Server

Picop 打开后会自动在本机拉起 Runner（`127.0.0.1:7523`），MCP 与画布执行都依赖它——**用之前保持 Picop 运行**：

```bash
curl http://127.0.0.1:7523/ping
```

把下面的配置加到你的 AI 工具（Claude Code / Codex / Trae / Cursor 均可）：

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

> 用 App 自带的 Node 执行 MCP Server（`ELECTRON_RUN_AS_NODE=1`），**不要求系统安装 node**。App 不在 `/Applications` 时替换为实际路径。

## 3. 安装 Picop SKILL

把 App 内置的分发技能复制到你的工具 skills 目录（按你用的工具选一条）：

```bash
# Claude Code
mkdir -p ~/.claude/skills && cp -R "/Applications/Picop.app/Contents/Resources/app/.skills/picop" ~/.claude/skills/

# Codex
mkdir -p ~/.codex/skills && cp -R "/Applications/Picop.app/Contents/Resources/app/.skills/picop" ~/.codex/skills/

# Trae
mkdir -p ~/.trae-cn/skills && cp -R "/Applications/Picop.app/Contents/Resources/app/.skills/picop" ~/.trae-cn/skills/
```

技能负责「build → export → 汇报」三步，并支持三个参数：

| 参数                             | 作用                                      |
| -------------------------------- | ----------------------------------------- |
| `-o speckit/openspec/spec/skill` | 指定导出格式（默认 `speckit`）            |
| `-s` / `--save`                  | 生成后只保存到 Picop 模板库，不写项目目录 |
| `-l` / `--list`                  | 只列出 Picop 已保存的工作流名称与描述     |

> 另外本机需装有任一 AI CLI（`claude` / `codex` / `deepseek`）：生成工作流与 AI 节点执行都用它，凭据留你自己的机器。

## 4. 一句话生成并导出工作流

在工具里直接描述流程，例如：

```text
把这段流程做成工作流并导出到 /Users/me/project：读取飞书需求文档 → 分析需求 → 输出技术方案
```

AI 会先返回对流程的理解（`explanation`），确认后写入你的项目：

```
specify/workflows/<name>/
├── workflow.yml          # 主工作流文件
├── ...                   # 各节点引用的输入物（userInput / Skill / Memory / BMad / Lark URL 清单）
└── manifest.json
```

- 想换个格式执行：`-o openspec` / `-o spec` / `-o skill`
- 只想先存起来回画布调整：`-s`
- 看已保存了哪些：`-l`

> 若工作流要按 speckit / openspec 执行，或包含 Lark 节点，再装运行时：把 `.skills/picop-install` 复制到同一 skills 目录，执行 `/picop-install`（详见 [工作流执行](../run/index.md)）。

MCP 四个工具的完整说明与常见问题见 [MCP + SKILL 零编排接入](./mcp_skill)。

---

## 5. 在画布上编排

MCP 生成的工作流可以存进 Picop 模板库回画布继续编排；画布也能导出 JSON 交给 MCP / 工具执行。

### 5.1 认识界面

左侧导航栏包含六个功能页：

| 菜单       | 功能                                                 |
| ---------- | ---------------------------------------------------- |
| 工作流编排 | 主画布：拖拽节点、连线、运行工作流                   |
| 规则与模型 | BMad 角色库、提示词管理、技能管理（模型配置已下线）  |
| 知识库     | 知识库文档管理                                       |
| 执行结果   | 查看历史执行结果与统计                               |
| 编辑器     | 项目文件编辑器（提示词 / 记忆 / 工作流 JSON / 技能） |
| 文档       | 本使用与学习指南（docs 目录，即当前页面）            |

### 5.2 如何创建节点

在工作流编排中，鼠标右击画布空白处即可添加节点：

![节点类型](../imgs/nodes.png)

### 5.3 保存工作流

完成编排后，点击左上角四个按钮中的最后一个「保存工作流」：

![保存工作流](../imgs/workflow_save.png)

为工作流起名后保存。

### 5.4 单步执行与运行调试

点击节点上的运行按钮会立即执行该节点（单步执行）：

![单步执行](../imgs/node_run.png)

点击执行面板的「运行」按连线顺序执行整个工作流，完成后可在右侧查看每个节点的输出：

![工作流运行](../imgs/workflow_run.png)

### 5.5 导出真实工作流

点击左上角第三个按钮「导出工作流」：

![导出工作流](../imgs/export.png)

导出参数：

| 导出参数     | 说明                                                                                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目标平台     | 1. Picop：保存到本平台，供重复使用（不能在其他工具执行）<br />2. Speckit：spec-kit 平台可运行的工作流文件<br />3. OpenSpec：OpenSpec 平台可运行的工作流文件<br />4. Spec：不安装任何 Spec 平台、让 AI 直接识别运行的工作流文件 |
| 导出模式     | 1. 仅导出 workflow.yml：只需要一个主文件，或准备基于它修改<br />2. 全量导出 zip：包含输入物、Skill、BMad 角色文件等，需要直接在其他工具运行时选择                                                                                  |
| 合并并行步骤 | Speckit / OpenSpec 实际是串行执行，勾选后会把并行节点合并为一个步骤                                                                                                                                                                |

![导出参数](../imgs/export_spec.png)

导出后得到的工作流文件才是可在其他工具（Trae、Cursor、Codex、Claude Code 等）中运行的产物：

| 格式     | 特点                                                                    | 执行方式                                                       |
| -------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| OpenSpec | artifacts 依赖图（proposal/design/tasks），含类型兜底与 tasks 自动补全  | 通过 `/opsx:*` 斜杠命令触发，需安装 OpenSpec 或 agent 内置支持 |
| Speckit  | 命令步骤流水线（workflow.yml），含 gate/分支/循环                       | 通过 `specify workflow run` 引擎执行，需安装 spec-kit CLI      |
| Spec     | 简化版 artifacts 依赖图（spec/plan/tasks），只认手动标注，不做推断补充  | 无需安装框架，解压后把 `spec/` 目录交给任意 AI agent 直接执行  |

> **注意**：Picop 是编排与验证工具，不是最终运行环境；执行方式见 [执行工作流](../run/index.md)。

---

## 6. 一个真正的工作流例子

一个完整的工作流需要包含：

1. 至少一个输入节点，用于告诉模型需要做什么
2. 一个或多个处理节点，一般指 Agent 相关节点，用于执行具体任务
3. 0 个或多个输出节点，把处理结果交给用户或后续节点

```json
{
  "name": "音乐人中心",
  "id": "音乐人中心",
  "nodes": [
    {
      "id": "node1",
      "type": "userInput",
      "data": {
        "title": "用户输入节点",
        "input": {
          "urls": [
            "/Users/lizhi/Desktop/work/lizhi_hy/hy-repo/packages/apps/singer-center"
          ],
          "prompt": "请帮我对这个需求文档进行前端任务的梳理，技术方案设计，最终输出为前端技术方案文档，请基于模版编写，本次我只需要负责需求中的音乐人中心"
        }
      },
      "position": {
        "x": 36.98424317222259,
        "y": 12.172681766567365
      },
      "measured": {
        "width": 160,
        "height": 77
      },
      "selected": false,
      "dragging": false
    },
    {
      "id": "6bf28463-d374-41ba-ab2d-f83891b67f76",
      "position": {
        "x": 275.98800000000006,
        "y": 12
      },
      "deletable": true,
      "draggable": true,
      "dragging": false,
      "selectable": true,
      "selected": false,
      "zIndex": 1,
      "isConnectable": true,
      "positionAbsoluteX": 300,
      "positionAbsoluteY": 100,
      "type": "lark",
      "data": {
        "title": "Lark文档节点",
        "url": "https://lizhi2021.feishu.cn/wiki/STX0wW6mhiyPzqkTusOc3sqknCf"
      },
      "measured": {
        "width": 160,
        "height": 74
      }
    },
    {
      "id": "e8d2db2f-4673-44b5-a959-5078f68e1471",
      "position": {
        "x": 528.9898630422631,
        "y": 17.42176662994123
      },
      "deletable": true,
      "draggable": true,
      "dragging": false,
      "selectable": true,
      "selected": false,
      "zIndex": 1,
      "isConnectable": true,
      "positionAbsoluteX": 506,
      "positionAbsoluteY": 52,
      "type": "agent",
      "data": {
        "title": "需求文档梳理",
        "modal": {
          "id": "f4d207ad-67d2-4a4a-be2c-de5a72dd26c5",
          "alias": "文档梳理"
        }
      },
      "measured": {
        "width": 160,
        "height": 58
      }
    },
    {
      "id": "144fb7bc-cc43-433b-a9b3-6bdb3254a0e4",
      "type": "bmadAgent",
      "position": {
        "x": 526.4490119172714,
        "y": -86.61424170198356
      },
      "deletable": true,
      "draggable": true,
      "selectable": true,
      "selected": false,
      "data": {
        "title": "Senior Software Engineer",
        "role": "Senior Software Engineer",
        "agentId": "Amelia",
        "roleDescription": "Test-first discipline (red, green, refactor), 100% pass before review, no fluff all precision. Speaks like a terminal prompt: exact file paths, AC IDs, and commit-message brevity — every statement citable.",
        "modal": {
          "id": "model-01"
        }
      },
      "measured": {
        "width": 160,
        "height": 58
      },
      "dragging": false
    },
    {
      "id": "cb00e23f-90a5-47a2-ae83-40c3c4156f82",
      "position": {
        "x": 976.4939614803992,
        "y": -1.010832582543685
      },
      "deletable": true,
      "draggable": true,
      "dragging": false,
      "selectable": true,
      "selected": false,
      "zIndex": 1,
      "isConnectable": true,
      "positionAbsoluteX": 987.2159999999999,
      "positionAbsoluteY": 71.008,
      "type": "lark",
      "data": {
        "title": "Lark文档节点",
        "action": "write",
        "url": "https://lizhi2021.feishu.cn/wiki/TLUhwkobfi4nJzkunHVcXhZPnyb",
        "specStep": "plan"
      },
      "measured": {
        "width": 160,
        "height": 89
      }
    },
    {
      "id": "c9b5e271-313c-47ed-89e6-9b01bc6c99f3",
      "position": {
        "x": 749.4348686140039,
        "y": -4.511657474043503
      },
      "deletable": true,
      "draggable": true,
      "dragging": false,
      "selectable": true,
      "selected": false,
      "zIndex": 1,
      "isConnectable": true,
      "positionAbsoluteX": 767.5725,
      "positionAbsoluteY": 18.64399999999999,
      "type": "codeAgent",
      "data": {
        "title": "代码分析",
        "projectPath": "/Users/lizhi/Desktop/work/lizhi_hy/hy-repo/packages/apps/singer-center",
        "instruction": "通过需求分析后对项目代码进行了解，关注特殊的地方，最终输出技术文档",
        "maxIterations": 40,
        "branch": "master",
        "modal": {
          "id": "e60f9a67-f9e8-413e-951d-b6e9e779173e"
        },
        "useAppMap": false,
        "description": "进行代码分析，最终输出技术方案文档"
      },
      "measured": {
        "width": 160,
        "height": 96
      }
    },
    {
      "id": "d80811b8-3984-4f22-a99f-0a02373bddc2",
      "position": {
        "x": 272.98311865740976,
        "y": -96.30429407182629
      },
      "deletable": true,
      "draggable": true,
      "selectable": true,
      "selected": false,
      "zIndex": 1,
      "isConnectable": true,
      "positionAbsoluteX": 200,
      "positionAbsoluteY": 0,
      "type": "memory",
      "data": {
        "title": "记忆节点",
        "memoryPath": "memory/memory.md"
      },
      "measured": {
        "width": 160,
        "height": 58
      }
    },
    {
      "id": "7df8ee0c-9779-41ff-8892-5cff9fbacdf0",
      "position": {
        "x": 530.297705897763,
        "y": 123.43947907296314
      },
      "deletable": true,
      "draggable": true,
      "selectable": true,
      "selected": false,
      "zIndex": 1,
      "isConnectable": true,
      "positionAbsoluteX": 200,
      "positionAbsoluteY": 0,
      "type": "skill",
      "data": {
        "title": "Skill节点",
        "skillId": "前端技术文档编写指南",
        "skillName": "前端技术文档编写指南"
      },
      "measured": {
        "width": 160,
        "height": 64
      }
    }
  ],
  "edges": [
    {
      "id": "node1-6bf28463-d374-41ba-ab2d-f83891b67f76",
      "source": "node1",
      "target": "6bf28463-d374-41ba-ab2d-f83891b67f76",
      "type": "nodeEdge"
    },
    {
      "id": "6bf28463-d374-41ba-ab2d-f83891b67f76-e8d2db2f-4673-44b5-a959-5078f68e1471",
      "source": "6bf28463-d374-41ba-ab2d-f83891b67f76",
      "target": "e8d2db2f-4673-44b5-a959-5078f68e1471",
      "type": "nodeEdge"
    },
    {
      "source": "d80811b8-3984-4f22-a99f-0a02373bddc2",
      "target": "e8d2db2f-4673-44b5-a959-5078f68e1471",
      "type": "nodeEdge",
      "id": "xy-edge__d80811b8-3984-4f22-a99f-0a02373bddc2-e8d2db2f-4673-44b5-a959-5078f68e1471"
    },
    {
      "source": "e8d2db2f-4673-44b5-a959-5078f68e1471",
      "target": "c9b5e271-313c-47ed-89e6-9b01bc6c99f3",
      "type": "nodeEdge",
      "id": "xy-edge__e8d2db2f-4673-44b5-a959-5078f68e1471-c9b5e271-313c-47ed-89e6-9b01bc6c99f3"
    },
    {
      "source": "c9b5e271-313c-47ed-89e6-9b01bc6c99f3",
      "target": "cb00e23f-90a5-47a2-ae83-40c3c4156f82",
      "type": "nodeEdge",
      "id": "xy-edge__c9b5e271-313c-47ed-89e6-9b01bc6c99f3-cb00e23f-90a5-47a2-ae83-40c3c4156f82"
    },
    {
      "source": "7df8ee0c-9779-41ff-8892-5cff9fbacdf0",
      "target": "c9b5e271-313c-47ed-89e6-9b01bc6c99f3",
      "type": "nodeEdge",
      "id": "xy-edge__7df8ee0c-9779-41ff-8892-5cff9fbacdf0-c9b5e271-313c-47ed-89e6-9b01bc6c99f3"
    },
    {
      "source": "144fb7bc-cc43-433b-a9b3-6bdb3254a0e4",
      "target": "c9b5e271-313c-47ed-89e6-9b01bc6c99f3",
      "type": "nodeEdge",
      "id": "xy-edge__144fb7bc-cc43-433b-a9b3-6bdb3254a0e4-c9b5e271-313c-47ed-89e6-9b01bc6c99f3"
    }
  ],
  "createdAt": "2026-08-28T10:13:16.106Z",
  "updatedAt": "2026-08-28T10:13:16.106Z"
}
```

---

## 7. 常见问题

| 问题                           | 处理                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 首次打开提示「无法验证开发者」 | 右键 App →「打开」，或执行 `xattr -dr com.apple.quarantine /Applications/Picop.app`                                                        |
| MCP 工具不可见 / 连接失败      | 确认 Picop 正在运行（`curl http://127.0.0.1:7523/ping`），并检查 MCP 配置是否指向 App 内的 `runner/mcp.mjs` 绝对路径                       |
| 智能体节点报错"未选择本地工具" | 确认本机装了 claude / codex / deepseek 之一，再到节点编辑面板选择「本地工具」                                                               |
| 执行卡在 Answer 节点           | 该节点等待用户输入，编辑面板填写后继续                                                                                                     |
| Lark 节点失败                  | 确认 Runner 在线，且宿主机已 `lark-cli auth login`                                                                                         |
| 知识库检索无结果               | 本地模式：确认所选本地工具已配置访问你知识库的 MCP，且 Runner 在线；远程 API 模式：确认请求 URL / 方法 / Headers / Body 配置正确、接口可达 |

## 下一步

- [MCP + SKILL 零编排接入](./mcp_skill) — 不打开画布，用自然语言直接生成并导出工作流产物
- [深入指南](./detail) — 节点、执行引擎、PIN、BMad、优化策略
- [执行工作流](../run/index.md) — 导出后在不同工具中运行
- [项目概览](../overview/index.md) — 平台定位与架构
