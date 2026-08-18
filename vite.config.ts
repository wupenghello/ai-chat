import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // 同源联调：/api 经 Vite proxy 转发本地 FastAPI（backend/，HttpOnly Cookie 依赖同源）；
  // 目标端口可经环境变量覆盖（走查脚本起独立后端时用，默认 8000 行为不变）
  server: {
    proxy: {
      '/api': process.env.AI_CHAT_DEV_API_TARGET ?? 'http://localhost:8000',
    },
  },
  test: {
    environment: 'jsdom',
  },
})
