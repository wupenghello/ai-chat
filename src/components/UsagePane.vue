<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { backend, type UsageSummary } from '../api/backend'

/**
 * 「用量与费用」设置分区（CHG-015 REQ-052，iter-21 T3；design-iter-21 §3 分区体规格）。
 *
 * 布局序：今日摘要行（今日对话 + 今日费用估算）→ 时间窗按钮组（近 7/30 天，默认 7）→
 * 每日表格（六列 + 合计行）→ 模式脚注。四分支态：加载中 / 空态 / 未配置单价（费用列「—」+
 * 表头注，tokens 照常）/ 加载失败（就地 U16 + 重试钮，不弹 toast——定夺④）。
 * 金额体例 = admin 遥测卡同源（¥ + toFixed(4)；null →「未配置」）；缓存缺失「—」
 * 永不显 0（铁律 5）。纯只读面零表单控件——isDirty() 零置位、Esc 链零插入点（§2）。
 * 数据：分区切入 / 窗口切换拉取，无轮询；today 三数字与 /api/quota 同源并呈（定夺④）。
 */
const props = defineProps<{ active: boolean }>()

type Phase = 'loading' | 'failed' | 'ready'
const phase = ref<Phase>('loading')
const data = ref<UsageSummary | null>(null)
const win = ref<7 | 30>(7)
const switching = ref(false)

async function load(days: 7 | 30 = win.value) {
  if (data.value === null) phase.value = 'loading' // 首次进入显加载态；窗口切换就地表替换
  try {
    data.value = await backend.getUsageSummary(days)
    phase.value = 'ready'
  } catch {
    phase.value = 'failed'
  }
}

watch(
  () => props.active,
  (v) => {
    if (v) void load()
  },
  { immediate: true },
)

async function switchWin(days: 7 | 30) {
  if (days === win.value || switching.value) return
  switching.value = true
  win.value = days
  try {
    await load(days) // 失败停留失败态（U16 + 重试）
  } finally {
    switching.value = false
  }
}

const rows = computed(() => data.value?.daily ?? [])
const priceConfigured = computed(() => data.value?.price.configured ?? true)

function fmtNum(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('zh-Hans-CN')
}

function fmtMoney(n: number | null | undefined): string {
  // admin 卡 A fmtMoney 同体例；null（未配置）由模板走「未配置」列级口径，本函数兜底同文
  return n == null ? '未配置' : `¥${n.toFixed(4)}`
}

const todayTurnsText = computed(() => {
  const t = data.value?.today
  if (!t) return '—'
  return t.mode === 'self' ? '自填模式 · 无免费额度上限' : `${t.used_today} / ${t.daily_limit} 次`
})

interface TotalRow {
  turns: number
  prompt: number
  completion: number
  hit: number | null // 任一日缺失 → 合计缺失（「—」，铁律 5 不补造）
  cost: number | null
}

const totals = computed<TotalRow>(() => {
  let turns = 0
  let prompt = 0
  let completion = 0
  let hit = 0
  let hitMissing = false
  let cost = 0
  let costMissing = false
  for (const r of rows.value) {
    turns += r.turns
    prompt += r.tokens_prompt
    completion += r.tokens_completion
    if (r.cache_hit_tokens == null) hitMissing = true
    else hit += r.cache_hit_tokens
    if (r.cost_total == null) costMissing = true
    else cost += r.cost_total
  }
  return {
    turns,
    prompt,
    completion,
    hit: hitMissing ? null : hit,
    cost: costMissing ? null : cost,
  }
})

const retrying = ref(false)
async function retry() {
  retrying.value = true
  try {
    await load()
  } finally {
    retrying.value = false
  }
}
</script>

<template>
  <div class="usage-pane">
    <div class="pane-label">用量与费用</div>
    <div class="u-sub">查看你的对话用量与费用估算</div>

    <!-- 今日摘要行（§3.1；today 数字与 /api/quota 同源） -->
    <div class="u-today">
      <div class="cell">
        <div class="k">今日对话</div>
        <div class="v">{{ todayTurnsText }}</div>
      </div>
      <div class="cell">
        <div class="k">今日费用估算</div>
        <!-- 数据未就绪（加载/失败态）显「—」，不造 ¥0.0000（铁律 5 呈现面，CR iter-21 当轮修） -->
        <div class="v">{{ phase !== 'ready' ? '—' : priceConfigured ? fmtMoney(data?.today?.cost_total ?? 0) : '未配置' }}</div>
      </div>
    </div>

    <!-- 时间窗（§3.2） -->
    <div class="u-win" role="radiogroup" aria-label="用量时间窗">
      <button
        v-for="d in [7, 30] as const"
        :key="d"
        type="button"
        role="radio"
        :aria-checked="win === d"
        :class="{ on: win === d }"
        @click="switchWin(d)"
      >
        近 {{ d }} 天
      </button>
      <span class="note">明细保留 {{ data?.retention_days ?? 90 }} 天，超期自动清理</span>
    </div>

    <!-- 每日列表（§3.3；四分支态 §3.4） -->
    <div v-if="phase === 'loading'" class="u-state">加载中…</div>
    <div v-else-if="phase === 'failed'" class="u-state">
      用量数据加载失败，请稍后重试
      <button type="button" class="retry" :disabled="retrying" @click="retry">重试</button>
    </div>
    <div v-else-if="rows.length === 0" class="u-state">选定时间范围内暂无用量记录</div>
    <div v-else class="u-table-wrap">
      <table class="u">
        <thead>
          <tr>
            <th>日期</th>
            <th>回合数</th>
            <th>输入 tokens</th>
            <th>输出 tokens</th>
            <th>缓存命中</th>
            <th>费用估算{{ priceConfigured ? '' : '（未配置单价）' }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.day">
            <td>{{ r.day }}</td>
            <td>{{ fmtNum(r.turns) }}</td>
            <td>{{ fmtNum(r.tokens_prompt) }}</td>
            <td>{{ fmtNum(r.tokens_completion) }}</td>
            <td>{{ fmtNum(r.cache_hit_tokens) }}</td>
            <td>{{ priceConfigured ? fmtMoney(r.cost_total) : '—' }}</td>
          </tr>
          <tr class="sum">
            <td>合计</td>
            <td>{{ fmtNum(totals.turns) }}</td>
            <td>{{ fmtNum(totals.prompt) }}</td>
            <td>{{ fmtNum(totals.completion) }}</td>
            <td>{{ fmtNum(totals.hit) }}</td>
            <td>{{ priceConfigured ? fmtMoney(totals.cost) : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="u-foot">仅统一 key 模式计成本；自填模式 tokens 不计成本</div>
  </div>
</template>

<style scoped>
/* design-iter-21 §9 零令牌自查：全部走语义令牌既有值（tokens v1.3/v1.3.1），零自造色值 */
.pane-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text-1);
  margin: 4px 0 0;
}
.u-sub {
  font-size: 13px;
  color: var(--c-text-3);
  margin-top: 2px;
}
.u-today {
  background: var(--c-subtle-bg);
  border-radius: var(--r-md);
  padding: 12px 16px;
  margin-top: 12px;
  display: flex;
  gap: 32px;
  flex-wrap: wrap;
}
.u-today .k {
  font-size: 12px;
  color: var(--c-text-3);
  margin-bottom: 4px;
}
.u-today .v {
  font-size: 16px;
  font-weight: 600;
  color: var(--c-text-1);
}
.u-win {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 16px 0 8px;
}
.u-win button {
  height: 28px;
  padding: 0 12px;
  font-size: 13px;
  border: none;
  background: transparent;
  color: var(--c-text-2);
  border-radius: var(--r-sm);
  cursor: pointer;
}
.u-win button:hover {
  background: var(--c-hover-bg);
}
.u-win button.on {
  background: var(--c-primary-l);
  color: var(--c-primary);
  font-weight: 500;
}
.u-win .note {
  font-size: 12px;
  color: var(--c-text-3);
  margin-left: 8px;
}
.u-table-wrap {
  overflow-x: auto; /* §3.3 ≤480px 全屏态：容器内滚动，REQ-050 单滚动容器口径不破坏 */
  margin-top: 4px;
}
table.u {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
table.u th {
  font-size: 12px;
  color: var(--c-text-3);
  font-weight: 400;
  text-align: right;
  padding: 8px;
  border-bottom: 1px solid var(--c-border);
  white-space: nowrap;
}
table.u td {
  text-align: right;
  padding: 9px 8px;
  border-bottom: 1px solid var(--c-border);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: var(--c-text-1);
}
table.u th:first-child,
table.u td:first-child {
  text-align: left;
  padding-left: 0;
}
table.u tr.sum td {
  background: var(--c-subtle-bg);
  font-weight: 600;
  border-bottom: none;
}
.u-foot {
  font-size: 12px;
  color: var(--c-text-3);
  margin-top: 8px;
}
.u-state {
  padding: 32px 0;
  text-align: center;
  font-size: 12px;
  color: var(--c-text-3);
}
.retry {
  display: block;
  margin: 8px auto 0;
  font-size: 13px;
  color: var(--c-primary);
  background: none;
  border: none;
  cursor: pointer;
}
.retry:hover {
  color: var(--c-primary-h);
}
</style>
