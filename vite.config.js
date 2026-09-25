import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  test: {
    // 默认 node 环境（引擎/SQL/store 纯逻辑测试）；组件测试在文件头用 // @vitest-environment jsdom 单独声明
    environment: 'node',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
    include: ['src/**/*.test.{js,jsx,ts,tsx}'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'html', 'json-summary'],
      // 关闭启动清理：沙箱 safe-delete 拦截 rm，导致覆盖启动时 trash 旧目录即中断；
      // 改为每次覆盖写入（已自带 merge=false 全量重算），避免依赖删除旧目录。
      clean: false,
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/**/__tests__/**', 'src/**/*.test.{js,jsx}', 'src/main.jsx', 'src/**/*.config.js'],
    },
  },
  build: {
    // 主入口体积已通过 manualChunks 拆出 react/lucide vendor，阈值略放宽以消除历史 >500KB 告警噪声
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // 静态依赖出独立 chunk：React 系 + lucide 图标库从入口 index 拆出，首屏只加载应用代码
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('lucide-react')) return 'lucide-vendor'
            if (id.includes('react') || id.includes('scheduler')) return 'react-vendor'
          }
        }
      }
    }
  }
})
