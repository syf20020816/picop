import { createFileRoute } from '@tanstack/react-router'
import '@xyflow/react/dist/style.css'
import { Flow } from '../components/flow'
import styles from './index.module.scss'
import 'antd/dist/antd.css'
import { ConfigProvider, Menu, Layout, theme, Tooltip, message } from 'antd'
import type { ThemeConfig } from 'antd'
import { PromptManager } from '#/components/rule'
import { Execution } from '#/components/execution'
import { FileEditor } from '#/components/file-editor'
import { Logo } from '#/components/logo'
import { useRouteStore } from '#/store/route'
import { pingRunner } from '#/services/runner'
import {
  Cable,
  FileCode,
  Bot,
  PanelLeftClose,
  PanelLeftOpen,
  ListChecks,
  BookSearch,
} from 'lucide-react'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/')({ component: App })

const config: ThemeConfig = {
  token: {
    colorPrimary: '#1890ff',
  },
  algorithm: theme.darkAlgorithm,
}

const { Sider, Content } = Layout

function App() {
  const activeKey = useRouteStore((state) => state.activeKey)
  const switchTo = useRouteStore((state) => state.switchTo)
  const [collapsed, setCollapsed] = useState(false)

  // 启动时探测本地 Runner（控制面/执行面分离：lark-cli 与模型凭据都在用户机器上执行）
  useEffect(() => {
    pingRunner().then((online) => {
      if (!online) {
        message.warning(
          '本地 Runner 未启动，Lark 与模型调用暂不可用（已回退开发模式）。请在项目目录运行: node runner/server.mjs',
          8,
        )
      }
    })
  }, [])

  const baseMenuItems = [
    { label: '工作流编排', key: 'workflow', icon: <Cable size={16} /> },
    { label: '规则与工作流', key: 'prompts', icon: <Bot size={16} /> },
    { label: '执行结果', key: 'execution', icon: <ListChecks size={16} /> },
    { label: '编辑器', key: 'editor', icon: <FileCode size={16} /> },
    {
      label: '文档',
      key: 'wiki',
      icon: <BookSearch size={16} />,
      onClick: () => window.open('http://localhost:4000', '_blank'),
    },
  ]

  const menuItems = collapsed
    ? baseMenuItems.map((item) => ({
        ...item,
        label: (
          <Tooltip title={item.label} placement="right">
            <span>{item.label}</span>
          </Tooltip>
        ),
      }))
    : baseMenuItems

  return (
    <ConfigProvider theme={config}>
      <Layout style={{ height: '100vh' }}>
        <Sider
          width={160}
          collapsedWidth={56}
          collapsed={collapsed}
          className={styles.sider}
          trigger={null}
        >
          <div className={styles.header}>
            {collapsed ? (
              <Logo size={24} letters={['P']} />
            ) : (
              <Logo size={20} />
            )}
          </div>
          <Menu
            onClick={({ key }) => {
              if (key === 'wiki') return // wiki 由菜单项 onClick 打开独立文档站
              switchTo(key)
            }}
            selectedKeys={[activeKey]}
            mode="vertical"
            items={menuItems}
            style={{ borderInlineEnd: 'none', background: 'transparent' }}
          />
          <div
            className={styles.trigger}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen color="white" size={16} />
            ) : (
              <PanelLeftClose color="white" size={16} />
            )}
          </div>
        </Sider>
        <Content style={{ overflow: 'auto' }}>
          {activeKey === 'workflow' && (
            <div className={styles.container}>
              <main className={styles.flow}>
                <Flow />
              </main>
            </div>
          )}
          {activeKey === 'prompts' && <PromptManager />}
          {activeKey === 'execution' && <Execution />}
          {activeKey === 'editor' && <FileEditor />}
        </Content>
      </Layout>
    </ConfigProvider>
  )
}
