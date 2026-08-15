import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Root from './Root.vue'
import { createAppRouter } from './router'
import { wireUnauthorizedRedirect } from './stores/auth'

const app = createApp(Root)
app.use(createPinia())

const router = createAppRouter()

// 任意后端请求 401：登录态失效 → 跳登录页（带回跳；REQ-006/020）
wireUnauthorizedRedirect(() => {
  const current = router.currentRoute.value
  void router.push({
    name: 'login',
    query: current.name === 'login' || current.fullPath === '/' ? {} : { redirect: current.fullPath },
  })
})

app.use(router)
app.mount('#app')
