<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSessionsStore, type Session } from '../stores/sessions'
import { useSettingsStore } from '../stores/settings'
import { matchSession, type SearchHit } from '../utils/search'
import BrandMark from './BrandMark.vue'
import SessionListItem from './SessionListItem.vue'
import ConfirmModal from './ConfirmModal.vue'

const sessions = useSessionsStore()
const settings = useSettingsStore()
const emit = defineEmits<{ openSettings: []; chat: [] }>()

const pendingDelete = ref<Session | null>(null)

function onNew() {
  sessions.createSession() // 生成中新建 = 中断并标注（store 内处理）
  emit('chat')
}

// REQ-016：会话搜索——标题命中优先，其次正文命中；空关键词恢复完整列表
const searchText = ref('')
const query = computed(() => searchText.value.trim().toLowerCase())

const filtered = computed<Array<{ session: Session; hit: SearchHit | null }>>(() => {
  if (!query.value) return sessions.sessions.map((s) => ({ session: s, hit: null }))
  return sessions.sessions
    .map((s) => ({ session: s, hit: matchSession(s, query.value) }))
    .filter((x): x is { session: Session; hit: SearchHit } => x.hit !== null)
    .sort((a, b) => {
      if (a.hit.type === 'title' && b.hit.type === 'body') return -1
      if (a.hit.type === 'body' && b.hit.type === 'title') return 1
      return b.session.updatedAt - a.session.updatedAt
    })
})
</script>

<template>
  <aside class="sidebar">
    <div class="brand-row">
      <BrandMark :size="24" with-text />
    </div>

    <button class="new-btn" @click="onNew">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
      </svg>
      新建会话
    </button>

    <div class="search-box">
      <svg class="search-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14Z"
        />
      </svg>
      <input
        v-model="searchText"
        class="search-input"
        type="text"
        placeholder="搜索会话"
        spellcheck="false"
        autocomplete="off"
        aria-label="搜索会话"
      />
      <button v-if="searchText" class="search-clear" aria-label="清除搜索" @click="searchText = ''">
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
          <path
            fill="currentColor"
            d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.7 2.89 18.29 9.17 12 2.89 5.71 4.3 4.29l6.29 6.3 6.3-6.3 1.41 1.42Z"
          />
        </svg>
      </button>
    </div>

    <ul class="session-list">
      <SessionListItem
        v-for="{ session, hit } in filtered"
        :key="session.id"
        :session="session"
        :active="session.id === sessions.activeId"
        :search="query"
        :hit="hit"
        @select="sessions.switchTo(session.id); emit('chat')"
        @remove="pendingDelete = session"
        @rename="(title) => sessions.renameSession(session.id, title)"
      />
      <li v-if="query && filtered.length === 0" class="no-result">无匹配会话</li>
    </ul>

    <div class="footer">
      <button class="settings-btn" @click="emit('openSettings')">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm-4.9-6.3 1.4 1.4A5.9 5.9 0 0 0 7 12c0 1 .3 2 .7 2.9l-1.4 1.4A7.9 7.9 0 0 1 4 12c0-1.6.5-3.1 1.3-4.3H7.1Zm11.6 8.6-1.4-1.4c.4-.9.7-1.9.7-2.9s-.3-2-.7-2.9l1.4-1.4A7.9 7.9 0 0 1 20 12c0 1.6-.5 3.1-1.3 4.3Z"
          />
        </svg>
        设置
      </button>
      <span class="profile-tag" :title="settings.activeProfile?.name">{{ settings.activeProfile?.name ?? '未配置' }}</span>
      <span class="api-dot" :class="settings.isConfigured ? 'ok' : 'bad'" :title="settings.isConfigured ? 'API 已配置' : 'API 未配置'" />
    </div>

    <ConfirmModal
      :open="!!pendingDelete"
      title="删除这个会话？"
      :body="`「${pendingDelete?.title ?? ''}」的全部消息将一并删除，无法恢复。`"
      confirm-label="删除"
      @confirm="pendingDelete && sessions.removeSession(pendingDelete.id); pendingDelete = null"
      @cancel="pendingDelete = null"
    />
  </aside>
</template>

<style scoped>
.sidebar {
  width: 264px;
  flex: none;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--c-surface);
  border-right: 1px solid var(--c-border);
  padding: 16px 12px;
  gap: 12px;
}
.brand-row {
  height: 24px;
  display: flex;
  align-items: center;
  padding: 0 4px;
}
.new-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: var(--c-primary-solid);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.new-btn:hover {
  background: var(--c-primary-solid-h);
}
.new-btn:active {
  transform: scale(0.98);
}
/* REQ-016 搜索框 */
.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 8px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.search-box:focus-within {
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-focus-ring);
}
.search-icon {
  flex: none;
  color: var(--c-text-3);
}
.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: var(--c-text-1);
  font-family: inherit;
}
.search-input::placeholder {
  color: var(--c-text-3);
}
.search-clear {
  flex: none;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--c-text-3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}
.search-clear:hover {
  background: var(--c-avatar-bg);
  color: var(--c-text-1);
}
.no-result {
  list-style: none;
  padding: 16px 12px;
  font-size: 12px;
  color: var(--c-text-3);
  text-align: center;
}
.session-list {
  flex: 1;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--c-border);
  padding-top: 12px;
}
.settings-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: none;
  font-size: 13px;
  color: var(--c-text-2);
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 6px;
  transition: all 0.15s ease;
}
.settings-btn:hover {
  background: var(--c-hover-bg);
  color: var(--c-text-1);
}
.profile-tag {
  font-size: 12px;
  color: var(--c-text-3);
  max-width: 96px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.api-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}
.api-dot.ok {
  background: var(--c-success);
}
.api-dot.bad {
  background: var(--c-danger-solid);
}
</style>
