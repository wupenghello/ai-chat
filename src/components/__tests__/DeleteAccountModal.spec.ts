/**
 * REQ-021 注销强确认模态（design-iter-9 §3.1）：
 * 密码二次确认（空 disabled / 不匹配 error 回填）/ 生成中警告条 / Esc·遮罩关闭 / 危险实底确认。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DeleteAccountModal from '../DeleteAccountModal.vue'

interface ModalProps {
  open: boolean
  username: string
  generating: boolean
  submitting: boolean
  error: string | null
}

const baseProps = (): ModalProps => ({
  open: true,
  username: '猫南北',
  generating: false,
  submitting: false,
  error: null,
})

function mountModal(overrides: Partial<ModalProps> = {}) {
  return mount(DeleteAccountModal, {
    props: { ...baseProps(), ...overrides },
    global: { stubs: { Teleport: true } },
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('注销强确认模态', () => {
  it('密码为空：永久注销账号 disabled；有输入才可点', async () => {
    const w = mountModal()
    const confirm = w.find('.btn-danger')
    expect(confirm.attributes('disabled')).toBeDefined()
    await w.find('input[type="password"]').setValue('mm2026')
    expect(w.find('.btn-danger').attributes('disabled')).toBeUndefined()
  })

  it('输入密码后确认：emit confirm 携带密码', async () => {
    const w = mountModal()
    await w.find('input[type="password"]').setValue('mm2026')
    await w.find('.btn-danger').trigger('click')
    expect(w.emitted('confirm')).toEqual([['mm2026']])
  })

  it('密码显隐：眼睛按钮切换 input type', async () => {
    const w = mountModal()
    const input = w.find('input[type="password"]')
    expect(input.exists()).toBe(true)
    await w.find('.eye-btn').trigger('click')
    expect(w.find('input[type="text"]').exists()).toBe(true)
  })

  it('error 回填：行内展示「密码不正确…」+ 红描边', () => {
    const w = mountModal({ error: '密码不正确，账号与数据未发生任何变更' })
    expect(w.text()).toContain('密码不正确，账号与数据未发生任何变更')
    expect(w.find('.field-input').classes()).toContain('invalid')
  })

  it('生成中：展示「注销前将自动终止生成」警告条', () => {
    const w = mountModal({ generating: true })
    expect(w.find('.gen-warn').exists()).toBe(true)
    expect(w.text()).toContain('注销前将自动终止生成')
  })

  it('取消 / Esc：emit cancel', async () => {
    const w = mountModal()
    await w.find('.btn').trigger('click') // 取消按钮
    expect(w.emitted('cancel')).toBeTruthy()
    // Esc
    const w2 = mountModal()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w2.emitted('cancel')).toBeTruthy()
  })

  it('正文明示删除范围与不可恢复 + 标题「注销账号？」', () => {
    const w = mountModal()
    expect(w.find('.modal-title').text()).toBe('注销账号？')
    expect(w.text()).toContain('全部云端数据')
    expect(w.text()).toContain('不可恢复')
  })
})
