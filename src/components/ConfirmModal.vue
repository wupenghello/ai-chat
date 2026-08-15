<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

/** 危险操作二次确认（删除会话 / 清除密钥复用）。Esc 与遮罩点击 = 取消 */
const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    body?: string
    confirmLabel?: string
    danger?: boolean
  }>(),
  { confirmLabel: '确认', danger: true, body: '' },
)
const emit = defineEmits<{ confirm: []; cancel: [] }>()

function onKey(e: KeyboardEvent) {
  if (props.open && e.key === 'Escape') emit('cancel')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="overlay" @click.self="emit('cancel')">
        <div class="modal" role="alertdialog" :aria-label="title">
          <h3 class="modal-title">{{ title }}</h3>
          <p v-if="body" class="modal-body">{{ body }}</p>
          <div class="modal-actions">
            <button class="btn" @click="emit('cancel')">取消</button>
            <button class="btn" :class="danger ? 'btn-danger' : 'btn-primary'" @click="emit('confirm')">
              {{ confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
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
  width: 360px;
  max-width: calc(100vw - 32px);
  padding: 24px;
}
.modal-title {
  margin: 0 0 8px;
  font-size: 17px;
  color: var(--c-text-1);
}
.modal-body {
  margin: 0 0 20px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--c-text-2);
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
  transition: all 0.15s ease;
}
.btn:hover {
  background: var(--c-hover-bg);
}
.btn:active {
  transform: scale(0.96);
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
.btn-danger {
  border-color: var(--c-danger);
  background: var(--c-danger-solid);
  color: #fff;
}
.btn-danger:hover {
  filter: brightness(0.92);
}
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}
.modal-enter-active .modal,
.modal-leave-active .modal {
  transition: transform 0.18s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .modal {
  transform: scale(0.96);
}
</style>
