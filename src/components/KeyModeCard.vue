<script setup lang="ts">
/** REQ-014 v3 密钥模式卡（design-iter-7 §1.1/§1.2）：统一 key 零配置态 ↔ 自填态。
    模式判定：存在当前生效档案 = 自填（activeProfileName 传入）；无 = 统一 key。
    quota（iter-8 T2，GET /api/quota）：免费额度行参数化——design-iter-7 走查 2 兑现；
    未取到时保持占位破折号（不编造数值，铁律 5 同源精神）。 */
defineProps<{
  mode: 'unified' | 'custom'
  activeProfileName?: string
  quota?: { daily_limit: number; used_today: number } | null
}>()

const emit = defineEmits<{ fallback: []; gotoAdv: [] }>()
</script>

<template>
  <!-- 统一 key 态（默认）：零配置，无任何密钥输入框（走查 1） -->
  <div v-if="mode === 'unified'" class="mode-card">
    <div class="mode-head">
      <span class="mode-ico" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.4" />
          <path d="M5.4 8.2l1.8 1.8 3.4-3.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <span class="mode-title">服务端统一密钥</span>
      <span class="mode-badge">当前模式</span>
    </div>
    <p class="mode-desc"><b>零配置</b>：无需填写任何密钥，免费额度内即可对话。请求经服务端代理转发。</p>
    <div class="quota-row">
      <span v-if="quota">免费额度：每日 {{ quota.daily_limit }} 次对话 · 今日已用 {{ quota.used_today }}</span>
      <template v-else>
        <span>免费额度：每日 — 次对话 · 今日已用 —</span>
        <span class="tag-occ">占位 · 数值由管理员配置（REQ-024，iter-8）</span>
      </template>
    </div>
    <div class="mode-actions">
      <button type="button" class="link-adv" @click="emit('gotoAdv')">
        在下方高级设置中添加自有密钥，解锁更高配额 ↓
      </button>
    </div>
  </div>

  <!-- 自填态：主色描边 + primary-l 底（与「当前生效档案」同一视觉语法，走查 4） -->
  <div v-else class="mode-card custom">
    <div class="mode-head">
      <span class="mode-ico custom" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
          <circle cx="5.5" cy="5.5" r="2.3" stroke="currentColor" stroke-width="1.4" />
          <path d="M7.2 7.2L13 13M10 10l1.8-1.8M12 12l1.8-1.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </span>
      <span class="mode-title">自填密钥 · 当前生效：{{ activeProfileName }}</span>
      <span class="mode-badge">已解锁更高配额</span>
    </div>
    <p class="mode-desc">使用你配置的供应商密钥发起请求。密钥<b>仅存服务端</b>（受保护存储），多设备一致，浏览器本地不保留。</p>
    <div class="mode-actions">
      <button type="button" class="btn-ghost-s" @click="emit('fallback')">回退统一密钥（免费额度）</button>
    </div>
  </div>
</template>

<style scoped>
.mode-card {
  border: 1px solid var(--c-border);
  border-radius: 12px;
  background: var(--c-surface);
  box-shadow: var(--shadow-1);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mode-card.custom {
  border-color: var(--c-primary);
  background: var(--c-primary-l);
}
.mode-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mode-ico {
  color: var(--c-success);
  display: inline-flex;
}
.mode-ico.custom {
  color: var(--c-primary);
}
.mode-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text-1);
}
.mode-badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--c-primary-l);
  color: var(--c-primary);
}
.mode-card.custom .mode-badge {
  background: var(--c-surface);
}
.mode-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--c-text-3);
}
.quota-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--c-text-3);
}
.tag-occ {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--c-warning-l);
  color: var(--c-warning);
}
.mode-actions {
  display: flex;
}
.link-adv {
  border: none;
  background: transparent;
  padding: 0;
  font-size: 12px;
  color: var(--c-primary);
  cursor: pointer;
  text-decoration: none;
}
.link-adv:hover {
  text-decoration: underline;
}
.btn-ghost-s {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--c-border);
  border-radius: 6px;
  background: var(--c-surface);
  color: var(--c-text-2);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.btn-ghost-s:hover {
  border-color: var(--c-primary);
  color: var(--c-primary);
}
</style>
