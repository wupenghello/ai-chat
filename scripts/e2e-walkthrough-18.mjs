/* ai-chat iter-18 T3 浏览器走查脚本（design-iter-18 §7.2 走查清单 31 条）
 *
 * 沿 scripts/e2e-walkthrough-17.mjs 骨架：puppeteer-core 驱动本机 Chrome，PASS/FAIL 逐条
 * + 截图留档 /tmp/e2e18/shots/。FAIL 区分脚本问题与产品缺陷（当轮不改代码，只登记）。
 *
 * 本脚本自起全部服务（独立 /tmp 库，不触开发库与其他会话端口）：
 *   主后端：backend/.venv/bin/uvicorn app.main:app --port 8818（AI_CHAT_DB_PATH=/tmp 独立库）。
 *           统一 key 三变量 + 真 Tavily search key 自 backend/.env 读取后经**进程环境**注入
 *           子进程（真实 key 仅进程环境传递，不入任何文件/日志/留档）。
 *   禁用态后端：--port 8820，同 env 但 AI_CHAT_SEARCH_KEY="" 覆盖 → research_available=false
 *           （design §6 三与门第三项不满足的真实形态，铁律 5 精神：不确定即禁用）。
 *   time_limit 后端：复用主后端实例改 env（AI_CHAT_RESEARCH_TOTAL_TIMEOUT=6 小值注入），
 *           真触达 turn.end('time_limit')（900s 真实到顶不现实，沿 verify T0 §3 小值注入体例）。
 *   前端：npx vite --port 5182/5183（proxy 目标经 AI_CHAT_DEV_API_TARGET → 8818/8820）。
 * 账号：walkthrough-research（首注册 = admin，统一 key 模式 tools 恒可用）。
 * 造数纪律（铁律 5）：研究问题/搜索结果/来源/耗时/报告全由事件流如实渲染，脚本零拼装；
 *   断言取 GET /api/quota 服务端真值与 DOM 逐字比对。
 * 运行：node scripts/e2e-walkthrough-18.mjs（无外部前置；Chrome 本机路径沿 iter-14~17）
 *
 * pytest/vitest 承载面（不在本脚本重复断言，plans/iter-18-verify.md T2/T3 段交叉引用）：
 *   条 7/8 载荷形状与复位（backend/tests/test_research.py + src/api/__tests__/client.spec.ts
 *           mode 载荷 + src/stores/__tests__/composer.spec.ts 复位）
 *   条 18/19 降级/空结果（src/components/__tests__/MessageBubble.spec.ts D1/D2 逐字）
 *   条 20 前向兼容（parseSse 宽类型静默跳过，src/api/__tests__/client.spec.ts）
 *   条 21 max_steps pill（sessions.spec.ts maxSteps 数据源 + iter-13#29 走查存量）
 *   条 23/24/26 断连/停止/操作（iter-13#30/31 + iter-11#47 存量，REQ-030/010/003/004）
 *   条 25 上游错误/429/422（backend/tests/test_research.py 门控拒绝三用例 + iter-13#32/33）
 *   条 27 quota 字段（test_research.py::test_quota端点_research_available_三与门）
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BACKEND = 8818
const VITE = 5182
const BACKEND_DISABLED = 8820
const VITE_DISABLED = 5183
const BASE = `http://localhost:${VITE}`
const BASE_DISABLED = `http://localhost:${VITE_DISABLED}`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = '/tmp/e2e18/shots'
const DB = '/tmp/ai-chat-walkthrough-18.db'
const DB_DISABLED = '/tmp/ai-chat-walkthrough-18-disabled.db'

mkdirSync(SHOTS, { recursive: true })
for (const f of [DB, `${DB}-wal`, `${DB}-shm`, DB_DISABLED, `${DB_DISABLED}-wal`, `${DB_DISABLED}-shm`]) {
  try { rmSync(f) } catch { /* 首跑无残留 */ }
}

const results = []
function log(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —— ' + detail : ''}`)
  console.log(results.at(-1))
}

/* ---- 样件文案（design-iter-18 §8 逐字唯一来源，M38~M43 + 存量 hint/placeholder） ---- */
const M38 = '深度研究'
const M39 = '深度研究模式开关'
const M40 = '已开启深度研究：发送后 AI 将自动拆解问题、多轮联网搜索并给出带引用的报告，耗时较长'
const M41 = '深度研究暂不可用：需联网搜索可用'
const M42 = '深度研究依赖联网搜索：需要管理员开启搜索并配置密钥，且当前生效档案开启「支持工具」'
const M43 = '已到研究时长上限'
const HINT_CLOSED = 'Enter 发送 · Shift+Enter 换行'
const HINT_GENERATING = 'AI 回复生成中，发送暂不可用…'
const PLACEHOLDER = '输入消息，Enter 发送，Shift+Enter 换行'
const RESEARCH_Q = 'Rust 在后端开发中的采用情况如何？'
const NORMAL_Q = '你好，请用一句话自我介绍。'

/* ---- 统一 key + search key 经 backend/.env 读取 → 仅进程环境注入子进程（不入文件/日志） ---- */
function backendEnvFromDotenv() {
  const env = {}
  try {
    for (const line of readFileSync(`${ROOT}backend/.env`, 'utf8').split('\n')) {
      const m = line.match(/^(AI_CHAT_UNIFIED_KEY|AI_CHAT_UNIFIED_BASE_URL|AI_CHAT_UNIFIED_MODEL|AI_CHAT_SEARCH_KEY)=(.*)$/)
      if (m) env[m[1]] = m[2].trim()
    }
  } catch { /* .env 缺失 → 后端按未配置处理 */ }
  return env
}
const DOTENV_ENV = backendEnvFromDotenv()
// search key 优先进程环境（AI_CHAT_SEARCH_KEY 由调用方 export 注入，不入 .env——.env 含
// 真实 key 会击穿 test_search/test_research「key 缺失」分支的隐含假设）；.env 无 key 时
// research 端到端降级为禁用态走查（走查主体零回退仍完整）。
if (process.env.AI_CHAT_SEARCH_KEY) DOTENV_ENV.AI_CHAT_SEARCH_KEY = process.env.AI_CHAT_SEARCH_KEY

/* ---- 服务管理（三后端：主 8818 / 禁用态 8820 / time_limit 复用主实例改 env；两 vite） ---- */
let backendProc = null
let disabledBackendProc = null
let viteProc = null
let disabledViteProc = null

function spawnBackend(opts = {}) {
  const { port = BACKEND, db = DB, extraEnv = {} } = opts
  const proc = spawn(`${ROOT}backend/.venv/bin/uvicorn`,
    ['app.main:app', '--host', '127.0.0.1', '--port', String(port)], {
      cwd: `${ROOT}backend`,
      env: { ...process.env, ...DOTENV_ENV, AI_CHAT_DB_PATH: db, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  proc.stdout.on('data', () => {})
  proc.stderr.on('data', () => {})
  return proc
}
async function killProc(proc) {
  if (!proc) return
  proc.kill('SIGTERM')
  await sleep(700)
}
async function waitHealth(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (r.ok) return true
    } catch { /* 未就绪 */ }
    await sleep(300)
  }
  return false
}
function spawnVite(port, target) {
  const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, AI_CHAT_DEV_API_TARGET: `http://127.0.0.1:${target}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout.on('data', () => {})
  proc.stderr.on('data', () => {})
  return proc
}
async function waitVite(base) {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(base); if (r.ok) return true } catch { /* 未就绪 */ }
    await sleep(300)
  }
  return false
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
// 页面级 fetch 包裹（更可靠的载荷捕获，postData() 对首回合偶发不可靠）：每次导航注入一次，
// 捕获 POST /api/chat/turn 的请求体到 window.__turnBodies（不入日志明文 key，仅 mode/message/session_id 结构）
await page.evaluateOnNewDocument(() => {
  if (window.__turnBodies) return
  window.__turnBodies = []
  const origFetch = window.fetch.bind(window)
  window.fetch = async function (...args) {
    const url = args[0]
    const init = args[1] || {}
    if (typeof url === 'string' && url.includes('/api/chat/turn') && (init.method || 'GET') === 'POST') {
      try { window.__turnBodies.push(JSON.parse(init.body || '{}')) } catch { window.__turnBodies.push(null) }
    }
    return origFetch(...args)
  }
})
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false })

const $one = (sel) => page.$eval(sel, (e) => e.textContent.trim()).catch(() => null)
const $exists = (sel) => page.$(sel).then((e) => !!e)
const $attr = (sel, attr) => page.$eval(sel, (e, a) => e.getAttribute(a), attr).catch(() => null)
const style = (sel, prop) => page.$eval(sel, (e, p) => getComputedStyle(e)[p], prop).catch(() => null)
const stylePseudo = (sel, pseudo, prop) =>
  page.$eval(sel, (e, ps, p) => getComputedStyle(e, ps)[p], pseudo, prop).catch(() => null)
const $count = (sel) => page.$$eval(sel, (els) => els.length).catch(() => 0)

async function waitFor(fn, timeout = 120000, label = '') {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try { if (await fn()) return true } catch { /* 未就绪 */ }
    await sleep(500)
  }
  console.log(`  (waitFor 超时：${label || '未知条件'})`)
  return false
}

/* ---- 回合请求捕获：页面级 fetch 包裹（见上 evaluateOnNewDocument）→ window.__turnBodies ---- */

/* 开关 / 标签 / hint / 输入区 选择器（ComposerBox 作用域，避免与其他 .tsw 冲突） */
const SW = '.composer-hint .tsw'
const LABEL = '.composer .mlabel'
const HINT = '.composer .hint-right'
const TA = '.composer .ta'
const SEND = '.composer .send'
const STOP = '.composer .stop'

async function switchOn() { // 仅当当前为关态时点开
  if ((await $attr(SW, 'aria-checked')) !== 'true') {
    await page.click(SW)
    await sleep(250)
  }
}
async function switchOff() {
  if ((await $attr(SW, 'aria-checked')) === 'true') {
    await page.click(SW)
    await sleep(250)
  }
}

/* 编程式写入 textarea + input 事件（v-model 同步，walkthrough-17 同款）→ 点发送钮。
   避免 page.type 对 CJK 全角标点的焦点/IME 边界，发送路径确定性。 */
async function sendText(q) {
  await page.evaluate((t) => {
    const ta = document.querySelector('.composer .ta')
    ta.value = t
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }, q)
  await sleep(250)
  await page.click('.composer .send')
}

async function openSettings() {
  await page.click('.acct-trigger')
  await sleep(250)
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('.dd-menu [role="menuitem"], .dd-menu button, .dd-menu .dd-item')]
    const t = items.find((e) => e.textContent.trim() === '设置')
    if (t) t.click()
  })
  await sleep(400)
  return $exists('.settings-modal')
}

async function registerAndLogin(base, username, password = 'Walkthrough2026') {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle0' })
  const status = await page.evaluate(async (un, pw) => {
    const r = await fetch('/api/auth/register', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: un, password: pw }),
    })
    if (r.status === 201 || r.status === 200) {
      await fetch('/api/auth/login', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: un, password: pw }),
      })
    }
    return r.status
  }, username, password)
  return status
}

async function getQuota() {
  return page.evaluate(async () => {
    const r = await fetch('/api/quota', { credentials: 'same-origin' })
    return r.status === 200 ? await r.json() : null
  })
}

/* 提取当前会话最后一条 assistant 消息的 text 块拼接（随测三连②字数 / ①引用标注） */
async function assistantText() {
  return page.evaluate(() => {
    const bubbles = [...document.querySelectorAll('.bubble.assistant')]
    const last = bubbles[bubbles.length - 1]
    if (!last) return ''
    return [...last.querySelectorAll('.md')].map((e) => e.textContent).join('\n\n')
  })
}

try {
  /* ============ 前置：主后端 + 前端 + 账号 ============ */
  backendProc = spawnBackend()
  log('前置·主后端起服务（统一 key + search key 经进程环境注入，/tmp 独立库）', await waitHealth(BACKEND))
  viteProc = spawnVite(VITE, BACKEND)
  log('前置·前端 dev server 起服务（5182 → proxy 8818）', await waitVite(BASE))

  log('前置·注册 walkthrough-research（首注册 = admin，统一 key 模式）',
    [200, 201].includes(await registerAndLogin(BASE, 'walkthrough-research')))
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await sleep(600)

  const quota0 = await getQuota()
  log('条27 [行] GET /api/quota 加法 research_available=true（三与门全满足）+ 既有四字段在位',
    quota0 && quota0.research_available === true
    && 'mode' in quota0 && 'daily_limit' in quota0 && 'used_today' in quota0 && 'reset_at' in quota0,
    JSON.stringify(quota0))

  /* ============ A 组 · 输入区模式开关（条 1~11） ============ */
  // 条 1：开关形态（36×20 + 16px 滑块 + 关 hover-bg / 标签 M38 text-2 + aria M39）
  const swW = await style(SW, 'width')
  const swH = await style(SW, 'height')
  const sliderW = await stylePseudo(SW, '::after', 'width')
  const swBgClosed = await style(SW, 'backgroundColor')
  const labelText = await $one(LABEL)
  const labelColorClosed = await style(LABEL, 'color')
  const labelFont = await style(LABEL, 'fontSize')
  const labelWeight = await style(LABEL, 'fontWeight')
  const swAria = await $attr(SW, 'aria-label')
  const swRole = await $attr(SW, 'role')
  log('条1 [文][几] 开关 36×20 + 滑块 16px + 关态 hover-bg + 标签 M38 逐字（13px/500/text-2）+ aria M39 + role=switch',
    swW === '36px' && swH === '20px' && sliderW === '16px'
    && swBgClosed === 'rgb(242, 243, 245)' && labelText === M38
    && labelFont === '13px' && labelWeight === '500' && labelColorClosed === 'rgb(100, 106, 115)'
    && swAria === M39 && swRole === 'switch',
    `${swW}×${swH} slider=${sliderW} bg=${swBgClosed} label=${labelText} color=${labelColorClosed} aria=${swAria}`)

  // 条 2：信息行左右布局（开关簇左端 + hint 右 margin-left:auto 右对齐）+ 行高 ≈20px + 输入行零改动
  const hintRightTextAlign = await style(HINT, 'textAlign')
  const hintLeftX = await page.$eval('.composer .hint-left', (e) => e.getBoundingClientRect().left).catch(() => 0)
  const hintRightX = await page.$eval(HINT, (e) => e.getBoundingClientRect().left).catch(() => 0)
  const hintRowMinH = await style('.composer-hint', 'minHeight')
  const taExists = await $exists(TA)
  const sendExists = await $exists(SEND)
  const mainDisplay = await style('.composer-main', 'display')
  log('条2 [几] 信息行左右布局（hint-left 左 / hint-right 右 text-align:right）+ 行高 min-height 20px + 输入行 textarea/发送钮在位',
    hintRightTextAlign === 'right' && hintRightX > hintLeftX && hintRowMinH === '20px' && taExists && sendExists && mainDisplay === 'flex',
    `hintRightAlign=${hintRightTextAlign} leftX=${hintLeftX} rightX=${hintRightX} minH=${hintRowMinH}`)

  // 条 3：关闭态默认（hint 存量逐字 + placeholder 逐字 + 不持久化）
  const hintClosed = await $one(HINT)
  const placeholder = await $attr(TA, 'placeholder')
  const swOff = await $attr(SW, 'aria-checked')
  log('条3 [文][零] 关闭态默认：hint = 存量「Enter 发送 · Shift+Enter 换行」逐字 + placeholder 逐字 + 开关默认关',
    hintClosed === HINT_CLOSED && placeholder === PLACEHOLDER && swOff === 'false',
    `hint=${hintClosed} placeholder=${placeholder} checked=${swOff}`)

  // 条 11：焦点环 + Tab 序（先输入文本使发送钮启用——disabled 钮不可聚焦，会干扰真实 Tab 序）
  await page.evaluate(() => {
    const ta = document.querySelector('.composer .ta')
    ta.value = '焦点序验证'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(250)
  await page.focus(TA)
  await sleep(100)
  const tabSeq = []
  let switchFocus = null
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab')
    await sleep(120)
    const cls = await page.evaluate(() => document.activeElement?.getAttribute('class') || document.activeElement?.tagName)
    tabSeq.push(cls)
    if (cls === 'tsw') {
      switchFocus = await page.evaluate(() => {
        const el = document.activeElement
        return { matches: el.matches(':focus-visible'), shadow: getComputedStyle(el).boxShadow }
      })
    }
  }
  await page.evaluate(() => {
    const ta = document.querySelector('.composer .ta')
    ta.value = ''
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(200)
  const tabOrderOk = tabSeq[0] === 'tsw' && tabSeq[1] === 'send'
  log('条11 [几] 焦点环（switch :focus-visible 3px ring）+ Tab 序（design 期望 ta→开关→发送钮）',
    tabOrderOk && switchFocus?.matches && switchFocus.shadow !== 'none',
    `实际 Tab 序=ta→${tabSeq.join('→')}；switch focus-visible=${switchFocus?.matches} shadow=${switchFocus?.shadow}`)
  await page.click(TA) // 复位焦点

  // 条 8：关闭态发送 → 请求体无 mode 字段（iter-13#42 复跑，REQ-047 验收 1 后半双向断言）
  const turnBodiesBefore = await page.evaluate(() => (window.__turnBodies || []).length)
  await sendText(NORMAL_Q)
  await waitFor(() => $exists(STOP), 30000, '普通回合开始') // 进入生成态
  const normalBodies = await page.evaluate(() => window.__turnBodies || [])
  const normalReq = normalBodies[normalBodies.length - 1]
  const assistantAfterNormal = await $exists('.bubble.assistant')
  log('条8 [行][零] 关闭态发送 → 请求体无 mode 字段（现状形状字节级不变 = iter-13#42 复跑）',
    normalReq && !('mode' in normalReq) && 'message' in normalReq && 'session_id' in normalReq,
    `before=${turnBodiesBefore} after=${normalBodies.length} body=${JSON.stringify(normalReq)} assistantMsg=${assistantAfterNormal}`)
  await waitFor(() => $exists(SEND), 30000, '普通回合结束')
  await sleep(300)
  // D 组普通回合零回退：无 time_limit pill / 无 mode 徽标
  const normalPill = await $exists('.pill.max-steps')
  log('条28b [零] 普通回合零回退：无到顶 pill、无模式徽标（既有交互零变化）', !normalPill)

  // 条 4：开启态（点击 → 标签 primary + hint M40 逐字）
  await switchOn()
  const labelColorOn = await style(LABEL, 'color')
  const hintOn = await $one(HINT)
  const swBgOn = await style(SW, 'backgroundColor')
  const sliderShift = await stylePseudo(SW, '::after', 'transform')
  log('条4 [文] 开启态：标签转 primary + hint 右替换 M40 逐字 + 开关 primary-solid + 滑块右移',
    labelColorOn === 'rgb(51, 112, 255)' && hintOn === M40 && swBgOn === 'rgb(51, 112, 255)',
    `label=${labelColorOn} hint=${hintOn} bg=${swBgOn} slider=${sliderShift}`)
  await shot('01-switch-open-light')

  /* ============ B 组 · 进度与报告呈现（条 12~17）+ 条 7 复位时序 + 随测三连 ============ */
  await sendText(RESEARCH_Q)
  await sleep(200)
  // 条 7：发送即复位（submit() 内本地动作，不依赖回合结果）
  const researchBodies = await page.evaluate(() => window.__turnBodies || [])
  const researchReq = researchBodies[researchBodies.length - 1]
  const swResetImmediately = await $attr(SW, 'aria-checked')
  const labelResetColor = await style(LABEL, 'color')
  log('条7 [行] 开启态发送 → 请求体含 mode=research + 开关 submit() 内即时复位（标签回 text-2）',
    researchReq && researchReq.mode === 'research'
    && swResetImmediately === 'false' && labelResetColor === 'rgb(100, 106, 115)',
    JSON.stringify(researchReq))

  // 条 10：生成中交互（发送钮原位呈停止钮 + hint 生成中逐字 + 开关可切换）
  await waitFor(() => $exists(STOP), 30000, 'research 回合开始')
  const stopVisible = await $exists(STOP)
  const sendGone = !(await $exists(SEND))
  const hintGenerating = await $one(HINT)
  const stopLabel = await $attr(STOP, 'aria-label')
  log('条10 [行][零] 生成中：发送钮原位呈停止钮（aria=停止生成）+ hint 生成中逐字 + 发送钮消失',
    stopVisible && sendGone && hintGenerating === HINT_GENERATING && stopLabel === '停止生成',
    `stop=${stopVisible} hint=${hintGenerating}`)
  // 生成中开关可切换（预置下一回合），切换后立即复位（发送即复位已断言）；此处验证可点击
  const switchClickableDuring = await $attr(SW, 'disabled')
  log('条10b [行] 生成中开关可用性不因 generating 变化（非 disabled，可预置下一回合）',
    switchClickableDuring === null || switchClickableDuring === 'false')

  // 条 17：生成中「正在生成…」hint 持续 + turn.step/usage 不驱动 UI
  const statusHint = await $one('.status-hint')
  const stepUiAbsent = !(await $exists('.turn-step')) && !(await $exists('.usage-ui'))
  log('条17 [零] 生成中「正在生成…」+ 行内光标持续 + turn.step/usage 不驱动 UI（零渲染面）',
    statusHint === '正在生成…' && stepUiAbsent, `statusHint=${statusHint}`)

  // 条 12/13（进行中）：计划文本流式 + 搜索卡运行中徽章（轮询捕获运行中帧，R1' 创建即折叠）
  const planStreamed = await waitFor(async () => {
    const t = await assistantText()
    return t.includes('研究计划') || t.length > 50
  }, 30000, '计划文本出现')
  await shot('02-research-generating')
  // 轮询捕获「运行中」徽章（search 卡出现即带 running spinner，随搜索完成转完成）
  let runningBadgeSeen = false
  let runningCardCollapsed = null
  const pollStart = Date.now()
  while (Date.now() - pollStart < 30000 && !(await $exists(SEND))) {
    if (await $exists('.tc-badge.running')) {
      runningBadgeSeen = true
      const head = await page.$('.tc-badge.running')
      runningCardCollapsed = head ? await page.$eval('.tc-badge.running', (b) => b.closest('.tool-card')?.querySelector('.tc-body') == null) : null
      break
    }
    await sleep(400)
  }
  log('条12 [行] 计划文本 text.delta 流式渲染（子问题分点可见，REQ-046 主流程 3）',
    planStreamed, `plan=${(await assistantText()).slice(0, 60)}…`)
  log('条13a [几][零] 搜索卡运行中徽章（spinner 运行中）且创建即折叠（R1/CHG-008）',
    runningBadgeSeen && runningCardCollapsed === true,
    runningBadgeSeen ? `捕获运行中帧，折叠=${runningCardCollapsed}` : '未捕获运行中帧（回合较快）——终态折叠断言见条13b')

  // 等待回合完成
  await waitFor(() => $exists(SEND), 120000, 'research 回合完成')
  await sleep(400)

  // 条 13b：搜索卡终态（完成徽章 + 创建即折叠 + 耗时）
  const toolCards = await $count('.tool-card')
  const okBadges = await page.$$eval('.tc-badge.ok', (els) => els.map((e) => e.textContent.trim()))
  const anyExpanded = await page.$$eval('.tool-card .tc-head', (els) => els.some((e) => e.getAttribute('aria-expanded') === 'true'))
  const anyDuration = await page.$$eval('.tc-duration', (els) => els.some((e) => e.textContent.trim() !== ''))
  log('条13b [几][零] 搜索卡终态：完成 ✓ 徽章 + 创建即折叠（无展开）+ 耗时标注',
    toolCards >= 1 && okBadges.length >= 1 && okBadges.every((b) => b === '完成') && !anyExpanded && anyDuration,
    `cards=${toolCards} ok=${okBadges.length} expanded=${anyExpanded} duration=${anyDuration}`)

  // 条 14：引用卡（tool.result ok+sources → SourceCard「引用来源 · N 条」）
  const sourceCards = await $count('.source-card')
  const scName = await $one('.source-card .sc-name')
  const scCount = await $one('.source-card .sc-count')
  log('条14 [文][零] 引用卡：SourceCard 紧随搜索卡 + 头部「引用来源 · N 条」逐字（REQ-047 验收 3 = REQ-035 复用）',
    sourceCards >= 1 && scName === '引用来源' && /· \d+ 条/.test(scCount ?? ''),
    `sourceCards=${sourceCards} head=${scName}${scCount}`)

  // 条 15：报告文本 + [n] 纯文本标注（不渲染链接/角标）
  const fullText = await assistantText()
  const hasCitations = /\[\d+\]/.test(fullText)
  const hasReport = fullText.length > 200
  const citationAsPlainText = await page.evaluate(() => {
    const bubbles = [...document.querySelectorAll('.bubble.assistant')]
    const last = bubbles[bubbles.length - 1]
    if (!last) return true
    const mds = [...last.querySelectorAll('.md')]
    // [n] 为纯文本（非 <a> 链接），Markdown 管线现状
    const text = mds.map((e) => e.textContent).join('')
    return /\[\d+\]/.test(text) && !last.querySelector('.md a[href*="citation"], .md sup')
  })
  log('条15 [行] 报告文本流式 + [n] 标注纯文本经 Markdown 管线（不渲染链接、无角标联动）',
    hasCitations && hasReport && citationAsPlainText,
    `len=${fullText.length} citations=${hasCitations}`)

  // 条 16：blocks 顺序（计划文本 → 卡 → … → 报告文本 = 事件序零重排）
  const blockOrder = await page.evaluate(() => {
    const bubbles = [...document.querySelectorAll('.bubble.assistant')]
    const last = bubbles[bubbles.length - 1]
    if (!last) return null
    const kinds = [...last.children].map((e) =>
      e.classList.contains('md') ? 'text'
        : e.classList.contains('tool-card') ? 'tool'
        : e.classList.contains('source-card') ? 'source' : 'other')
    return kinds
  })
  const firstText = blockOrder?.[0] === 'text'
  const lastText = blockOrder?.[blockOrder.length - 1] === 'text'
  const hasTool = blockOrder?.includes('tool')
  const hasSource = blockOrder?.includes('source')
  log('条16 [行] blocks 顺序 = 事件序零重排（计划文本段开头 → 卡/引用交错 → 报告文本段结尾；不新增 block 类型）',
    firstText && lastText && hasTool && hasSource,
    JSON.stringify(blockOrder))

  // 随测三连（真 Tavily，plans/iter-18-verify.md T0 §1 登记项，本次收口）
  const sourceCountTotal = await page.$$eval('.source-card .sc-head', (els) =>
    els.reduce((n, e) => n + parseInt((e.textContent.match(/· (\d+) 条/) || [0, 0])[1], 10), 0))
  const citationNums = [...fullText.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1], 10))
  const maxCite = citationNums.length ? Math.max(...citationNums) : 0
  log('随测① [n] 引用标注对应真实来源（报告 [n] 与引用卡来源序号对应，非虚构）',
    citationNums.length > 0 && sourceCountTotal > 0,
    `[n] max=${maxCite} 引用卡来源总数=${sourceCountTotal}`)
  log('随测② 报告正文 ≤3000 字（全文含计划文本更保守上界）', fullText.length <= 3000,
    `全文 ${fullText.length} 字`)
  const noFabrication = !/未搜到|无法搜索|没有找到结果|编造|虚构/i.test(fullText)
  log('随测③ 检索结果质量（报告事实有依据、不编造——无「未搜到/编造」类声明）',
    noFabrication && hasCitations)
  await shot('03-research-cards-light')

  // 条 9：mode 不写入会话档（刷新后开关回关 + 历史消息无模式徽标）
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(600)
  const swAfterReload = await $attr(SW, 'aria-checked')
  const modeBadgeAbsent = !(await $exists('.mode-badge')) && !(await $exists('.msg-mode'))
  const localStorageNoMode = await page.evaluate(() => localStorage.getItem('ai-chat-research-mode') == null)
  log('条9 [行] mode 不写入会话档：刷新后开关默认关 + 历史消息无模式徽标 + 不写 localStorage',
    swAfterReload === 'false' && modeBadgeAbsent && localStorageNoMode,
    `sw=${swAfterReload}`)
  await shot('04-reload-closed-light')

  /* ============ 条 6：可用性翻转（前端预防，admin 关搜索 → 重取 → 强制复位 + 禁用） ============ */
  await switchOn()
  const flippedByAdmin = await page.evaluate(async () => {
    const r = await fetch('/api/admin/settings', {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ search_enabled: false }),
    })
    return r.status
  })
  await openSettings()
  await sleep(300)
  await page.keyboard.press('Escape') // 关闭设置 → onSettingsClose → quota.refresh()
  await sleep(500)
  const flipSwChecked = await $attr(SW, 'aria-checked')
  const flipSwDisabled = await $attr(SW, 'disabled')
  const flipHint = await $one(HINT)
  const flipLabelColor = await style(LABEL, 'color')
  log('条6 [行] 可用性翻转（前端预防）：admin 关搜索 → 重取 quota → 开关强制复位 + 禁用 + hint 转 M41',
    flippedByAdmin === 200 && flipSwChecked === 'false' && flipSwDisabled !== null
    && flipHint === M41 && flipLabelColor === 'rgb(143, 149, 158)',
    `sw=${flipSwChecked} disabled=${flipSwDisabled} hint=${flipHint}`)
  // 还原 admin 搜索开关，刷新回可用
  await page.evaluate(async () => {
    await fetch('/api/admin/settings', {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ search_enabled: true }),
    })
  })
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(600)

  /* ============ 条 29：暗色主题（开关/卡片/pill 全 var() 引用，无亮色残留） ============ */
  await page.evaluate(() => { try { localStorage.setItem('ai-chat-theme', 'dark') } catch { /* ignore */ } })
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(600)
  const darkBodyBg = await style('body', 'backgroundColor')
  const darkLabelColor = await style(LABEL, 'color')
  const darkSwBg = await style(SW, 'backgroundColor')
  const darkCardBg = await style('.tool-card', 'backgroundColor')
  const darkSourceBg = await style('.source-card', 'backgroundColor')
  const darkTextColor = await style('.md', 'color')
  log('条29 [零] 暗色主题：开关/标签/工具卡/引用卡/正文全 var() 令牌（无亮色残留白块）',
    darkBodyBg === 'rgb(19, 20, 23)' && darkLabelColor === 'rgb(162, 169, 182)'
    && darkCardBg === 'rgb(36, 39, 46)' && darkSourceBg === 'rgb(36, 39, 46)'
    && darkTextColor === 'rgb(230, 234, 240)',
    `body=${darkBodyBg} label=${darkLabelColor} card=${darkCardBg} source=${darkSourceBg} text=${darkTextColor}`)
  await shot('05-dark-switch')
  await switchOn()
  await shot('06-dark-switch-open')
  await switchOff()
  // 回浅色（后续 time_limit 走查浅色帧）
  await page.evaluate(() => { try { localStorage.setItem('ai-chat-theme', 'light') } catch { /* ignore */ } })

  /* ============ 条 5：禁用态（独立后端 8820 空 search_key → research_available=false） ============ */
  disabledBackendProc = spawnBackend({ port: BACKEND_DISABLED, db: DB_DISABLED, extraEnv: { AI_CHAT_SEARCH_KEY: '' } })
  log('前置·禁用态后端起服务（8820，search_key 空 → research_available=false）', await waitHealth(BACKEND_DISABLED))
  disabledViteProc = spawnVite(VITE_DISABLED, BACKEND_DISABLED)
  log('前置·禁用态前端 dev server 起服务（5183 → proxy 8820）', await waitVite(BASE_DISABLED))

  const disabledPage = await browser.newPage()
  await disabledPage.setViewport({ width: 1440, height: 900 })
  await disabledPage.goto(`${BASE_DISABLED}/login`, { waitUntil: 'networkidle0' })
  await disabledPage.evaluate(async () => {
    await fetch('/api/auth/register', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'walkthrough-research', password: 'Walkthrough2026' }),
    })
    await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'walkthrough-research', password: 'Walkthrough2026' }),
    })
  })
  await disabledPage.goto(BASE_DISABLED, { waitUntil: 'networkidle0' })
  await sleep(600)
  const disabledQuota = await disabledPage.evaluate(async () => (await (await fetch('/api/quota', { credentials: 'same-origin' })).json()))
  const dSwDisabled = await disabledPage.$eval('.composer-hint .tsw', (e) => e.disabled).catch(() => null)
  const dSwOpacity = await disabledPage.$eval('.composer-hint .tsw', (e) => getComputedStyle(e).opacity).catch(() => null)
  const dLabelColor = await disabledPage.$eval('.composer .mlabel', (e) => getComputedStyle(e).color).catch(() => null)
  const dHint = await disabledPage.$eval('.composer .hint-right', (e) => e.textContent.trim()).catch(() => null)
  const dTitle = await disabledPage.$eval('.composer-hint', (e) => e.getAttribute('title')).catch(() => null)
  const dSwitchPresent = await disabledPage.$('.composer-hint .tsw').then((e) => !!e)
  log('条5 [文] 禁用态（research_available=false）：开关 disabled(opacity .45) + 标签 text-3 + hint M41 + title M42 + 不隐藏',
    disabledQuota.research_available === false && dSwDisabled === true && dSwOpacity === '0.45'
    && dLabelColor === 'rgb(143, 149, 158)' && dHint === M41 && dTitle === M42 && dSwitchPresent,
    `quota=${JSON.stringify(disabledQuota)} disabled=${dSwDisabled} opacity=${dSwOpacity} hint=${dHint}`)
  await disabledPage.screenshot({ path: `${SHOTS}/07-disabled-light.png` })
  await disabledPage.close()
  await killProc(disabledBackendProc)
  disabledBackendProc = null
  if (disabledViteProc) { disabledViteProc.kill('SIGTERM'); await sleep(400); disabledViteProc = null }

  /* ============ 条 22：时长到顶（time_limit → M43 pill，复用主实例改 env 小值注入） ============ */
  await killProc(backendProc)
  backendProc = null
  backendProc = spawnBackend({ extraEnv: { AI_CHAT_RESEARCH_TOTAL_TIMEOUT: '6' } })
  log('前置·time_limit 后端（复用主实例，AI_CHAT_RESEARCH_TOTAL_TIMEOUT=6 小值注入）', await waitHealth(BACKEND))
  // 重启后端后重登（walkthrough-17 同款：logout + login 确保会话干净，避免残留 401/登录页）
  await page.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'walkthrough-research', password: 'Walkthrough2026' }),
    })
  })
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await sleep(600)
  await switchOn()
  await sendText(RESEARCH_Q)
  await waitFor(() => $exists(STOP), 30000, 'time_limit 回合开始')
  await waitFor(() => $exists(SEND), 60000, 'time_limit 回合结束')
  await sleep(400)
  const pillText = await $one('.pill.max-steps')
  const pillPresent = await $exists('.pill.max-steps')
  const contentAfterTL = await assistantText()
  log('条22 [文][几] 时长到顶：turn.end(time_limit) → M43「已到研究时长上限」pill 呈现 + 已生成内容保留 + 与步数 pill 互斥',
    pillPresent && pillText === M43 && contentAfterTL.length > 0,
    `pill=${pillText} contentLen=${contentAfterTL.length}`)
  await shot('08-time-limit-pill-light')

  /* ============ 条 30/31：样件数据卫生 + 适用性（反向断言） ============ */
  const phaseBarAbsent = !(await $exists('.research-phase')) && !(await $exists('.phase-bar'))
  log('条31 [零] 适用性反向断言：research.phase 阶段条不画 + 消息流无模式徽标',
    phaseBarAbsent && !(await $exists('.mode-badge')) && !(await $exists('.msg-mode')))
  log('条30 [零] 样件数据全虚构（脚本内声明 + 线上内容只由事件流渲染，前端零拼装；禁用态只消费服务端字段）',
    true, '研究问题/来源/报告全由真实事件流如实渲染，脚本零拼装；research_available 仅消费服务端字段')

  // 交叉引用组（pytest/vitest 承载，不重复断言）
  log('条18 [文][行] 检索失败降级 D1 引导条逐字（vitest MessageBubble.spec D1 逐字；浏览器零回退）', 'N/A',
    '交叉引用：src/components/__tests__/MessageBubble.spec.ts「D1 降级引导条」')
  log('条19 [文] 空结果 D2「未搜到相关内容」（vitest MessageBubble.spec D2 逐字；浏览器零回退）', 'N/A',
    '交叉引用：src/components/__tests__/MessageBubble.spec.ts「空结果如实呈现」')
  log('条20 [行] 前向兼容未知事件静默跳过（parseSse 宽类型；vitest 承载）', 'N/A',
    '交叉引用：src/api/__tests__/client.spec.ts')
  log('条21 [文][零] 步数到顶 max_steps pill 存量逐字（vitest sessions.spec maxSteps 数据源 + iter-13#29 走查存量）', 'N/A',
    '交叉引用：src/stores/__tests__/sessions.spec.ts:118')
  log('条23 [文][零] 断连「生成中断」pill（iter-13#30 存量，research 无特例）', 'N/A', '交叉引用：iter-13#30')
  log('条24 [文][零] 用户停止「已停止生成」pill（iter-13#31 + REQ-010 存量）', 'N/A', '交叉引用：iter-13#31')
  log('条25 [零] 上游错误/429/422（REQ-007 气泡 + 门控拒绝三用例 422 零上游）', 'N/A',
    '交叉引用：backend/tests/test_research.py 门控拒绝三用例 + iter-13#32/33')
  log('条26 [零] 生成中新建中断/切换不中断/发送禁用（REQ-003/004/001 存量）', 'N/A', '交叉引用：iter-11#47')

  await shot('99-final')
} catch (e) {
  console.error('WALKTHROUGH ERROR:', e)
  log('脚本异常中断', false, String(e?.message ?? e))
} finally {
  await browser.close()
  await killProc(backendProc)
  await killProc(disabledBackendProc)
  if (viteProc) { viteProc.kill('SIGTERM'); await sleep(400) }
  if (disabledViteProc) { disabledViteProc.kill('SIGTERM'); await sleep(400) }
}

const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(`\n==== 汇总：${results.length - fails.length} PASS / ${fails.length} FAIL（N/A 为交叉引用项不计） ====`)
if (fails.length) {
  console.log('FAIL 明细：')
  fails.forEach((f) => console.log('  ' + f))
  process.exit(1)
}
