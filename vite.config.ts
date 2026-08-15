import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // 同源联调：/api 经 Vite proxy 转发本地 FastAPI（backend/，HttpOnly Cookie 依赖同源）
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  test: {
    environment: 'jsdom',
  },
})
