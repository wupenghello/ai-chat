import { defineStore } from 'pinia'
import { backend, type ServerProfile } from '../api/backend'

/** REQ-018（iter-7 T2）：供应商档案——存服务端，前端只持掩码视图（明文绝不下发前端）。 */
export interface ApiProfile {
  id: string
  name: string
  baseUrl: string
  model: string
  apiKeyMasked: string
}

/** 添加/编辑模态输入：编辑时 apiKey 留空 = 沿用服务端已存 key（密钥不回显设计，design-iter-7 §2.2） */
export interface ProfileInput {
  name: string
  baseUrl: string
  model: string
  apiKey: string
}

/**
 * localStorage 只持久化系统提示词（REQ-008）。
 * 旧版本存于此的档案字段（baseUrl/model/apiKey/profiles/activeProfileId）停读不清——
 * 存量档案上云导入 iter-8 落地（spec REQ-018 定案），导入完成后才清除；期间原样保留。
 */
interface PersistedSettings {
  systemPrompt?: string
  baseUrl?: string
  model?: string
  apiKey?: string
  profiles?: unknown
  activeProfileId?: string
}

const STORAGE_KEY = 'ai-chat:settings'

function readRaw(): PersistedSettings {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function persistSystemPrompt(text: string) {
  const raw = readRaw()
  if (text) raw.systemPrompt = text
  else delete raw.systemPrompt
  if (Object.keys(raw).length === 0) localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(raw))
}

/** 模态前端校验（REQ-014 必填）：editing=true 时 apiKey 可空 = 沿用原值 */
export function validateProfileInput(
  p: Partial<ProfileInput>,
  editing: boolean,
): Partial<Record<keyof ProfileInput, string>> {
  const errors: Partial<Record<keyof ProfileInput, string>> = {}
  if (!p.name?.trim()) errors.name = '必填：档案名称（如 DeepSeek、GLM）'
  if (!p.baseUrl?.trim()) errors.baseUrl = '必填：API 地址（如 https://api.deepseek.com）'
  else if (!/^https?:\/\//.test(p.baseUrl.trim())) errors.baseUrl = '必须以 http(s):// 开头'
  if (!p.model?.trim()) errors.model = '必填：模型名（如 deepseek-chat）'
  if (!editing && !p.apiKey?.trim()) errors.apiKey = '必填：API Key'
  return errors
}

function toLocal(p: ServerProfile): ApiProfile {
  return { id: p.id, name: p.name, baseUrl: p.base_url, model: p.model, apiKeyMasked: p.api_key_masked }
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    profiles: [] as ApiProfile[],
    activeProfileId: null as string | null,
    systemPrompt: readRaw().systemPrompt ?? '',
    pendingProfileEffect: false,
    profilesLoaded: false,
    /** iter-10 T1①：boot 拉取失败标记——为 true 时设置页档案区提供「重试」（boot 可重入） */
    bootFailed: false,
  }),
  getters: {
    activeProfile(state): ApiProfile | null {
      return state.profiles.find((p) => p.id === state.activeProfileId) ?? null
    },
    /** v3 模式判定（design-iter-7 §1 定稿）：有当前生效档案 = 自填（custom）；无 = 统一 key（unified） */
    keyMode(): 'unified' | 'custom' {
      return this.activeProfile ? 'custom' : 'unified'
    },
    /** 兼容消费方（顶栏模型名/导出）：当前生效档案的模型与地址；统一 key 模式为空对象 */
    config(state): { baseUrl?: string; model?: string } {
      const a = state.profiles.find((p) => p.id === state.activeProfileId)
      return a ? { baseUrl: a.baseUrl, model: a.model } : {}
    },
  },
  actions: {
    /** 登录后拉取档案（App onMounted；Root 登录态变化重挂载时重跑）。
        可重入：失败置 bootFailed 后仍抛出（调用方降级提示），设置页重试再次调用即可恢复（iter-10 T1①）。 */
    async boot() {
      try {
        const list = await backend.listProfiles()
        this.profiles = list.map(toLocal)
        this.activeProfileId = list.find((p) => p.is_active)?.id ?? null
        this.profilesLoaded = true
        this.bootFailed = false
      } catch (e) {
        this.bootFailed = true
        throw e
      }
    },

    /** 新增档案（REQ-014 主流程 2：保存后下一次请求起生效） */
    async saveNewProfile(input: ProfileInput): Promise<Partial<Record<keyof ProfileInput, string>>> {
      const errors = validateProfileInput(input, false)
      if (Object.keys(errors).length > 0) return errors
      const created = await backend.createProfile({
        name: input.name.trim(),
        base_url: input.baseUrl.trim(),
        model: input.model.trim(),
        api_key: input.apiKey.trim(),
      })
      this.profiles.push(toLocal(created))
      return {}
    },

    /** 编辑档案：apiKey 留空 = 沿用服务端已存 key（不回显） */
    async saveProfileEdit(
      id: string,
      input: ProfileInput,
    ): Promise<Partial<Record<keyof ProfileInput, string>>> {
      const errors = validateProfileInput(input, true)
      if (Object.keys(errors).length > 0) return errors
      const updated = await backend.updateProfile(id, {
        name: input.name.trim(),
        base_url: input.baseUrl.trim(),
        model: input.model.trim(),
        api_key: input.apiKey.trim(),
      })
      const idx = this.profiles.findIndex((p) => p.id === id)
      if (idx >= 0) this.profiles.splice(idx, 1, toLocal(updated))
      return {}
    },

    /** 删除档案；当前生效档案服务端 409 拒删（前端禁用外的双保险），返回是否删除 */
    async removeProfile(id: string): Promise<boolean> {
      try {
        await backend.deleteProfile(id)
      } catch {
        return false
      }
      this.profiles = this.profiles.filter((p) => p.id !== id)
      return true
    },

    /** REQ-018：切换当前生效档案（进入自填模式），下一次请求生效（CHG-002） */
    async setActiveProfile(id: string) {
      if (!this.profiles.some((p) => p.id === id)) return
      await backend.activateProfile(id)
      this.activeProfileId = id
    },

    /** REQ-014 主流程 4：清除自填配置 → 回退统一 key 模式（档案保留、可再启用），无确认弹窗（可逆） */
    async clearActiveProfile() {
      await backend.clearActiveProfile()
      this.activeProfileId = null
    },

    /** REQ-018 待澄清 7：生成中切换 → 「待生效」胶囊，全部生成结束转正（瞬态，不持久化） */
    markPendingEffect() {
      this.pendingProfileEffect = true
    },
    clearPendingEffect() {
      this.pendingProfileEffect = false
    },

    /** REQ-008：保存系统提示词（全局单一，CEO 2026-08-15 拍板）。
        留空/仅空白 = 无提示词；只影响之后的轮次（组装时机在 generate）。 */
    saveSystemPrompt(text: string) {
      this.systemPrompt = text.trim()
      persistSystemPrompt(this.systemPrompt)
    },
  },
})
