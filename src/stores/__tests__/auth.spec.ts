/**
 * REQ-020 登录态 store 测试：boot 探测 / 注册即登录 / 登出清理 / 401 失效。
 * backend API 层 mock（不依赖真实后端，tailoring 测试裁剪口径）。
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

import { useAuthStore } from '../auth'

const USER = { id: 1, username: '猫南北' }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('boot：刷新保持登录态（REQ-020 验收机制）', () => {
  it('me 成功 → 已登录', async () => {
    backendMock.me.mockResolvedValue(USER)
    const auth = useAuthStore()
    await auth.boot()
    expect(auth.user).toEqual(USER)
    expect(auth.checked).toBe(true)
  })

  it('me 401 → 未登录但 checked 完成（守卫不再重复探测）', async () => {
    backendMock.me.mockRejectedValue(new Error('401'))
    const auth = useAuthStore()
    await auth.boot()
    expect(auth.user).toBeNull()
    expect(auth.checked).toBe(true)
  })
})

describe('register：成功即登录（REQ-020 主流程 3）', () => {
  it('注册成功 → user 置为返回用户', async () => {
    backendMock.register.mockResolvedValue(USER)
    const auth = useAuthStore()
    await auth.register('猫南北', 'password123')
    expect(backendMock.register).toHaveBeenCalledWith('猫南北', 'password123')
    expect(auth.user).toEqual(USER)
  })

  it('注册 409 → 异常上抛，user 保持 null', async () => {
    backendMock.register.mockRejectedValue(new Error('用户名已存在'))
    const auth = useAuthStore()
    await expect(auth.register('alice', 'password123')).rejects.toThrow('用户名已存在')
    expect(auth.user).toBeNull()
  })
})

describe('login / logout / 失效', () => {
  it('登录成功置 user', async () => {
    backendMock.login.mockResolvedValue(USER)
    const auth = useAuthStore()
    await auth.login('猫南北', 'password123')
    expect(auth.user).toEqual(USER)
  })

  it('登出：无论后端结果如何都清理本地登录态', async () => {
    backendMock.me.mockResolvedValue(USER)
    const auth = useAuthStore()
    await auth.boot()
    backendMock.logout.mockRejectedValue(new Error('网络错误'))
    await auth.logout()
    expect(auth.user).toBeNull()
  })

  it('invalidate：任意 401 → 登录态失效（REQ-006 异常分支）', async () => {
    backendMock.me.mockResolvedValue(USER)
    const auth = useAuthStore()
    await auth.boot()
    auth.invalidate()
    expect(auth.user).toBeNull()
  })
})
