import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // 仅内联 @tanstack/* 到 SSR 产物：规避 hoisted 残留包（npm 遗留真目录）与
  // pnpm 解析版本不一致导致的运行时导出缺失（如 router-core 的 _getRenderedMatches）。
  // 其余依赖保持外部化，避免 rolldown 在 @ant-design/icons 等 CJS/ESM 混合包上
  // 生成未定义标识符（_mod$1）的 interop 缺陷。
  ssr: { noExternal: [/^@tanstack\//] },
  server: {
    // 显式绑定 IPv4 回环：macOS 下 Node 常把 localhost 解析为 ::1，
    // 会导致 wait-on tcp:127.0.0.1 与 Electron 加载地址不一致而卡住。
    host: '127.0.0.1',
    watch: {
      // 规避 TanStack Router generator 与 Vite watcher 在 macOS/APFS 上的 mtime 竞争导致无限 reload
      // 参考：https://github.com/TanStack/router/issues/6775
      // picop-docs 是独立的 dumi 文档站：其 dev 启动时会改写 .dumi/tmp/tsconfig.json，
      // 该目录在 vite root 之内，会触发 vite 清缓存 + SSR program reload，
      // 使 dev:all 下 Electron 的首次 SSR 请求撞上 reload 崩溃（routerContext 失效）。
      ignored: ['**/routeTree.gen.ts', '**/picop-docs/**'],
    },
  },
  plugins: [devtools(), tanstackStart(), viteReact()],
})

export default config
