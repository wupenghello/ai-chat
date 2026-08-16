import { defineStore } from 'pinia'

export interface ToastAction {
  label: string
  /** 目标视图名（App 内导航），当前仅 'settings' */
  to: 'settings'
}

export interface ToastItem {
  id: number
  message: string
  /** REQ-021：成功绿 toast（--success-on-dark #4CC38A）——注销成功 / 改密成功等正常终态 */
  variant?: 'success'
  action?: ToastAction
}

let seq = 0

export const useToastStore = defineStore('toast', {
  state: () => ({ items: [] as ToastItem[] }),
  actions: {
    /** 普通提示 3s 自动消失；带动作按钮 6s（给用户留点击时间）；success 变体绿字（含 ✓ 前缀由调用方拼入） */
    push(message: string, action?: ToastAction, duration = action ? 6000 : 3000, variant?: 'success') {
      const id = ++seq
      this.items.push({ id, message, action, variant })
      setTimeout(() => this.dismiss(id), duration)
    },
    dismiss(id: number) {
      this.items = this.items.filter((t) => t.id !== id)
    },
  },
})
