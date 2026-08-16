<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  backend,
  type AdminOverview,
  type AdminUsagePage,
  type AdminUserRow,
  type AdminUsersPage,
} from '../api/backend'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import { useTheme } from '../composables/useTheme'
import { highlightSegments } from '../utils/search'
import BrandMark from '../components/BrandMark.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import AppToast from '../components/AppToast.vue'

/**
 * REQ-025（iter-8 T2）+ REQ-029（iter-12 T2）：管理员后台——design-iter-12 §1~§3。
 * 安全边界在服务端（admin 接口对非管理员 403）；本页 403 态与侧栏入口隐藏只是引导层。
 * REQ-025 功能口径零回退（§5 映射 / §7.2 零回退组）：治理操作 / 六列 / 403 / 筛选交互全沿用；
 * 本轮变的是层级与留白（概览统计卡 / 搜索 / 分页 / 灰底白卡，定夺⑤⑦），
 * 用量排序实现迁后端（定夺⑥：分页后客户端排序跨页语义错误）。
 */

const auth = useAuthStore()
const toast = useToastStore()
const router = useRouter()
const { toggleTheme } = useTheme()

const isAdmin = computed(() => auth.user?.is_admin === true)

const tab = ref<'users' | 'usage'>('users')

function errMsg(e: unknown, fallback = '操作失败'): string {
  return e instanceof Error && e.message ? e.message : fallback
}

// ---- 概览统计卡（§1.2，定夺④/⑤）----
const overview = ref<AdminOverview | null>(null)

/** 全站配额三态（定夺⑤：着色阈值沿 iter-8 computed——≥80% near / 用尽 burst / 总量≤0 normal） */
const siteState = computed<'normal' | 'near' | 'burst'>(() => {
  const o = overview.value
  if (!o || o.unified_daily_total <= 0) return 'normal'
  if (o.unified_used >= o.unified_daily_total) return 'burst'
  if (o.unified_used / o.unified_daily_total >= 0.8) return 'near'
  return 'normal'
})

const sitePct = computed(() => {
  const o = overview.value
  if (!o || o.unified_daily_total <= 0) return '0%'
  return `${Math.min(100, Math.round((o.unified_used / o.unified_daily_total) * 100))}%`
})

function fmtNum(n: number): string {
  return n.toLocaleString('zh-Hans-CN')
}

// ---- 用户列表（§2：搜索 + 分页 + 治理沿用）----
const PAGE_SIZE = 20 // 定夺③：统一 20/页，不做页大小切换

const usersPage = ref<AdminUsersPage | null>(null)
const userOptions = ref<AdminUserRow[]>([]) // 用量筛选下拉数据源：纯列表全量（§4.1 兼容形态）
const usersError = ref('')
const usersLoading = ref(false)

const searchInput = ref('')
const searchQuery = ref('') // 已生效搜索词（防抖 300ms / Enter 立即，§2.1）
const usersOffset = ref(0)
let searchTimer: ReturnType<typeof setTimeout> | null = null
let usersPendingScroll = false // 翻页后滚动至表格顶部（§2.1；首次加载不滚）
const usersTable = ref<HTMLElement | null>(null)

const searching = computed(() => searchQuery.value.trim() !== '')
const usersTotal = computed(() => usersPage.value?.total ?? 0)
const usersPageCount = computed(() => Math.max(1, Math.ceil(usersTotal.value / PAGE_SIZE)))
const usersCurrent = computed(() => (usersPage.value?.offset ?? 0) / PAGE_SIZE + 1)
const usersMultiPage = computed(() => usersTotal.value > PAGE_SIZE) // 单页隐藏控件（定夺③）

async function loadUsers() {
  usersLoading.value = true
  usersError.value = ''
  try {
    const params: { search?: string; limit: number; offset: number } = {
      limit: PAGE_SIZE,
      offset: usersOffset.value,
    }
    const q = searchQuery.value.trim()
    if (q) params.search = q
    usersPage.value = await backend.adminUsersPage(params)
    usersOffset.value = usersPage.value.offset // 越界钳制后的生效值回写（定夺②，信封 offset）
    if (usersPendingScroll) {
      usersPendingScroll = false
      usersTable.value?.scrollIntoView({ block: 'start' })
    }
  } catch (e) {
    usersError.value = errMsg(e, '用户列表加载失败')
  } finally {
    usersLoading.value = false
  }
}

function applySearch() {
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }
  const q = searchInput.value.trim()
  if (q === searchQuery.value && usersOffset.value === 0) return
  searchQuery.value = q
  usersOffset.value = 0 // 搜索词变更（含清除）→ 回第 1 页（§2.1）
  void loadUsers()
}

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(applySearch, 300)
}

function clearSearch() {
  searchInput.value = ''
  applySearch()
}

function nameSegs(name: string) {
  return highlightSegments(name, searching.value ? searchQuery.value : '')
}

/** 页码窗口：≤7 页全显；>7 页折叠首末与当前 ±1，中间「…」（§2.1） */
function pageList(current: number, pages: number): Array<number | '…'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const keep = new Set([1, 2, pages - 1, pages, current - 1, current, current + 1])
  const out: Array<number | '…'> = []
  let prev = 0
  for (let p = 1; p <= pages; p++) {
    if (keep.has(p)) {
      if (prev && p - prev > 1) out.push('…')
      out.push(p)
      prev = p
    }
  }
  return out
}

function gotoUsersPage(n: number) {
  if (n < 1 || n > usersPageCount.value || n === usersCurrent.value) return
  usersOffset.value = (n - 1) * PAGE_SIZE
  usersPendingScroll = true
  void loadUsers()
}

/** 档位徽标文案（iter-8 §1.2 定夺①：默认档随模式，覆盖以「自定义 N」主色徽标区分） */
function tierLabel(u: AdminUserRow): string {
  if (u.quota_override != null) return `自定义 ${u.quota_override}`
  return u.mode === 'self' ? '自填档' : '免费档'
}

// 封禁（iter-8 §1.3：确认模态 danger 实底；解封直接生效无确认——可逆）
const banTarget = ref<AdminUserRow | null>(null)

async function confirmBan() {
  const target = banTarget.value
  if (!target) return
  try {
    await backend.banUser(target.id)
    toast.push(`已封禁 ${target.username}`)
    banTarget.value = null
    await afterGovernance()
  } catch (e) {
    toast.push(errMsg(e))
  }
}

async function unban(u: AdminUserRow) {
  try {
    await backend.unbanUser(u.id)
    toast.push(`已解封 ${u.username}`)
    await afterGovernance()
  } catch (e) {
    toast.push(errMsg(e))
  }
}

/** 治理操作生效后：列表与统计卡重载（§2.1 零回退组——iter-8#14~18 口径） */
async function afterGovernance() {
  await Promise.all([loadUsers(), loadMeta()])
}

async function loadMeta() {
  try {
    ;[userOptions.value, overview.value] = await Promise.all([
      backend.adminUsers(),
      backend.adminOverview(),
    ])
  } catch {
    // 概览/下拉失败不阻塞列表主流程：卡片区与下拉按既有数据继续渲染
  }
}

// 调配额模态（iter-8 §1.3：默认档 / 自定义 N，正整数校验不入库）
const quotaTarget = ref<AdminUserRow | null>(null)
const quotaCustom = ref(false)
const quotaInput = ref('')
const quotaErr = ref('')

function openQuota(u: AdminUserRow) {
  quotaTarget.value = u
  quotaCustom.value = u.quota_override != null
  quotaInput.value = u.quota_override != null ? String(u.quota_override) : ''
  quotaErr.value = ''
}

async function saveQuota() {
  const target = quotaTarget.value
  if (!target) return
  let value: number | null = null
  if (quotaCustom.value) {
    const raw = quotaInput.value.trim()
    if (!/^\d+$/.test(raw) || Number(raw) < 1) {
      quotaErr.value = '请输入正整数（≥1），不能用小数或留空'
      return
    }
    value = Number(raw)
  }
  try {
    await backend.setUserQuota(target.id, value)
    toast.push('配额已保存，自下一次请求生效')
    quotaTarget.value = null
    await afterGovernance()
  } catch (e) {
    toast.push(errMsg(e))
  }
}

// ---- 用量列表（§3：分页 + 筛选沿用 + 排序后端化）----
function toISODate(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

const todayISO = toISODate(new Date())
const weekAgoISO = toISODate(new Date(Date.now() - 6 * 24 * 3600 * 1000))

const usagePage = ref<AdminUsagePage | null>(null)
const usageError = ref('')
const usageLoading = ref(false)
const usageOffset = ref(0)
let usagePendingScroll = false
const usageTable = ref<HTMLElement | null>(null)
const userFilter = ref<number | ''>('')
const dateFrom = ref(weekAgoISO)
const dateTo = ref(todayISO)
const sortKey = ref<'day' | 'requests' | 'tokens'>('day')
const sortDir = ref<'asc' | 'desc'>('desc')

const usageTotal = computed(() => usagePage.value?.total ?? 0)
const usagePageCount = computed(() => Math.max(1, Math.ceil(usageTotal.value / PAGE_SIZE)))
const usageCurrent = computed(() => (usagePage.value?.offset ?? 0) / PAGE_SIZE + 1)
const usageMultiPage = computed(() => usageTotal.value > PAGE_SIZE)

/** 排序交互零变化、实现后端化（§3.1 / 定夺⑥）：点击升降切换，请求带 sort_key/sort_dir 且 offset 重置 0 */
function toggleSort(key: 'day' | 'requests' | 'tokens') {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'desc'
  }
  usageOffset.value = 0
  void loadUsage()
}

async function loadUsage() {
  usageLoading.value = true
  usageError.value = ''
  try {
    usagePage.value = await backend.adminUsagePage({
      user_id: userFilter.value === '' ? undefined : userFilter.value,
      date_from: dateFrom.value || undefined,
      date_to: dateTo.value || undefined,
      sort_key: sortKey.value,
      sort_dir: sortDir.value,
      limit: PAGE_SIZE,
      offset: usageOffset.value,
    })
    usageOffset.value = usagePage.value.offset
    if (usagePendingScroll) {
      usagePendingScroll = false
      usageTable.value?.scrollIntoView({ block: 'start' })
    }
  } catch (e) {
    usageError.value = errMsg(e, '用量数据加载失败')
  } finally {
    usageLoading.value = false
  }
}

/** 缺失时段标注（§3.1 + 铁律 5）：信封 distinct_days（全窗口去重天数）与窗口天数比对，
 * 不受分页影响（后端 §4.2 供数）；不连续 → 琥珀行声明「不估算补齐」 */
const hasGap = computed(() => {
  const p = usagePage.value
  if (!p || p.distinct_days === 0 || !dateFrom.value || !dateTo.value || dateFrom.value > dateTo.value) return false
  const days = Math.round((Date.parse(dateTo.value) - Date.parse(dateFrom.value)) / 86400000) + 1
  if (days > 366) return false
  return p.distinct_days < days
})

function applyFilters() {
  usageOffset.value = 0 // 筛选变更 → 回第 1 页（§3.1）
  void loadUsage()
}

function gotoUsagePage(n: number) {
  if (n < 1 || n > usagePageCount.value || n === usageCurrent.value) return
  usageOffset.value = (n - 1) * PAGE_SIZE
  usagePendingScroll = true
  void loadUsage()
}

onMounted(() => {
  if (isAdmin.value) {
    void loadUsers()
    void loadMeta()
    void loadUsage()
  }
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <!-- §1.5 普通用户 403 态：不渲染任何后台数据、不发起任何后台请求（路由层拦截；接口层独立 403） -->
  <div v-if="!isAdmin" class="forbid-page">
    <div class="forbid-card">
      <svg viewBox="0 0 24 24" width="36" height="36" style="color: var(--c-danger)">
        <path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 3l7 2.6v5.6c0 4.4-3 8.3-7 9.8-4-1.5-7-5.4-7-9.8V5.6L12 3z" />
        <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" />
      </svg>
      <div class="f-title">无权访问（403）</div>
      <div class="f-desc">管理后台仅对管理员开放，此页面不会展示任何后台数据。</div>
      <button class="btn-primary" type="button" @click="router.push('/')">返回主界面</button>
    </div>
    <AppToast />
  </div>

  <!-- §1.1 页面框架：顶栏（品牌 + 管理后台徽标 + 主题 + 返回）+ 概览卡区 + 警示条 + 分段 tab -->
  <div v-else class="admin-page">
    <header class="adm-top">
      <div class="adm-brand">
        <BrandMark :size="22" with-text />
        <span class="adm-tag">管理后台</span>
      </div>
      <span class="adm-sp" />
      <button class="btn-icon32" type="button" title="切换主题" aria-label="切换主题" @click="toggleTheme">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor" />
        </svg>
      </button>
      <button class="btn-ghost" type="button" @click="router.push('/')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        返回主界面
      </button>
    </header>

    <main class="adm-body">
      <!-- §1.2 概览统计卡：四卡常驻 tabs 上方（定夺④/⑦） -->
      <div v-if="overview" class="stat-grid">
        <div class="stat-card">
          <div class="s-label">总用户数</div>
          <div class="s-value">{{ fmtNum(overview.total_users) }}</div>
          <div class="s-sub">全部注册账号（含已封禁与管理员）</div>
        </div>
        <div class="stat-card">
          <div class="s-label">今日请求</div>
          <div class="s-value">{{ fmtNum(overview.today_requests) }}</div>
          <div class="s-sub">今日 · 全部密钥模式合计</div>
        </div>
        <div class="stat-card">
          <div class="s-label">今日 token</div>
          <div class="s-value">{{ fmtNum(overview.today_tokens) }}</div>
          <div class="s-sub">今日 · 上游 usage 帧合计</div>
        </div>
        <div class="stat-card">
          <div class="s-label">统一 key 每日用量</div>
          <div class="s-value">{{ fmtNum(overview.unified_used) }} / {{ fmtNum(overview.unified_daily_total) }} 次</div>
          <div class="s-bar">
            <div class="s-fill" :class="siteState" :style="{ width: sitePct }" />
          </div>
          <div class="s-sub s-state" :class="siteState">
            <template v-if="siteState === 'burst'">已熔断，明日 00:00 自动恢复</template>
            <template v-else-if="siteState === 'near'">已接近上限，请关注消耗</template>
            <template v-else>剩余 {{ fmtNum(overview.unified_daily_total - overview.unified_used) }} 次</template>
          </div>
        </div>
      </div>

      <!-- 定夺⑤：near/burst 页面级警示条（文案逐字沿用 iter-8#10/#11 口径）；常态条退役 -->
      <div v-if="overview && siteState !== 'normal'" class="site-bar" :class="siteState">
        统一 key 每日总量 {{ fmtNum(overview.unified_daily_total) }} · 今日已用 {{ fmtNum(overview.unified_used) }}<template v-if="siteState === 'near'">（已接近上限，请关注消耗）</template><template v-else>—— <b>已暂停全站新对话请求，明日 00:00 自动恢复；自填 key 用户不受影响</b></template>
      </div>

      <div class="adm-tabs" role="radiogroup" aria-label="后台分区">
        <button type="button" role="radio" :aria-checked="tab === 'users'" :class="{ on: tab === 'users' }" @click="tab = 'users'">
          用户列表
        </button>
        <button type="button" role="radio" :aria-checked="tab === 'usage'" :class="{ on: tab === 'usage' }" @click="tab = 'usage'">
          用量列表
        </button>
      </div>

      <!-- §2 用户列表：搜索 + 分页 + 治理操作沿用 -->
      <section v-show="tab === 'users'" class="panel">
        <div v-if="usersLoading" class="state-hint"><span class="spinner" aria-hidden="true" />正在加载用户列表…</div>
        <div v-else-if="usersError" class="err-banner">
          {{ usersError }}
          <button type="button" class="btn-ghost" @click="loadUsers">重试</button>
        </div>
        <template v-else-if="usersPage">
          <div class="u-toolbar">
            <div class="u-search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
                <path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
              <input
                v-model="searchInput"
                type="text"
                placeholder="搜索用户名"
                aria-label="搜索用户名"
                @input="onSearchInput"
                @keydown.enter="applySearch"
              />
              <button
                v-if="searchInput"
                type="button"
                class="u-clear"
                title="清除搜索"
                aria-label="清除搜索"
                @click="clearSearch"
              >
                <svg width="12" height="12" viewBox="0 0 24 24"><path fill="currentColor" d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.7 2.89 18.29 9.17 12 2.89 5.71 4.3 4.29l6.29 6.3 6.3-6.3 1.41 1.42Z" /></svg>
              </button>
            </div>
            <span v-if="searching" class="tb-count">找到 {{ fmtNum(usersTotal) }} 个用户</span>
          </div>

          <!-- §2.1 搜索空态：空盒 + 副注 + 清除动作（非错误态，REQ-029 异常分支） -->
          <div v-if="searching && usersTotal === 0" class="u-empty">
            <div class="e-title">未找到匹配「{{ searchQuery }}」的用户</div>
            <div class="e-sub">用户名搜索大小写不敏感</div>
            <button type="button" class="btn-ghost" @click="clearSearch">清除搜索</button>
          </div>

          <div v-else ref="usersTable" class="tbl-card">
            <table class="adm-table">
              <thead>
                <tr>
                  <th>用户名</th>
                  <th>注册时间</th>
                  <th>状态</th>
                  <th>密钥模式</th>
                  <th>配额</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in usersPage.items" :key="u.id">
                  <td>
                    <span class="uname" :title="u.username"><template v-for="(seg, i) in nameSegs(u.username)" :key="i"><mark v-if="seg.hit" class="hl">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span>
                    <span v-if="u.is_admin" class="pill admin">管理员</span>
                  </td>
                  <td class="mono">{{ u.created_at }}</td>
                  <td>
                    <span class="pill" :class="u.banned ? 'banned' : 'ok'">{{ u.banned ? '已封禁' : '正常' }}</span>
                  </td>
                  <td class="mode">{{ u.mode === 'self' ? '自填 key' : '统一 key' }}</td>
                  <td>
                    <span class="pill tier" :class="{ custom: u.quota_override != null }">{{ tierLabel(u) }}</span>
                    <span v-if="u.banned" class="mono used">—</span>
                    <span v-else class="mono used" :class="{ exhausted: u.used_today >= u.daily_limit }">
                      {{ u.used_today >= u.daily_limit ? '今日已用尽' : `今日 ${u.used_today}/${u.daily_limit}` }}
                    </span>
                  </td>
                  <td class="acts">
                    <button
                      v-if="!u.banned"
                      type="button"
                      class="mini danger"
                      :disabled="u.is_admin"
                      :title="u.is_admin ? '管理员本人不可封禁' : undefined"
                      @click="banTarget = u"
                    >
                      封禁
                    </button>
                    <button v-else type="button" class="mini" @click="unban(u)">解封</button>
                    <button type="button" class="mini" @click="openQuota(u)">调配额</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- §2.1 分页：单页隐藏控件，仅保留计数（定夺③） -->
          <div v-if="!searching && usersTotal > 0" class="page-row">
            <span class="p-info">共 {{ fmtNum(usersTotal) }} 个用户{{ usersMultiPage ? ` · ${usersPageCount} 页` : '' }}</span>
            <div v-if="usersMultiPage" class="pager">
              <button type="button" class="pg-btn" :disabled="usersCurrent === 1" aria-label="上一页" @click="gotoUsersPage(usersCurrent - 1)">‹</button>
              <template v-for="(p, i) in pageList(usersCurrent, usersPageCount)" :key="`${p}-${i}`">
                <span v-if="p === '…'" class="pg-ellipsis">…</span>
                <button v-else type="button" class="pg-btn" :class="{ on: p === usersCurrent }" @click="gotoUsersPage(p)">{{ p }}</button>
              </template>
              <button type="button" class="pg-btn" :disabled="usersCurrent === usersPageCount" aria-label="下一页" @click="gotoUsersPage(usersCurrent + 1)">›</button>
            </div>
          </div>
        </template>
      </section>

      <!-- §3 用量列表：筛选沿用 + 排序后端化 + 分页 -->
      <section v-show="tab === 'usage'" class="panel">
        <div class="adm-toolbar">
          <span class="tb-label">用户</span>
          <select v-model="userFilter" aria-label="按用户过滤" @change="applyFilters">
            <option value="">全部用户</option>
            <option v-for="u in userOptions" :key="u.id" :value="u.id">{{ u.username }}</option>
          </select>
          <span class="tb-label">日期</span>
          <input v-model="dateFrom" type="date" aria-label="起始日期" @change="applyFilters" />
          <span class="tb-label">至</span>
          <input v-model="dateTo" type="date" aria-label="结束日期" @change="applyFilters" />
          <span class="tb-count">共 {{ fmtNum(usageTotal) }} 条</span>
        </div>

        <div v-if="usageLoading" class="state-hint"><span class="spinner" aria-hidden="true" />正在加载用量数据…</div>
        <div v-else-if="usageError" class="err-banner">
          {{ usageError }}
          <button type="button" class="btn-ghost" @click="loadUsage">重试</button>
        </div>
        <template v-else>
          <div v-if="hasGap" class="gap-note">部分时段无统计数据：仅显示已有数据（不估算补齐）</div>
          <div v-if="usageTotal > 0" ref="usageTable" class="tbl-card">
            <table class="adm-table">
              <thead>
                <tr>
                  <th class="sortable" @click="toggleSort('day')">
                    日期<span v-if="sortKey === 'day'" class="arrow">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
                  </th>
                  <th>用户名</th>
                  <th class="sortable num" @click="toggleSort('requests')">
                    请求数<span v-if="sortKey === 'requests'" class="arrow">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
                  </th>
                  <th class="sortable num" @click="toggleSort('tokens')">
                    token 数<span v-if="sortKey === 'tokens'" class="arrow">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in usagePage?.items ?? []" :key="`${r.day}-${r.user_id}`">
                  <td class="mono">{{ r.day }}</td>
                  <td>{{ r.username }}</td>
                  <td class="mono num">{{ r.requests }}</td>
                  <td class="mono num">{{ r.tokens }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="empty-usage">暂无用量数据——新用户或新部署尚无对话记录时属正常现象</div>

          <div v-if="usageTotal > 0" class="page-row">
            <span class="p-info">共 {{ fmtNum(usageTotal) }} 条{{ usageMultiPage ? ` · ${usagePageCount} 页` : '' }}</span>
            <div v-if="usageMultiPage" class="pager">
              <button type="button" class="pg-btn" :disabled="usageCurrent === 1" aria-label="上一页" @click="gotoUsagePage(usageCurrent - 1)">‹</button>
              <template v-for="(p, i) in pageList(usageCurrent, usagePageCount)" :key="`${p}-${i}`">
                <span v-if="p === '…'" class="pg-ellipsis">…</span>
                <button v-else type="button" class="pg-btn" :class="{ on: p === usageCurrent }" @click="gotoUsagePage(p)">{{ p }}</button>
              </template>
              <button type="button" class="pg-btn" :disabled="usageCurrent === usagePageCount" aria-label="下一页" @click="gotoUsagePage(usageCurrent + 1)">›</button>
            </div>
          </div>
        </template>
      </section>
    </main>

    <!-- §1.3 封禁确认模态（danger 实底，明示后果与可逆性） -->
    <ConfirmModal
      :open="!!banTarget"
      title="封禁该用户？"
      :body="`封禁后 ${banTarget?.username ?? ''} 将无法登录与调用，云端数据保留；解封后可恢复使用。`"
      confirm-label="确认封禁"
      @confirm="confirmBan"
      @cancel="banTarget = null"
    />

    <!-- §1.3 调配额模态：默认档 / 自定义 N（正整数校验不入库） -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="quotaTarget" class="overlay" @click.self="quotaTarget = null">
          <div class="modal" role="dialog" aria-label="调整配额">
            <h3 class="modal-title">调整配额</h3>
            <p class="modal-sub">
              用户 {{ quotaTarget.username }} · 当前：{{ quotaTarget.mode === 'self' ? '自填 key' : '统一 key' }} 模式{{
                quotaTarget.quota_override != null ? ` · 已覆盖为 ${quotaTarget.quota_override} 次/日` : `（默认 ${quotaTarget.daily_limit} 次/日）`
              }}
            </p>
            <label class="q-opt">
              <input v-model="quotaCustom" :value="false" type="radio" name="qmode" />
              <span>按默认档位（随密钥模式）<span class="q-desc">统一 key = 免费档 · 自填 key = 高档（部署配置默认值）</span></span>
            </label>
            <label class="q-opt" :class="{ invalid: quotaErr }">
              <input v-model="quotaCustom" :value="true" type="radio" name="qmode" />
              <span>自定义每日 <input v-model="quotaInput" type="text" class="q-num" placeholder="N" /> 次（覆盖默认档位）</span>
            </label>
            <div v-if="quotaErr" class="hint-err">{{ quotaErr }}</div>
            <p class="m-note">调整自下一次请求生效；覆盖后在列表中以「自定义 N」徽标与默认档位区分。</p>
            <div class="modal-actions">
              <button class="btn" type="button" @click="quotaTarget = null">取消</button>
              <button class="btn btn-primary" type="button" @click="saveQuota">保存</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <AppToast />
  </div>
</template>

<style scoped>
/* ---- 403 态（§1.5） ---- */
.forbid-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--c-bg);
}
.forbid-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 360px;
  max-width: calc(100vw - 32px);
  padding: 32px 28px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 12px;
  box-shadow: var(--shadow-1);
  text-align: center;
}
.f-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--c-text-1);
}
.f-desc {
  font-size: 13px;
  color: var(--c-text-2);
  margin-bottom: 8px;
}

/* ---- 框架（§1.1：页面底 --c-bg + 内容列 1080px，定夺⑦） ---- */
.admin-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--c-bg);
}
.adm-top {
  height: 52px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px;
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
}
.adm-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}
.adm-tag {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--c-primary-l);
  color: var(--c-primary);
}
.adm-sp {
  flex: 1;
}
.btn-icon32 {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--c-text-2);
  cursor: pointer;
}
.btn-icon32:hover {
  background: var(--c-hover-bg);
  color: var(--c-text-1);
}
.btn-ghost {
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 12px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-surface);
  color: var(--c-text-2);
  font-size: 13px;
  cursor: pointer;
}
.btn-ghost:hover {
  background: var(--c-hover-bg);
  color: var(--c-text-1);
}
.adm-body {
  flex: 1;
  width: min(1080px, calc(100% - 48px));
  margin: 24px auto;
}
.adm-tabs {
  display: inline-flex;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-surface);
  padding: 3px;
  gap: 2px;
}
.adm-tabs button {
  height: 32px;
  padding: 0 16px;
  border: none;
  border-radius: 6px;
  background: none;
  font-size: 13px;
  color: var(--c-text-2);
  cursor: pointer;
}
.adm-tabs button.on {
  background: var(--c-primary-l);
  color: var(--c-primary);
  font-weight: 500;
}
.panel {
  margin-top: 12px;
}

/* ---- 概览统计卡（§1.2，定夺④/⑤/⑦） ---- */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}
.stat-card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 12px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.s-label {
  font-size: 13px;
  color: var(--c-text-2);
}
.s-value {
  font-size: 20px;
  font-weight: 600;
  color: var(--c-text-1);
  font-variant-numeric: tabular-nums;
}
.s-sub {
  font-size: 12px;
  color: var(--c-text-3);
}
.s-bar {
  height: 6px;
  border-radius: 999px;
  background: var(--c-hover-bg);
  overflow: hidden;
  margin: 2px 0;
}
.s-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--c-primary-solid);
  transition: width 0.2s ease;
}
.s-fill.near {
  background: var(--c-warning);
}
.s-fill.burst {
  background: var(--c-danger-solid);
}
.s-state.near {
  color: var(--c-warning);
}
.s-state.burst {
  color: var(--c-danger);
}

/* ---- 定夺⑤：near/burst 页面级警示条（仅此时渲染；文案与视觉沿 iter-8 site-strip） ---- */
.site-bar {
  padding: 10px 14px;
  margin-bottom: 12px;
  border-radius: 8px;
  border-left: 3px solid var(--c-warning);
  background: var(--c-warning-l);
  font-size: 13px;
  color: var(--c-text-2);
}
.site-bar.burst {
  border-left-color: var(--c-danger);
  background: var(--c-danger-l);
  color: var(--c-danger);
}

/* ---- 状态与表格（§2/§3：表格入卡 + td 12/16，定夺⑦） ---- */
.state-hint {
  padding: 32px 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  color: var(--c-text-3);
}
.spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-primary);
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.err-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--c-danger-l);
  color: var(--c-danger);
  font-size: 13px;
}
.tbl-card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  box-shadow: var(--shadow-1);
  overflow-x: auto;
}
.adm-table {
  width: 100%;
  border-collapse: collapse;
  background: transparent;
}
.adm-table th {
  text-align: left;
  font-size: 12px;
  font-weight: 500;
  color: var(--c-text-3);
  background: var(--c-subtle-bg);
  padding: 10px 16px;
  white-space: nowrap;
}
.adm-table td {
  padding: 12px 16px;
  font-size: 13px;
  color: var(--c-text-1);
  border-top: 1px solid var(--c-border);
  white-space: nowrap;
}
.mono {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: var(--c-text-3);
}
.uname {
  display: inline-block;
  vertical-align: middle;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
mark.hl {
  background: transparent;
  color: var(--c-primary);
  font-weight: 600;
}
.pill {
  display: inline-block;
  height: 20px;
  line-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  margin-left: 6px;
  vertical-align: middle;
}
.pill.ok {
  background: var(--c-subtle-bg);
  color: var(--c-success);
}
.pill.banned {
  background: var(--c-danger-l);
  color: var(--c-danger);
}
.pill.admin {
  background: var(--c-primary-l);
  color: var(--c-primary);
}
.pill.tier {
  background: var(--c-subtle-bg);
  color: var(--c-text-2);
}
.pill.tier.custom {
  background: var(--c-primary-l);
  color: var(--c-primary);
}
.used {
  margin-left: 6px;
  font-size: 12px;
  color: var(--c-text-3);
}
.used.exhausted {
  color: var(--c-danger);
}
.mode {
  color: var(--c-text-2);
}
.acts {
  display: flex;
  gap: 6px;
}
.mini {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--c-border);
  border-radius: 6px;
  background: var(--c-surface);
  color: var(--c-text-2);
  font-size: 12px;
  cursor: pointer;
}
.mini:hover {
  background: var(--c-hover-bg);
  color: var(--c-text-1);
}
.mini.danger {
  color: var(--c-danger);
}
.mini.danger:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.num {
  text-align: right;
}
th.sortable {
  cursor: pointer;
  user-select: none;
}
.arrow {
  margin-left: 2px;
  font-size: 10px;
  color: var(--c-primary);
}
.gap-note {
  padding: 8px 14px;
  margin-bottom: 8px;
  border-radius: 8px;
  background: var(--c-warning-l);
  color: var(--c-warning);
  font-size: 12px;
}
.empty-usage {
  padding: 32px 0;
  text-align: center;
  font-size: 12px;
  color: var(--c-text-3);
  border: 1px dashed var(--c-border);
  border-radius: 8px;
}

/* ---- 用户搜索框（§2.1：260×32 + icon + 清除钮 + 焦点环） ---- */
.u-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}
.u-search {
  width: 260px;
  height: 32px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-surface);
  color: var(--c-text-3);
}
.u-search:focus-within {
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-focus-ring);
}
.u-search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: none;
  color: var(--c-text-1);
  font-size: 13px;
  font-family: inherit;
}
.u-search input::placeholder {
  color: var(--c-text-3);
}
.u-clear {
  width: 20px;
  height: 20px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--c-text-3);
  cursor: pointer;
}
.u-clear:hover {
  background: var(--c-hover-bg);
  color: var(--c-text-1);
}
.u-empty {
  padding: 32px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  border: 1px dashed var(--c-border);
  border-radius: 8px;
  background: var(--c-surface);
}
.e-title {
  font-size: 13px;
  color: var(--c-text-1);
}
.e-sub {
  font-size: 12px;
  color: var(--c-text-3);
  margin-bottom: 4px;
}

/* ---- 分页控件（§2.1/§3.1：28px 页码钮，当前页沿分段控件选中语法） ---- */
.page-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
}
.p-info {
  font-size: 12px;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}
.pager {
  display: flex;
  align-items: center;
  gap: 4px;
}
.pg-btn {
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border: none;
  border-radius: 6px;
  background: var(--c-surface);
  color: var(--c-text-2);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.pg-btn:hover:not(:disabled) {
  border: 1px solid var(--c-primary);
  color: var(--c-primary);
}
.pg-btn:active:not(:disabled) {
  transform: scale(0.94);
}
.pg-btn.on {
  background: var(--c-primary-l);
  color: var(--c-primary);
  font-weight: 500;
}
.pg-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.pg-ellipsis {
  min-width: 20px;
  text-align: center;
  font-size: 12px;
  color: var(--c-text-3);
}

/* ---- 用量工具栏（§3.1：32px 控件 + focus 主色描边 + 焦点环，沿用） ---- */
.adm-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.tb-label {
  font-size: 12px;
  color: var(--c-text-3);
}
.adm-toolbar select,
.adm-toolbar input {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-surface);
  color: var(--c-text-1);
  font-size: 13px;
  font-family: inherit;
}
.adm-toolbar select:focus,
.adm-toolbar input:focus {
  outline: none;
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-focus-ring);
}
.tb-count {
  font-size: 12px;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}

/* ---- 调配额模态（§1.3，沿用） ---- */
.overlay {
  position: fixed;
  inset: 0;
  background: var(--c-mask);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 150;
}
.modal {
  background: var(--c-surface);
  border-radius: 12px;
  box-shadow: var(--shadow-3);
  width: 400px;
  max-width: calc(100vw - 32px);
  padding: 24px;
}
.modal-title {
  margin: 0 0 8px;
  font-size: 17px;
  color: var(--c-text-1);
}
.modal-sub {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--c-text-2);
}
.q-opt {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--c-text-1);
  cursor: pointer;
}
.q-opt.invalid {
  border-color: var(--c-danger);
}
.q-desc {
  display: block;
  font-size: 12px;
  color: var(--c-text-3);
  margin-top: 2px;
}
.q-num {
  width: 64px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--c-border);
  border-radius: 6px;
  background: var(--c-surface);
  color: var(--c-text-1);
  font-size: 13px;
  text-align: center;
}
.hint-err {
  margin: 4px 0 8px;
  font-size: 12px;
  color: var(--c-danger);
}
.m-note {
  margin: 8px 0 16px;
  font-size: 12px;
  color: var(--c-text-3);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.btn {
  height: 32px;
  padding: 0 16px;
  border-radius: 6px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-text-1);
  font-size: 13px;
  cursor: pointer;
}
.btn:hover {
  background: var(--c-hover-bg);
}
.btn-primary {
  border-color: var(--c-primary);
  background: var(--c-primary-solid);
  color: #fff;
}
.btn-primary:hover {
  background: var(--c-primary-solid-h);
  border-color: var(--c-primary-h);
}
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
