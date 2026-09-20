---
title: 快速上手
order: 2
---

# 快速上手（Quickstart）

> **本指南带你从零开始，在 10 分钟内用可视化画布搭建并运行第一个 AI 工作流。**
>
> 如果您需要更加详细的说明，请参考 [深入使用指南](./3/detail)。

## 0. 认识界面

左侧导航栏包含六个功能页：

| 菜单       | 功能                                                 |
| ---------- | ---------------------------------------------------- |
| 工作流编排 | 主画布：拖拽节点、连线、运行工作流                   |
| 规则与模型 | BMad 角色库、提示词管理、技能管理（模型配置已下线）  |
| 知识库     | 知识库文档管理                                       |
| 执行结果   | 查看历史执行结果与统计                               |
| 编辑器     | 项目文件编辑器（提示词 / 记忆 / 工作流 JSON / 技能） |
| 文档       | 本使用与学习指南（docs 目录，即当前页面）            |

## 1. 如何创建节点

在工作流编排中，使用鼠标右击画布空白处，您可以添加以下类型的节点：

![节点类型](../imgs/nodes.png)

## 2. 保存工作流

当您完成工作流后，在左上角你可以看到四个按钮，点击最后一个保存工作流按钮对当前工作流进行保存

![保存工作流](../imgs/workflow_save.png)

接下来为你的工作流起一个名称，点击保存按钮即可。

## 3. 准备运行环境（启动本地 Runner）

AI 类节点、Lark 节点、文件节点的执行都由你本机的 **Runner 服务** 完成，平台不持有任何模型凭据。开始运行前，请先在本机启动 Runner：

```bash
# 使用 codex cli
codex
# 使用 deepseek cli
deepseek
```

Picop自动探测 Runner 是否在线。AI 类节点还需要本机装有 AI CLI 工具（Claude Code / Codex / DeepSeek 任选其一）——编辑面板的「本地工具」下拉会自动探测已安装项。

## 4. 单步执行与运行调试

当你点击节点上的运行按钮时，该节点会立即执行，直到完成。这是单步执行。

![单步执行](../imgs/node_run.png)

如果你想运行整个工作流，点击执行面板的「运行」按钮。这会将所有节点按连线顺序执行，直到所有节点完成。
执行完成后你可以在右侧面板中查看每个节点的输出结果。

![工作流运行](../imgs/workflow_run.png)

## 5. 导出真实工作流

在左上角的四个按钮中，点击第三个按钮「导出工作流」。

![导出工作流](../imgs/export.png)

接下来选择你需要的导出参数，进行导出即可，导出参数说明如下：

| 导出参数     | 说明                                                                                                                                                                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目标平台     | 1. Picop：Picop 平台，如果你想将本平台的工作流保存到本地，进行重复使用，选择这个选项，但无法让你得到能执行的工作流文件 <br /> 2. Speckit: 用于在 spec-kit 平台运行的工作流文件 <br /> 3. OpenSpec: 用于在 OpenSpec 平台运行的工作流文件 <br /> 4. Spec: 用于在你不安装任何Spec平台情况下，能够让AI识别运行的工作流文件 |
| 导出模式     | 1. 仅导出workflow.yml：如果您只是想单纯获取一个没有任何输入物，或依据这个工作流进行修改，选择这个选项。 <br /> 2. 全量导出zip：包含输入物、Skill、BMad 角色文件等，如果您需要在其他工具中直接运行这个工作流，选择这个选项。                                                                                            |
| 合并并行步骤 | 是否合并并行步骤，对于Speckit，OpenSpec实际都是串行的，选择这个选项后，会将并行节点合并为一个步骤。                                                                                                                                                                                                                    |

![导出参数](../imgs/export_spec.png)

你将得到一个能够在其他工具（Trae、Cursor、Codex、Claude Code 等）中运行的工作流文件，目前分为三种格式：

| 格式     | 特点                                                                   | 执行方式                                                       |
| -------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| OpenSpec | artifacts 依赖图（proposal/design/tasks），含类型兜底与 tasks 自动补全 | 通过 `/opsx:*` 斜杠命令触发，需安装 OpenSpec 或 agent 内置支持 |
| Speckit  | 命令步骤流水线（workflow\.yml），含 gate/分支/循环                     | 通过 `specify workflow run` 引擎执行，需安装 spec-kit CLI      |
| Spec     | 简化版 artifacts 依赖图（spec/plan/tasks），只认手动标注，不做推断补充 | 无需安装框架，解压后把 `spec/` 目录交给任意 AI agent 直接执行  |

每种格式均可导出为纯工作流文件（yaml）或全量 zip 包（含输入物、Skill、BMad 角色文件等）。

> **注意：**
>
> 这个工作流文件才是你可以在其他工具中运行的工作流文件，所以请不要将本系统作为最终运行环境。
>
> 如何使用工作流请参考：[执行工作流](../run/index.md)。

---

## 6. 一个真正的工作流例子

一个完整的工作流需要包含：

1. 至少一个输入节点，用于告诉模型需要做什么
2. 一个或多个处理节点，处理节点一般指Agent相关节点，用于执行具体的任务
3. 0个或多个输出节点，用于将处理结果输出给用户或后续节点

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
      "dragging": false,
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
      "dragging": false,
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

## 7. 常见问题

| 问题                           | 处理                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 智能体节点报错"未选择本地工具" | 确认本机已启动 Runner（`node runner/server.mjs`）且安装了 AI CLI 工具，再到节点编辑面板选择「本地工具」                                    |
| 本地工具下拉为空               | 检查本机是否安装了 claude / codex / deepseek 之一，且 Runner 在线（`GET /ping`）                                                           |
| 执行卡在 Answer 节点           | 该节点等待用户输入，编辑面板填写后继续                                                                                                     |
| Lark 节点失败                  | 确认 Runner 已启动，且宿主机已 `lark-cli auth login`                                                                                       |
| 知识库检索无结果               | 本地模式：确认所选本地工具已配置访问你知识库的 MCP，且 Runner 在线；远程 API 模式：确认请求 URL / 方法 / Headers / Body 配置正确、接口可达 |

## 下一步

- [项目概览](overview.md) — 平台定位与架构

- [MCP + SKILL 零编排接入](mcp_skill.md) — 不打开画布，在自己的工具里用自然语言直接生成并导出工作流产物

- [深入指南](detail.md) — 20 种节点、执行引擎、PIN、BMad、优化策略
