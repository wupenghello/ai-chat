<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { backend, type AdminOverview, type AdminUsageRow, type AdminUserRow } from '../api/backend'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import { useTheme } from '../composables/useTheme'
import BrandMark from '../components/BrandMark.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import AppToast from '../components/AppToast.vue'

/**
 * REQ-025（iter-8 T2）：管理员 Web 后台——design-iter-8 §1。
 * 安全边界在服务端（admin 接口对非管理员 403）；本页 403 态与侧栏入口隐藏只是引导层（定夺 ③）。
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

// ---- 用户列表面板（§1.2） ----
const users = ref<AdminUserRow[] | null>(null)
const overview = ref<AdminOverview | null>(null)
const usersError = ref('')
const usersLoading = ref(false)

async function loadUsers() {
  usersLoading.value = true
  usersError.value = ''
  try {
    ;[users.value, overview.value] = await Promise.all([backend.adminUsers(), backend.adminOverview()])
  } catch (e) {
    usersError.value = errMsg(e, '用户列表加载失败')
  } finally {
    usersLoading.value = false
  }
}

/** 全站配额条三态：常态 / ≥80% 琥珀 / 已熔断红（§1.2 定夺 ①） */
const siteState = computed<'normal' | 'near' | 'burst'>(() => {
  const o = overview.value
  if (!o || o.unified_daily_total <= 0) return 'normal'
  if (o.unified_used >= o.unified_daily_total) return 'burst'
  if (o.unified_used / o.unified_daily_total >= 0.8) return 'near'
  return 'normal'
})

function fmtNum(n: number): string {
  return n.toLocaleString('zh-Hans-CN')
}

/** 档位徽标文案（§1.2 定夺 ①：默认档随模式，覆盖以「自定义 N」主色徽标区分） */
function tierLabel(u: AdminUserRow): string {
  if (u.quota_override != null) return `自定义 ${u.quota_override}`
  return u.mode === 'self' ? '自填档' : '免费档'
}

// 封禁（§1.3：确认模态 danger 实底；解封直接生效无确认——可逆）
const banTarget = ref<AdminUserRow | null>(null)

async function confirmBan() {
  const target = banTarget.value
  if (!target) return
  try {
    await backend.banUser(target.id)
    toast.push(`已封禁 ${target.username}`)
    banTarget.value = null
    await loadUsers()
  } catch (e) {
    toast.push(errMsg(e))
  }
}

async function unban(u: AdminUserRow) {
  try {
    await backend.unbanUser(u.id)
    toast.push(`已解封 ${u.username}`)
    await loadUsers()
  } catch (e) {
    toast.push(errMsg(e))
  }
}

// 调配额模态（§1.3：默认档 / 自定义 N，正整数校验不入库）
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
    await loadUsers()
  } catch (e) {
    toast.push(errMsg(e))
  }
}

// ---- 用量列表面板（§1.4） ----
function toISODate(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

const todayISO = toISODate(new Date())
const weekAgoISO = toISODate(new Date(Date.now() - 6 * 24 * 3600 * 1000))

const usageRows = ref<AdminUsageRow[] | null>(null)
const usageError = ref('')
const usageLoading = ref(false)
const userFilter = ref<number | ''>('')
const dateFrom = ref(weekAgoISO)
const dateTo = ref(todayISO)
const sortKey = ref<'day' | 'requests' | 'tokens'>('day')
const sortDir = ref<'asc' | 'desc'>('desc')

function toggleSort(key: 'day' | 'requests' | 'tokens') {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'desc'
  }
}

async function loadUsage() {
  usageLoading.value = true
  usageError.value = ''
  try {
    usageRows.value = await backend.adminUsage({
      user_id: userFilter.value === '' ? undefined : userFilter.value,
      date_from: dateFrom.value || undefined,
      date_to: dateTo.value || undefined,
    })
  } catch (e) {
    usageError.value = errMsg(e, '用量数据加载失败')
  } finally {
    usageLoading.value = false
  }
}

const sortedUsage = computed<AdminUsageRow[]>(() => {
  const rows = [...(usageRows.value ?? [])]
  const dir = sortDir.value === 'asc' ? 1 : -1
  rows.sort((a, b) => (a[sortKey.value] > b[sortKey.value] ? dir : a[sortKey.value] < b[sortKey.value] ? -dir : 0))
  return rows
})

/** 缺失时段标注（§1.4 + 铁律 5）：窗口内有数据但不连续 → 琥珀行声明「不估算补齐」 */
const hasGap = computed(() => {
  const rows = usageRows.value
  if (!rows || rows.length === 0 || !dateFrom.value || !dateTo.value || dateFrom.value > dateTo.value) return false
  const days = Math.round((Date.parse(dateTo.value) - Date.parse(dateFrom.value)) / 86400000) + 1
  if (days > 366) return false
  const distinct = new Set(rows.map((r) => r.day)).size
  return distinct > 0 && distinct < days
})

function applyFilters() {
  void loadUsage()
}

onMounted(() => {
  if (isAdmin.value) {
    void loadUsers()
    void loadUsage()
  }
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

  <!-- §1.1 页面框架：顶栏（品牌 + 管理后台徽标 + 主题 + 返回）+ 分段 tab -->
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
      <div class="adm-tabs" role="radiogroup" aria-label="后台分区">
        <button type="button" role="radio" :aria-checked="tab === 'users'" :class="{ on: tab === 'users' }" @click="tab = 'users'">
          用户列表
        </button>
        <button type="button" role="radio" :aria-checked="tab === 'usage'" :class="{ on: tab === 'usage' }" @click="tab = 'usage'">
          用量列表
        </button>
      </div>

      <!-- §1.2 用户列表 -->
      <section v-show="tab === 'users'" class="panel">
        <div v-if="usersLoading" class="state-hint"><span class="spinner" aria-hidden="true" />正在加载用户列表…</div>
        <div v-else-if="usersError" class="err-banner">
          {{ usersError }}
          <button type="button" class="btn-ghost" @click="loadUsers">重试</button>
        </div>
        <template v-else-if="users">
          <!-- 全站配额条（定夺 ①）：常态 / ≥80% 琥珀 / 熔断红 -->
          <div v-if="overview" class="site-bar" :class="siteState">
            <template v-if="siteState === 'burst'">
              统一 key 每日总量 {{ fmtNum(overview.unified_daily_total )}} · 今日已用 {{ fmtNum(overview.unified_used) }}
              —— <b>已暂停全站新对话请求，明日 00:00 自动恢复；自填 key 用户不受影响</b>
            </template>
            <template v-else>
              统一 key 每日总量 {{ fmtNum(overview.unified_daily_total) }} · 今日已用 {{ fmtNum(overview.unified_used) }}
              <b v-if="siteState === 'near'">（已接近上限，请关注消耗）</b>
            </template>
          </div>
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
              <tr v-for="u in users" :key="u.id">
                <td>
                  <span class="uname" :title="u.username">{{ u.username }}</span>
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
        </template>
      </section>

      <!-- §1.4 用量列表 -->
      <section v-show="tab === 'usage'" class="panel">
        <div class="adm-toolbar">
          <span class="tb-label">用户</span>
          <select v-model="userFilter" aria-label="按用户过滤" @change="applyFilters">
            <option value="">全部用户</option>
            <option v-for="u in users ?? []" :key="u.id" :value="u.id">{{ u.username }}</option>
          </select>
          <span class="tb-label">日期</span>
          <input v-model="dateFrom" type="date" aria-label="起始日期" @change="applyFilters" />
          <span class="tb-label">至</span>
          <input v-model="dateTo" type="date" aria-label="结束日期" @change="applyFilters" />
          <span class="tb-count">{{ usageRows?.length ?? 0 }} 条</span>
        </div>

        <div v-if="usageLoading" class="state-hint"><span class="spinner" aria-hidden="true" />正在加载用量数据…</div>
        <div v-else-if="usageError" class="err-banner">
          {{ usageError }}
          <button type="button" class="btn-ghost" @click="loadUsage">重试</button>
        </div>
        <template v-else>
          <div v-if="hasGap" class="gap-note">部分时段无统计数据：仅显示已有数据（不估算补齐）</div>
          <table v-if="sortedUsage.length" class="adm-table">
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
              <tr v-for="(r, i) in sortedUsage" :key="`${r.day}-${r.user_id}-${i}`">
                <td class="mono">{{ r.day }}</td>
                <td>{{ r.username }}</td>
                <td class="mono num">{{ r.requests }}</td>
                <td class="mono num">{{ r.tokens }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty-usage">暂无用量数据——新用户或新部署尚无对话记录时属正常现象</div>
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
  background: var(--c-subtle-bg);
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

/* ---- 框架（§1.1） ---- */
.admin-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--c-subtle-bg);
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
  width: min(960px, calc(100% - 48px));
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

/* ---- 状态与表格（§1.2/§1.4） ---- */
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
.site-bar {
  padding: 10px 14px;
  margin-bottom: 12px;
  border-radius: 8px;
  border-left: 3px solid var(--c-success);
  background: var(--c-surface);
  font-size: 13px;
  color: var(--c-text-2);
}
.site-bar.near {
  border-left-color: var(--c-warning);
  background: var(--c-warning-l);
}
.site-bar.burst {
  border-left-color: var(--c-danger);
  background: var(--c-danger-l);
  color: var(--c-danger);
}
.adm-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  overflow: hidden;
}
.adm-table th {
  text-align: left;
  font-size: 12px;
  font-weight: 500;
  color: var(--c-text-3);
  background: var(--c-subtle-bg);
  padding: 9px 14px;
  white-space: nowrap;
}
.adm-table td {
  padding: 10px 14px;
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

/* ---- 用量工具栏（§1.4：32px 控件 + focus 主色描边 + 焦点环） ---- */
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
}

/* ---- 调配额模态（§1.3） ---- */
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
