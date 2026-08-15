import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Root from './Root.vue'
import { createAppRouter } from './router'
import { wireUnauthorizedRedirect } from './stores/auth'

const app = createApp(Root)
app.use(createPinia())

const router = createAppRouter()

// 任意后端请求 401：登录态失效 → 跳登录页（带回跳与过期标记；REQ-006/020，design-iter-6 §4.1）
wireUnauthorizedRedirect(() => {
  const current = router.currentRoute.value
  void router.push({
    name: 'login',
    query:
      current.name === 'login' || current.fullPath === '/'
        ? { expired: '1' }
        : { redirect: current.fullPath, expired: '1' },
  })
})

app.use(router)
app.mount('#app')
