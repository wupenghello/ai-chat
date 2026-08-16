import { defineStore } from 'pinia'
import { backend, request } from '../api/backend'
import { loadSessions as loadLocalSessions, purgeLegacyDb, type PersistedSession } from '../db/idb'
import { loadSessions as loadCloudSessions } from '../db/persistence'
import { useSettingsStore } from './settings'

/**
 * 存量数据上云（iter-8 T3，design-iter-8 §2/§3 定夺 ②）：
 * - 检测：登录后（App 挂载）查本地旧数据——会话 = IndexedDB 旧库非空；档案 = 旧 localStorage 字段存在
 * - 会话导入为新增不覆盖：跳过云端已存在 id；按会话 id PUT 幂等（中断不产生半条、重试不重复）
 * - 档案导入为新增：POST 服务端生成新 id；重试按（名称+地址+模型）对云端去重防重复
 * - 会话完成：本地 IndexedDB 转只读备份（运行时已不写入），30 天后到期整库清除（PurgeAt 键驱动）
 * - 档案完成：清除旧 localStorage 档案字段（保留 systemPrompt）——REQ-014「浏览器检索不到 key」全量口径销账
 * - 「暂不导入」：sessionStorage 标记本次登录内不再显示（含刷新）、零上传；下次登录重新检测
 */

export interface LegacyProfile {
  name: string
  baseUrl: string
  model: string
  apiKey: string
}

export type MigKind = 'sessions' | 'profiles'
export type MigState = 'none' | 'prompt' | 'doing' | 'done' | 'fail'

const SETTINGS_KEY = 'ai-chat:settings'
const PURGE_KEY = 'ai-chat:idb-purge-at'
const PURGE_MS = 30 * 24 * 3600 * 1000

function dismissKey(kind: MigKind): string {
  return `ai-chat:mig-dismissed-${kind}`
}

function isDismissed(kind: MigKind): boolean {
  try {
    return sessionStorage.getItem(dismissKey(kind)) === '1'
  } catch {
    return false
  }
}

function setDismissed(kind: MigKind): void {
  try {
    sessionStorage.setItem(dismissKey(kind), '1')
  } catch {
    /* 隐私模式：仅本内存态生效 */
  }
}

/** 旧版 localStorage 档案字段读取（settings store 定案的迁移源口径：停读不清，导入完成才清除） */
export function readLegacyProfiles(): LegacyProfile[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    const out: LegacyProfile[] = []
    if (Array.isArray(raw.profiles)) {
      for (const p of raw.profiles) {
        if (p && typeof p === 'object' && p.baseUrl && p.apiKey) {
          out.push({
            name: String(p.name ?? '未命名档案'),
            baseUrl: String(p.baseUrl),
            model: String(p.model ?? ''),
            apiKey: String(p.apiKey),
          })
        }
      }
    }
    if (out.length === 0 && raw.baseUrl && raw.apiKey) {
      out.push({
        name: '默认配置',
        baseUrl: String(raw.baseUrl),
        model: String(raw.model ?? ''),
        apiKey: String(raw.apiKey),
      })
    }
    return out
  } catch {
    return []
  }
}

/** 导入完成后清除旧档案字段（systemPrompt 保留） */
function clearLegacyProfileFields(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    delete raw.baseUrl
    delete raw.model
    delete raw.apiKey
    delete raw.profiles
    delete raw.activeProfileId
    if (Object.keys(raw).length === 0) localStorage.removeItem(SETTINGS_KEY)
    else localStorage.setItem(SETTINGS_KEY, JSON.stringify(raw))
  } catch {
    /* 损坏数据：导入已完成（云端为准），清除尽力而为 */
  }
}

interface Banner {
  state: MigState
  total: number
  done: number
  cancel: boolean
}

function freshBanner(): Banner {
  return { state: 'none', total: 0, done: 0, cancel: false }
}

export const useMigrationStore = defineStore('migration', {
  state: () => ({
    sessions: freshBanner(),
    profiles: freshBanner(),
    legacySessions: [] as PersistedSession[],
    legacyProfiles: [] as LegacyProfile[],
    checked: false,
  }),
  actions: {
    /** 登录后检测（App onMounted / Root 重挂载重跑）；到期清除检查一并执行 */
    async detect() {
      this.maybePurge()
      // 会话：IndexedDB 旧库非空 且 未「暂不导入」且 未完成过（PurgeAt 未设）
      if (!isDismissed('sessions') && !localStorage.getItem(PURGE_KEY)) {
        try {
          const local = await loadLocalSessions()
          if (local.length > 0) {
            this.legacySessions = local
            this.sessions = { ...freshBanner(), state: 'prompt', total: local.length }
          }
        } catch {
          /* IndexedDB 不可用/无库：零打扰 */
        }
      }
      // 档案：旧 localStorage 字段存在
      if (!isDismissed('profiles')) {
        const list = readLegacyProfiles()
        if (list.length > 0) {
          this.legacyProfiles = list
          this.profiles = { ...freshBanner(), state: 'prompt', total: list.length }
        }
      }
      this.checked = true
    },

    /** 30 天只读安全窗到期 → 整库清除（REQ-022/006：清除可观测） */
    maybePurge() {
      const at = Number(localStorage.getItem(PURGE_KEY) ?? 0)
      if (at && Date.now() >= at) {
        localStorage.removeItem(PURGE_KEY)
        void purgeLegacyDb()
      }
    },

    dismiss(kind: MigKind) {
      setDismissed(kind)
      this[kind] = freshBanner()
    },

    /** 完成态「知道了」：仅收起（完成标志已落：会话 = PurgeAt 键；档案 = 本地字段已清） */
    knowDone(kind: MigKind) {
      this[kind] = freshBanner()
    },

    /** 会话导入：跳过云端已有 id（新增不覆盖 + 幂等重试）；可取消（单会话原子） */
    async importSessions() {
      const b = this.sessions
      b.state = 'doing'
      b.cancel = false
      try {
        const cloud = await loadCloudSessions()
        const existing = new Set(cloud.map((s) => s.id))
        const targets = this.legacySessions.filter((s) => !existing.has(s.id))
        b.total = this.legacySessions.length
        b.done = b.total - targets.length
        for (const s of targets) {
          if (b.cancel) {
            b.state = 'prompt' // 取消：即时停止，本地完整保留，可再次导入
            return
          }
          await request('PUT', `/api/sessions/${encodeURIComponent(s.id)}`, s)
          b.done++
        }
        // 完成：本地转只读备份（运行时已不写入），30 天后自动清除
        localStorage.setItem(PURGE_KEY, String(Date.now() + PURGE_MS))
        b.state = 'done'
      } catch {
        b.state = 'fail' // 本地数据未受影响；重试按云端 id 去重续传
      }
    },

    cancelSessions() {
      this.sessions.cancel = true
    },

    /** 档案导入：POST 新增（服务端生成 id）；重试按名称+地址+模型对云端去重防重复 */
    async importProfiles() {
      const b = this.profiles
      b.state = 'doing'
      b.cancel = false
      try {
        const cloud = await backend.listProfiles()
        const exists = new Set(cloud.map((p) => `${p.name}|${p.base_url}|${p.model}`))
        const targets = this.legacyProfiles.filter(
          (p) => !exists.has(`${p.name}|${p.baseUrl}|${p.model}`),
        )
        b.total = this.legacyProfiles.length
        b.done = b.total - targets.length
        for (const p of targets) {
          if (b.cancel) {
            b.state = 'prompt'
            return
          }
          await backend.createProfile({
            name: p.name,
            base_url: p.baseUrl,
            model: p.model,
            api_key: p.apiKey,
          })
          b.done++
        }
        // 完成：清除本地旧档案字段（REQ-014 全量口径销账；systemPrompt 保留）
        clearLegacyProfileFields()
        b.state = 'done'
        // 刷新档案列表（导入的档案立即在设置页可见，掩码显示）
        void useSettingsStore().boot().catch(() => {
          /* 刷新失败不回滚导入结果 */
        })
      } catch {
        b.state = 'fail' // 密钥未上传/本地未受影响；重试按云端去重续传
      }
    },

    cancelProfiles() {
      this.profiles.cancel = true
    },
  },
})
