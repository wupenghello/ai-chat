<script setup lang="ts">
import { ref } from 'vue'
import { useSessionsStore, type Session } from '../stores/sessions'
import { useSettingsStore } from '../stores/settings'
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

    <ul class="session-list">
      <SessionListItem
        v-for="s in sessions.sessions"
        :key="s.id"
        :session="s"
        :active="s.id === sessions.activeId"
        @select="sessions.switchTo(s.id); emit('chat')"
        @remove="pendingDelete = s"
        @rename="(title) => sessions.renameSession(s.id, title)"
      />
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
  background: var(--c-primary);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.new-btn:hover {
  background: var(--c-primary-h);
}
.new-btn:active {
  transform: scale(0.98);
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
  background: #f2f3f5;
  color: var(--c-text-1);
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
  background: var(--c-error);
}
</style>
