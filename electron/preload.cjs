/**
 * 预加载脚本（CommonJS）
 *
 * 仅向渲染进程暴露只读的桌面环境信息；业务能力已通过同源 /api/* 与本地 Runner 提供，
 * 因此这里刻意保持最小暴露面，不开放任何 Node/Electron 原始能力。
 */

const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
})
