<script setup lang="ts">
import { useToastStore } from '../stores/toast'

const toast = useToastStore()
const emit = defineEmits<{ navigate: [to: 'settings'] }>()
</script>

<template>
  <div class="toast-wrap" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in toast.items" :key="t.id" class="toast">
        <span class="toast-msg" :class="t.variant">{{ t.message }}</span>
        <button v-if="t.action" class="toast-action" @click="emit('navigate', t.action.to); toast.dismiss(t.id)">
          {{ t.action.label }}
        </button>
        <button class="toast-close" aria-label="关闭" @click="toast.dismiss(t.id)">×</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-wrap {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--c-toast-bg);
  border: 1px solid var(--c-toast-border);
  color: #fff;
  font-size: 13px;
  padding: 10px 14px;
  border-radius: 8px;
  box-shadow: var(--shadow-2);
}
.toast-msg {
  line-height: 1.5;
}
/* REQ-021：成功绿 toast（success-on-dark #4CC38A，深底白字对比度达标） */
.toast-msg.success {
  color: var(--c-success-on-dark);
  font-weight: 600;
}
.toast-action {
  border: none;
  background: none;
  color: var(--c-primary-on-dark);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 0;
  white-space: nowrap;
}
.toast-action:hover {
  text-decoration: underline;
}
.toast-close {
  border: none;
  background: none;
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
  cursor: pointer;
  padding: 0 2px;
}
.toast-enter-active {
  transition: all 0.25s ease;
}
.toast-leave-active {
  transition: all 0.18s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
