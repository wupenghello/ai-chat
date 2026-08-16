/**
 * 存量上云提示条组件（design-iter-8 §2/§3，走查 30~41）：
 * 双条堆叠与独立动作 / 三要点强调文案（38）/ 失败强调密钥未上传（39）/ 暂不导入零上传（32/41）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'

import MigrationBanners from '../MigrationBanners.vue'
import { useMigrationStore } from '../../stores/migration'

beforeEach(() => {
  setActivePinia(createPinia())
  sessionStorage.clear()
})

function mountBanners() {
  return mount(MigrationBanners)
}

describe('提示态与堆叠（走查 30/37/38）', () => {
  it('无旧数据：零渲染（零打扰）', () => {
    const wrapper = mountBanners()
    expect(wrapper.find('[data-testid="migration-banners"]').exists()).toBe(false)
  })

  it('双条堆叠（会话在上、档案在下），文案三要点齐备（走查 37/38）', () => {
    const mig = useMigrationStore()
    mig.sessions = { state: 'prompt', total: 20, done: 0, cancel: false }
    mig.profiles = { state: 'prompt', total: 2, done: 0, cancel: false }
    const wrapper = mountBanners()
    const banners = wrapper.findAll('.mig-banner')
    expect(banners).toHaveLength(2)
    expect(banners[0].text()).toContain('20 个本地会话')
    expect(banners[0].text()).toContain('导入为新增，不覆盖云端已有会话')
    expect(banners[0].text()).toContain('30 天后自动清除')
    expect(banners[1].text()).toContain('2 套供应商档案')
    expect(banners[1].text()).toContain('密钥仅在点击导入后上传')
    expect(banners[1].text()).toContain('未经你的确认不会上传')
    expect(banners[1].text()).toContain('导入为新增，不覆盖云端已有档案')
    expect(banners[1].text()).toContain('本地不再保存任何档案与密钥数据')
  })

  it('「暂不导入」：条移除 + sessionStorage 标记（本次登录不再显示，零上传）——DOM 同步移除（DEF-019 回归）', async () => {
    const mig = useMigrationStore()
    mig.sessions = { state: 'prompt', total: 5, done: 0, cancel: false }
    const wrapper = mountBanners()
    expect(wrapper.findAll('.mig-banner')).toHaveLength(1)
    await wrapper.find('.mb-btn').trigger('click')
    expect(mig.sessions.state).toBe('none')
    expect(wrapper.findAll('.mig-banner')).toHaveLength(0) // 界面同步消失，不滞留旧引用
    expect(sessionStorage.getItem('ai-chat:mig-dismissed-sessions')).toBe('1')
  })
})

describe('进行中与完成（走查 33/35/40）', () => {
  it('进行中：进度 x/N + 进度条 + 取消按钮', () => {
    const mig = useMigrationStore()
    mig.sessions = { state: 'doing', total: 20, done: 7, cancel: false }
    const wrapper = mountBanners()
    expect(wrapper.text()).toContain('正在导入本地会话…')
    expect(wrapper.text()).toContain('7 / 20')
    expect(wrapper.find('.mb-prog .fill').attributes('style')).toContain('35%')
    expect(wrapper.find('button.mb-btn').text()).toBe('取消')
  })

  it('完成（会话）：只读备份 30 天说明 + 知道了收起', async () => {
    const mig = useMigrationStore()
    mig.sessions = { state: 'done', total: 20, done: 20, cancel: false }
    const wrapper = mountBanners()
    expect(wrapper.text()).toContain('已导入 20 个会话')
    expect(wrapper.text()).toContain('只读备份')
    expect(wrapper.text()).toContain('30 天后自动清除')
    await wrapper.find('button.mb-btn').trigger('click') // 知道了
    expect(mig.sessions.state).toBe('none')
    expect(wrapper.findAll('.mig-banner')).toHaveLength(0) // DOM 同步收起（DEF-019 回归）
  })

  it('完成（档案）：本地不再保存任何档案与密钥数据说明（走查 40）', () => {
    const mig = useMigrationStore()
    mig.profiles = { state: 'done', total: 2, done: 2, cancel: false }
    const wrapper = mountBanners()
    expect(wrapper.text()).toContain('已导入 2 套供应商档案')
    expect(wrapper.text()).toContain('本地已不再保存任何档案与密钥数据')
  })
})

describe('失败态（走查 36/39）', () => {
  it('会话失败：本地未受影响 + 不重复导入说明 + 重试/暂不导入', () => {
    const mig = useMigrationStore()
    mig.sessions = { state: 'fail', total: 20, done: 10, cancel: false }
    const wrapper = mountBanners()
    expect(wrapper.text()).toContain('导入失败：无法连接服务器')
    expect(wrapper.text()).toContain('本地数据未受任何影响')
    expect(wrapper.text()).toContain('已完成的会话不会重复导入')
    const labels = wrapper.findAll('button').map((b) => b.text())
    expect(labels).toContain('重试')
    expect(labels).toContain('暂不导入')
  })

  it('档案失败：强调密钥未上传（走查 39）', () => {
    const mig = useMigrationStore()
    mig.profiles = { state: 'fail', total: 2, done: 0, cancel: false }
    const wrapper = mountBanners()
    expect(wrapper.text()).toContain('本地档案与密钥未受任何影响、未上传')
    expect(wrapper.find('.mb-btn-danger').text()).toBe('重试')
  })
})
