import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import App from '../App.vue'
import LoginView from '../views/LoginView.vue'

/**
 * REQ-006（CHG-004 改写）：必须登录——未登录访问任何功能页一律跳登录页，
 * 登录后回跳原路由（?redirect=，仅允许站内路径，防 open redirect）。
 */
export function createAppRouter() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', name: 'chat', component: App },
      { path: '/login', name: 'login', component: LoginView },
      { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
  })

  router.beforeEach(async (to) => {
    const auth = useAuthStore()
    if (!auth.checked) await auth.boot()
    if (to.name !== 'login' && !auth.user) {
      return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } }
    }
    if (to.name === 'login' && auth.user) return { name: 'chat' }
    return true
  })

  return router
}
