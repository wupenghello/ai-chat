<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import ToggleSwitch from './ToggleSwitch.vue'
import { useMediaQuery } from '../composables/useMediaQuery'

/* iter-20 T2（REQ-049/051，design-iter-20 §3 定夺④/M45）：触控口径——
 * hover:none（CSS 同源媒体特性）下 placeholder = M45「输入消息」、闲置态 Enter hint 不渲染；
 * M40/M41/生成中提示保留（模式与状态语义与输入方式无关）；hover:hover 存量逐字零变化 */
const touch = useMediaQuery('(hover: none)')
const PLACEHOLDER_DESKTOP = '输入消息，Enter 发送，Shift+Enter 换行'
const PLACEHOLDER_TOUCH = '输入消息' // M45
const placeholderText = computed(() => (touch.value ? PLACEHOLDER_TOUCH : PLACEHOLDER_DESKTOP))

const props = defineProps<{ generating?: boolean; hint?: string; researchAvailable?: boolean }>()
const emit = defineEmits<{ send: [text: string, mode?: 'research']; stop: [] }>()

// CHG-012/REQ-047（design-iter-18 §8 样件文案 M38~M42，逐字唯一来源）
const M38 = '深度研究'
const M39 = '深度研究模式开关'
const M40 = '已开启深度研究：发送后 AI 将自动拆解问题、多轮联网搜索并给出带引用的报告，耗时较长'
const M41 = '深度研究暂不可用：需联网搜索可用'
const M42 = '深度研究依赖联网搜索：需要管理员开启搜索并配置密钥，且当前生效档案开启「支持工具」'

const text = ref('')
const el = ref<HTMLTextAreaElement | null>(null)
const canSend = computed(() => !props.generating && text.value.trim().length > 0)

// 深度研究模式开关（§2）：回合级属性，组件本地 ref，不持久化（不写 localStorage / 会话档）
const research = ref(false)
// research_available !== true → 禁用态（§6：前端缺省保守，不确定即禁用）
const researchDisabled = computed(() => props.researchAvailable !== true)

// 可用性翻转前端预防（§2.3 / 走查条 6）：开启态下重取得不可用 → 强制复位 + 禁用
watch(
  () => props.researchAvailable,
  (avail) => {
    if (!avail) research.value = false
  },
)

// 信息行右侧文案状态机（§2.2）：生成中 > 禁用 > 开启 > 关闭
const hintText = computed(() => {
  if (props.generating) return props.hint ?? 'AI 回复生成中，发送暂不可用…'
  if (researchDisabled.value) return M41
  if (research.value) return M40
  // 触屏闲置态：键盘口径文案不渲染（design-iter-20 §3 定夺④）；桌面逐字零变化
  return touch.value ? '' : 'Enter 发送 · Shift+Enter 换行'
})

async function autosize() {
  await nextTick()
  const t = el.value
  if (!t) return
  t.style.height = 'auto'
  t.style.height = Math.min(t.scrollHeight, 160) + 'px'
}

function submit() {
  if (!canSend.value) return
  // 开启态发送携带 mode='research'；关闭态零 mode（现状零变化）
  if (research.value && props.researchAvailable) emit('send', text.value, 'research')
  else emit('send', text.value)
  text.value = ''
  research.value = false // 发送即复位（§2.3 定夺③：submit() 内本地动作，HTTP 失败也已复位）
  void autosize()
}

function onStop() {
  if (props.generating) emit('stop') // 边界：流恰好结束（已非生成态）时忽略，no-op
}

function onKey(e: KeyboardEvent) {
  if (e.isComposing) return // 中文输入法选词回车不发送
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <div class="composer">
    <div class="composer-main">
      <textarea
        ref="el"
        v-model="text"
        rows="1"
        class="ta"
        :placeholder="placeholderText"
        @keydown="onKey"
        @input="autosize"
      />
      <!-- REQ-010：生成中发送按钮原位切换为停止按钮；CHG-003 按钮与 textarea 同排、顶部对齐首行 -->
      <button v-if="generating" class="stop" aria-label="停止生成" @click="onStop">
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <rect width="10" height="10" rx="1.5" fill="currentColor" />
        </svg>
        停止
      </button>
      <button v-else class="send" :disabled="!canSend" aria-label="发送" @click="submit">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M3 20.5 22 12 3 3.5 3 10l13 2-13 2z" />
        </svg>
      </button>
    </div>
    <div class="composer-hint" :title="researchDisabled ? M42 : undefined">
      <div class="hint-left">
        <ToggleSwitch
          :model-value="research"
          :label="M39"
          :disabled="researchDisabled"
          @update:model-value="research = $event"
        />
        <span class="mlabel" :class="{ on: research && !researchDisabled, dis: researchDisabled }">{{ M38 }}</span>
      </div>
      <span v-if="hintText" class="hint-right">{{ hintText }}</span>
    </div>
  </div>
</template>

<style scoped>
.composer {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 12px;
  padding: 12px;
  box-shadow: var(--shadow-1);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.composer:focus-within {
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-focus-ring);
}
.composer-main {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.ta {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  font-size: 14px;
  line-height: 1.6;
  color: var(--c-text-1);
  max-height: 160px;
  font-family: inherit;
  padding-top: 7px; /* 让首行文字与 36px 按钮视觉居中（CHG-003 顶部对齐首行） */
}
.ta::placeholder {
  color: var(--c-text-3);
}
/* CHG-012/REQ-047（design-iter-18 §2.1）：信息行由单行文本改左右布局——
   左端 = 模式开关簇（ToggleSwitch + 旁置标签），右端 = hint 文案（margin-left:auto 右对齐）；
   输入行（textarea + 发送/停止钮）零改动 */
.composer-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  min-height: 20px;
}
.hint-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* 旁置标签 M38（§2.1）：13px/500，随态变色（关 = text-2 / 开 = primary / 禁 = text-3） */
.mlabel {
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text-2);
  transition: color 0.15s ease;
}
.mlabel.on {
  color: var(--c-primary);
}
.mlabel.dis {
  color: var(--c-text-3);
}
.hint-right {
  margin-left: auto;
  font-size: 12px;
  color: var(--c-text-3);
  text-align: right;
}
.send {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: none;
  background: var(--c-primary-solid);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.send:hover:not(:disabled) {
  background: var(--c-primary-solid-h);
}
.send:active:not(:disabled) {
  transform: scale(0.94);
}
.send:disabled {
  background: var(--c-disabled-bg);
  cursor: not-allowed;
}
/* REQ-010：停止按钮（design-iter-2 已基线：红实底 + 白字 + 方块图标） */
.stop {
  flex: none;
  height: 36px;
  padding: 0 16px;
  border: none;
  border-radius: 8px;
  background: var(--c-danger-solid);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background 0.15s ease, transform 0.1s ease;
}
.stop:hover {
  background: var(--c-danger-solid-h);
}
.stop:active {
  background: var(--c-danger-solid-h);
  transform: scale(0.94);
}

/* ---- iter-20 T2（REQ-051，design-iter-20 §5.2）：发送/停止钮 44px 命中区分类口径 ----
 * ≤768px：36px 视觉不变 + ::after 透明热区扩至 44×44；≤480px：视觉放大 44×44（主操作钮）；
 * >768px（hover:hover 桌面）36px 逐像素零变化（媒体查询带界，桌面规则面零触碰） */
@media (max-width: 768px) {
  .send,
  .stop {
    position: relative;
  }
  .send::after,
  .stop::after {
    content: '';
    position: absolute;
    inset: calc((44px - 100%) / 2);
  }
}
@media (max-width: 480px) {
  .send {
    width: 44px;
    height: 44px;
  }
  .stop {
    height: 44px;
  }
}
</style>
