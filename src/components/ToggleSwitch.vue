<script setup lang="ts">
/**
 * 开关（toggle switch）——iter-14 T3（design-iter-14 §4.2，公司 design-system/components.md v1.3）。
 *
 * 36×20 轨道（开 = --c-primary-solid / 关 = --c-hover-bg）+ 16px 白实体滑块（固定反白，
 * 暗色关态轨道上仍清晰可辨）+ 1px --c-border 描边 + --shadow-1；开态 transform 右移 16px。
 * 语义：button + role="switch" + aria-checked；Enter/Space 原生；:focus-visible 3px 焦点环；
 * 按压不做 scale（轨道小、抖动大于反馈）。零新令牌。
 * 消费方：admin 联网搜索开关行 + 档案「支持工具」第五字段（同一组件两处）。
 */
const props = defineProps<{
  modelValue: boolean
  /** 无文字内容，承载可访问名（内部落到 button 的 aria-label） */
  label: string
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function toggle() {
  if (!props.disabled) emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <button
    type="button"
    class="tsw"
    :class="{ on: modelValue }"
    role="switch"
    :aria-checked="modelValue ? 'true' : 'false'"
    :aria-label="label"
    :disabled="disabled"
    @click="toggle"
  />
</template>

<style scoped>
.tsw {
  position: relative;
  flex: none;
  width: 36px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: var(--c-hover-bg);
  cursor: pointer;
  transition: background 0.15s ease;
  font-family: inherit;
}
.tsw::after {
  content: '';
  position: absolute;
  top: 1.5px;
  left: 1.5px;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  border-radius: 50%;
  background: #fff; /* 固定反白实体（components.md v1.3：不引用 --c-surface——暗色关态会同色不可辨） */
  border: 1px solid var(--c-border);
  box-shadow: var(--shadow-1);
  transition: transform 0.15s ease;
}
.tsw.on {
  background: var(--c-primary-solid);
}
.tsw.on::after {
  transform: translateX(16px);
}
.tsw:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--c-focus-ring);
}
.tsw:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
</style>
