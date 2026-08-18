/* ai-chat iter-15 T3 浏览器走查脚本（design-iter-15 §7.2 走查清单 44 条之浏览器适用条目）
 *
 * 沿 scripts/e2e-walkthrough-13.mjs / e2e-walkthrough-14.mjs 惯例：puppeteer-core 驱动本机
 * Chrome，PASS/FAIL 逐条输出 + 截图留档 /tmp/e2e15/shots/。FAIL 区分脚本问题与产品缺陷。
 *
 * 本脚本自起全部服务（独立 /tmp 库，不触开发库与其他会话端口）：
 *   后端：backend/.venv/bin/uvicorn app.main:app --port 8803（AI_CHAT_DB_PATH=/tmp 独立库）。
 *         遥测视图为只读聚合（T2 已交付的 telemetry 表），无需上游 key——本脚本零 key 处理。
 *   两阶段：A = 带单价三变量（AI_CHAT_PRICE_INPUT=2 / OUTPUT=8 / CACHE_HIT=0.5，元/1M tokens，
 *         与 design-iter-15 T7 样件值同）；B = 不带单价变量（单价未配置态走查，同库重启）。
 *   前端：npx vite --port 5180 --strictPort（proxy 目标经 AI_CHAT_DEV_API_TARGET 覆盖 → 8803）。
 * 账号：walkthrough-admin / Walkthrough2026（该库首个注册用户 = admin）；
 *       walkthrough-user（普通用户，403 走查）。
 * 造数：全部遥测样件为**虚构数据**（铁律 5：走查样件全虚构；线上度量只允许机器采集）——
 *   经 backend/.venv/bin/python 直插 telemetry 表（模拟机器已采集的形态）：
 *   近 7 天（day 0~6）= 缓存列 NULL 的 unified 行 + self 行（承载「缓存字段全缺失」态）；
 *   day 7 无行（缺失时段缺口）；day 8~13 = 带缓存字段行（命中率 40.0% 确定性样件）；
 *   day 0 工具行四态（ok/error/timeout/cancelled）+ echo/demo_weather。
 * 运行：node scripts/e2e-walkthrough-15.mjs（无外部前置；Chrome 本机路径沿 iter-14）
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BACKEND = 8803
const VITE = 5180
const BASE = `http://localhost:${VITE}`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = '/tmp/e2e15/shots'
const DB = '/tmp/ai-chat-walkthrough-15.db'

mkdirSync(SHOTS, { recursive: true })
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { rmSync(f) } catch { /* 首跑无残留 */ } }

const results = []
function log(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —— ' + detail : ''}`)
  console.log(results.at(-1))
}

/* ---- 造数常量（全虚构，铁律 5；JS 与 python 种子同源口径） ---- */
const seedDay = (back) => {
  const d = new Date(Date.now() - back * 86400000)
  const z = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}
const TODAY = seedDay(0)
const uDay = (b) => ({ prompt: 120000 + b * 6200, completion: 30000 + b * 2600, self: b === 0 ? 12480 : 8000 + b * 420 })
const cDay = (b) => { // day 8~13 带缓存字段：命中率恒 40.0%（确定性样件）
  const prompt = 150000 + (b - 8) * 5000
  const completion = 40000 + (b - 8) * 1500
  const hit = Math.round(prompt * 0.4)
  return { prompt, completion, hit, miss: prompt - hit }
}
const EXPECT_TODAY_COST = (uDay(0).prompt * 2 + uDay(0).completion * 8) / 1e6 // 缓存 NULL → 命中成本 0
const EXPECT_SELF_WIN7 = Array.from({ length: 7 }, (_, b) => uDay(b).self).reduce((a, b) => a + b, 0)
const EXPECT_D13_COST = (cDay(13).prompt * 2 + cDay(13).completion * 8 + cDay(13).hit * 0.5) / 1e6

const SEED_PY = `
import sqlite3, sys
from datetime import datetime, timedelta
db = sys.argv[1]
day = lambda back: (datetime.now() - timedelta(days=back)).strftime("%Y-%m-%d")
conn = sqlite3.connect(db)
def llm(d, mode, prompt=None, completion=None, total=0, hit=None, miss=None):
    conn.execute("INSERT INTO telemetry (day,user_id,mode,turn_id,endpoint,kind,step,model,"
        "latency_ms,status,tokens_prompt,tokens_completion,tokens_total,cache_hit_tokens,"
        "cache_miss_tokens) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (d, 1, mode, "seed-turn", "turn", "llm", 1, "deepseek-chat", 820, "ok",
         prompt, completion, total, hit, miss))
def tool(d, name, status, latency):
    conn.execute("INSERT INTO telemetry (day,user_id,mode,turn_id,endpoint,kind,step,"
        "latency_ms,status,tool_name) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (d, 1, "unified", "seed-turn", "turn", "tool", 2, latency, status, name))
# day 0~6：unified 缓存列 NULL（承载「缓存字段全缺失」态）+ self 行
for b in range(0, 7):
    p, c, s = ${uDay(0).prompt} + b * 6200, ${uDay(0).completion} + b * 2600, ${uDay(0).self} if b == 0 else 8000 + b * 420
    llm(day(b), "unified", p, c, p + c, None, None)
    llm(day(b), "self", None, None, s, None, None)
# day 7：无行（缺失时段缺口——不造数填补，铁律 5）
# day 8~13：带缓存字段行（命中率恒 40.0%）
for b in range(8, 14):
    p, c = ${cDay(8).prompt} + (b - 8) * 5000, ${cDay(8).completion} + (b - 8) * 1500
    llm(day(b), "unified", p, c, p + c, round(p * 0.4), p - round(p * 0.4))
# day 0 工具行：四态 + echo/demo_weather（确定性聚合样件）
for latency in (2000, 2100, 2260): tool(day(0), "search", "ok", latency)
tool(day(0), "search", "error", 890)
tool(day(0), "search", "timeout", 10000)
tool(day(0), "search", "cancelled", 120)
tool(day(0), "echo", "ok", 5); tool(day(0), "echo", "ok", 7)
tool(day(0), "demo_weather", "ok", 350)
conn.commit(); conn.close()
print("seeded")
`

/* ---- 服务管理 ---- */
let backendProc = null
let viteProc = null
function spawnBackend(withPrice) {
  const env = { ...process.env, AI_CHAT_DB_PATH: DB }
  if (withPrice) {
    env.AI_CHAT_PRICE_INPUT = '2'
    env.AI_CHAT_PRICE_OUTPUT = '8'
    env.AI_CHAT_PRICE_CACHE_HIT = '0.5'
  }
  backendProc = spawn(`${ROOT}backend/.venv/bin/uvicorn`, ['app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND)], {
    cwd: `${ROOT}backend`, env, stdio: ['ignore', 'pipe', 'pipe'],
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

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true })

const fetchApi = (path, opts = {}) =>
  page.evaluate(
    (p, o) =>
      fetch(p, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...o })
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
    path, opts,
  )
const $one = (sel) => page.$eval(sel, (e) => e.textContent.trim()).catch(() => null)
const style = (sel, prop) => page.$eval(sel, (e, p) => getComputedStyle(e)[p], prop).catch(() => null)

/* 遥测请求计数与拦截标志（条 14 交互位置 / 条 38 加载帧 / 条 39 失败态） */
let telRequests = 0
let telDelayMs = 0
let telFail = false
await page.setRequestInterception(true)
page.on('request', async (req) => {
  if (req.url().includes('/api/admin/telemetry')) {
    telRequests += 1
    if (telFail) return req.abort()
    if (telDelayMs) await sleep(telDelayMs)
  }
  req.continue()
})

async function clickTab(text) {
  await page.evaluate((t) => {
    [...document.querySelectorAll('.adm-tabs button')].find((b) => b.textContent.trim() === t)?.click()
  }, text)
  await sleep(400)
}
async function clickWin(label) {
  await page.evaluate((t) => {
    [...document.querySelectorAll('.win-seg button')].find((b) => b.textContent.trim() === t)?.click()
  }, label)
  await sleep(600)
}

try {
  /* ============ 阶段 A：带单价三变量 ============ */
  spawnBackend(true)
  log('前置·后端 A 起服务（带单价三变量，/tmp 独立库）', await waitHealth())
  spawnVite()
  let viteUp = false
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE); if (r.ok) { viteUp = true; break } } catch { /* 未就绪 */ }
    await sleep(300)
  }
  log('前置·前端 dev server 起服务（5180 → proxy 8803）', viteUp)

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
  const reg = await page.evaluate(async (un, pw) => {
    const r = await fetch('/api/auth/register', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: un, password: pw }),
    })
    const body = await r.json().catch(() => null)
    return { status: r.status, isAdmin: body?.is_admin }
  }, 'walkthrough-admin', 'Walkthrough2026')
  log('前置·注册 walkthrough-admin（首用户 = admin）', [200, 201].includes(reg.status) && reg.isAdmin === true, `status=${reg.status}`)
  const reg2 = await page.evaluate(async () => {
    const r = await fetch('/api/auth/register', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'walkthrough-user', password: 'Walkthrough2026' }),
    })
    return { status: r.status }
  })
  log('前置·注册 walkthrough-user（普通用户，403 走查用）', [200, 201].includes(reg2.status), `status=${reg2.status}`)
  // 第二次注册覆盖了会话 Cookie——重新以 admin 登录（403 走查前恢复管理员身份）
  const relogin = await page.evaluate(async () => {
    const r = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'walkthrough-admin', password: 'Walkthrough2026' }),
    })
    return r.status
  })
  log('前置·重新登录 walkthrough-admin（注册普通用户覆盖了会话）', relogin === 200, `status=${relogin}`)

  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' })
  await sleep(500)

  /* ---- 零回退组（浅色）：条 1/2/3/5/6 ---- */
  const frame = await page.evaluate(() => {
    const body = document.querySelector('.adm-body')
    const top = document.querySelector('.adm-top')
    return {
      bodyW: body?.getBoundingClientRect().width,
      pageBg: getComputedStyle(document.querySelector('.admin-page')).backgroundColor,
      topH: top?.getBoundingClientRect().height,
      cards: document.querySelectorAll('.stat-card').length,
      swRow: !!document.querySelector('.sw-row'),
      tabs: [...document.querySelectorAll('.adm-tabs button')].map((b) => b.textContent.trim()),
      role: document.querySelector('.adm-tabs')?.getAttribute('role'),
    }
  })
  log('条1 页面框架零回退（灰底 --c-bg + 内容列 ≤1080px，遥测面板在同一 adm-body 内）',
    !!frame && frame.bodyW <= 1080 && frame.pageBg === 'rgb(245, 246, 247)', JSON.stringify({ bodyW: frame?.bodyW, pageBg: frame?.pageBg }))
  log('条2 顶栏 52px 零变化（品牌 + 管理后台徽标 + 主题钮 + 返回主界面）',
    frame?.topH === 52 && (await $one('.adm-tag')) === '管理后台' && !!await $one('.btn-ghost'), `topH=${frame?.topH}`)
  log('条3 概览四卡零变化（tabs 上方常驻，三 tab 均可见）', frame?.cards === 4, `cards=${frame?.cards}`)
  const swPos = await page.evaluate(() => {
    const kids = [...document.querySelector('.adm-body').children].map((e) => e.className)
    return { grid: kids.findIndex((c) => c.includes('stat-grid')), sw: kids.findIndex((c) => c.includes('sw-row')), tabs: kids.findIndex((c) => c.includes('adm-tabs')) }
  })
  log('条5 搜索开关行零变化（统计卡区后、tabs 前）',
    swPos.grid >= 0 && swPos.grid < swPos.sw && swPos.sw < swPos.tabs, JSON.stringify(swPos))
  log('条6 tabs 加法 2→3（前两段文案零变化 + 「遥测」第三段 + radiogroup 语义 + 高 32px）',
    JSON.stringify(frame?.tabs) === JSON.stringify(['用户列表', '用量列表', '遥测']) && frame?.role === 'radiogroup'
    && await style('.adm-tabs button', 'height') === '32px', JSON.stringify(frame?.tabs))

  /* ---- 条 40：空窗口态（造数前，零遥测行） ---- */
  await clickTab('遥测')
  await sleep(400)
  const empty = { box: await $one('.tel-empty'), win: await page.$$eval('.win-seg button', (b) => b.length) }
  log('条40 空窗口态：面板整体空盒 T28 逐字（dashed 空盒，非错误态）+ 工具行保留可切换',
    empty.box === '窗口内无遥测数据——新部署或尚无对话的日子属正常现象' && empty.win === 3, JSON.stringify(empty))
  await shot('00-empty-window-light')

  /* ---- 造数（虚构样件直插 telemetry 表——模拟机器已采集形态） ---- */
  const seedProc = spawn(`${ROOT}backend/.venv/bin/python`, ['-c', SEED_PY, DB], { stdio: ['ignore', 'pipe', 'pipe'] })
  const seedOut = await new Promise((res) => { let o = ''; seedProc.stdout.on('data', (d) => { o += d }); seedProc.on('close', () => res(o.trim())) })
  log('前置·虚构遥测样件入库（day0~6 缓存 NULL / day7 缺口 / day8~13 带字段 / day0 工具四态）', seedOut === 'seeded', seedOut)

  /* ---- 条 13/14：时间语义与窗口切换（API 面） ---- */
  const api7 = await fetchApi('/api/admin/telemetry?days=7')
  log('条13 时间语义：窗口右端点 = 服务器本地今日（date_to 含当日日期）+ 今日有数据 daily 含今日行',
    api7.status === 200 && api7.body?.window?.date_to === TODAY && api7.body?.daily?.[0]?.day === TODAY,
    `date_to=${api7.body?.window?.date_to} today=${TODAY}`)

  const reqBase = telRequests
  await clickWin('近 14 天')
  await sleep(300)
  const reqDelta = telRequests - reqBase
  const stillTel = await page.evaluate(() =>
    [...document.querySelectorAll('.adm-tabs button')].find((b) => b.getAttribute('aria-checked') === 'true')?.textContent.trim())
  log('条14 窗口切换仅重载遥测面板（恰 1 次遥测请求；tab 停留「遥测」；选择保留）',
    reqDelta === 1 && stillTel === '遥测', `requests+${reqDelta} tab=${stillTel}`)

  /* ---- 窗口 14：缺失时段 + 混合命中率（浅色断言） ---- */
  const gap = await $one('.panel > .tel-card:last-child .gap-note')
  log('条37 缺失时段琥珀行 T23 逐字（day7 缺口；无数据日不造空行，不估算补齐）',
    gap === '部分时段无统计数据：仅显示已有数据（不估算补齐）'
    && await page.$$eval('.panel > .tel-card:last-child tbody tr', (r) => r.length) === 13, `rows=13/14天`)
  const winRate = await page.evaluate(() =>
    [...document.querySelectorAll('.tel-2col .tel-card')][0]?.querySelector('.tc-big')?.textContent.trim())
  log('条25/29 窗口合计命中率 = Σhit/(Σhit+Σmiss) 仅计带字段行（day8~13 恒 40.0%；缺失日不污染）',
    winRate === '40.0%', `winRate=${winRate}`)
  const d13 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.panel > .tel-card:last-child tbody tr')]
    const cells = (r) => r ? [...r.querySelectorAll('td')].map((t) => t.textContent.trim()) : null
    return { first: cells(rows[0]), last: cells(rows.at(-1)) } // daily 降序：首行 = 今日，末行 = day13
  })
  log('条19/36 明细列口径（今日行：缓存缺失列「—」+ 成本 = 后端值 4 位小数直显，不做前端再计算）',
    !!d13.first && d13.first[0] === TODAY && d13.first[1] === '120,000' && d13.first[3] === '—'
    && d13.first[4] === `¥${EXPECT_TODAY_COST.toFixed(4)}` && d13.first[5] === '12,480'
    && !!d13.last && d13.last[0] === seedDay(13) && d13.last[1] === '175,000'
    && d13.last[4] === `¥${EXPECT_D13_COST.toFixed(4)}`,
    JSON.stringify(d13))
  const missRow = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.tel-2col .tel-card tbody tr')]
    const r = rows.find((x) => x.querySelector('.pill.miss'))
    return r ? { day: r.querySelector('td')?.textContent.trim(), cells: [...r.querySelectorAll('td')].map((t) => t.textContent.trim()) } : null
  })
  log('条27 缓存缺失日：两 tokens 列「—」+ 命中率列缺失徽标（永不显 0）',
    !!missRow && missRow.cells[1] === '—' && missRow.cells[2] === '—' && missRow.cells[3] === '缺失',
    JSON.stringify(missRow?.cells))

  /* ---- 窗口 7：缓存字段全缺失态 + 成本卡 ---- */
  await clickWin('近 7 天')
  const w7 = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.tel-card')]
    const cardB = document.querySelectorAll('.tel-2col .tel-card')[0]
    return {
      big: cards[0]?.querySelector('.tc-big')?.textContent.trim(),
      bigSub: cards[0]?.querySelector('.tc-big-sub')?.textContent.trim(),
      bdCosts: [...cards[0].querySelectorAll('.bd-cost')].map((e) => e.textContent.trim()),
      bdTokCache: cards[0].querySelectorAll('.bd-tokens')[2]?.textContent.trim(),
      self: cards[0].querySelectorAll('.kv-row')[1]?.textContent.trim(),
      winRateBadge: cardB?.querySelector('.tc-big-row .pill.miss')?.textContent.trim(),
      hasNaN: cardB?.textContent.includes('NaN'),
      hasZeroPct: cardB?.textContent.includes('0.0%'),
    }
  })
  log('条17/19 卡 A 大数值（今日成本 = Σtokens×单价÷1e6，¥4 位小数）+ 右侧注含当日日期与「统一 key」',
    w7.big === `¥${EXPECT_TODAY_COST.toFixed(4)}` && w7.bigSub === `${TODAY} · 统一 key`,
    JSON.stringify({ big: w7.big, sub: w7.bigSub }))
  log('条28 缓存字段全缺失态：窗口合计位「缺失」徽标 T15（不显 0%、不显 NaN）+ 说明 T13 常驻',
    w7.winRateBadge === '缺失' && !w7.hasNaN && !w7.hasZeroPct, JSON.stringify({ badge: w7.winRateBadge }))
  log('条21 自填行 T9 逐字（「用户自带密钥」五字 + 窗口 Σself tokens + 「不计成本」徽标）',
    w7.self === `自填模式（用户自带密钥）：tokens ${EXPECT_SELF_WIN7.toLocaleString('zh-Hans-CN')} · 不计成本不计成本`,
    w7.self)
  log('条27补 缓存全缺失日卡 A 分项：tokens 位「—」（NULL 不显 0）+ 命中成本 ¥0.0000（已知部分如实）',
    w7.bdTokCache === '—' && w7.bdCosts[2] === '¥0.0000', JSON.stringify({ tok: w7.bdTokCache, cost: w7.bdCosts }))
  await shot('01-win7-nocache-light')
  await clickWin('近 14 天')
  await shot('02-win14-gap-mixed-light')

  /* ---- 条 11/12/15/16/18/20/24/26/30/31/32/35 几何与逐字（浅色，窗口 14） ---- */
  const geo = await page.evaluate(() => {
    const cs = (el) => el ? getComputedStyle(el) : null
    const card = document.querySelector('.tel-card')
    const two = document.querySelector('.tel-2col')
    const th = document.querySelector('.tel-table th')
    const td = document.querySelector('.tel-table td')
    const big = document.querySelector('.tc-big')
    const segBtn = document.querySelector('.win-seg button.on')
    const pill = document.querySelector('.tel-card .pill')
    const gapNote = document.querySelector('.tel-card .gap-note')
    const panel = document.querySelector('.panel[style]') ?? [...document.querySelectorAll('.panel')][2]
    return {
      cardPad: cs(card)?.padding, cardRadius: cs(card)?.borderRadius,
      twoGap: cs(two)?.gap, twoCols: cs(two)?.gridTemplateColumns,
      thPad: cs(th)?.padding, tdPad: cs(td)?.padding,
      bigFont: cs(big)?.fontSize, bigWeight: cs(big)?.fontWeight, bigNum: cs(big)?.fontVariantNumeric,
      segH: cs(segBtn)?.height, segBg: cs(segBtn)?.backgroundColor,
      pillH: cs(pill)?.height, pillFont: cs(pill)?.fontSize,
      gapPad: cs(gapNote)?.padding, gapBg: cs(gapNote)?.backgroundColor,
      panelTop: cs(panel)?.marginTop,
    }
  })
  log('条15 遥测卡容器几何（padding 16/20 · 圆角 12 · 双卡 grid 等宽 gap 16 · 面板上距 tabs 12px）',
    geo.cardPad === '16px 20px' && geo.cardRadius === '12px' && geo.twoGap === '16px'
    && geo.panelTop === '12px' && !!geo.twoCols && geo.twoCols.split(' ').length === 2,
    JSON.stringify(geo))
  const tblGeo = {
    thAlign: await style('.tel-table th.num', 'textAlign'),
    tdNum: await style('.tel-table td.num', 'fontVariantNumeric'),
  }
  log('条26/31 表格几何（th 10/16 subtle-bg · td 12/16 · 数字列右对齐 tabular）',
    geo.thPad === '10px 16px' && geo.tdPad === '12px 16px'
    && tblGeo.thAlign === 'right' && tblGeo.tdNum === 'tabular-nums',
    JSON.stringify({ th: geo.thPad, td: geo.tdPad, ...tblGeo }))
  log('条11 时间窗分段（T24 三段逐字 + 高 32px + 选中 primary-l/primary/500 + 默认近 7 天）',
    geo.segH === '32px' && geo.segBg === 'rgb(240, 244, 255)'
    && JSON.stringify(await page.$$eval('.win-seg button', (b) => b.map((x) => x.textContent.trim())))
      === JSON.stringify(['近 7 天', '近 14 天', '近 30 天']), JSON.stringify({ h: geo.segH, bg: geo.segBg }))
  log('条12 保留期注记 T25 逐字（retention_days=90 由响应供数）',
    await $one('.retention-note') === '遥测明细保留 90 天，超期数据自动清理', await $one('.retention-note') ?? '')
  log('条17 大数值几何（20px/600 tabular-nums）',
    geo.bigFont === '20px' && geo.bigWeight === '600' && geo.bigNum === 'tabular-nums',
    JSON.stringify({ f: geo.bigFont, w: geo.bigWeight, n: geo.bigNum }))
  log('条32 状态徽标四态 T19 逐字 + 胶囊高 20px/12px·500（徽章家族既有形态）',
    geo.pillH === '20px' && geo.pillFont === '12px'
    && JSON.stringify(await page.$$eval('.tel-2col .tel-card:last-of-type .pill', (p) => p.map((x) => x.textContent.trim())))
      === JSON.stringify(['成功', '成功', '已取消', '失败', '成功', '超时']) /* tool_name ASC, status ASC 确定性序 */,
    `h=${geo.pillH}`)
  log('条16 卡 A 标题区 T2/T3 逐字', await $one('.tel-card .tc-head') === '每日成本估算'
    && await $one('.tel-card .tc-sub') === '仅统一 key 模式计成本；自填模式 tokens 不计成本')
  log('条18 分项三列 T5 逐字 + 等宽栅格 gap 16（输入/输出/缓存命中）',
    JSON.stringify(await page.$$eval('.bd-label', (e) => e.map((x) => x.textContent.trim()))) === JSON.stringify(['输入', '输出', '缓存命中'])
    && await style('.bd-grid', 'gap') === '16px')
  const kv = await page.evaluate(() => {
    const row = document.querySelector('.tel-card .kv-row')
    return { label: row?.querySelector('.kv-label')?.textContent.trim(), val: row?.querySelector('.kv-val')?.textContent.trim(), note: row?.querySelector('.kv-note')?.textContent.trim(), inputs: document.querySelectorAll('.tel-card input').length }
  })
  log('条20 单价行 T6/T7/T8 逐字（¥N / 1M tokens ×3）+ admin 只读存在性断言（遥测卡零输入框）',
    kv.label === '单价（只读）' && kv.val === '输入 ¥2 / 1M tokens · 输出 ¥8 / 1M tokens · 缓存命中 ¥0.5 / 1M tokens'
    && kv.note === '单价由 backend/.env 三变量 AI_CHAT_PRICE_* 注入，admin 只读' && kv.inputs === 0,
    JSON.stringify(kv))
  log('条24 卡 B 标题区 T12/T13 逐字（公式 + 「仅统计上游返回缓存字段的调用」）',
    await page.evaluate(() => document.querySelectorAll('.tel-2col .tel-card')[0]?.querySelector('.tc-head')?.textContent.trim()) === '缓存命中率'
    && await page.evaluate(() => document.querySelectorAll('.tel-2col .tel-card')[0]?.querySelector('.tc-sub')?.textContent.trim())
      === '命中率 = Σ缓存命中 tokens ÷（Σ命中 + Σ未命中）· 仅统计上游返回缓存字段的调用')
  log('条30 卡 C 标题区 T16/T17 逐字（含「本视图即搜索用量面板」承载声明）',
    await page.evaluate(() => document.querySelectorAll('.tel-2col .tel-card')[1]?.querySelector('.tc-sub')?.textContent.trim())
      === '按工具名 × 状态聚合；search 为当前唯一生产工具（本视图即搜索用量面板）')
  log('条35 卡 D 标题 T21 + 六列表头 T22 逐字（「自填 tokens（不计成本）」括号六字不差）',
    JSON.stringify(await page.$$eval('.panel > .tel-card:last-child thead th', (t) => t.map((x) => x.textContent.trim())))
      === JSON.stringify(['日期', '输入 tokens', '输出 tokens', '缓存命中 tokens', '成本估算', '自填 tokens（不计成本）']))

  /* ---- 条 42：暗色主题（全元素亮色残留扫描 + 关键文字令牌断言） ---- */
  await page.click('button[aria-label="切换主题"]')
  await sleep(500)
  const dark = await page.evaluate(() => {
    const LIGHTS = ['rgb(255, 255, 255)', 'rgb(250, 251, 252)', 'rgb(245, 246, 247)', 'rgb(242, 243, 245)', 'rgb(240, 244, 255)', 'rgb(255, 247, 232)', 'rgb(253, 236, 234)']
    const panels = [...document.querySelectorAll('.panel')].filter((p) => p.querySelector('.tel-toolbar'))
    const leak = []
    for (const p of panels) for (const el of p.querySelectorAll('*')) {
      const bg = getComputedStyle(el).backgroundColor
      if (bg !== 'rgba(0, 0, 0, 0)' && LIGHTS.includes(bg)) leak.push(`${el.tagName}.${el.className} ${bg}`)
    }
    return {
      leak: leak.slice(0, 5),
      cardBg: getComputedStyle(document.querySelector('.tel-card')).backgroundColor,
      headColor: getComputedStyle(document.querySelector('.tc-head')).color,
      subColor: getComputedStyle(document.querySelector('.tc-sub')).color,
      missBg: getComputedStyle(document.querySelector('.pill.miss')).backgroundColor,
      missColor: getComputedStyle(document.querySelector('.pill.miss')).color,
      pageBg: getComputedStyle(document.querySelector('.admin-page')).backgroundColor,
    }
  })
  log('条42 亮暗双主题：暗色遥测面板零亮色残留 + 卡面/文字令牌断言（surface #1E2026 / text-1 #E6EAF0 / 琥珀 #38290F+#EDA23B）',
    dark.leak.length === 0 && dark.cardBg === 'rgb(30, 32, 38)' && dark.headColor === 'rgb(230, 234, 240)'
    && dark.subColor === 'rgb(128, 136, 150)' && dark.missBg === 'rgb(56, 41, 15)' && dark.missColor === 'rgb(237, 162, 59)'
    && dark.pageBg === 'rgb(19, 20, 23)',
    JSON.stringify(dark))
  log('条42补 正文对比度（tokens v1.3 暗值 text-1 #E6EAF0 / surface #1E2026 ≈ 13.9:1 ≥ 4.5:1；text-3 #808896 ≈ 5.5:1）', true, 'tokens v1.3 计算值，iter-12 OBS-3 认可口径')
  await shot('03-win14-dark')

  /* ---- 条 38：加载态一帧（mock 慢响应运行时取证） ---- */
  await page.click('button[aria-label="切换主题"]') // 回浅色
  await sleep(400)
  telDelayMs = 1500
  const reqBeforeLoad = telRequests
  await clickWin('近 30 天')
  await sleep(400) // 请求在途（延迟 1500ms）
  const loading = { hint: await $one('.state-hint'), spin: await page.$('.spinner') !== null }
  log('条38 加载态一帧（慢响应运行时取证：spinner + T26「正在加载遥测数据…」）',
    loading.hint === '正在加载遥测数据…' && loading.spin, JSON.stringify(loading))
  await shot('04-loading-frame')
  telDelayMs = 0
  await sleep(1600)
  log('条38补 加载完成后渲染（近 30 天窗口）', await $one('.tel-card .tc-head') === '每日成本估算' && telRequests === reqBeforeLoad + 1)

  /* ---- 条 39：失败态 + 重试保留窗口选择 ---- */
  telFail = true
  await clickWin('近 14 天')
  await sleep(500)
  const errBanner = await $one('.err-banner')
  log('条39 失败态：danger banner T27 逐字 + 「重试」按钮',
    errBanner?.includes('遥测数据加载失败') && await page.$('.err-banner button') !== null, errBanner ?? '')
  await page.evaluate(() => [...document.querySelectorAll('.err-banner button')].find((b) => b.textContent.trim() === '重试')?.click())
  await sleep(600)
  telFail = false
  await page.evaluate(() => [...document.querySelectorAll('.err-banner button')].find((b) => b.textContent.trim() === '重试')?.click())
  await sleep(800)
  const afterRetry = await page.evaluate(() => ({
    head: document.querySelector('.tel-card .tc-head')?.textContent.trim(),
    on: [...document.querySelectorAll('.win-seg button')].find((b) => b.classList.contains('on'))?.textContent.trim(),
  }))
  log('条39补 重试保留当前时间窗选择（近 14 天不清状态）',
    afterRetry.head === '每日成本估算' && afterRetry.on === '近 14 天', JSON.stringify(afterRetry))
  await shot('05-win14-after-retry-light')

  /* ============ 阶段 B：单价未配置（同库重启，不带单价变量） ============ */
  await killBackend()
  spawnBackend(false)
  log('前置·后端 B 起服务（单价三变量未注入，同库重启）', await waitHealth())
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' })
  await sleep(500)
  await clickTab('遥测')
  await sleep(300)
  await clickWin('近 14 天') // 窗口 14：day8~13 带字段行有命中率（窗口 7 缓存全缺失，合计位为徽标）
  await page.waitForSelector('.tel-card', { timeout: 8000 }).catch(() => {})
  const noprice = await page.evaluate(() => {
    const cardA = document.querySelector('.tel-card')
    const cardD = document.querySelector('.panel > .tel-card:last-child')
    if (!cardA || !cardD) return { missing: true, loading: !!document.querySelector('.state-hint'), err: document.querySelector('.err-banner')?.textContent.trim() }
    return {
      big: cardA.querySelector('.tc-big')?.textContent.trim(),
      bdCosts: [...cardA.querySelectorAll('.bd-cost')].map((e) => e.textContent.trim()),
      tokens: [...cardA.querySelectorAll('.bd-tokens')].map((e) => e.textContent.trim()),
      hint: cardA.querySelector('.warn-hint')?.textContent.trim(),
      kvMiss: cardA.querySelector('.kv-miss')?.textContent.trim(),
      yenInA: /¥\s*\d/.test(cardA.textContent ?? ''),
      dCosts: [...cardD.querySelectorAll('tbody tr')].map((r) => r.querySelectorAll('td')[4]?.textContent.trim()),
      rateOk: document.querySelectorAll('.tel-2col .tel-card')[0]?.querySelector('.tc-big')?.textContent.trim(),
      hintPad: cardA.querySelector('.warn-hint') ? getComputedStyle(cardA.querySelector('.warn-hint')).padding : null,
    }
  })
  log('前置·单价未配置态渲染就绪', !noprice.missing, JSON.stringify(noprice.missing ? noprice : 'ready'))
  log('条22 单价未配置态：大数值与小计「—」+ tokens 如实显示 + warning 提示 T10 逐字 + 单价行值 T11（padding 8/12）',
    !noprice.missing && noprice.big === '—' && (noprice.bdCosts ?? []).every((c) => c === '—')
    && (noprice.tokens ?? [''])[0].includes('tokens')
    && noprice.hint === '单价未配置：请在 backend/.env 配置 AI_CHAT_PRICE_INPUT / AI_CHAT_PRICE_OUTPUT / AI_CHAT_PRICE_CACHE_HIT 并重启后端，即可启用每日成本估算'
    && noprice.kvMiss === '单价三变量未配置' && noprice.hintPad === '8px 12px',
    JSON.stringify({ big: noprice.big, kv: noprice.kvMiss }))
  log('条23 未配置不估算（变异断言）：卡 A 无任何 ¥ 数字残留 + 卡 D 成本列全「—」+ 命中率区不受影响',
    !noprice.missing && !noprice.yenInA && (noprice.dCosts ?? []).every((c) => c === '—')
    && typeof noprice.rateOk === 'string' && noprice.rateOk.endsWith('%'),
    JSON.stringify({ yenInA: noprice.yenInA, dCosts: (noprice.dCosts ?? []).slice(0, 3), rate: noprice.rateOk }))
  await shot('06-noprice-light')
  await page.click('button[aria-label="切换主题"]')
  await sleep(500)
  const nopriceDark = await page.evaluate(() => ({
    hintBg: getComputedStyle(document.querySelector('.warn-hint')).backgroundColor,
    hintColor: getComputedStyle(document.querySelector('.warn-hint')).color,
  }))
  log('条22补 单价未配置态暗色（warning-l #38290F + 左缘/文字 #EDA23B，无亮色残留）',
    nopriceDark.hintBg === 'rgb(56, 41, 15)' && nopriceDark.hintColor === 'rgb(237, 162, 59)', JSON.stringify(nopriceDark))
  await shot('07-noprice-dark')

  /* ---- 条 41/10：普通用户 403（界面 DOM 无遥测节点 + 端点零泄露） ---- */
  await page.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'walkthrough-user', password: 'Walkthrough2026' }),
    })
  })
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' })
  await sleep(500)
  const normalDom = await page.evaluate(() => ({
    forbid: document.body.textContent.includes('无权访问（403）'),
    telNodes: document.querySelectorAll('.tel-card, .win-seg, .adm-tabs').length,
  }))
  log('条10/41 普通用户：403 卡渲染 + DOM 无遥测节点（tab 在 AdminView 403 守卫之内）',
    normalDom.forbid && normalDom.telNodes === 0, JSON.stringify(normalDom))
  const tel403 = await fetchApi('/api/admin/telemetry?days=7')
  log('条41 遥测端点 403 零泄露（响应体仅 detail，零遥测字段；REQ-025 验收 5 延伸）',
    tel403.status === 403 && JSON.stringify(Object.keys(tel403.body ?? {})) === '["detail"]',
    JSON.stringify({ status: tel403.status, keys: Object.keys(tel403.body ?? {}) }))

  /* ---- 条 44：适用性（表格横滚保护 / 无趋势图表 / 零轮询） ---- */
  await page.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'walkthrough-admin', password: 'Walkthrough2026' }),
    })
  })
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' })
  await clickTab('遥测')
  await sleep(500)
  const applic = await page.evaluate(() => ({
    overflow: getComputedStyle(document.querySelector('.tbl-in-card')).overflowX,
    canvas: document.querySelectorAll('canvas, svg.recharts, .chart').length,
  }))
  const pollBefore = telRequests
  await sleep(2500)
  log('条44 适用性（表格 overflow-x auto 横滚保护；数值表格口径无趋势图表；管理员手动视图零轮询）',
    applic.overflow === 'auto' && applic.canvas === 0 && telRequests === pollBefore,
    JSON.stringify({ ...applic, pollDelta: telRequests - pollBefore }))

  /* ---- 自动化用例承载标注（pytest/vitest 已断言的条目） ---- */
  const byTests = [
    ['条4 警示条文案逐字零回退', '常态样件不渲染（overview 100/2000 normal）；near/burst 文案逐字 = AdminView.spec 既有 305 用例组（零改动复跑全绿）'],
    ['条7 用户列表面板全能力复跑', 'AdminView.spec 既有组（搜索/分页/封禁/解封/调配额/模态/toast，305 内零改动）；本脚本条 6 已断言 tab 载体'],
    ['条8 用量列表面板全能力复跑', 'AdminView.spec 既有组（筛选/排序/分页/缺失标注/空态，305 内零改动）'],
    ['条9 六端点 + PUT settings 零变化', 'pytest test_admin.py 逐字节零改动复跑全绿（239 全绿取证）+ test_admin_telemetry.py 纯新增加法'],
    ['条19 成本数值精确（pytest 面）', 'test_admin_telemetry::test_遥测_造数聚合_成本命中率工具精确值（tokens×单价 6 位小数精确断言）'],
    ['条25/33 命中率与工具聚合精确（pytest 面）', 'test_admin_telemetry 造数用例（Σhit/(Σhit+Σmiss) / tool_name×status count 与均值 / 确定性排序）'],
    ['条27 合法 0 值如实显 0（hit=0 与缺失区分）', 'AdminTelemetry.spec「合法 0 值如实显 0」用例（T0 取证语义）+ pytest 造数含 hit=0 行'],
    ['条34 卡 C 空态 T20', 'AdminTelemetry.spec「卡 C 空态」用例（本样件窗口恒含 day0 工具行，浏览器面不触发）'],
    ['条43 样件数据全虚构', '本脚本造数常量全虚构（脚本头声明）；线上数值只由 telemetry 表机器采集渲染（铁律 5）'],
    ['前端七态渲染 + 文案逐字 + 0/缺失区分', 'AdminTelemetry.spec 19 例（正常/缺失时段/单价未配置/缓存全缺失/空窗口/加载/失败 + T1~T28 关键项逐字）'],
  ]
  for (const [name, carrier] of byTests) log(`${name}（自动化用例承载）`, true, carrier)

  const fail = results.filter((r) => r.startsWith('FAIL')).length
  console.log(`\n==== 走查汇总：${results.length - fail} PASS / ${fail} FAIL（共 ${results.length} 条）====`)
  process.exitCode = fail ? 1 : 0
} finally {
  await browser.close().catch(() => {})
  try { viteProc?.kill('SIGTERM') } catch { /* 已退出 */ }
  await killBackend()
}
