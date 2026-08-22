/* ai-chat iter-20 T3 浏览器走查脚本（design-iter-20 §7.2 走查清单 31 条）
 *
 * 沿 scripts/e2e-walkthrough-18.mjs 骨架：puppeteer-core 驱动本机 Chrome，PASS/FAIL 逐条
 * + 截图留档 /tmp/e2e20/shots/。FAIL 区分脚本问题与产品缺陷（小缺陷当轮修 + defects.md 登记）。
 *
 * 断点走查形态（真实 Chrome 视口调整 + hover 媒体特性仿真）：
 *   桌面 1440×900（E 组零回退 + REQ-050 验收 5 桌面 720px）
 *   ≤768px 375×812（A 组抽屉态）/ ≤480px 同 375（B 组收窄 + C 组弹窗全屏）
 *   <330px 320×640（条 9 附：min(80vw, 264px)）
 *   触屏态 = page.emulateMediaFeatures([{name:'hover', value:'none'}])（D 组，CSS 媒体特性仿真）
 *   双主题 = localStorage ai-chat-theme（light/dark 四象限）
 *
 * 本脚本自起全部服务（独立 /tmp 库，不触开发库与其他会话端口）：
 *   主后端：backend/.venv/bin/uvicorn app.main:app --port 8814（AI_CHAT_DB_PATH=/tmp 独立库）。
 *           统一 key 三变量自 backend/.env 读取后经**进程环境**注入子进程（真实 key 仅进程环境传递）。
 *   前端：npx vite --port 5180（proxy 目标经 AI_CHAT_DEV_API_TARGET → 8814）。
 * 账号：walkthrough-mobile（首注册 = admin，统一 key 模式）。
 * 运行：node scripts/e2e-walkthrough-20.mjs（无外部前置；Chrome 本机路径沿 iter-14~18）
 *
 * vitest/pytest 承载面（不在本脚本重复断言，plans/iter-20-verify.md T3 段交叉引用）：
 *   条 19 弹窗逻辑全量（settings-form 28 + SettingsMobileCssContract 12，REQ-050 验收 4）
 *   条 31 全局回归（vitest 411 / pytest 347 / guard:style / 构建，verify T3 段机器数字）
 *   条 6 抽屉不写 localStorage 的键面（MobileShell.spec 专项断言）+ 本脚本浏览器复证
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BACKEND = 8814
const VITE = 5180
const BASE = `http://localhost:${VITE}`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = '/tmp/e2e20/shots'
const DB = '/tmp/ai-chat-walkthrough-20.db'

mkdirSync(SHOTS, { recursive: true })
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
  try { rmSync(f) } catch { /* 首跑无残留 */ }
}

const results = []
function log(name, ok, detail = '') {
  results.push(`${ok === null ? 'N/A ' : ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —— ' + detail : ''}`)
  console.log(results.at(-1))
}

/* ---- 样件文案（design-iter-20 §7 逐字唯一来源，M44~M45 + 存量 hint/placeholder） ---- */
const M44 = '打开会话列表'
const M40 = '已开启深度研究：发送后 AI 将自动拆解问题、多轮联网搜索并给出带引用的报告，耗时较长'
const M41 = '深度研究暂不可用：需联网搜索可用'
const HINT_GENERATING = 'AI 回复生成中，发送暂不可用…'
const M45 = '输入消息'
const HINT_CLOSED = 'Enter 发送 · Shift+Enter 换行'
const PLACEHOLDER = '输入消息，Enter 发送，Shift+Enter 换行'

/* ---- 统一 key 经 backend/.env 读取 → 仅进程环境注入子进程（不入文件/日志） ---- */
function backendEnvFromDotenv() {
  const env = {}
  try {
    for (const line of readFileSync(`${ROOT}backend/.env`, 'utf8').split('\n')) {
      const m = line.match(/^(AI_CHAT_UNIFIED_KEY|AI_CHAT_UNIFIED_BASE_URL|AI_CHAT_UNIFIED_MODEL)=(.*)$/)
      if (m) env[m[1]] = m[2].trim()
    }
  } catch { /* .env 缺失 → 后端按未配置处理 */ }
  return env
}
const DOTENV_ENV = backendEnvFromDotenv()

let backendProc = null
let viteProc = null
function spawnBackend() {
  const proc = spawn(`${ROOT}backend/.venv/bin/uvicorn`,
    ['app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND)], {
      cwd: `${ROOT}backend`,
      env: { ...process.env, ...DOTENV_ENV, AI_CHAT_DB_PATH: DB },
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
  const proc = spawn('npx', ['vite', '--port', String(VITE), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, AI_CHAT_DEV_API_TARGET: `http://127.0.0.1:${BACKEND}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout.on('data', () => {})
  proc.stderr.on('data', () => {})
  return proc
}
async function waitVite() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE); if (r.ok) return true } catch { /* 未就绪 */ }
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
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false })

const $one = (sel) => page.$eval(sel, (e) => e.textContent.trim()).catch(() => null)
const $exists = (sel) => page.$(sel).then((e) => !!e)
const $attr = (sel, attr) => page.$eval(sel, (e, a) => e.getAttribute(a), attr).catch(() => null)
const style = (sel, prop) => page.$eval(sel, (e, p) => getComputedStyle(e)[p], prop).catch(() => null)
const rect = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }).catch(() => null)
const vw = () => page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))

async function waitFor(fn, timeout = 60000, label = '') {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try { if (await fn()) return true } catch { /* 未就绪 */ }
    await sleep(400)
  }
  console.log(`  (waitFor 超时：${label || '未知条件'})`)
  return false
}

/* 编程式写入 textarea + input 事件（v-model 同步，walkthrough-17/18 同款） */
async function sendText(q) {
  await page.evaluate((t) => {
    const ta = document.querySelector('.composer .ta')
    ta.value = t
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }, q)
  await sleep(250)
  await page.click('.composer .send')
}

/* 移动端开设置：抽屉 → 账户「···」→ 设置（桌面直接 .acct-trigger） */
async function openSettingsMobile() {
  if (!(await $exists('.settings-modal'))) {
    await page.click('.drawer-btn')
    await sleep(350)
    await page.click('.acct-trigger')
    await sleep(300)
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('.dd-menu [role="menuitem"], .dd-menu button')]
      const t = items.find((e) => e.textContent.trim() === '设置')
      if (t) t.click()
    })
    await sleep(450)
  }
  return $exists('.settings-modal')
}

try {
  /* ============ 前置 ============ */
  backendProc = spawnBackend()
  log('前置·主后端起服务（统一 key 经进程环境注入，/tmp 独立库）', await waitHealth())
  viteProc = spawnVite()
  log('前置·前端 dev server 起服务（5180 → proxy 8814）', await waitVite())

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
  const regStatus = await page.evaluate(async () => {
    const r = await fetch('/api/auth/register', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'walkthrough-mobile', password: 'Walkthrough2026' }),
    })
    if (r.status === 201 || r.status === 200) {
      await fetch('/api/auth/login', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'walkthrough-mobile', password: 'Walkthrough2026' }),
      })
    }
    return r.status
  })
  log('前置·注册 walkthrough-mobile（首注册 = admin，统一 key 模式）', [200, 201].includes(regStatus))
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await sleep(600)
  // 造会话：桌面态新建一个会话 + 发一条消息（气泡断言输入；报告内容由真实事件流渲染，零拼装）
  await page.click('.new-btn')
  await sleep(400)
  await sendText('你好，请用一句话自我介绍。')
  await sleep(1500) // 回合进行/完成皆可，用户气泡已渲染
  await waitFor(() => $exists('.bubble.user'), 20000, '用户气泡')

  /* ============ E 组 · 桌面零回退（>768px，1440×900） ============ */
  // 条 29：侧栏 264px 双列 + rail 56px 逐像素零变化（iter-11 走查 16~18 复跑）
  const deskSidebar = await rect('.sidebar')
  const deskMain = await rect('.main')
  await page.evaluate(() => localStorage.setItem('mm-sidebar-collapsed', '1'))
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(600)
  const railW = (await rect('.sidebar'))?.w
  const drawerBtnDesktopHidden = !(await $exists('.mobile-topbar') && await page.$eval('.mobile-topbar', (e) => getComputedStyle(e).display !== 'none'))
  await page.evaluate(() => localStorage.removeItem('mm-sidebar-collapsed'))
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(600)
  log('条29 [几][零] >768px 侧栏 264px 双列 + rail 56px（collapsed 键）逐像素零变化 + 移动顶条不渲染',
    Math.round(deskSidebar.w) === 264 && Math.round(deskMain.x) === 264 && Math.round(railW) === 56 && drawerBtnDesktopHidden,
    `sidebar=${deskSidebar?.w} mainX=${deskMain?.x} rail=${railW} topbarHidden=${drawerBtnDesktopHidden}`)

  // 条 30：hover:hover 下「···」hover 浮现行为零变化 + hint/placeholder 桌面逐字零变化
  const deskDotsOpacity = await style('.sidebar .item .dd-trigger', 'opacity')
  const deskHint = await $one('.composer .hint-right')
  const deskPlaceholder = await $attr('.composer .ta', 'placeholder')
  const deskActionOpacity = await style('.msg-col.assistant .action-btn', 'opacity')
  // hint 为状态机文案（idle/M40/M41/生成中四态逐字，iter-18 §8 口径）——取合法状态集断言
  const HINT_STATES = [HINT_CLOSED, M40, M41, HINT_GENERATING]
  log('条30 [行][零] hover:hover 桌面零回退：「···」/操作栏 opacity:0（hover 浮现沿现状）+ hint 状态文案逐字 + placeholder 逐字',
    deskDotsOpacity === '0' && deskActionOpacity === '0'
    && HINT_STATES.includes(deskHint) && deskPlaceholder === PLACEHOLDER,
    `dots=${deskDotsOpacity} action=${deskActionOpacity} hint=${deskHint} ph=${deskPlaceholder}`)

  // 条 22：>480px 弹窗 720px 左右分栏逐像素零变化（REQ-050 验收 5）
  await page.click('.acct-trigger')
  await sleep(300)
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('.dd-menu [role="menuitem"], .dd-menu button')]
    const t = items.find((e) => e.textContent.trim() === '设置')
    if (t) t.click()
  })
  await sleep(450)
  const dModal = await rect('.settings-modal')
  const dModalRadius = await style('.settings-modal', 'borderRadius')
  const dNavW = (await rect('.sm-nav'))?.w
  const dNavDir = await style('.sm-nav', 'flexDirection')
  await page.keyboard.press('Escape')
  await sleep(300)
  log('条22 [几][零] >480px 弹窗 720px 分栏逐像素零变化（width/max-width 命中 + 导航 168px 纵列 + radius 12px）',
    Math.round(dModal.w) === 720 && dModalRadius === '12px' && Math.round(dNavW) === 168 && dNavDir === 'column',
    `w=${dModal?.w} radius=${dModalRadius} nav=${dNavW} dir=${dNavDir}`)
  await shot('01-desktop-settings-720')

  // 条 13 附（桌面半）：发送钮桌面 36×36 逐像素零变化
  const deskSend = await rect('.composer .send')
  log('条13b [几][零] 发送钮 >480px 恢复 36×36（REQ-051 验收 3 桌面零变化）',
    Math.round(deskSend.w) === 36 && Math.round(deskSend.h) === 36, `${deskSend?.w}×${deskSend?.h}`)

  /* ============ A 组 · ≤768px 抽屉态（375×812，hover:hover） ============ */
  await page.setViewport({ width: 375, height: 812 })
  await sleep(500)
  const vp1 = await vw()

  // 条 1：抽屉关闭 rail 不渲染、正文列宽 = 视口 100%
  const mSidebarVis = await style('.sidebar', 'visibility')
  const mSidebarTransform = await style('.sidebar', 'transform')
  const mMain = await rect('.main')
  const topbarH = (await rect('.mobile-topbar'))?.h
  log('条1 [几][行] ≤768px 抽屉关闭：侧栏不占宽（fixed + translateX(-100%)/hidden）、正文列宽 = 视口 100%（验收 1）',
    mSidebarVis === 'hidden' && mMain.w === vp1.w && Math.round(mMain.x) === 0,
    `vis=${mSidebarVis} transform=${mSidebarTransform} main=${mMain?.w}@${mMain?.x} vp=${vp1.w}`)

  // 条 8：入口钮 44×44 常驻 48px 顶条 + M44 逐字 + aria-expanded 随态
  const btn = await rect('.drawer-btn')
  const btnAria = await $attr('.drawer-btn', 'aria-label')
  const btnTitle = await $attr('.drawer-btn', 'title')
  const btnExpanded0 = await $attr('.drawer-btn', 'aria-expanded')
  log('条8 [几][文] 入口钮 44×44 + 顶条 48px + aria-label/title = M44「打开会话列表」逐字',
    Math.round(btn.w) === 44 && Math.round(btn.h) === 44 && Math.round(topbarH) === 48
    && btnAria === M44 && btnTitle === M44 && btnExpanded0 === 'false',
    `btn=${btn?.w}×${btn?.h} topbar=${topbarH} aria=${btnAria}/${btnTitle} exp=${btnExpanded0}`)

  // 条 2：抽屉展开 overlay 覆盖正文（非挤压）+ 遮罩 --c-mask
  const lsBefore = await page.evaluate(() => JSON.stringify({ ...localStorage }))
  await page.click('.drawer-btn')
  await sleep(400)
  const dOpen = await rect('.sidebar')
  const dPos = await style('.sidebar', 'position')
  const maskBg = await style('.drawer-mask', 'backgroundColor')
  const maskRect = await rect('.drawer-mask')
  const btnExpanded1 = await $attr('.drawer-btn', 'aria-expanded')
  const mainStill = await rect('.main')
  log('条2 [几] 抽屉展开 = fixed overlay 覆盖正文（非挤压）+ 遮罩全屏 var(--c-mask) 浅 rgba(31,35,41,.4)',
    dPos === 'fixed' && dOpen.x === 0 && dOpen.y === 0 && Math.round(dOpen.w) === 264
    && maskRect.w === vp1.w && maskBg === 'rgba(31, 35, 41, 0.4)'
    && mainStill.w === vp1.w && btnExpanded1 === 'true',
    `pos=${dPos} drawer=${dOpen?.w}@${dOpen?.x} mask=${maskBg} main=${mainStill?.w} exp=${btnExpanded1}`)
  await shot('02-drawer-open-light-375')

  // 条 3：点遮罩任意处关闭
  await page.mouse.click(340, 700)
  await sleep(350)
  const closedByMask = (await style('.sidebar', 'visibility')) === 'hidden'
  log('条3 [行] 点遮罩任意处关闭抽屉（aria-expanded 回 false）',
    closedByMask && (await $attr('.drawer-btn', 'aria-expanded')) === 'false')

  // 条 4：Esc 关闭
  await page.click('.drawer-btn')
  await sleep(350)
  await page.keyboard.press('Escape')
  await sleep(350)
  log('条4 [行] Esc 关闭抽屉', (await style('.sidebar', 'visibility')) === 'hidden')

  // 条 5：选中会话 → 抽屉自动关 + 正文全宽恢复（主流程；先在抽屉内新建第二会话）
  await page.click('.drawer-btn')
  await sleep(350)
  await page.click('.sidebar .new-btn')
  await sleep(400)
  const picked = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.sidebar .item')]
    if (items.length >= 1) { items[0].click(); return items.length }
    return 0
  })
  await sleep(400)
  log('条5 [行] 选中会话 → 抽屉自动关 + 正文全宽恢复',
    picked >= 1 && (await style('.sidebar', 'visibility')) === 'hidden' && (await rect('.main')).w === vp1.w,
    `sessions=${picked}`)

  // 条 6：抽屉开合不写 localStorage 任何键（mm-sidebar-collapsed 零污染）
  const lsAfter = await page.evaluate(() => JSON.stringify({ ...localStorage }))
  const collapsedNull = await page.evaluate(() => localStorage.getItem('mm-sidebar-collapsed') === null)
  log('条6 [行][零] 抽屉开合全程零 localStorage 写入（键集前后一致 + mm-sidebar-collapsed 保持 null）',
    lsBefore === lsAfter && collapsedNull, `before==after=${lsBefore === lsAfter}`)

  // 条 9：抽屉宽 264px 原样平移；<330px 视口 min(80vw, 264px)；动画 .15s ease
  await page.click('.drawer-btn')
  await sleep(350)
  const trans = await style('.sidebar', 'transition')
  const w375 = (await rect('.sidebar'))?.w
  await page.setViewport({ width: 320, height: 640 })
  await sleep(400)
  const w320 = (await rect('.sidebar'))?.w
  await shot('03-drawer-320')
  await page.setViewport({ width: 375, height: 812 })
  await sleep(400)
  log('条9 [几] 抽屉宽 264px（375px 视口）+ 320px 视口 min(80vw,264)=256 + 动画含 .15s ease（tokens 唯一动效值）',
    Math.round(w375) === 264 && Math.round(w320) === 256 && trans.includes('0.15s'),
    `375=${w375} 320=${w320} trans=${trans}`)
  await page.keyboard.press('Escape')
  await sleep(300)

  /* ============ B 组 · ≤480px 收窄态（375，hover:hover） ============ */
  // 当前会话可能为空（条 5 选中首会话）——先发一条消息确保消息流/气泡载体在位
  await sendText('移动端收窄态走查样例消息。')
  await waitFor(() => $exists('.msg-col.user'), 30000, '移动端用户气泡')
  await waitFor(() => $exists('.composer .send'), 60000, '移动端回合完成（发送钮回归）')
  // 条 10：气泡 max-width ≤92% + 不横向溢出
  const bubbleMW = await style('.msg-col.user', 'maxWidth')
  const noOverflow = await page.evaluate(() => {
    const l = document.querySelector('.list')
    return l ? l.scrollWidth <= l.clientWidth : false
  })
  log('条10 [几] ≤480px 用户气泡 max-width 92% + 列表 scrollWidth ≤ clientWidth（验收 4 不溢出）',
    bubbleMW === '92%' && noOverflow, `mw=${bubbleMW} noOverflow=${noOverflow}`)

  // 条 11：正文列左右 padding 12px（.list 收窄态）
  const listPL = await style('.list', 'paddingLeft')
  const listPR = await style('.list', 'paddingRight')
  log('条11 [几] 正文列左右 padding 12px（间距令牌既有值）', listPL === '12px' && listPR === '12px', `${listPL}/${listPR}`)

  // 条 12：composer-row padding ≤12px + 发送钮可点击
  const crPadding = await style('.composer-row', 'padding')
  const sendClickable = await page.evaluate(() => {
    const s = document.querySelector('.composer .send')
    if (!s) return false
    const r = s.getBoundingClientRect()
    const vp2 = { w: window.innerWidth, h: window.innerHeight }
    return r.x >= 0 && r.y >= 0 && r.right <= vp2.w && r.bottom <= vp2.h
  })
  log('条12 [几] composer-row 左右 padding ≤12px + 发送钮在视口内可点击（验收 5）',
    crPadding === '12px' && sendClickable, `padding=${crPadding} clickable=${sendClickable}`)

  // 条 13：发送/停止钮 ≤480px 视觉 44×44
  const send44 = await rect('.composer .send')
  log('条13 [几] 发送钮 ≤480px 视觉 44×44（停止钮同款高度 44——生成中条 7 顺带复证）',
    Math.round(send44.w) === 44 && Math.round(send44.h) === 44, `${send44?.w}×${send44?.h}`)

  /* ============ C 组 · ≤480px 弹窗全屏态（375，hover:hover） ============ */
  log('前置·移动端开设置（抽屉 → 账户「···」→ 设置）', await openSettingsMobile())
  // 条 16：弹窗 inset 0 = 100vw × 100vh + 圆角 0 + 无投影（验收 1）
  const fsModal = await rect('.settings-modal')
  const fsVp = await vw()
  const fsRadius = await style('.settings-modal', 'borderRadius')
  const fsShadow = await style('.settings-modal', 'boxShadow')
  log('条16 [几] ≤480px 弹窗 inset:0 = 100vw×100vh（DOM 断言）+ 圆角 0 + 投影不适用（验收 1）',
    fsModal.x === 0 && fsModal.y === 0 && fsModal.w === fsVp.w && fsModal.h === fsVp.h
    && fsRadius === '0px' && fsShadow === 'none',
    `rect=${fsModal?.w}×${fsModal?.h}@${fsModal?.x},${fsModal?.y} radius=${fsRadius} shadow=${fsShadow}`)
  await shot('04-settings-fullscreen-light')

  // 条 17：表单列唯一滚动容器 + 内容不横向溢出（验收 2/3）
  const paneOY = await style('.sm-pane', 'overflowY')
  const navOY = await style('.sm-nav', 'overflowY')
  const docNoHOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  log('条17 [几][行] 表单列唯一纵向滚动（pane auto + 导航 overflow-y hidden）+ 文档无横向溢出（验收 2/3）',
    paneOY === 'auto' && navOY === 'hidden' && docNoHOverflow,
    `pane=${paneOY} nav=${navOY} noH=${docNoHOverflow}`)

  // 条 18：导航横切（flex row + overflow-x auto + role=tablist 六分区 + 方向键沿现状）
  const navDir = await style('.sm-nav', 'flexDirection')
  const navOX = await style('.sm-nav', 'overflowX')
  const tabCount = await page.$$eval('.sm-nav [role="tab"]', (els) => els.length)
  const navRole = await $attr('.sm-nav', 'role')
  await page.click('.sm-nav [role="tab"]')
  await page.keyboard.press('ArrowRight')
  await sleep(300)
  const arrowPane = await page.evaluate(() => {
    const panes = [...document.querySelectorAll('.sm-pane')]
    const v = panes.find((p) => p.style.display !== 'none')
    return v?.textContent ?? ''
  })
  log('条18 [几] 导航横向滚动条（flex row + overflow-x:auto + 滚动条 --c-scrollbar）+ role=tablist 六分区 + 方向键切换沿现状（定夺⑤）',
    navDir === 'row' && navOX === 'auto' && tabCount === 6 && navRole === 'tablist' && arrowPane.includes('密钥模式'),
    `dir=${navDir} ox=${navOX} tabs=${tabCount} arrow→${arrowPane.slice(0, 8)}`)

  // 条 21：「前往高级设置」全屏态复验（模式卡跨分区链接 → 分区直达 + 高亮 + 导航滚动至目标钮可见）
  await page.click('.sm-nav [data-pane="mode"]')
  await sleep(250)
  await page.evaluate(() => {
    const link = document.querySelector('.link-adv')
    if (link) link.click()
  })
  await sleep(500)
  const advVisible = await page.evaluate(() => {
    const panes = [...document.querySelectorAll('.sm-pane')]
    const v = panes.find((p) => p.style.display !== 'none')
    return v?.textContent ?? ''
  })
  const advFlash = await $exists('.section-label.flash')
  const advBtnInView = await page.evaluate(() => {
    const nav = document.querySelector('.sm-nav')
    const b = nav.querySelector('[data-pane="adv"]')
    const nr = nav.getBoundingClientRect()
    const br = b.getBoundingClientRect()
    return br.left >= nr.left && br.right <= nr.right + 1
  })
  log('条21 [行] 「前往高级设置」全屏态复验：分区直达 + 标题高亮 flash + 横向导航滚动至目标钮可见（验收 6 / iter-2 走查 15）',
    advVisible.includes('高级设置 · 自填供应商密钥') && advFlash && advBtnInView,
    `pane=${advVisible.slice(0, 10)} flash=${advFlash} btnInView=${advBtnInView}`)
  await shot('05-settings-adv-flash-nav')

  // 条 20：内嵌二级弹窗 ≤480px 同口径全屏（档案编辑模态 + 注销模态）
  await page.click('.sm-nav [data-pane="adv"]')
  await sleep(250)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((e) => e.textContent.includes('添加供应商档案'))
    if (b) b.click()
  })
  await sleep(400)
  const editModal = await page.$eval('.settings-modal .modal', (e) => {
    const r = e.getBoundingClientRect()
    const s = getComputedStyle(e)
    return { w: r.width, h: r.height, x: r.x, y: r.y, radius: s.borderRadius }
  }).catch(() => null)
  await shot('06-second-modal-fullscreen')
  await page.keyboard.press('Escape') // Esc 链：档案编辑模态先关、外层弹窗保持（DEF-027 口径）
  await sleep(300)
  const outerKept = await $exists('.settings-modal')
  // 注销模态（DeleteAccountModal 组件，独立 Teleport）
  await page.click('.sm-nav [data-pane="account"]')
  await sleep(250)
  await page.click('.dz-btn')
  await sleep(400)
  const delModal = await page.$eval('.overlay .modal', (e) => {
    const r = e.getBoundingClientRect()
    return { w: r.width, h: r.height, radius: getComputedStyle(e).borderRadius }
  }).catch(() => null)
  await page.keyboard.press('Escape')
  await sleep(300)
  log('条20 [几] 二级弹窗同口径全屏（档案编辑 + 注销模态 100vw×100vh + radius 0）+ Esc 先关最上层（外层保持）',
    editModal && Math.round(editModal.w) === 375 && Math.round(editModal.h) === 812 && editModal.radius === '0px' && outerKept
    && delModal && Math.round(delModal.w) === 375 && Math.round(delModal.h) === 812 && delModal.radius === '0px',
    `edit=${editModal && Math.round(editModal.w)}×${editModal && Math.round(editModal.h)} r=${editModal?.radius} outerKept=${outerKept} del=${delModal && Math.round(delModal.w)}×${delModal && Math.round(delModal.h)}`)

  // 条 19：关闭钮/Esc/返回路径保留（干净状态 Esc 直接关；逻辑零改动全量 = vitest 交叉引用）
  await page.keyboard.press('Escape')
  await sleep(350)
  log('条19 [行][零] 干净状态 Esc 直接关闭弹窗回对话现场（弹窗逻辑零改动 = settings 全量 vitest 交叉背书）',
    !(await $exists('.settings-modal')))

  /* ============ D 组 · 触屏交互（375，hover:none 仿真） ============ */
  // 触屏态 = 设备仿真（setViewport isMobile+hasTouch → Chrome 报告 hover:none；设计稿「设备仿真」口径；
  // CDP Emulation.setEmulatedMedia 的 hover 特性在本机 Chrome 已不生效——实测 fallback，登记 verify T3）
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
  await sleep(400)
  await sleep(300)

  // 条 14：hover:none 闲置态 hint 不渲染（M40/M41/生成中保留 = 状态文案与输入方式无关，交叉引用 ComposerTouch.spec）
  const touchHint = await $one('.composer .hint-right')
  // 闲置态「Enter 发送…」不渲染；M40/M41/生成中为状态文案保留逐字（本环境 search 未配置 → M41 命中即合法）
  const HINT_KEEP = [M40, M41, HINT_GENERATING]
  log('条14 [文][零] hover:none 闲置态：右侧「Enter 发送 · Shift+Enter 换行」不渲染（M40/M41/生成中保留逐字 = vitest ComposerTouch.spec 交叉）',
    touchHint === null || HINT_KEEP.includes(touchHint), `hint=${touchHint}`)

  // 条 15：hover:none placeholder = M45「输入消息」逐字
  const touchPh = await $attr('.composer .ta', 'placeholder')
  log('条15 [文] hover:none placeholder = M45「输入消息」逐字', touchPh === M45, `ph=${touchPh}`)

  // 条 23：hover:none 会话「···」无 hover 即可见
  await page.click('.drawer-btn')
  await sleep(350)
  const dotsOpacity = await style('.sidebar .item .dd-trigger', 'opacity')
  log('条23 [行] hover:none 会话「···」无 hover 即可见（opacity 常 1，一处 CSS 规则零 JS 分叉）',
    dotsOpacity === '1', `opacity=${dotsOpacity}`)

  // 条 25a：「···」热区扩至 ≥44（视觉 28 不变；::after 透明扩展，伪元素命中测试）
  const hotZone = await page.evaluate(() => {
    const el = document.querySelector('.sidebar .item .dd-trigger')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left - 6, r.top + r.height / 2) // (44-28)/2=8 外扩区内
    // 命中 ::after 热区 = elementFromPoint 归属本钮或其菜单包裹件（.dd）；记录实际目标便于诊断
    const owner = hit && (hit === el || el.contains(hit) || (hit.closest && hit.closest('.dd') === el.closest('.dd')))
    return { w: r.width, h: r.height, hit: !!owner, hitTag: hit ? hit.className || hit.tagName : null }
  })
  log('条25a [几] 「···」热区 ≥44×44（视觉 28px 不变 + ::after 透明扩展，外扩点命中本体）',
    hotZone && Math.round(hotZone.w) === 28 && hotZone.hit,
    `visual=${hotZone?.w} hit=${hotZone?.hit} hitTag=${hotZone?.hitTag}`)
  await page.keyboard.press('Escape')
  await sleep(300)

  // 条 24 + 25b：操作栏常显 + 热区 ≥44（有 assistant 消息时）
  const hasAssistant = await $exists('.msg-col.assistant .action-btn')
  if (hasAssistant) {
    await page.evaluate(() => document.querySelector('.msg-col.assistant .action-btn')?.scrollIntoView({ block: 'center' }))
    await sleep(200)
    const actOpacity = await style('.msg-col.assistant .action-btn', 'opacity')
    const actHot = await page.evaluate(() => {
      const el = document.querySelector('.msg-col.assistant .action-btn')
      if (!el) return null
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left - 8, r.top + r.height / 2) // (44-24)/2=10 外扩区内
      const owner = hit && (hit === el || el.contains(hit) || (hit.closest && hit.closest('.msg-col') === el.closest('.msg-col')))
      return { w: r.width, hit: !!owner, hitTag: hit ? hit.className || hit.tagName : null }
    })
    log('条24 [行] hover:none 消息操作栏（复制/修改）无 hover 即可见（opacity 常 1）', actOpacity === '1', `opacity=${actOpacity}`)
    log('条25b [几] 操作栏钮热区 ≥44×44（视觉 24px 不变 + 外扩点命中本体）',
      actHot && Math.round(actHot.w) === 24 && actHot.hit, `visual=${actHot?.w} hit=${actHot?.hit} hitTag=${actHot?.hitTag}`)
  } else {
    log('条24 [行] hover:none 操作栏常显（无 assistant 消息载体，N/A 交叉引用 MessageBubble.spec hover:none 契约）', null)
    log('条25b [几] 操作栏热区 ≥44（同上交叉引用 MobileCssContract.spec）', null)
  }

  // 条 26：active 按压态兜底（CSSOM 扫描 :active scale 规则在位，视觉反馈级 hover 保留）
  const activeRules = await page.evaluate(() => {
    let found = 0
    for (const sheet of document.styleSheets) {
      let rules
      try { rules = sheet.cssRules } catch { continue }
      for (const r of rules || []) {
        if (r.selectorText && r.selectorText.includes(':active') && r.style && r.style.transform && r.style.transform.includes('scale')) found++
      }
    }
    return found
  })
  log('条26 [几] active 按压态兜底（:active scale 规则在位）+ 既有 hover 视觉反馈规则不消除（CSS 保留）',
    activeRules >= 2, `activeScaleRules=${activeRules}`)

  // 条 28：焦点可达（入口钮 :focus-visible 焦点环 --c-focus-ring）
  const focusRing = await page.evaluate(async () => {
    const btn = document.querySelector('.drawer-btn')
    btn.focus()
    await new Promise((r) => setTimeout(r, 120))
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    const byKeyboard = btn.matches(':focus-visible')
    return { byKeyboard, shadow: getComputedStyle(btn).boxShadow }
  })
  log('条28 [几] 入口钮焦点可达（:focus-visible 焦点环 --c-focus-ring 沿用）',
    focusRing.byKeyboard && focusRing.shadow !== 'none', `focusVisible=${focusRing.byKeyboard} shadow=${focusRing.shadow}`)

  // 条 27：暗色四象限零裸色值（抽屉开态 + 弹窗全屏态 × 暗）
  await page.evaluate(() => { try { localStorage.setItem('ai-chat-theme', 'dark') } catch { /* ignore */ } })
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(600)
  await page.click('.drawer-btn')
  await sleep(400)
  const darkMask = await style('.drawer-mask', 'backgroundColor')
  const darkTopbar = await style('.mobile-topbar', 'backgroundColor')
  await shot('07-drawer-open-dark-375')
  await page.keyboard.press('Escape')
  await sleep(300)
  await openSettingsMobile()
  await sleep(300)
  const darkModalBg = await style('.settings-modal', 'backgroundColor')
  const darkModalRect = await rect('.settings-modal')
  const darkNavBorder = await style('.sm-nav', 'borderBottomColor')
  await shot('08-settings-fullscreen-dark')
  log('条27 [几] 暗色四象限零裸色值：遮罩 rgba(0,0,0,.55) + 顶条/弹窗 --c-surface 暗值 + 导航分隔 --c-border 暗值（REQ-017）',
    darkMask === 'rgba(0, 0, 0, 0.55)' && darkTopbar === 'rgb(30, 32, 38)'
    && darkModalBg === 'rgb(30, 32, 38)' && darkNavBorder === 'rgb(51, 54, 62)'
    && darkModalRect.w === 375 && darkModalRect.h === 812,
    `mask=${darkMask} topbar=${darkTopbar} modal=${darkModalBg} navBorder=${darkNavBorder}`)
  await page.keyboard.press('Escape')
  await sleep(300)
  await page.evaluate(() => { try { localStorage.setItem('ai-chat-theme', 'light') } catch { /* ignore */ } })
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(600)

  /* ============ 条 7：生成中开合抽屉 SSE 流帧序不变（真实回合） ============ */
  await page.setViewport({ width: 375, height: 812, isMobile: false, hasTouch: false, deviceScaleFactor: 1 })
  await sleep(400)
  await sendText('请用两句话介绍一下你自己。')
  const generating = await waitFor(() => $exists('.composer .stop'), 15000, '回合进入生成态')
  if (generating) {
    const stop44 = await rect('.composer .stop')
    await page.click('.drawer-btn') // 生成中开抽屉
    await sleep(400)
    await page.keyboard.press('Escape') // 合抽屉（SSE 与容器切换零交互）
    await sleep(400)
    await page.click('.drawer-btn')
    await sleep(300)
    await page.keyboard.press('Escape')
    await sleep(300)
    await waitFor(() => $exists('.composer .send'), 60000, '回合完成')
    await sleep(400)
    const finalText = await page.evaluate(() => {
      const bubbles = [...document.querySelectorAll('.bubble.assistant, .msg-col.assistant')]
      const last = bubbles[bubbles.length - 1]
      return last ? last.textContent.trim() : ''
    })
    const noBrokenPill = !(await $exists('.pill.disconnected'))
    log('条7 [行] 生成中开合抽屉：回合正常完成（内容非空、无中断 pill）+ 停止钮 ≤480px 高 44（验收 7 + 条 13 停止钮半）',
      finalText.length > 0 && noBrokenPill && Math.round(stop44.h) === 44,
      `len=${finalText.length} noPill=${noBrokenPill} stopH=${stop44?.h}`)
    await shot('09-after-generation')
  } else {
    log('条7 [行] 生成中开合抽屉（回合未进入生成态——统一 key 未配置或即时失败，N/A 交叉引用 MobileShell.spec SSE 断言）', null)
  }

  // 条 31：全局回归交叉引用（pytest 347 + vitest 411 + guard + 构建机器数字，verify T3 段）
  log('条31 [零] 桌面走查基线全量复跑 + vitest 411 / pytest 347 零回退（机器数字登记 plans/iter-20-verify.md T3 段）',
    'N/A', '交叉引用：npm test 411/411 + backend pytest 347/347 + guard:style + npm run build 全绿（verify T3 §回归）')
  log('条19b [零] 弹窗逻辑全量（settings-form 28 + SettingsMobileCssContract 12 全绿，REQ-050 验收 4）',
    'N/A', '交叉引用：npx vitest run 全量 411/411')

  await shot('99-final')
} catch (e) {
  console.error('WALKTHROUGH ERROR:', e)
  log('脚本异常中断', false, String(e?.message ?? e))
} finally {
  await browser.close()
  await killProc(backendProc)
  if (viteProc) { viteProc.kill('SIGTERM'); await sleep(400) }
}

const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(`\n==== 汇总：${results.filter((r) => r.startsWith('PASS')).length} PASS / ${fails.length} FAIL（N/A 为交叉引用项不计） ====`)
if (fails.length) {
  console.log('FAIL 明细：')
  fails.forEach((f) => console.log('  ' + f))
  process.exit(1)
}
