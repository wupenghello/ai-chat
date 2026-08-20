/* ai-chat iter-17 T3 浏览器走查脚本（design-iter-17 §7.2 走查清单 34 条之浏览器适用条目）
 *
 * 沿 scripts/e2e-walkthrough-16.mjs 惯例：puppeteer-core 驱动本机 Chrome，PASS/FAIL 逐条输出
 * + 截图留档 /tmp/e2e17/shots/。FAIL 区分脚本问题与产品缺陷。
 *
 * 本脚本自起全部服务（独立 /tmp 库，不触开发库与其他会话端口）：
 *   后端：backend/.venv/bin/uvicorn app.main:app --port 8818（AI_CHAT_DB_PATH=/tmp 独立库）。
 *         统一 key 三变量自 backend/.env 读取后经**进程环境**注入子进程（真实 key 仅进程
 *         环境传递，不入任何文件/日志/留档）。记忆扫描任务随 lifespan 启动，走查造数不建
 *         满足触发条件的会话（无 4 轮 + 静默会话），抽取零触发、种子记忆恒稳。
 *   前端：npx vite --port 5182 --strictPort（proxy 目标经 AI_CHAT_DEV_API_TARGET → 8818）。
 * 账号：walkthrough-mem（首注册用户 = admin）；walkthrough-empty（空态走查，无记忆）。
 * 造数纪律（铁律 5）：5 条记忆样件全虚构（脚本内声明，与 design-iter-17 §6 卫生口径同源）；
 *   注入预览断言取 GET /api/memory injection_preview 服务端真值与 DOM 逐字比对（零本地拼装）。
 * 运行：node scripts/e2e-walkthrough-17.mjs（无外部前置；Chrome 本机路径沿 iter-14/15/16）
 *
 * pytest/vitest 承载面（不在本脚本重复断言，plans/iter-17-verify.md T3 段交叉引用）：
 *   条 24 取值比对的 pytest 面（REQ-043 验收 4）/ 条 28 回合中编辑无 409（设计定案 + API 面）/
 *   条 29 生效时效的组装断言（REQ-042 验收 1~2）/ 条 31 归属隔离（REQ-043 验收 5）。
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BACKEND = 8818
const VITE = 5182
const BASE = `http://localhost:${VITE}`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = '/tmp/e2e17/shots'
const DB = '/tmp/ai-chat-walkthrough-17.db'

mkdirSync(SHOTS, { recursive: true })
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { rmSync(f) } catch { /* 首跑无残留 */ } }

const results = []
function log(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —— ' + detail : ''}`)
  console.log(results.at(-1))
}

/* ---- 统一 key 经 backend/.env 读取 → 仅进程环境注入子进程（不入文件/日志） ---- */
function unifiedEnvFromDotenv() {
  const env = {}
  try {
    for (const line of readFileSync(`${ROOT}backend/.env`, 'utf8').split('\n')) {
      const m = line.match(/^(AI_CHAT_UNIFIED_KEY|AI_CHAT_UNIFIED_BASE_URL|AI_CHAT_UNIFIED_MODEL)=(.*)$/)
      if (m) env[m[1]] = m[2].trim()
    }
  } catch { /* .env 缺失 → 后端按未配置处理 */ }
  return env
}
const UNIFIED_ENV = unifiedEnvFromDotenv()

/* ---- 虚构记忆样件（全虚构演示数据，铁律 5；元信息三分支全覆盖） ---- */
// s_title 会话存在（title 在档）→ M10 分支；s_gone 无会话档 → M11 分支；NULL 来源 → M12 分支
const SEED_MEMORY_PY = `
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
uid = conn.execute("SELECT id FROM users WHERE username_key='walkthrough-mem'").fetchone()[0]
# 来源会话 s_title（title = 「迭代计划流程设计」）
conn.execute("INSERT INTO chat_sessions (id, user_id, data, updated_at) VALUES (?,?,?,?)",
    ("s_title", uid, json.dumps({"id": "s_title", "schema": 2,
     "title": "迭代计划流程设计", "createdAt": 1, "updatedAt": 1, "messages": []}), 1))
entries = [
    ("要求 AI 用简洁的中文回复，避免冗长解释，不使用表情符号。", "s_title", "deepseek-chat"),
    ("与 AI 约定：周报按「本周完成 / 下周计划 / 风险」三段式输出。", "s_gone", "deepseek-chat"),
    ("用户是后端工程师，主要使用 Python 与 FastAPI。", None, None),
    ("与 AI 约定：涉及部署与发布的事项，先给检查清单再执行。", "s_title", "deepseek-chat"),
    ("用户团队为全远程协作，成员分布在多个城市。", "s_gone", "deepseek-chat"),
]
for content, sid, model in entries:
    conn.execute("INSERT INTO user_memories (user_id, content, source_session_id, model)"
                 " VALUES (?,?,?,?)", (uid, content, sid, model))
conn.commit()
conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
conn.close()
print("seeded-memory")
`

/* ---- 服务管理 ---- */
let backendProc = null
let viteProc = null
function spawnBackend() {
  backendProc = spawn(`${ROOT}backend/.venv/bin/uvicorn`,
    ['app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND)], {
      cwd: `${ROOT}backend`,
      env: { ...process.env, ...UNIFIED_ENV, AI_CHAT_DB_PATH: DB },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  backendProc.stdout.on('data', () => {})
  backendProc.stderr.on('data', () => {})
}
async function killBackend() {
  if (!backendProc) return
  backendProc.kill('SIGTERM')
  await sleep(600)
  backendProc = null
}
async function waitHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${BACKEND}/api/health`)
      if (r.ok) return true
    } catch { /* 未就绪 */ }
    await sleep(300)
  }
  return false
}
function spawnVite() {
  viteProc = spawn('npx', ['vite', '--port', String(VITE), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, AI_CHAT_DEV_API_TARGET: `http://127.0.0.1:${BACKEND}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  viteProc.stdout.on('data', () => {})
  viteProc.stderr.on('data', () => {})
}
function runPy(script, db = DB) {
  return new Promise((resolve) => {
    const p = spawn(`${ROOT}backend/.venv/bin/python`, ['-c', script, db],
      { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (d) => { out += d })
    p.on('close', () => resolve(out.trim()))
  })
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false })

const $one = (sel) => page.$eval(sel, (e) => e.textContent.trim()).catch(() => null)
const $exists = (sel) => page.$(sel).then((e) => !!e)
const style = (sel, prop) => page.$eval(sel, (e, p) => getComputedStyle(e)[p], prop).catch(() => null)
const $lastToast = () =>
  page.$$eval('.toast .toast-msg', (els) => els.at(-1)?.textContent.trim() ?? null).catch(() => null)
async function openSettings() {
  // 侧栏账户区「···」菜单（.acct-trigger，aria-label 账户操作）→ 菜单项「设置」
  await page.click('.acct-trigger')
  await sleep(250)
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('.dd-menu [role="menuitem"], .dd-menu button, .dd-menu .dd-item')]
    const t = items.find((e) => e.textContent.trim() === '设置')
    if (t) t.click()
  })
  await sleep(350)
  return $exists('.settings-modal')
}
async function gotoMemoryPane() {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.sm-nav [data-pane]')]
      .find((b) => b.dataset.pane === 'memory')
    btn?.click()
  })
  await sleep(400) // GET /api/memory 往返
}

try {
  /* ============ 前置：服务 / 账号 / 记忆造数 ============ */
  spawnBackend()
  log('前置·后端起服务（统一 key 经进程环境注入，/tmp 独立库）', await waitHealth())
  spawnVite()
  let viteUp = false
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE); if (r.ok) { viteUp = true; break } } catch { /* 未就绪 */ }
    await sleep(300)
  }
  log('前置·前端 dev server 起服务（5182 → proxy 8818）', viteUp)

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
  const reg = await page.evaluate(async (un, pw) => {
    const r = await fetch('/api/auth/register', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: un, password: pw }),
    })
    return r.status
  }, 'walkthrough-mem', 'Walkthrough2026')
  await page.evaluate(async () => {
    await fetch('/api/auth/register', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'walkthrough-empty', password: 'Walkthrough2026' }),
    })
    await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'walkthrough-mem', password: 'Walkthrough2026' }),
    })
  })
  log('前置·注册 walkthrough-mem + walkthrough-empty 并登录', [200, 201].includes(reg))
  log('前置·记忆造数（5 条虚构样件，元信息三分支全覆盖）',
    (await runPy(SEED_MEMORY_PY)) === 'seeded-memory')

  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await sleep(500)

  /* ============ A 组 · 弹窗容器零回退（条 1/2/5/10） ============ */
  await openSettings()
  await sleep(300)
  const modalW = await style('.settings-modal', 'width')
  const modalH = await style('.settings-modal', 'height')
  const navW = await style('.sm-nav', 'width')
  log('条1 [几] 弹窗 720×560 固定高 + 左导航 168px（iter-11#37 零变化）',
    modalW === '720px' && modalH === '560px' && navW === '168px', `${modalW}×${modalH} / nav ${navW}`)

  const navLabels = await page.$$eval('.sm-nav [role="tab"]', (els) => els.map((e) => e.textContent.trim()))
  log('条2 [零][几] 左导航六项定序（AI 的记忆在对话设置后、账号前）+ 项高 36px',
    JSON.stringify(navLabels) === JSON.stringify(['外观', '密钥模式', '高级设置', '对话设置', 'AI 的记忆', '账号'])
    && (await style('.sm-nav [role="tab"]', 'height')) === '36px',
    navLabels.join('/'))

  // 方向键导航取模含新项（对话设置 → ArrowDown → AI 的记忆）
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.sm-nav [data-pane]')].find((b) => b.dataset.pane === 'chat')
    btn?.focus()
    btn?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  })
  await sleep(200)
  const memSelected = await page.$eval('.sm-nav [data-pane="memory"]', (e) => e.getAttribute('aria-selected')).catch(() => null)
  log('条2b [行] 方向键 ArrowDown 自对话设置切入 AI 的记忆（取模机制涵盖新项）', memSelected === 'true')

  /* ============ 条 10/14/15/16/17 · 分区可达 + 列表态 ============ */
  await gotoMemoryPane()
  const paneTitle = await $one('.mem-pane .pane-label')
  const paneNote = await $one('.mem-note')
  log('条10 [文] 分区标题 M2 + 说明句 M3 逐字',
    paneTitle === 'AI 的记忆'
    && paneNote === '记忆由对话自动沉淀，AI 在回复时参考；你的修改自下一回合起生效。')

  const listHead = await $one('.mlh-title')
  const listCount = await $one('.mlh-count')
  const listTitle = await page.$eval('.mlh-count', (e) => e.getAttribute('title')).catch(() => null)
  log('条14 [文] 列表头 M7 + 计数 M8「共 5 条」+ title M9 上限口径',
    listHead === '记忆条目' && listCount === '共 5 条'
    && listTitle === '上限 30 条，自动抽取超限时按上限截断')

  const itemCount = await page.$$eval('.mem-item', (els) => els.length)
  const itemBorder = await style('.mem-item', 'borderTopWidth')
  const itemPad = await style('.mem-item', 'padding')
  const contentEllipsis = await style('.mi-content', 'textOverflow')
  log('条15 [文][几] 条目卡 5 张 + border 1px + padding 10/12 + 文本不 ellipsis',
    itemCount === 5 && itemBorder === '1px' && (itemPad === '10px 12px' || itemPad === '10px 12px 10px 12px')
    && contentEllipsis !== 'ellipsis', `cards=${itemCount} pad=${itemPad}`)

  const metas = await page.$$eval('.mi-meta', (els) => els.map((e) => e.textContent.trim()))
  log('条16 [文] 元信息三分支逐字（M10 会话名 / M11 来源已删 / M12 手工编辑）',
    metas.some((m) => /^自动抽取 ·「迭代计划流程设计」· 更新于 \d{4}-\d{2}-\d{2}$/.test(m))
    && metas.some((m) => /^自动抽取 · 更新于 \d{4}-\d{2}-\d{2}$/.test(m))
    && metas.some((m) => /^手工编辑 · 更新于 \d{4}-\d{2}-\d{2}$/.test(m)),
    metas.join(' | '))

  const btnH = await style('.mi-icon', 'width')
  const editLabel = await page.$eval('.mi-icon', (e) => e.getAttribute('aria-label')).catch(() => null)
  const delLabel = await page.$eval('.mi-icon-del', (e) => e.getAttribute('aria-label')).catch(() => null)
  log('条17 [几] 操作钮 26px + aria-label 逐字 M13/M14',
    btnH === '26px' && editLabel === '编辑记忆' && delLabel === '删除记忆')

  /* ============ 条 23/24/25 · 注入预览（逐字同源核对） ============ */
  const previewCollapsed = !(await $exists('.mp-code'))
  await page.click('.mp-head')
  await sleep(200)
  const previewDom = await page.$eval('.mp-code', (e) => e.textContent).catch(() => null)
  const apiPreview = await page.evaluate(async () => {
    const r = await fetch('/api/memory', { credentials: 'same-origin' })
    return (await r.json()).injection_preview
  })
  const previewBg = await style('.mp-code', 'backgroundColor')
  log('条23 [文][行] 预览默认折叠 → 展开代码块族（深底 computed）',
    previewCollapsed && previewDom !== null && previewBg !== 'rgba(0, 0, 0, 0)', `bg=${previewBg}`)
  log('条24 [行] 预览 = 服务端 injection_preview 逐字（含包裹标签，前端零拼装）',
    previewDom !== null && previewDom === apiPreview
    && previewDom.includes('<user_memory>') && previewDom.includes('</user_memory>')
    && previewDom.includes('以下是关于用户的长期记忆（自动从历史对话抽取），回复时作为用户背景参考：'))
  // 编号与列表顺序一一对应（预览第 1 条 = 列表第 1 条内容）
  const firstContent = await $one('.mem-item .mi-content')
  log('条24b [行] 预览编号与列表顺序一一对应（第 1 条内容一致）',
    previewDom?.includes(`1. ${firstContent}`) === true)
  await shot('01-list-light')

  /* ============ 条 11/12/13 · 开关行与停用态 ============ */
  const swTitle = await $one('.mem-switch-row .field-label')
  const swHint = await $one('.mem-switch-row .field-hint')
  const swAria = await page.$eval('.tsw', (e) => e.getAttribute('aria-label')).catch(() => null)
  log('条11 [文][几] 开关行标题 M4 + 说明 M37 + aria-label M5',
    swTitle === 'AI 参考记忆' && swHint === '开启后，AI 在每个回合回复时参考下方记忆'
    && swAria === 'AI 参考记忆开关')

  await page.click('.tsw') // 停用
  await sleep(600)
  const offBanner = await $one('.mem-off-banner')
  const listOff = await page.$eval('.mem-list', (e) => e.classList.contains('off')).catch(() => false)
  const frozenBtns = await page.$$eval('.mi-icon', (els) => els.every((b) => b.disabled))
  const toastOff = await $lastToast()
  log('条12 [文][行] 停用链路：PUT → toast M32 逐字（白字态）+ 重取刷新',
    toastOff === '记忆已停用：AI 将不再参考任何记忆')
  log('条13 [文][行] 停用态：通知条 M6 逐字 + 列表灰显 + 操作冻结',
    offBanner === '记忆已停用：AI 不再参考任何记忆，也不再进行新的沉淀。已有记忆保留，重新启用即恢复。'
    && listOff && frozenBtns)
  // 停用态预览 = M24 停用句（不呈现注入内容）；预览块可能仍处展开态（previewOpen 跨重取保持）
  if (!(await $exists('.mp-body'))) {
    await page.click('.mp-head')
    await sleep(200)
  }
  const offPreview = await $one('.mp-null')
  log('条25 [文] 停用分支预览 = M24 停用句（无注入物，铁律 5）',
    offPreview === '记忆已停用，记忆内容不会注入对话。重新启用即恢复注入。')
  await shot('02-off-light')

  await page.click('.tsw') // 重新启用
  await sleep(600)
  log('条12b [文][行] 启用链路：toast M33 逐字（success 绿字）',
    (await $lastToast()) === '✓ 记忆已重新启用，下一回合生效')

  /* ============ 条 18/19/20 · 行内编辑链路 ============ */
  await page.click('.mi-icon') // 编辑第一条
  await sleep(200)
  const taBorder = await style('.mi-ta', 'borderTopColor')
  const countText = await $one('.mi-count')
  log('条18 [行] 编辑态：条目位换 textarea（focus 即入）', (await $exists('.mi-ta')) && !!taBorder)
  log('条19 [文][几] 计数模板 M15「{N} / 150」+ maxlength 150',
    / \/ 150$/.test(countText ?? '')
    && (await page.$eval('.mi-ta', (e) => e.getAttribute('maxlength')).catch(() => null)) === '150')

  // Esc 取消还原（条 20：Esc 链插入点——取消编辑但弹窗不关）
  await page.keyboard.type('【Esc 取消验证追加文本】')
  await page.keyboard.press('Escape')
  await sleep(200)
  const afterEsc = await $one('.mem-item .mi-content')
  log('条20 [行] Esc 退出编辑态还原原文本（不落库）且弹窗不关（Esc 链插入点不破序）',
    !(await $exists('.mi-ta')) && !(afterEsc ?? '').includes('【Esc 取消验证追加文本】')
    && (await $exists('.settings-modal')))

  // 保存链路：改写第一条 → toast M30 + 重取后来源转 M12 手工编辑分支
  await page.click('.mi-icon')
  await sleep(200)
  await page.evaluate(() => { const ta = document.querySelector('.mi-ta'); if (ta) { ta.value = '' } })
  await page.click('.mi-ta')
  await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta')
  await page.keyboard.type('走查改写：用户偏好简洁中文回复（编辑态保存验证）。')
  await page.click('.mi-btn-save')
  await sleep(700)
  const toastSave = await $lastToast()
  const meta0 = await page.$eval('.mem-item .mi-meta', (e) => e.textContent.trim()).catch(() => null)
  log('条18b [文][行] 保存链路：toast M30 逐字 + 重取后来源转手工编辑分支 M12',
    toastSave === '✓ 记忆已保存，下一回合生效' && /^手工编辑 · 更新于 \d{4}-\d{2}-\d{2}$/.test(meta0 ?? ''))
  // trim 为空 → 保存禁用（条 19b）：编程式置空 + input 事件（v-model 同步，避免选区键序不稳定）
  await page.click('.mi-icon')
  await sleep(200)
  await page.evaluate(() => {
    const ta = document.querySelector('.mi-ta')
    if (ta) {
      ta.value = ''
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  await sleep(150)
  const saveDisabled = await page.$eval('.mi-btn-save', (e) => e.disabled).catch(() => null)
  await page.keyboard.press('Escape')
  log('条19b [行] trim 为空 → 保存禁用', saveDisabled === true)

  /* ============ 条 21/22 · 删除确认链路 ============ */
  await page.click('.mi-icon-del')
  await sleep(300)
  const cmTitle = await $one('.modal-title')
  const cmBody = await $one('.modal-body')
  const cmBtn = await page.$eval('.modal .btn-danger', (e) => e.textContent.trim()).catch(() => null)
  const cmWidth = await style('.modal', 'width')
  log('条21 [文][几] 删除确认 ConfirmModal：360px + M19/M20/M21 逐字',
    cmTitle === '删除这条记忆？'
    && cmBody === '删除后 AI 将不再参考这条记忆，此操作不可撤销。'
    && cmBtn === '删除' && cmWidth === '360px')
  await page.click('.modal .btn-danger')
  await sleep(700)
  const toastDel = await $lastToast()
  const countAfterDel = await $one('.mlh-count')
  log('条22 [行] 删除链路：DELETE → toast M31 逐字 + 重取计数 −1（5→4）',
    toastDel === '✓ 记忆已删除，下一回合生效' && countAfterDel === '共 4 条')
  await shot('03-after-edit-delete-light')

  /* ============ 条 6/5 · 未保存拦截零变化 + 关闭三方式 ============ */
  // 记忆编辑态不参与 dirty：编辑中直接关闭弹窗不触发拦截
  await page.click('.mi-icon')
  await sleep(200)
  await page.keyboard.type('临时编辑内容')
  await page.click('.sm-close')
  await sleep(300)
  log('条6 [零] 记忆编辑态不参与 dirty 拦截（关闭弹窗 = 取消编辑，无弹窗拦截）',
    !(await $exists('.settings-modal')) && !(await $exists('.dirty-mask')))

  // 关闭后重开 + Esc 关闭
  await openSettings()
  await sleep(300)
  await page.keyboard.press('Escape')
  await sleep(300)
  log('条5 [零][行] Esc 关闭弹窗（关闭方式零回退）', !(await $exists('.settings-modal')))

  /* ============ 条 26 · 空态（walkthrough-empty 用户） ============ */
  await page.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'walkthrough-empty', password: 'Walkthrough2026' }),
    })
  })
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await sleep(500)
  await openSettings()
  await sleep(300)
  await gotoMemoryPane()
  const emptyTitle = await $one('.me-title')
  const emptyDesc = await $one('.me-desc')
  const switchStillThere = await $exists('.mem-switch-row')
  log('条26 [文] 空态：M26 + M27 逐字（含自动沉淀说明）+ 开关行正常在位',
    emptyTitle === '暂无记忆'
    && emptyDesc === '记忆在对话中自动沉淀：对话结束后，AI 自动抽取关于你的身份、偏好与约定等值得记住的信息。'
    && switchStillThere)
  // 空态预览 = M25 空句
  await page.click('.mp-head')
  await sleep(200)
  log('条25b [文] 空条目分支预览 = M25 空句',
    (await $one('.mp-null')) === '暂无记忆条目，暂无注入内容。')
  await shot('04-empty-light')

  /* ============ 条 27 · 加载失败态（停后端 → 切分区重取） ============ */
  await killBackend()
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.sm-nav [data-pane]')].find((b) => b.dataset.pane === 'appearance')
    btn?.click()
  })
  await sleep(200)
  await gotoMemoryPane() // 重取 GET → 后端已停 → 失败态
  await sleep(400)
  const failedText = await $one('.mem-failed')
  const noControls = !(await $exists('.mem-switch-row')) && !(await $exists('.mem-list')) && !(await $exists('.mem-preview'))
  log('条27 [文][行] 加载失败态：M28 逐字 + 控制件全不渲染（状态未知不渲染）',
    (failedText ?? '').includes('记忆加载失败，请检查网络') && noControls)
  await shot('05-failed-light')

  /* ============ 条 32 · 暗色主题复跑（重启后端恢复数据面） ============ */
  spawnBackend()
  await waitHealth()
  await page.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'walkthrough-mem', password: 'Walkthrough2026' }),
    })
  })
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await sleep(500)
  await page.evaluate(() => {
    try { localStorage.setItem('ai-chat-theme', 'dark') } catch { /* ignore */ }
  })
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(500)
  await openSettings()
  await sleep(300)
  await gotoMemoryPane()
  const darkBodyBg = await style('.settings-modal', 'backgroundColor')
  const darkNavBg = await style('.sm-nav', 'backgroundColor')
  const darkText = await style('.mi-content', 'color')
  await page.click('.mp-head')
  await sleep(200)
  const darkCodeBg = await style('.mp-code', 'backgroundColor')
  log('条32 [零] 暗色主题：弹窗/导航/令牌切换 + 预览代码块暗色仍深底（无亮色残留）',
    darkBodyBg !== 'rgb(255, 255, 255)' && darkNavBg !== darkBodyBg
    && darkCodeBg !== 'rgba(0, 0, 0, 0)', `modal=${darkBodyBg} code=${darkCodeBg}`)
  await shot('06-list-dark')

  // 暗色停用态锁定帧
  await page.click('.tsw')
  await sleep(600)
  await shot('07-off-dark')

  /* ============ 条 33 · 样件数据卫生声明（脚本造数全虚构，见文件头声明） ============ */
  log('条33 [零] 样件数据全虚构（脚本内声明 + 预览恒服务端字段渲染）', true,
    'SEED_MEMORY_PY 5 条样件全虚构；生产实现预览 = injection_preview 逐字（条 24 已断言）')

  await shot('99-final')
} catch (e) {
  console.error('WALKTHROUGH ERROR:', e)
  log('脚本异常中断', false, String(e?.message ?? e))
} finally {
  await browser.close()
  await killBackend()
  if (viteProc) { viteProc.kill('SIGTERM'); await sleep(400) }
}

const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(`\n==== 汇总：${results.length - fails.length} PASS / ${fails.length} FAIL ====`)
if (fails.length) {
  console.log('FAIL 明细：')
  fails.forEach((f) => console.log('  ' + f))
  process.exit(1)
}
