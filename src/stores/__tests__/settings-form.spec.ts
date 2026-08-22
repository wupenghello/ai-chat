import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/backend')>()),
  backend: {
    listProfiles: vi.fn(async () => []),
    createProfile: vi.fn(),
    updateProfile: vi.fn(),
    deleteProfile: vi.fn(),
    activateProfile: vi.fn(),
    clearActiveProfile: vi.fn(),
    getQuota: vi.fn(async () => null),
    changePassword: vi.fn(),
    deleteAccount: vi.fn(),
  },
}))
vi.mock('../../db/persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../db/persistence')>()),
  clearPendingOps: vi.fn(),
}))

import { ApiBackendError, backend } from '../../api/backend'
import { clearPendingOps } from '../../db/persistence'
import SettingsForm from '../../components/SettingsForm.vue'
import { useSettingsStore } from '../settings'
import { useAuthStore } from '../auth'
import { useToastStore } from '../toast'
import { useSessionsStore } from '../sessions'

const mocked = vi.mocked(backend)
const SERVER_P = (id: string, name: string, active = false) => ({
  id,
  name,
  base_url: 'https://api.test',
  model: 'm1',
  api_key_masked: 'sk-****1234',
  is_active: active,
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setActivePinia(createPinia())
})

async function mountForm() {
  const settings = useSettingsStore()
  settings.profilesLoaded = true
  useAuthStore().user = { id: 1, username: '猫南北' }
  // REQ-028（iter-11 T3）：设置弹窗化——组件以 open 驱动渲染（v-show 分区保持 DOM 兼容既有断言）
  return mount(SettingsForm, { props: { open: true } })
}

describe('SettingsForm（REQ-014 v3 / design-iter-7 §1~2）', () => {
  it('统一 key 默认态：状态卡零密钥输入框 + 配额占位破折号（走查 1/2）', async () => {
    const w = await mountForm()
    const text = w.text()
    expect(text).toContain('服务端统一密钥')
    expect(text).toContain('当前模式')
    expect(text).toContain('每日 — 次对话')
    expect(text).toContain('占位')
    // 首屏无任何供应商密钥输入框（旧版三要素表单已消亡）；仅账号区改密 3 密码字段（REQ-021 新增）
    expect(w.findAll('input[type="password"]').length).toBe(3)
  })

  it('自填模式态：模式卡显示生效档案名 + 回退按钮（走查 4/6）', async () => {
    const settings = useSettingsStore()
    settings.profiles = [{ id: 'a', name: 'DeepSeek', baseUrl: 'https://api.test', model: 'm', apiKeyMasked: 'sk-****1234' }]
    settings.activeProfileId = 'a'
    const w = await mountForm()
    expect(w.text()).toContain('自填密钥 · 当前生效：DeepSeek')
    expect(w.text()).toContain('已解锁更高配额')
    const fallbackBtn = w.findAll('button').find((b) => b.text().includes('回退统一密钥'))
    expect(fallbackBtn).toBeTruthy()
  })

  it('boot 失败：档案区显示加载失败与「重试」；重试成功后列表恢复（iter-10 T1①，不刷新页面）', async () => {
    const settings = useSettingsStore()
    settings.bootFailed = true
    settings.profilesLoaded = false
    useAuthStore().user = { id: 1, username: '猫南北' }
    const w = await mount(SettingsForm, { props: { open: true } })
    expect(w.text()).toContain('档案加载失败')
    expect(w.text()).not.toContain('暂无档案') // 失败态优先于空列表占位

    mocked.listProfiles.mockResolvedValue([SERVER_P('a', 'DeepSeek', true)])
    await w.findAll('button').find((b) => b.text().includes('重试'))!.trigger('click')
    await vi.waitFor(() => {
      expect(w.text()).not.toContain('档案加载失败')
      expect(w.text()).toContain('DeepSeek')
    })
    expect(settings.profilesLoaded).toBe(true)
    expect(settings.bootFailed).toBe(false)
  })

  it('编辑模态：密钥不回显（留空=沿用），添加模态：密钥必填（走查 8/9）', async () => {
    const settings = useSettingsStore()
    settings.profiles = [{ id: 'a', name: 'DeepSeek', baseUrl: 'https://api.test', model: 'm', apiKeyMasked: 'sk-****1234' }]
    const w = await mountForm()
    await w.findAll('button').find((b) => b.attributes('aria-label') === '编辑档案')!.trigger('click')
    const keyInput = w.find('.modal input[type="password"]')
    expect((keyInput.element as HTMLInputElement).value).toBe('') // 明文不回填
    expect(w.text()).toContain('已保存，不回显')
    expect(keyInput.attributes('placeholder')).toContain('留空保持不变') // 留空=沿用
  })

  it('回退：清除当前生效、档案保留，无确认弹窗（走查 6，REQ-014 主流程 4）', async () => {
    mocked.clearActiveProfile.mockResolvedValue({ detail: 'cleared' })
    const settings = useSettingsStore()
    settings.profiles = [{ id: 'a', name: 'DeepSeek', baseUrl: '', model: '', apiKeyMasked: '' }]
    settings.activeProfileId = 'a'
    const w = await mountForm()
    await w.findAll('button').find((b) => b.text().includes('回退统一密钥'))!.trigger('click')
    await vi.waitFor(() => {
      expect(mocked.clearActiveProfile).toHaveBeenCalledTimes(1)
      expect(settings.activeProfileId).toBeNull()
      expect(settings.profiles).toHaveLength(1) // 档案保留
    })
    // 可逆操作无确认模态
    expect(w.findComponent({ name: 'ConfirmModal' }).props('open')).toBe(false)
  })

  it('添加档案：掩码入列表，明文不落地（走查 10/13）', async () => {
    mocked.createProfile.mockResolvedValue(SERVER_P('new', 'GLM'))
    const w = await mountForm()
    await w.findAll('button').find((b) => b.text().includes('添加供应商档案'))!.trigger('click')
    const inputs = w.findAll('.modal input')
    await inputs[0].setValue('GLM')
    await inputs[1].setValue('https://open.bigmodel.cn/api/paas/v4')
    await inputs[2].setValue('glm-5.3')
    await inputs[3].setValue('sk-live-abcd9999')
    await w.findAll('button').find((b) => b.text().includes('保存档案'))!.trigger('click')
    await vi.waitFor(() => {
      expect(mocked.createProfile).toHaveBeenCalled()
      expect(w.text()).toContain('sk-****1234') // 列表显示服务端掩码
    })
  })
})

describe('REQ-021 账号管理 · 修改密码（design-iter-9 §2）', () => {
  const submitBtn = (w: ReturnType<typeof mount>) => w.findAll('button').find((b) => b.text().trim() === '更新密码')!

  it('必填缺失：三项行内「必填」提示，不提交', async () => {
    const w = await mountForm()
    await submitBtn(w).trigger('click')
    expect(w.text()).toContain('必填：请输入旧密码')
    expect(w.text()).toContain('必填：请输入新密码')
    expect(w.text()).toContain('必填：请再次输入新密码')
    expect(mocked.changePassword).not.toHaveBeenCalled()
  })

  it('新密码不足 8 位：行内拦截，不提交', async () => {
    const w = await mountForm()
    const inputs = w.findAll('input[type="password"]')
    await inputs[0].setValue('mm2026')
    await inputs[1].setValue('1234567')
    await inputs[2].setValue('1234567')
    await submitBtn(w).trigger('click')
    expect(w.text()).toContain('新密码至少 8 位')
    expect(mocked.changePassword).not.toHaveBeenCalled()
  })

  it('新密码纯数字：行内拦截「需包含字母与数字」，不提交', async () => {
    const w = await mountForm()
    const inputs = w.findAll('input[type="password"]')
    await inputs[0].setValue('mm2026')
    await inputs[1].setValue('12345678')
    await inputs[2].setValue('12345678')
    await submitBtn(w).trigger('click')
    expect(w.text()).toContain('新密码需包含字母与数字')
    expect(mocked.changePassword).not.toHaveBeenCalled()
  })

  it('新密码纯字母：行内拦截「需包含字母与数字」，不提交', async () => {
    const w = await mountForm()
    const inputs = w.findAll('input[type="password"]')
    await inputs[0].setValue('mm2026')
    await inputs[1].setValue('abcdefgh')
    await inputs[2].setValue('abcdefgh')
    await submitBtn(w).trigger('click')
    expect(w.text()).toContain('新密码需包含字母与数字')
    expect(mocked.changePassword).not.toHaveBeenCalled()
  })

  it('两次不一致：确认字段行内拦截', async () => {
    const w = await mountForm()
    const inputs = w.findAll('input[type="password"]')
    await inputs[0].setValue('mm2026')
    await inputs[1].setValue('newpass123')
    await inputs[2].setValue('newpass456')
    await submitBtn(w).trigger('click')
    expect(w.text()).toContain('两次输入的密码不一致')
    expect(mocked.changePassword).not.toHaveBeenCalled()
  })

  it('新密码=旧密码：行内拦截（与后端 400 同口径）', async () => {
    const w = await mountForm()
    const inputs = w.findAll('input[type="password"]')
    await inputs[0].setValue('password123')
    await inputs[1].setValue('password123')
    await inputs[2].setValue('password123')
    await submitBtn(w).trigger('click')
    expect(w.text()).toContain('新密码不能与旧密码相同')
    expect(mocked.changePassword).not.toHaveBeenCalled()
  })

  it('旧密码错误（后端 400）：旧密码字段红描边 + 行内提示', async () => {
    mocked.changePassword.mockRejectedValue(new ApiBackendError(400, '旧密码错误'))
    const w = await mountForm()
    const inputs = w.findAll('input[type="password"]')
    await inputs[0].setValue('wrong-old')
    await inputs[1].setValue('newpass123')
    await inputs[2].setValue('newpass123')
    await submitBtn(w).trigger('click')
    await flushPromises()
    expect(w.text()).toContain('旧密码错误')
    expect(inputs[0].classes()).toContain('invalid')
    expect(useAuthStore().user).not.toBeNull()
  })

  it('成功：表单清空 + 成功横幅 + 成功绿 toast（当前设备保持登录，定夺①）', async () => {
    mocked.changePassword.mockResolvedValue({ detail: '密码已更新' })
    const w = await mountForm()
    const inputs = w.findAll('input[type="password"]')
    await inputs[0].setValue('mm2026')
    await inputs[1].setValue('newpass123')
    await inputs[2].setValue('newpass123')
    await submitBtn(w).trigger('click')
    await flushPromises()
    expect(mocked.changePassword).toHaveBeenCalledWith('mm2026', 'newpass123')
    expect((inputs[0].element as HTMLInputElement).value).toBe('')
    expect(w.text()).toContain('密码已更新')
    expect(useAuthStore().user).not.toBeNull() // 当前设备保持登录
    const items = useToastStore().items
    expect(items.some((t) => t.variant === 'success' && t.message.includes('密码已更新'))).toBe(true)
  })
})

describe('REQ-021 账号管理 · 注销（design-iter-9 §3）', () => {
  it('密码二次确认成功：deleteAccount 调用 + 清本地凭据/暂存队列 + 成功绿 toast', async () => {
    mocked.deleteAccount.mockResolvedValue({ detail: '账号已删除' })
    const w = await mountForm()
    const modal = w.findComponent({ name: 'DeleteAccountModal' })
    expect(modal.props('open')).toBe(false)
    await w.find('.dz-btn').trigger('click')
    expect(modal.props('open')).toBe(true)
    modal.vm.$emit('confirm', 'mm2026')
    await flushPromises()
    expect(mocked.deleteAccount).toHaveBeenCalledWith('mm2026')
    expect(clearPendingOps).toHaveBeenCalled()
    expect(useAuthStore().user).toBeNull() // 清除凭据 → Root 监听跳 /login
    expect(useToastStore().items.some((t) => t.variant === 'success' && t.message.includes('账号已删除'))).toBe(true)
  })

  it('密码不匹配（后端 400）：错误回填模态、账号与数据不变', async () => {
    mocked.deleteAccount.mockRejectedValue(new ApiBackendError(400, '密码不正确，账号与数据未发生任何变更'))
    const w = await mountForm()
    const modal = w.findComponent({ name: 'DeleteAccountModal' })
    await w.find('.dz-btn').trigger('click')
    modal.vm.$emit('confirm', 'wrong-pwd')
    await flushPromises()
    expect(useAuthStore().user).not.toBeNull()
    expect(modal.props('error')).toBe('密码不正确，账号与数据未发生任何变更')
    expect(modal.props('open')).toBe(true)
  })

  it('生成中注销：先终止全部生成再继续注销流程（不打断取消）', async () => {
    mocked.deleteAccount.mockResolvedValue({ detail: '账号已删除' })
    const sessions = useSessionsStore()
    sessions.controllers['s1'] = new AbortController()
    const spy = vi.spyOn(sessions, 'abortAllGenerations')
    const w = await mountForm()
    const modal = w.findComponent({ name: 'DeleteAccountModal' })
    await w.find('.dz-btn').trigger('click')
    expect(modal.props('generating')).toBe(true)
    modal.vm.$emit('confirm', 'mm2026')
    await flushPromises()
    expect(spy).toHaveBeenCalled()
    expect(mocked.deleteAccount).toHaveBeenCalledWith('mm2026')
    spy.mockRestore()
  })
})

describe('SettingsForm 设置弹窗化（REQ-028，iter-11 T3，design-iter-11 §4 走查 37~40）', () => {
  it('弹窗结构：role=dialog + 左导航七分区，默认落「外观」分区（v-show 单显示）', async () => {
    // CHG-011 改写映射（iter-17 T3）：五分区 → 六分区，「AI 的记忆」插在对话设置之后、
    // 账号之前（REQ-028 改写定序）；旧断言五项列表 → 新断言六项，功能性删除为零
    // CHG-015 改写映射（iter-21 T3）：六分区 → 七分区，「用量与费用」插在 AI 的记忆
    // 之后、账号之前（design-iter-21 §2 定夺②）；旧断言六项列表 → 新断言七项，功能性删除为零
    const w = await mountForm()
    expect(w.find('.settings-modal[role="dialog"]').exists()).toBe(true)
    const navLabels = w.findAll('.sm-nav [role="tab"]').map((b) => b.text())
    expect(navLabels).toEqual(['外观', '密钥模式', '高级设置', '对话设置', 'AI 的记忆', '用量与费用', '账号'])
    const visible = w.findAll('.sm-pane').filter((p) => (p.element as HTMLElement).style.display !== 'none')
    expect(visible.length).toBe(1)
    expect(visible[0].text()).toContain('外观')
  })

  it('分区切换：点「账号」显示账号分区、其余隐藏；切分区不丢表单状态（v-show 不销毁）', async () => {
    const w = await mountForm()
    // 先在对话设置输入草稿
    await w.findAll('.sm-nav [role="tab"]')[3].trigger('click')
    await w.find('.prompt-ta').setValue('草稿内容')
    // 切去账号（索引 6，CHG-015 加法分区后平移）再切回，草稿仍在（分区隐藏不销毁）
    await w.findAll('.sm-nav [role="tab"]')[6].trigger('click')
    let visible = w.findAll('.sm-pane').filter((p) => (p.element as HTMLElement).style.display !== 'none')
    expect(visible[0].text()).toContain('注销账号')
    await w.findAll('.sm-nav [role="tab"]')[3].trigger('click')
    expect((w.find('.prompt-ta').element as HTMLTextAreaElement).value).toBe('草稿内容')
  })

  it('方向键切分区：导航钮 ArrowDown 循环（走查 37）', async () => {
    const w = await mountForm()
    const first = w.findAll('.sm-nav [role="tab"]')[0]
    await first.trigger('keydown', { key: 'ArrowDown' })
    let visible = w.findAll('.sm-pane').filter((p) => (p.element as HTMLElement).style.display !== 'none')
    expect(visible[0].text()).toContain('密钥模式')
  })

  it('locateAdv 直达：open+locateAdv 挂载即落「高级设置」分区（错误气泡场景，走查 §4.3）', async () => {
    const settings = useSettingsStore()
    settings.profilesLoaded = true
    useAuthStore().user = { id: 1, username: '猫南北' }
    const w = mount(SettingsForm, { props: { open: true, locateAdv: true } })
    const visible = w.findAll('.sm-pane').filter((p) => (p.element as HTMLElement).style.display !== 'none')
    expect(visible.length).toBe(1)
    expect(visible[0].text()).toContain('高级设置 · 自填供应商密钥')
  })

  it('未保存拦截（定夺⑥）：提示词有改动时关闭弹「有未保存的修改」；直接关闭 emit close，取消则保持', async () => {
    const w = await mountForm()
    await w.findAll('.sm-nav [role="tab"]')[3].trigger('click')
    await w.find('.prompt-ta').setValue('未保存草稿')
    await w.find('button[aria-label="关闭设置"]').trigger('click')
    expect(w.find('.dirty-mask').exists()).toBe(true)
    expect(w.text()).toContain('有未保存的修改')
    // 取消：确认层关、弹窗仍在
    await w.findAll('.dirty-mask .btn')[0].trigger('click')
    expect(w.find('.dirty-mask').exists()).toBe(false)
    expect(w.find('.settings-modal').exists()).toBe(true)
    // 再关 → 直接关闭 → emit close
    await w.find('button[aria-label="关闭设置"]').trigger('click')
    await w.findAll('.dirty-mask .btn')[1].trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })

  it('改密字段非空亦拦截；保存提示词后干净关闭不拦', async () => {
    const w = await mountForm()
    await w.findAll('.sm-nav [role="tab"]')[4].trigger('click')
    await w.find('input[autocomplete="current-password"]').setValue('oldpass1')
    await w.find('button[aria-label="关闭设置"]').trigger('click')
    expect(w.find('.dirty-mask').exists()).toBe(true)
    await w.findAll('.dirty-mask .btn')[0].trigger('click')
    // 清空改密字段 → 干净 → 直接 emit close
    await w.find('input[autocomplete="current-password"]').setValue('')
    await w.find('button[aria-label="关闭设置"]').trigger('click')
    expect(w.find('.dirty-mask').exists()).toBe(false)
    expect(w.emitted('close')).toBeTruthy()
  })

  it('Esc 关闭（走查 40）：干净状态直接 emit close；脏状态走未保存确认', async () => {
    const w = await mountForm()
    await w.find('.settings-mask').trigger('keydown', { key: 'Escape' })
    expect(w.emitted('close')).toBeTruthy()
    expect(w.find('.dirty-mask').exists()).toBe(false)
  })
})

describe('档案「支持工具」开关（iter-14 T3，design-iter-14 §5，REQ-014 定夺①）', () => {
  it('添加模态第五字段：API Key 之后、默认开（aria-checked=true）+ D7 hint 逐字', async () => {
    const w = await mountForm()
    await w.findAll('button').find((b) => b.text().includes('添加供应商档案'))!.trigger('click')
    const toolsField = w.find('.tools-field')
    expect(toolsField.exists()).toBe(true)
    expect(toolsField.find('.field-label').text()).toBe('支持工具')
    expect(toolsField.find('.field-hint').text()).toBe('关闭后，使用此档案的对话不携带工具（如联网搜索），AI 直接回答')
    expect(toolsField.find('.tsw').attributes('aria-checked')).toBe('true')
    // 第五字段位置：模态内最后一个 password 输入（API Key）之后
    const modal = w.find('.modal')
    const labels = modal.findAll('.field-label').map((l) => l.text())
    expect(labels.indexOf('支持工具')).toBeGreaterThan(labels.findIndex((l) => l.startsWith('API Key')))
  })

  it('编辑模态回显 tools_enabled 实值（关态）；列表行 p-sub 尾「 · 工具已关」', async () => {
    const settings = useSettingsStore()
    settings.profiles = [
      { id: 'a', name: '公司中转', baseUrl: 'https://relay.example-corp.cn', model: 'glm-4.7', apiKeyMasked: 'sk-****f03', toolsEnabled: false },
      { id: 'b', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKeyMasked: 'sk-****ab12', toolsEnabled: true },
    ]
    const w = await mountForm()
    const subs = w.findAll('.p-sub').map((s) => s.text())
    expect(subs[0]).toContain(' · 工具已关') // 关态才显示
    expect(subs[1]).not.toContain('工具已关') // 开态不打扰不显示
    await w.findAll('button').find((b) => b.attributes('aria-label') === '编辑档案')!.trigger('click')
    expect(w.find('.tools-field .tsw').attributes('aria-checked')).toBe('false') // 回显关
  })

  it('切换后随「保存档案」一并提交（无独立保存钮）：payload 含 tools_enabled:false', async () => {
    mocked.updateProfile.mockResolvedValue(SERVER_P('a', '公司中转'))
    const settings = useSettingsStore()
    settings.profiles = [{ id: 'a', name: '公司中转', baseUrl: 'https://relay.test', model: 'm', apiKeyMasked: 'sk-****1234', toolsEnabled: true }]
    const w = await mountForm()
    await w.findAll('button').find((b) => b.attributes('aria-label') === '编辑档案')!.trigger('click')
    await w.find('.tools-field .tsw').trigger('click') // 切为关
    expect(w.find('.tools-field .tsw').attributes('aria-checked')).toBe('false')
    await w.findAll('button').find((b) => b.text().includes('保存修改'))!.trigger('click')
    await vi.waitFor(() => {
      expect(mocked.updateProfile).toHaveBeenCalledWith(
        'a',
        expect.objectContaining({ tools_enabled: false }),
      )
    })
  })

  it('新建保存：payload 含 tools_enabled:true（缺省 true）', async () => {
    mocked.createProfile.mockResolvedValue(SERVER_P('new', 'GLM'))
    const w = await mountForm()
    await w.findAll('button').find((b) => b.text().includes('添加供应商档案'))!.trigger('click')
    const inputs = w.findAll('.modal input')
    await inputs[0].setValue('GLM')
    await inputs[1].setValue('https://api.test')
    await inputs[2].setValue('glm-5.3')
    await inputs[3].setValue('sk-live-abcd9999')
    await w.findAll('button').find((b) => b.text().includes('保存档案'))!.trigger('click')
    await vi.waitFor(() => {
      expect(mocked.createProfile).toHaveBeenCalledWith(expect.objectContaining({ tools_enabled: true }))
    })
  })
})
