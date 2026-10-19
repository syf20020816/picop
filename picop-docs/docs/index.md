---
title: Picop 文档
hero:
  title: Picop
  description: Picop 是一个设计时（Design-time）编排平台，不是最终工作流的运行时, 用于设计和验证工作流的执行流程。它承认了现代AI驱动开发中“多工具协同”的复杂性，并提供了一个轻量级、本地优先、面向开发者的解决方案。它的目标是让复杂的Spec工作流变得可视、可控、可复用，从而将开发者的精力从繁琐的“流程胶水代码”中解放出来，真正聚焦于高价值的“流程设计”和“问题解决”上
  actions:
    - text: 项目概览
      link: /overview
    - text: 快速入门
      link: /tutorial/quickstart
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
