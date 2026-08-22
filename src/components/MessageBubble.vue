<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { Message } from '../stores/sessions'
import { contentBlocks, contentText, type Block, type SourceItem, type ToolCallBlock, type ToolResultBlock } from '../api/client'
import { renderMarkdown } from '../utils/markdown'
import ToolStepCard from './ToolStepCard.vue'
import SourceCard from './SourceCard.vue'

const props = defineProps<{ message: Message; followingCount?: number }>()
const emit = defineEmits<{ edit: [id: string, text: string]; toggleVersion: [forkId: string] }>()

// REQ-015 编辑态：仅用户消息可编辑
const editing = ref(false)
const draft = ref('')
const editEl = ref<HTMLTextAreaElement | null>(null)
const canSave = computed(() => editing.value && draft.value.trim().length > 0)

// CHG-003 复制整条消息（复制原文，非渲染后 HTML）
const copied = ref(false)

// CHG-007 REQ-032（iter-13 T2）：读时归一化（v1 string ⇒ 单文本段）进同一渲染管线；
// v1/v2 消息同流无差别呈现（逐字零回退）。文本段走 Markdown（REQ-011 改写：仅 text 段），
// 工具调用段渲染步骤卡（结果按 tool_call_id 就地配对；tool_result 段不独立渲染）
const blocks = computed<Block[]>(() => contentBlocks(props.message.content))
const results = computed(() => {
  const map = new Map<string, ToolResultBlock>()
  for (const b of blocks.value) if (b.type === 'tool_result') map.set(b.tool_call_id, b)
  return map
})
const renderedOf = (text: string) => renderMarkdown(text)

// iter-14 T3（design-iter-14 §2.1）：配对 tool_result 含非空 sources 且 status=ok →
// 紧随工具卡渲染引用来源卡（渲染层派生，blocks 数组零新增段类型；缺失/空/≠ok 一律无卡）
function sourcesOf(call: ToolCallBlock): SourceItem[] | null {
  const r = results.value.get(call.tool_call_id)
  return r && r.status === 'ok' && r.sources && r.sources.length > 0 ? r.sources : null
}

// D1 降级引导条（design-iter-14 §3，逐字文案）：search 工具 error/timeout 且消息仍有
// 后续文本段（直答）→ 失败卡之后、直答首段之前渲染 warning 条；渲染层派生不落库
// （派生规则确定性：历史重渲染一致；error 与 timeout 共用一句，诊断详情在工具卡结果区）
function showDegrade(call: ToolCallBlock, index: number): boolean {
  if (call.name !== 'search') return false
  const r = results.value.get(call.tool_call_id)
  if (!r || (r.status !== 'error' && r.status !== 'timeout')) return false
  return blocks.value.slice(index + 1).some((x) => x.type === 'text' && x.text.trim().length > 0)
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 降级：非安全上下文 / 剪贴板 API 不可用时用 execCommand
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

// 事件委托：代码块复制按钮在 v-html 内容里，冒泡到容器统一处理
function onCopy(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest('.code-copy') as HTMLElement | null
  if (!btn) return
  const code = btn.closest('.code-block')?.querySelector('pre code')?.textContent ?? ''
  void copyToClipboard(code).then((ok) => {
    if (!ok) return
    btn.classList.add('copied')
    btn.textContent = '已复制'
    window.setTimeout(() => {
      btn.classList.remove('copied')
      btn.textContent = '复制'
    }, 1500)
  })
}

// CHG-003：复制整条消息原文，短暂反馈「已复制」——文本段空行拼接，工具内容不入（design-iter-13 §2 适配面）
function copyMessage() {
  void copyToClipboard(contentText(props.message.content)).then((ok) => {
    if (!ok) return
    copied.value = true
    window.setTimeout(() => (copied.value = false), 1500)
  })
}

// REQ-015 编辑态交互：进入编辑回填原文本；Enter 确认、Shift+Enter 换行、Esc 取消
function startEdit() {
  draft.value = typeof props.message.content === 'string' ? props.message.content : contentText(props.message.content)
  editing.value = true
  void nextTick(() => editEl.value?.focus())
}

function cancelEdit() {
  editing.value = false
  draft.value = ''
}

function saveEdit() {
  if (!canSave.value) return
  emit('edit', props.message.id, draft.value.trim())
  editing.value = false
}

function onEditKey(e: KeyboardEvent) {
  if (e.isComposing) return // 中文输入法选词回车不保存
  if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    saveEdit()
  }
}
</script>

<template>
  <!-- REQ-027（design-iter-11 §3.1，走查 23）：去全部头像——AI logo 与「我」均不渲染（DOM 级） -->
  <div class="row" :class="message.role">
    <div class="msg-col" :class="message.role">
      <!-- REQ-015：编辑态（仅用户消息）替换气泡为编辑面板 -->
      <div v-if="message.role === 'user' && editing" class="edit-form">
        <textarea
          ref="editEl"
          v-model="draft"
          rows="1"
          class="edit-ta"
          @keydown="onEditKey"
        />
        <div class="edit-hint">
          {{ followingCount ? `保存后，此消息及其后的 ${followingCount} 条回复将被删除并重新生成` : '保存后仅重新生成该条回复' }}
        </div>
        <div class="edit-actions">
          <button class="edit-cancel" @click="cancelEdit">取消</button>
          <button class="edit-save" :disabled="!canSave" @click="saveEdit">保存并重新生成</button>
        </div>
      </div>

      <div v-else class="bubble" :class="message.role">
        <!-- 用户消息保持纯文本（恒 string，design-iter-13 §2 写侧） -->
        <span v-if="message.role === 'user'" class="content">{{ message.content }}</span>
        <!-- AI 回复（REQ-032）：blocks 顺序渲染——文本段走 Markdown 富文本，工具调用段渲染步骤卡；
             顺序 = 事件顺序，不重排、不合并跨工具卡文本段（design-iter-13 §2） -->
        <template v-else>
          <template v-for="(b, i) in blocks" :key="i">
            <div v-if="b.type === 'text'" class="md" v-html="renderedOf(b.text)" @click="onCopy"></div>
            <template v-else-if="b.type === 'tool_call'">
              <ToolStepCard
                :call="b"
                :result="results.get(b.tool_call_id)"
                :live="message.status === 'generating'"
              />
              <!-- 引用来源卡：紧跟 search 工具卡之后、回答首段之前（§2.1 位置 = blocks 顺序自然结果） -->
              <SourceCard v-if="sourcesOf(b)" :sources="sourcesOf(b)!" />
              <!-- D1 降级引导条（§3）：失败/超时且有后续直答文本段；渲染层派生不落库、导出/复制不含 -->
              <div v-if="showDegrade(b, i)" class="degrade-note" role="note">搜索未成功，以下为模型直接回答</div>
            </template>
          </template>
        </template>

        <span v-if="message.status === 'generating'" class="cursor" aria-hidden="true" />
        <span v-if="message.status === 'generating'" class="status-hint">正在生成…</span>
        <span v-else-if="message.status === 'interrupted'" class="pill interrupted">生成中断</span>
        <span v-else-if="message.status === 'stopped'" class="pill stopped">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="1.5" fill="currentColor" /></svg>
          已停止生成
        </span>
        <!-- REQ-030：turn.end(max_steps) 回合级标注（design-iter-13 §3.4，文案逐字） -->
        <span v-if="message.maxSteps && message.status !== 'generating'" class="pill max-steps">已到单回合步数上限</span>
        <!-- CHG-012/REQ-047：turn.end(time_limit) 时长到顶标注（design-iter-18 §4，M43 逐字，沿 maxSteps pill 体例；与步数 pill 互斥，一回合一 pill） -->
        <span v-else-if="message.timeLimit && message.status !== 'generating'" class="pill max-steps">已到研究时长上限</span>
      </div>

      <!-- CHG-003：消息下方操作栏（icon-only，hover 出 tooltip；复制/修改 hover 才显示） -->
      <div v-if="!editing" class="action-row">
        <button class="action-btn" :title="copied ? '已复制' : '复制'" :aria-label="copied ? '已复制' : '复制'" @click="copyMessage">
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
            <path fill="currentColor" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z" />
          </svg>
        </button>
        <button v-if="message.role === 'user'" class="action-btn" title="修改" aria-label="修改" @click="startEdit">
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
            <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
          </svg>
        </button>
        <!-- REQ-019：版本切换用左右箭头 + 计数器（常显，可看出当前版本） -->
        <div v-if="message.forkId" class="version-nav">
          <button class="action-btn" title="上一版本" aria-label="上一版本" @click="emit('toggleVersion', message.forkId!)">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
            </svg>
          </button>
          <span class="version-count">{{ (message.forkIndex ?? 0) + 1 }}/2</span>
          <button class="action-btn" title="下一版本" aria-label="下一版本" @click="emit('toggleVersion', message.forkId!)">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path fill="currentColor" d="M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* REQ-027（走查 23/24/26）：无头像布局——AI 消息全宽无背景，用户消息浅色轻量气泡
   （avatar-bg + text-1：亮暗对比度 13.2:1 / 10.0:1，设计 §3.2 选型结论） */
.row {
  display: flex;
  width: 100%;
  animation: rise 0.25s ease;
}
/* DEF-031 修复（2026-08-17，CEO 走查发现）：design-iter-11 基线「用户消息浅色气泡右对齐」
   ——本规则缺失使用户气泡自 iter-11 起停靠正文列左缘（.row width:100% 架空了外层
   row-wrap 的 justify-content:flex-end） */
.row.user {
  justify-content: flex-end;
}
/* CHG-003：消息列（气泡 + 下方操作栏），宽度由本列约束 */
.msg-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  max-width: 80%;
}
.msg-col.assistant {
  flex: 1;
  max-width: 100%;
}
.msg-col.user {
  align-items: flex-end;
}
.bubble {
  max-width: 100%;
  font-size: 15px;
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
}
.bubble.user {
  background: var(--c-avatar-bg);
  color: var(--c-text-1);
  padding: 10px 14px;
  border-radius: 12px 12px 4px 12px;
}
.bubble.assistant {
  padding: 4px 0;
}
.cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: var(--c-primary-solid);
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: blink 0.9s steps(1) infinite;
}
.status-hint {
  display: block;
  font-size: 12px;
  color: var(--c-text-3);
  margin-top: 4px;
}
.pill.interrupted {
  display: inline-block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--c-warning);
  background: var(--c-warning-l);
  border-radius: 999px;
  padding: 2px 10px;
}
.pill.stopped {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--c-text-2);
  background: var(--c-hover-bg);
  border-radius: 999px;
  padding: 2px 8px;
}
/* REQ-030：步数上限 pill（warning 族——时效性截停，design-iter-13 §3.4） */
.pill.max-steps {
  display: inline-block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--c-warning);
  background: var(--c-warning-l);
  border-radius: 999px;
  padding: 2px 10px;
}
/* iter-14 D1 降级引导条（design-iter-14 §3 逐字）：warning-l 底 + 左缘 3px warning +
   13px warning 字 + padding 8px 12px + 8px 圆角；宽度包裹内容（block 级可见性） */
.degrade-note {
  margin: 4px 0;
  width: fit-content;
  max-width: 100%;
  border-left: 3px solid var(--c-warning);
  background: var(--c-warning-l);
  color: var(--c-warning);
  font-size: 13px;
  line-height: 1.6;
  padding: 8px 12px;
  border-radius: 8px;
}
/* CHG-003：消息下方操作栏——icon-only、hover 出 tooltip；复制/修改 hover 才显示，版本箭头常显 */
.action-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
}
.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--c-text-3);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.msg-col:hover .action-btn {
  opacity: 1;
}
.action-btn:hover {
  background: var(--c-hover-bg);
  color: var(--c-text-1);
}
/* iter-20 T2（REQ-051，design-iter-20 §5.1/§5.2）：触屏（hover:none）操作栏常显 +
 * 44px 命中区（icon 24px 视觉不变，::after 透明扩展）——与 hover:hover 互斥，桌面零触碰 */
@media (hover: none) {
  .action-btn {
    opacity: 1;
    position: relative;
  }
  .action-btn::after {
    content: '';
    position: absolute;
    inset: calc((44px - 100%) / 2);
  }
}
/* iter-20 T2（REQ-049，design-iter-20 §3）：≤480px 用户气泡 max-width 80% → 92%
 * （随列宽自然收缩不横向溢出视口）；>480px 逐像素零变化（媒体查询带界） */
@media (max-width: 480px) {
  .msg-col {
    max-width: 92%;
  }
  .msg-col.assistant {
    max-width: 100%;
  }
}
.version-nav {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: 2px;
}
.version-nav .action-btn {
  opacity: 1; /* 版本切换箭头常显 */
}
.version-count {
  font-size: 12px;
  color: var(--c-text-3);
  min-width: 30px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
/* REQ-015 编辑态：主色描边面板 + 就地回填 textarea + 取消/保存操作栏 */
.edit-form {
  width: 100%;
  background: var(--c-surface);
  border: 1px solid var(--c-primary);
  border-radius: 12px;
  padding: 10px 12px;
  box-shadow: 0 0 0 3px var(--c-focus-ring);
}
.edit-ta {
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  font-size: 15px;
  line-height: 1.6;
  color: var(--c-text-1);
  font-family: inherit;
}
.edit-hint {
  font-size: 12px;
  color: var(--c-text-3);
  margin-top: 6px;
}
.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.edit-cancel {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-surface);
  color: var(--c-text-2);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.edit-cancel:hover {
  border-color: var(--c-primary);
  color: var(--c-primary);
}
.edit-save {
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: 8px;
  background: var(--c-primary-solid);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;
}
.edit-save:hover:not(:disabled) {
  background: var(--c-primary-solid-h);
}
.edit-save:disabled {
  background: var(--c-disabled-bg);
  cursor: not-allowed;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}
</style>

<!-- Markdown 富文本样式（v-html 内容不受 scoped 约束，故独立非 scoped 块；令牌对齐 design/iter-3） -->
<style>
.md {
  font-size: 15px;
  line-height: 1.75;
  color: var(--c-text-1);
  /* DEF-030 修复（2026-08-17，CEO 走查发现）：气泡容器的 pre-wrap（用户纯文本需要）
     曾继承进本容器，把 markdown-it 块间 \n 渲染成整行空行（段间距 34px）。
     段内单换行改由 markdown-it breaks:true 显式 <br> 承载，语义不变 */
  white-space: normal;
}
.md p {
  margin: 0 0 8px;
}
.md p:last-child {
  margin-bottom: 0;
}
.md h1,
.md h2,
.md h3,
.md h4 {
  font-weight: 600;
  color: var(--c-text-1);
  margin: 16px 0 8px;
  line-height: 1.4;
}
.md h1 {
  font-size: 20px;
}
.md h2 {
  font-size: 18px;
}
.md h3 {
  font-size: 16px;
}
.md h4 {
  font-size: 15px;
}
.md ul,
.md ol {
  margin: 0 0 8px;
  padding-left: 24px;
}
.md li {
  margin: 2px 0;
}
.md li::marker {
  color: var(--c-text-3);
}
.md blockquote {
  border-left: 3px solid var(--c-border);
  padding: 2px 12px;
  color: var(--c-text-2);
  margin: 8px 0;
}
.md a {
  color: var(--c-primary);
  text-decoration: none;
}
.md a:hover {
  text-decoration: underline;
}
.md hr {
  border: none;
  border-top: 1px solid var(--c-border);
  margin: 12px 0;
}
.md strong {
  font-weight: 600;
}
.md code {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px;
  background: var(--c-hover-bg);
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--c-text-1);
  word-break: break-all;
}
.md table {
  border-collapse: collapse;
  margin: 8px 0;
  width: 100%;
  font-size: 14px;
}
.md th,
.md td {
  border: 1px solid var(--c-border);
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
}
.md th {
  background: var(--c-subtle-bg);
  font-weight: 500;
  color: var(--c-text-2);
}
.md td {
  color: var(--c-text-1);
}
.md .table-wrap {
  overflow-x: auto;
  margin: 8px 0;
}

.code-block {
  position: relative;
  margin: 12px 0;
}
.code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--c-code-head);
  color: var(--c-code-head-text);
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 12px 12px 0 0;
}
.code-lang {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
}
.code-block pre {
  background: var(--c-code-bg);
  color: var(--c-code-text);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  padding: 12px 16px;
  border-radius: 0 0 12px 12px;
  overflow-x: auto;
  white-space: pre;
  margin: 0;
}
.code-block pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  color: inherit;
  font-size: inherit;
  word-break: normal;
}
.code-copy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: var(--c-code-head-text);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  transition: color 0.15s ease, background 0.15s ease;
}
.code-copy:hover {
  color: var(--c-code-text);
  background: rgba(255, 255, 255, 0.12);
}
/* REQ-011 新增令牌：深底成功反馈绿 #4CC38A（CEO 批准 2026-08-15） */
.code-copy.copied {
  color: var(--c-success-on-dark);
}
</style>
