/**
 * REQ-006/020 路由守卫测试：未登录一律跳登录页并携带 redirect；
 * 登录后访问 /login 弹回主界面；boot 只探测一次。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const backendMock = vi.hoisted(() => ({
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  me: vi.fn(),
}))

vi.mock('../../api/backend', () => ({
  backend: backendMock,
  setUnauthorizedHandler: vi.fn(),
}))

import { createAppRouter } from '../index'
import { useAuthStore } from '../../stores/auth'

// 守卫测试只需要路由表，不挂载真实 App（其 onMounted 会触 IndexedDB）
vi.mock('../../App.vue', () => ({ default: { template: '<div>chat</div>' } }))
vi.mock('../../views/LoginView.vue', () => ({ default: { template: '<div>login</div>' } }))

function makeRouter() {
  return createAppRouter()
}

async function drive(router: ReturnType<typeof makeRouter>, path: string) {
  await router.push(path)
  await router.isReady()
  return router.currentRoute.value
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('未登录门禁（REQ-006：只看得到登录页）', () => {
  it('me 401：访问首页 → 跳 /login 且不带多余 redirect', async () => {
    backendMock.me.mockRejectedValue(new Error('401'))
    const to = await drive(makeRouter(), '/')
    expect(to.name).toBe('login')
    expect(to.query.redirect).toBeUndefined()
  })

  it('访问功能页 → 跳 /login 且 redirect 记录原路径', async () => {
    backendMock.me.mockRejectedValue(new Error('401'))
    const router = makeRouter()
    router.addRoute({ path: '/settings', name: 'settings', component: { template: '<div />' } })
    const to = await drive(router, '/settings')
    expect(to.name).toBe('login')
    expect(to.query.redirect).toBe('/settings')
  })

  it('未知路径 → 兜底回首页（再由门禁转登录，不带 redirect）', async () => {
    backendMock.me.mockRejectedValue(new Error('401'))
    const to = await drive(makeRouter(), '/no/such/path')
    expect(to.name).toBe('login')
    expect(to.query.redirect).toBeUndefined()
  })

  it('未登录访问 /admin → 跳 /login 且 redirect 回跳（design-iter-8 §1.1 走查 3）', async () => {
    backendMock.me.mockRejectedValue(new Error('401'))
    const to = await drive(makeRouter(), '/admin')
    expect(to.name).toBe('login')
    expect(to.query.redirect).toBe('/admin')
  })
})

describe('已登录', () => {
  it('me 成功：正常进入功能页', async () => {
    backendMock.me.mockResolvedValue({ id: 1, username: '猫南北' })
    const to = await drive(makeRouter(), '/')
    expect(to.name).toBe('chat')
  })

  it('已登录访问 /login → 弹回主界面', async () => {
    backendMock.me.mockResolvedValue({ id: 1, username: '猫南北' })
    const to = await drive(makeRouter(), '/login')
    expect(to.name).toBe('chat')
  })

  it('已登录访问 /admin → 路由层放行（403 态由组件渲染，非管理员双保险在接口层）', async () => {
    backendMock.me.mockResolvedValue({ id: 2, username: 'bob' })
    const to = await drive(makeRouter(), '/admin')
    expect(to.name).toBe('admin')
  })
})

describe('boot 探测次数', () => {
  it('多次导航只探测一次（checked 生效）', async () => {
    backendMock.me.mockResolvedValue({ id: 1, username: '猫南北' })
    const router = makeRouter()
    await drive(router, '/')
    await router.push('/login')
    await router.push('/')
    expect(backendMock.me).toHaveBeenCalledTimes(1)
    expect(useAuthStore().user?.username).toBe('猫南北')
  })
})
