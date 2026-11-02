---
title: Picop 文档
hero:
  title: Picop
  description: 设计时（Design-time）的 AI 工作流编排平台——用可视化 DAG 设计与验证流程，再导出为 speckit / openspec / spec / skill 产物交给你的 AI 工具执行。轻量、本地优先、凭据不出本机。
  actions:
    - text: 快速开始
      link: /tutorial/quickstart
    - text: 项目概览
      link: /overview
features:
  - title: 不内置也不配置模型
    description: AI 类节点直接复用用户本机的 Claude Code / Codex / DeepSeek，执行靠本地 Runner，凭据全留用户机器
  - title: 不重复造 Spec 框架
    description: 阶段标记（specStep）由平台负责，specs/ 目录由 openspec / speckit 等专业框架生成
  - title: 编辑器即验证台
    description: 所见即所得，支持单节点调试、PIN 固定、断点续跑
  - title: PIN 机制
    description: 满足迭代调试场景，避免重复消耗 Token
  - title: MCP + SKILL 零编排接入
    description: 在自己的工具里用自然语言直接生成并导出工作流产物，无需打开画布、无需学习编排
---
