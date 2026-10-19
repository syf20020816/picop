import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface GlobalState {
  // 全局模式
  globalMode: 'normal' | 'spec'
  setGlobalMode: (mode: 'normal' | 'spec') => void
  isStepMenuOpen: boolean;
  setIsStepMenuOpen: (open: boolean) => void
  // 全局本地工具：全流程统一使用同一个 CLI（claude/codex/deepseek），避免各节点偏差
  tool: string | null
  setTool: (tool: string | null) => void
}

export const useGlobalStore = create<GlobalState>()(
  persist(
    (set) => ({
      globalMode: 'normal',
      setGlobalMode: (mode) => set({ globalMode: mode }),
      isStepMenuOpen: true,
      setIsStepMenuOpen: (open) => set({ isStepMenuOpen: open }),
      tool: null,
      setTool: (tool) => set({ tool }),
    }),
    {
      name: 'picop-global',
      partialize: (s) => ({ tool: s.tool }),
    },
  ),
)
