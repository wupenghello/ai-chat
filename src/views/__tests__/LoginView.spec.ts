/**
 * design-iter-6 登录/注册页测试：前端校验三项 / 统一错误文案 / 状态类琥珀 /
 * 模式切换 / 密码显隐 / 成功回跳 redirect（防 open redirect）。
 * 挂真实 vue-router（memory history）与真实 Pinia，仅 mock backend API。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

const backendMock = vi.hoisted(() => ({
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  me: vi.fn(),
}))

vi.mock('../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/backend')>()),
  backend: backendMock,
}))

import LoginView from '../LoginView.vue'
import { ApiBackendError } from '../../api/backend'
import { useAuthStore } from '../../stores/auth'

const USER = { id: 1, username: '猫南北' }

async function mountView(initialPath = '/login'): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/', name: 'chat', component: { template: '<div>chat</div>' } },
      { path: '/secret', name: 'secret', component: { template: '<div>secret</div>' } },
    ],
  })
  router.push(initialPath)
  await router.isReady()
  const auth = useAuthStore()
  auth.checked = true
  const wrapper = mount(LoginView, { global: { plugins: [router] } })
  return { wrapper, router }
}

function fill(wrapper: VueWrapper, u: string, p: string, c?: string) {
  const inputs = wrapper.findAll('input')
  const [username, password, confirm] = inputs
  void username.setValue(u)
  void password.setValue(p)
  if (confirm) void confirm.setValue(c ?? '')
}

const banner = (w: VueWrapper) => w.find('.form-banner')
const fieldError = (w: VueWrapper, field: 'username' | 'password' | 'confirm') => {
  const idx = field === 'username' ? 0 : field === 'password' ? 1 : 2
  return w.findAll('.field')[idx]?.find('.field-error')?.text() ?? ''
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('登录模式', () => {
  it('空值提交：字段行内提示（design §3 映射表），不发请求', async () => {
    const { wrapper } = await mountView()
    fill(wrapper, '', '')
    await wrapper.find('form').trigger('submit')
    expect(fieldError(wrapper, 'username')).toBe('请输入用户名')
    expect(fieldError(wrapper, 'password')).toBe('请输入密码')
    expect(banner(wrapper).exists()).toBe(false)
    expect(backendMock.login).not.toHaveBeenCalled()
  })

  it('密码错误：统一「用户名或密码错误」红色提示（danger）', async () => {
    backendMock.login.mockRejectedValue(new ApiBackendError(401, '用户名或密码错误'))
    const { wrapper } = await mountView()
    fill(wrapper, 'alice', 'wrong-password')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(banner(wrapper).text()).toBe('用户名或密码错误')
    expect(banner(wrapper).classes()).toContain('danger')
  })

  it('登录已过期：状态类琥珀提示（warning）', async () => {
    backendMock.login.mockRejectedValue(new ApiBackendError(401, '登录已过期，请重新登录'))
    const { wrapper } = await mountView()
    fill(wrapper, 'alice', 'password123')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(banner(wrapper).classes()).toContain('warning')
  })

  it('在线被封禁跳转到达（sessionStorage 标记）→ 封禁横幅且读取即清除（design-iter-8 走查 29）', async () => {
    sessionStorage.setItem('ai-chat-banned', '1')
    const { wrapper } = await mountView()
    expect(banner(wrapper).text()).toBe('账号已被封禁，无法使用。如有疑问请联系管理员')
    expect(banner(wrapper).classes()).toContain('warning')
    expect(sessionStorage.getItem('ai-chat-banned')).toBeNull()
  })

  it('封禁：403 琥珀提示', async () => {
    backendMock.login.mockRejectedValue(new ApiBackendError(403, '账号已被封禁'))
    const { wrapper } = await mountView()
    fill(wrapper, 'alice', 'password123')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(banner(wrapper).text()).toBe('账号已被封禁')
    expect(banner(wrapper).classes()).toContain('warning')
  })

  it('401 失效跳转到达（expired=1）：显示「登录已过期」琥珀提示（design §4.1）', async () => {
    const { wrapper } = await mountView('/login?redirect=/secret&expired=1')
    expect(banner(wrapper).text()).toBe('登录已过期，请重新登录')
    expect(banner(wrapper).classes()).toContain('warning')
  })

  it('网络/5xx：danger banner 内嵌「重试」，已填内容不清空（design §1.2/清单 5）', async () => {
    backendMock.login.mockRejectedValue(new ApiBackendError(500, '请求失败（500）'))
    const { wrapper } = await mountView()
    fill(wrapper, 'alice', 'password123')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(banner(wrapper).classes()).toContain('danger')
    expect(banner(wrapper).find('.banner-retry').exists()).toBe(true)
    expect((wrapper.findAll('input')[0].element as HTMLInputElement).value).toBe('alice')
  })

  it('登录成功：进入 redirect 指定的原页面', async () => {
    backendMock.login.mockResolvedValue(USER)
    const { wrapper, router } = await mountView('/login?redirect=/secret')
    fill(wrapper, 'alice', 'password123')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('secret')
  })

  it('登录成功：redirect 非站内路径（//evil）→ 落首页（防 open redirect）', async () => {
    backendMock.login.mockResolvedValue(USER)
    const { wrapper, router } = await mountView('/login?redirect=//evil.example.com')
    fill(wrapper, 'alice', 'password123')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
  })
})

describe('注册模式', () => {
  async function toRegister() {
    const ctx = await mountView()
    await ctx.wrapper.find('.switch-btn').trigger('click')
    return ctx
  }

  it('用户名不合法：字段行内提示规则文案（与后端同口径）', async () => {
    const { wrapper } = await toRegister()
    fill(wrapper, 'bad@name', 'password123', 'password123')
    await wrapper.find('form').trigger('submit')
    expect(fieldError(wrapper, 'username')).toContain('用户名需为 2~32 字符')
    expect(backendMock.register).not.toHaveBeenCalled()
  })

  it('密码不足 8 位：字段行内拦截', async () => {
    const { wrapper } = await toRegister()
    fill(wrapper, 'alice', '1234567', '1234567')
    await wrapper.find('form').trigger('submit')
    expect(fieldError(wrapper, 'password')).toContain('密码最短 8 位')
  })

  it('两次密码不一致：确认字段行内拦截', async () => {
    const { wrapper } = await toRegister()
    fill(wrapper, 'alice', 'password123', 'password456')
    await wrapper.find('form').trigger('submit')
    expect(fieldError(wrapper, 'confirm')).toContain('两次输入的密码不一致')
  })

  it('用户名已存在（409）：用户名字段行内提示（design §3 映射表）', async () => {
    backendMock.register.mockRejectedValue(new ApiBackendError(409, '用户名已存在'))
    const { wrapper } = await toRegister()
    fill(wrapper, 'alice', 'password123', 'password123')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(fieldError(wrapper, 'username')).toBe('用户名已存在')
    expect(banner(wrapper).exists()).toBe(false)
  })

  it('注册成功：直接登录并进入主界面（无中间登录步骤）', async () => {
    backendMock.register.mockResolvedValue(USER)
    const { wrapper, router } = await toRegister()
    fill(wrapper, 'alice', 'password123', 'password123')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(useAuthStore().user).toEqual(USER)
    expect(router.currentRoute.value.path).toBe('/')
  })
})

describe('交互细节（design-iter-6 定案）', () => {
  it('密码显隐眼睛按钮切换 type', async () => {
    const { wrapper } = await mountView()
    const passwordInput = wrapper.findAll('input')[1]
    expect(passwordInput.attributes('type')).toBe('password')
    await wrapper.find('.eye-btn').trigger('click')
    expect(passwordInput.attributes('type')).toBe('text')
  })

  it('模式切换清空字段错误与提示条', async () => {
    const { wrapper } = await mountView()
    fill(wrapper, '', '')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.findAll('.field-error').length).toBe(2)
    await wrapper.find('.switch-btn').trigger('click')
    expect(wrapper.findAll('.field-error').length).toBe(0)
    expect(banner(wrapper).exists()).toBe(false)
  })

  it('确认密码也有显隐眼睛按钮（design 定案 7「全部密码字段」）', async () => {
    const { wrapper } = await mountView()
    await wrapper.find('.switch-btn').trigger('click')
    const [, , confirmInput] = wrapper.findAll('input')
    expect(confirmInput.attributes('type')).toBe('password')
    await wrapper.findAll('.eye-btn')[1].trigger('click')
    expect(confirmInput.attributes('type')).toBe('text')
  })

  it('无「忘记密码」链接（无邮箱体系，design 定案 6）', async () => {
    const { wrapper } = await mountView()
    expect(wrapper.text()).not.toContain('忘记密码')
  })
})
