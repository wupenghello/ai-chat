/**
 * 存量数据上云（iter-8 T3，design-iter-8 §2/§3）：检测/导入/取消/失败重试/完成清除/30 天到期整库删除。
 * mock 数据层（idb/persistence）与后端 API；localStorage/sessionStorage 用真实 jsdom 存储。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const idbMock = vi.hoisted(() => ({
  loadSessions: vi.fn(),
  purgeLegacyDb: vi.fn().mockResolvedValue(undefined),
}))
const persistenceMock = vi.hoisted(() => ({ loadSessions: vi.fn() }))
const backendMock = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  createProfile: vi.fn(),
}))
const requestMock = vi.hoisted(() => vi.fn())

vi.mock('../../db/idb', () => ({
  loadSessions: idbMock.loadSessions,
  purgeLegacyDb: idbMock.purgeLegacyDb,
}))
vi.mock('../../db/persistence', () => ({
  loadSessions: persistenceMock.loadSessions,
}))
vi.mock('../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/backend')>()),
  backend: backendMock,
  request: requestMock,
}))

import { readLegacyProfiles, useMigrationStore } from '../migration'

const LOCAL_SESSIONS = [
  { id: 's1', title: '旧会话1', createdAt: 1, updatedAt: 3, messages: [] },
  { id: 's2', title: '旧会话2', createdAt: 1, updatedAt: 2, messages: [] },
  { id: 's3', title: '旧会话3', createdAt: 1, updatedAt: 1, messages: [] },
]

const LEGACY_SETTINGS = {
  systemPrompt: '保留我',
  profiles: [
    { id: 'p1', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: 'sk-old-1' },
    { id: 'p2', name: 'GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4', apiKey: 'sk-old-2' },
  ],
  activeProfileId: 'p1',
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  idbMock.purgeLegacyDb.mockResolvedValue(undefined)
})

describe('检测（design-iter-8 §2.1 定夺 ②）', () => {
  it('无本地旧数据：零打扰（两条均 none）', async () => {
    idbMock.loadSessions.mockResolvedValue([])
    const mig = useMigrationStore()
    await mig.detect()
    expect(mig.sessions.state).toBe('none')
    expect(mig.profiles.state).toBe('none')
  })

  it('有旧会话与旧档案：两条各自 prompt 且计数正确', async () => {
    idbMock.loadSessions.mockResolvedValue(LOCAL_SESSIONS)
    localStorage.setItem('ai-chat:settings', JSON.stringify(LEGACY_SETTINGS))
    const mig = useMigrationStore()
    await mig.detect()
    expect(mig.sessions.state).toBe('prompt')
    expect(mig.sessions.total).toBe(3)
    expect(mig.profiles.state).toBe('prompt')
    expect(mig.profiles.total).toBe(2)
  })

  it('会话已导入过（PurgeAt 已设）：不再提示（导入完成者不再出现）', async () => {
    idbMock.loadSessions.mockResolvedValue(LOCAL_SESSIONS)
    localStorage.setItem('ai-chat:idb-purge-at', String(Date.now() + 1000))
    const mig = useMigrationStore()
    await mig.detect()
    expect(mig.sessions.state).toBe('none')
  })

  it('「暂不导入」后本次登录不再显示（sessionStorage 标记）', async () => {
    idbMock.loadSessions.mockResolvedValue(LOCAL_SESSIONS)
    const mig = useMigrationStore()
    await mig.detect()
    mig.dismiss('sessions')
    expect(mig.sessions.state).toBe('none')
    await mig.detect()
    expect(mig.sessions.state).toBe('none')
    expect(idbMock.loadSessions).toHaveBeenCalled() // 检测照常，展示被标记抑制
  })

  it('旧档案字段解析：profiles 数组 + 单套配置回退 + 损坏容错', () => {
    expect(readLegacyProfiles()).toEqual([])
    localStorage.setItem('ai-chat:settings', JSON.stringify(LEGACY_SETTINGS))
    expect(readLegacyProfiles()).toHaveLength(2)
    localStorage.setItem('ai-chat:settings', JSON.stringify({ baseUrl: 'https://x', model: 'm', apiKey: 'k' }))
    expect(readLegacyProfiles()).toEqual([
      { name: '默认配置', baseUrl: 'https://x', model: 'm', apiKey: 'k' },
    ])
    localStorage.setItem('ai-chat:settings', '{oops')
    expect(readLegacyProfiles()).toEqual([])
  })
})

describe('会话导入（REQ-022：新增不覆盖 / 幂等 / 可取消）', () => {
  async function prepared() {
    idbMock.loadSessions.mockResolvedValue(LOCAL_SESSIONS)
    const mig = useMigrationStore()
    await mig.detect()
    return mig
  }

  it('跳过云端已有 id（新增不覆盖），逐条 PUT，完成设 30 天清除键', async () => {
    const mig = await prepared()
    persistenceMock.loadSessions.mockResolvedValue([{ id: 's2', title: '云端已有', createdAt: 0, updatedAt: 0, messages: [] }])
    requestMock.mockResolvedValue({})
    await mig.importSessions()
    const puts = requestMock.mock.calls.filter(([m]) => m === 'PUT')
    expect(puts.map(([, p]) => p)).toEqual(['/api/sessions/s1', '/api/sessions/s3'])
    expect(mig.sessions.state).toBe('done')
    expect(mig.sessions.done).toBe(3)
    const at = Number(localStorage.getItem('ai-chat:idb-purge-at'))
    expect(at).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000)
    expect(at).toBeLessThan(Date.now() + 31 * 24 * 3600 * 1000)
  })

  it('失败 → fail 态；重试按云端 id 去重续传（不重复导入已完成的）', async () => {
    const mig = await prepared()
    persistenceMock.loadSessions.mockResolvedValue([])
    requestMock
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({})
    await mig.importSessions()
    expect(mig.sessions.state).toBe('fail')
    // 重试：云端已含 s1（上次成功），仅 PUT s2/s3
    persistenceMock.loadSessions.mockResolvedValue([
      { id: 's1', title: 'x', createdAt: 0, updatedAt: 0, messages: [] },
    ])
    await mig.importSessions()
    const puts = requestMock.mock.calls.filter(([m]) => m === 'PUT')
    expect(puts).toHaveLength(3) // 首轮 1 次 + 重试 2 次
    expect(mig.sessions.state).toBe('done')
  })

  it('取消：即时停止回提示态，剩余会话未上传（本地完整保留）', async () => {
    const mig = await prepared()
    persistenceMock.loadSessions.mockResolvedValue([])
    requestMock.mockImplementation(async () => {
      mig.cancelSessions() // 第 1 条 PUT 完成时请求取消
      return {}
    })
    await mig.importSessions()
    const puts = requestMock.mock.calls.filter(([m]) => m === 'PUT')
    expect(puts).toHaveLength(1)
    expect(mig.sessions.state).toBe('prompt')
    expect(localStorage.getItem('ai-chat:idb-purge-at')).toBeNull() // 未完成不设清除键
  })
})

describe('档案导入（REQ-018：key 确认后上传 / 新增 / 完成清除本地）', () => {
  async function prepared() {
    localStorage.setItem('ai-chat:settings', JSON.stringify(LEGACY_SETTINGS))
    const mig = useMigrationStore()
    await mig.detect()
    return mig
  }

  it('逐套 POST 新增；完成后清除本地档案字段且保留 systemPrompt', async () => {
    const mig = await prepared()
    backendMock.listProfiles.mockResolvedValue([])
    backendMock.createProfile.mockResolvedValue({ id: 'n1' })
    await mig.importProfiles()
    expect(backendMock.createProfile).toHaveBeenCalledTimes(2)
    expect(backendMock.createProfile).toHaveBeenCalledWith({
      name: 'DeepSeek',
      base_url: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      api_key: 'sk-old-1',
    })
    expect(mig.profiles.state).toBe('done')
    const raw = JSON.parse(localStorage.getItem('ai-chat:settings') ?? '{}')
    expect(raw.systemPrompt).toBe('保留我')
    expect(raw.profiles).toBeUndefined()
    expect(raw.apiKey).toBeUndefined()
    expect(localStorage.getItem('ai-chat:settings') ?? '').not.toContain('sk-old')
  })

  it('失败 → fail 态且本地字段原样保留（密钥未上传，安全语义）', async () => {
    const mig = await prepared()
    backendMock.listProfiles.mockResolvedValue([])
    backendMock.createProfile.mockRejectedValue(new Error('network'))
    await mig.importProfiles()
    expect(mig.profiles.state).toBe('fail')
    expect(localStorage.getItem('ai-chat:settings')).toContain('sk-old-1')
  })

  it('重试按名称+地址+模型对云端去重（不产生重复档案）', async () => {
    const mig = await prepared()
    backendMock.listProfiles.mockResolvedValue([
      { id: 'c1', name: 'DeepSeek', base_url: 'https://api.deepseek.com', model: 'deepseek-chat', api_key_masked: '***' },
    ])
    backendMock.createProfile.mockResolvedValue({ id: 'n2' })
    await mig.importProfiles()
    expect(backendMock.createProfile).toHaveBeenCalledTimes(1) // 仅 GLM
    expect(mig.profiles.state).toBe('done')
  })
})

describe('30 天到期清除（REQ-022/006：可观测验收）', () => {
  it('到期 → 整库删除并清键', async () => {
    localStorage.setItem('ai-chat:idb-purge-at', String(Date.now() - 1000))
    const mig = useMigrationStore()
    mig.maybePurge()
    expect(idbMock.purgeLegacyDb).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('ai-chat:idb-purge-at')).toBeNull()
  })

  it('未到期 → 不删', () => {
    localStorage.setItem('ai-chat:idb-purge-at', String(Date.now() + 1000))
    const mig = useMigrationStore()
    mig.maybePurge()
    expect(idbMock.purgeLegacyDb).not.toHaveBeenCalled()
  })
})
