import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import App from '../App.vue'
import AdminView from '../views/AdminView.vue'
import LoginView from '../views/LoginView.vue'

/**
 * REQ-006（CHG-004 改写）：必须登录——未登录访问任何功能页一律跳登录页，
 * 登录后回跳原路由（?redirect=，仅允许站内路径，防 open redirect）。
 * /admin（REQ-025，design-iter-8 §1.1）：非管理员的 403 态在 AdminView 内渲染
 * （安全边界在服务端接口 403，前端为引导层——双保险）。
 */
export function createAppRouter() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', name: 'chat', component: App },
      { path: '/admin', name: 'admin', component: AdminView },
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
