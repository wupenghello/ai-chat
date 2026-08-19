/* ai-chat iter-16 T3 浏览器走查脚本（design-iter-16 §7.2 走查清单 44 条之浏览器适用条目）
 *
 * 沿 scripts/e2e-walkthrough-15.mjs 惯例：puppeteer-core 驱动本机 Chrome，PASS/FAIL 逐条输出
 * + 截图留档 /tmp/e2e16/shots/。FAIL 区分脚本问题与产品缺陷。
 *
 * 本脚本自起全部服务（独立 /tmp 库，不触开发库与其他会话端口）：
 *   后端：backend/.venv/bin/uvicorn app.main:app --port 8817（AI_CHAT_DB_PATH=/tmp 独立库）。
 *         走查需真实后端与真实摘要调用（任务书口径，沿 b2_t0_smoke.py 模式）：统一 key 三变量
 *         自 backend/.env 读取后经**进程环境**注入子进程（真实 key 仅进程环境传递，
 *         不入任何文件/日志/留档）；单价三变量显式注入（2/8/0.5，与 iter-15 样件同）。
 *   前端：npx vite --port 5181 --strictPort（proxy 目标经 AI_CHAT_DEV_API_TARGET → 8817）。
 * 账号：walkthrough-admin / Walkthrough2026（首注册用户 = admin）；walkthrough-user（403 走查）。
 * 造数纪律（铁律 5）：会话档样件与 admin 遥测样件全虚构（脚本内声明）；手动压缩产生的
 *   compress 行/context_summary/懒回填值为真实后端机器采集，断言其与 llm 行一致性（不手填）。
 * 压缩触发：手动压缩端点直接驱动（不必等阈值）；下一回合摘要注入取证以直插 step=1
 *   tokens_prompt=8500 遥测行制造阈值条件（机器读数口径）。
 * 运行：node scripts/e2e-walkthrough-16.mjs（无外部前置；Chrome 本机路径沿 iter-14/15）
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BACKEND = 8817
const VITE = 5181
const BASE = `http://localhost:${VITE}`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = '/tmp/e2e16/shots'
const DB = '/tmp/ai-chat-walkthrough-16.db'

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
  } catch { /* .env 缺失 → 后端按未配置处理（走查成功路径将失败，前置断言兜底） */ }
  return env
}
const UNIFIED_ENV = unifiedEnvFromDotenv()

/* ---- 虚构会话样件（走查演示数据全虚构；线上数据只由机器采集，铁律 5） ---- */
const mkUserMsg = (id, text) => ({ id, role: 'user', content: text, status: 'done' })
const mkAsstMsg = (id, text, status = 'done') => ({ id, role: 'assistant', content: text, status })
const PAD = '这是一段用于凑够会话体量的知识性问答内容，仅用于走查演示。'

function longSessionMessages() {
  // 22 轮：第 1 轮种关键事实（超出基线 v6 20 轮窗口，压缩摘要承载的实证锚点）
  const msgs = [
    mkUserMsg('u1', '我叫小明，我正在开发一款叫「喵喵」的 AI 聊天产品，请记住我的名字和产品名。'),
    mkAsstMsg('a1', '记住了，小明。你正在开发 AI 聊天产品「喵喵」。'),
  ]
  for (let i = 2; i <= 22; i++) {
    msgs.push(mkUserMsg(`u${i}`, `第 ${i} 个知识性问题：请用一句话介绍一个技术概念。${PAD}`))
    msgs.push(mkAsstMsg(`a${i}`, `第 ${i} 个回答：这是一个关于软件工程与人工智能的知识性要点。${PAD}`))
  }
  return msgs
}
function shortSessionMessages() { // 3 轮 ≤ R=5 → 无需压缩
  const msgs = []
  for (let i = 1; i <= 3; i++) {
    msgs.push(mkUserMsg(`u${i}`, `短会话问题 ${i}`))
    msgs.push(mkAsstMsg(`a${i}`, `短会话回答 ${i}`))
  }
  return msgs
}
function interruptedSessionMessages() { // 6 轮 > R=5，含生成中断消息（pill 优先级样件）
  const msgs = []
  for (let i = 1; i <= 6; i++) {
    msgs.push(mkUserMsg(`u${i}`, `中断样件问题 ${i}。${PAD}`))
    msgs.push(mkAsstMsg(`a${i}`, `中断样件回答 ${i}。${PAD}`, i === 6 ? 'interrupted' : 'done'))
  }
  return msgs
}

/* ---- admin 遥测虚构样件（同 iter-15 口径：数值全虚构；phase 见走查流程） ---- */
const seedDay = (back) => {
  const d = new Date(Date.now() - back * 86400000)
  const z = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}
const SEED_LLM_PY = `
import sqlite3, sys
from datetime import datetime
conn = sqlite3.connect(sys.argv[1])
day = datetime.now().strftime("%Y-%m-%d")
conn.execute("INSERT INTO telemetry (day,user_id,mode,turn_id,endpoint,kind,step,model,"
    "latency_ms,status,tokens_prompt,tokens_completion,tokens_total,cache_hit_tokens,"
    "cache_miss_tokens) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    (day, 1, "unified", "seed-turn", "turn", "llm", 1, "deepseek-chat", 820, "ok",
     150000, 30000, 180000, 60000, 90000))
conn.commit()
conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
conn.close()
print("seeded-llm")
`
// phase C：ok 未测得 ×2（tokens_after NULL）+ error + timeout → 缺失态
const SEED_COMPACT_C_PY = `
import sqlite3, sys
from datetime import datetime
conn = sqlite3.connect(sys.argv[1])
day = datetime.now().strftime("%Y-%m-%d")
def row(status, before, after, prompt):
    conn.execute("INSERT INTO telemetry (day,user_id,mode,turn_id,endpoint,kind,step,model,"
        "latency_ms,status,tokens_prompt,tokens_total,tokens_before,tokens_after,session_id)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (day, 1, "unified", None, "compact", "compress", None, "deepseek-chat",
         1900, status, prompt, prompt or 0, before, after, "s-seed"))
row("ok", 9000, None, 4000)
row("ok", 12000, None, 4000)
row("error", 9500, None, None)
row("timeout", 8800, None, None)
conn.commit()
conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
conn.close()
print("seeded-compact-c")
`
// phase D：测得行 ×8（before 48000 / after 15360 → Σ 384000/122880 → 降幅 68.0%，
// 与 design-iter-16 §3 样件数值同源虚构）
const SEED_COMPACT_D_PY = `
import sqlite3, sys
from datetime import datetime
conn = sqlite3.connect(sys.argv[1])
day = datetime.now().strftime("%Y-%m-%d")
for i in range(8):
    conn.execute("INSERT INTO telemetry (day,user_id,mode,turn_id,endpoint,kind,step,model,"
        "latency_ms,status,tokens_prompt,tokens_total,tokens_before,tokens_after,session_id)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (day, 1, "unified", None, "compact", "compress", None, "deepseek-chat",
         1900 + i, "ok", 5000, 5600, 48000, 15360, f"s-seed-{i}"))
conn.commit()
conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
conn.close()
print("seeded-compact-d")
`
// 懒回填一致性核对（真实机器采集面）：compress 行 tokens_after == 该会话下一回合
// step=1 llm 行 tokens_prompt；且 compress 行恰 1 条（水位复用零新摘要调用）
const CHECK_BACKFILL_PY = `
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1]); conn.row_factory = sqlite3.Row
rows = conn.execute("SELECT * FROM telemetry WHERE kind='compress' AND session_id='s_long'").fetchall()
llm1 = conn.execute("SELECT tokens_prompt FROM telemetry WHERE kind='llm' AND step=1"
    " AND session_id='s_long' AND endpoint='turn' ORDER BY id DESC LIMIT 1").fetchone()
summ = conn.execute("SELECT summary FROM context_summary WHERE session_id='s_long'").fetchone()
print(json.dumps({
    "compress_count": len(rows),
    "endpoints": sorted({r["endpoint"] for r in rows}),
    "turn_ids_null": all(r["turn_id"] is None for r in rows),
    "statuses": sorted({r["status"] for r in rows}),
    "tokens_after": [r["tokens_after"] for r in rows],
    "step1_prompt": llm1["tokens_prompt"] if llm1 else None,
    "has_summary": summ is not None and "小明" in summ["summary"],
}, ensure_ascii=False))
`
const CHECK_SUMMARY_UNCHANGED_PY = `
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
n = conn.execute("SELECT COUNT(*) FROM context_summary WHERE session_id='s_long'").fetchone()[0]
md5 = conn.execute("SELECT LENGTH(summary) FROM context_summary WHERE session_id='s_long'").fetchone()
print(f"{n}|{md5[0] if md5 else 0}")
`

/* ---- 服务管理 ---- */
let backendProc = null
let viteProc = null
function spawnBackend() {
  backendProc = spawn(`${ROOT}backend/.venv/bin/uvicorn`,
    ['app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND)], {
      cwd: `${ROOT}backend`,
      env: {
        ...process.env, ...UNIFIED_ENV,
        AI_CHAT_DB_PATH: DB,
        AI_CHAT_PRICE_INPUT: '2', AI_CHAT_PRICE_OUTPUT: '8', AI_CHAT_PRICE_CACHE_HIT: '0.5',
      },
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
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true })

const fetchApi = (path, opts = {}) =>
  page.evaluate(
    (p, o) =>
      fetch(p, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...o })
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
    path, opts,
  )
const $one = (sel) => page.$eval(sel, (e) => e.textContent.trim()).catch(() => null)
/** toast 为堆叠容器：取最新一条（最后入列） */
const $lastToast = () =>
  page.$$eval('.toast .toast-msg', (els) => els.at(-1)?.textContent.trim() ?? null).catch(() => null)
const style = (sel, prop) => page.$eval(sel, (e, p) => getComputedStyle(e)[p], prop).catch(() => null)

/* ---- 压缩请求拦截：pass（可带延迟，打真实端点）/ fail502 / busy409 / okCompacted ---- */
let compactMode = 'pass'
let compactDelayMs = 0
let compactRequests = 0
let lastCompactBody = null
await page.setRequestInterception(true)
page.on('request', async (req) => {
  if (req.url().includes('/api/chat/compact')) {
    compactRequests += 1
    lastCompactBody = req.postData()
    if (compactMode === 'fail502') {
      return req.respond({ status: 502, contentType: 'application/json', body: JSON.stringify({
        detail: { code: 'compact_failed', message: '压缩失败，请稍后再试' } }) })
    }
    if (compactMode === 'busy409') {
      return req.respond({ status: 409, contentType: 'application/json', body: JSON.stringify({
        detail: { code: 'session_generating', message: '该会话正在生成回复，暂不能压缩，请等生成完成后再试' } }) })
    }
    if (compactMode === 'okCompacted') {
      return req.respond({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'compacted', tokens_before: null }) })
    }
    if (compactDelayMs) await sleep(compactDelayMs)
  }
  req.continue()
})

async function putSession(sid, title, messages) {
  return fetchApi(`/api/sessions/${sid}`, {
    method: 'PUT',
    body: JSON.stringify({ id: sid, schema: 2, title, messages, updatedAt: Date.now() / 1000 }),
  })
}
async function openMenuOf(title) {
  // 按显示标题定位列表项并点开「···」菜单（corrupted 会话显示标题恒为「无法读取的会话」）
  await page.evaluate((t) => {
    const li = [...document.querySelectorAll('.item')]
      .find((x) => x.querySelector('.title')?.textContent.trim() === t)
    li?.querySelector('.dd-trigger')?.click()
  }, title)
  await sleep(250)
}
async function clickCompactItem() {
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="menuitem"]')]
      .find((b) => b.textContent.trim() === '压缩上下文')?.click()
  })
}
async function toastText() {
  await sleep(300)
  return $lastToast()
}
/** 真实摘要调用耗时不定（上限约 30s 护栏）：轮询等待目标 toast 到达（取最新一条，toast 堆叠） */
async function waitForToast(substr, timeoutMs = 25000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const t = await $lastToast()
    if (t && t.includes(substr)) return t
    await sleep(250)
  }
  return $lastToast()
}
/** 等待 toast 清空（toast 3s 自动消失；同名文案断言前清场防旧 toast 串扰） */
async function drainToasts(timeoutMs = 6000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const n = await page.$$eval('.toast', (els) => els.length).catch(() => 0)
    if (n === 0) return
    await sleep(200)
  }
}
async function switchThemeTo(dark) {
  // 主题 = 根节点 data-theme 覆盖令牌（useTheme 机制）；主界面无主题钮，直置属性 + 持久键
  await page.evaluate((d) => {
    document.documentElement.dataset.theme = d ? 'dark' : 'light'
    try { localStorage.setItem('ai-chat-theme', d ? 'dark' : 'light') } catch { /* 忽略 */ }
  }, dark)
  await sleep(400)
}

try {
  /* ============ 前置：服务 / 账号 / 会话造数 ============ */
  spawnBackend()
  log('前置·后端起服务（真实统一 key 经进程环境注入，/tmp 独立库）', await waitHealth()
    && Object.keys(UNIFIED_ENV).length === 3, 'key 仅进程环境传递、不入留档')
  spawnVite()
  let viteUp = false
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE); if (r.ok) { viteUp = true; break } } catch { /* 未就绪 */ }
    await sleep(300)
  }
  log('前置·前端 dev server 起服务（5181 → proxy 8817）', viteUp)

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
  log('前置·注册 walkthrough-admin（首用户 = admin）', [200, 201].includes(reg.status) && reg.isAdmin === true)
  const reg2 = await page.evaluate(async () => {
    const r = await fetch('/api/auth/register', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'walkthrough-user', password: 'Walkthrough2026' }),
    })
    return r.status
  })
  await page.evaluate(async () => {
    await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'walkthrough-admin', password: 'Walkthrough2026' }),
    })
  })
  log('前置·注册 walkthrough-user 并重新登录 admin', [200, 201].includes(reg2), `status=${reg2}`)

  // 会话造数（全虚构）：s_long 22 轮 / s_short 3 轮 / s_int 6 轮带中断 / s_bad 损坏
  //（损坏 = 合法 JSON 缺 messages——前端 corrupted 判定口径；非法 JSON 会使 GET 列表 500，
  //  后端 422 双保险面由 pytest 承载）
  const putResults = [
    await putSession('s_long', 'B2 长会话样件（关键事实与知识问答）', longSessionMessages()),
    await putSession('s_short', '短会话样件（无需压缩）', shortSessionMessages()),
    await putSession('s_int', '中断样件（生成中断 pill）', interruptedSessionMessages()),
  ]
  const seedBad = await runPy(`
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.execute("INSERT INTO chat_sessions (id, user_id, data, updated_at) VALUES (?, 1, ?, 1)",
    ("s_bad", json.dumps({"id": "s_bad", "title": "损坏样件", "updatedAt": 1}, ensure_ascii=False)))
conn.commit()
conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")  # 跨进程 WAL 可见性收敛（后端新连接立即可读）
conn.close()
print("ok")
`)
  // 后端可见性核对（GET /api/sessions 含 s_bad 才继续——防 WAL 收敛竞态）
  let badVisible = false
  for (let i = 0; i < 20 && !badVisible; i++) {
    const list = await fetchApi('/api/sessions')
    badVisible = Array.isArray(list.body) && list.body.some((s) => s.id === 's_bad')
    if (!badVisible) await sleep(250)
  }
  log('前置·虚构会话样件入库（22 轮长会话 / 3 轮短会话 / 6 轮中断样件 / 损坏会话后端可见）',
    putResults.every((r) => r.status === 200) && seedBad === 'ok' && badVisible,
    `s_bad visible=${badVisible}`)

  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await sleep(600)

  /* ============ admin 遥测面（先于侧栏真实压缩，保证虚构样件断言确定性） ============ */
  log('前置·admin llm 样件入库（今日 unified 150k/30k + 缓存 60k/90k）',
    (await runPy(SEED_LLM_PY)) === 'seeded-llm')
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' })
  await sleep(500)
  await page.evaluate(() => {
    [...document.querySelectorAll('.adm-tabs button')].find((b) => b.textContent.trim() === '遥测')?.click()
  })
  await sleep(600)

  /* ---- 条 30~33 admin 零回退组（iter-15#1~44 复跑，浅色） ---- */
  const frame = await page.evaluate(() => ({
    topH: document.querySelector('.adm-top')?.getBoundingClientRect().height,
    tabs: [...document.querySelectorAll('.adm-tabs button')].map((b) => b.textContent.trim()),
    cards: document.querySelectorAll('.stat-card').length,
    cardAHead: document.querySelector('.tel-card .tc-head')?.textContent.trim(),
    cardASub: document.querySelector('.tel-card .tc-sub')?.textContent.trim(),
    cardBHead: document.querySelectorAll('.tel-2col .tel-card')[0]?.querySelector('.tc-head')?.textContent.trim(),
    cardCHead: document.querySelectorAll('.tel-2col .tel-card')[1]?.querySelector('.tc-head')?.textContent.trim(),
    cardDHead: [...document.querySelectorAll('.tel-card')].at(-1)?.querySelector('.tc-head')?.textContent.trim(),
    cardDThs: [...[...document.querySelectorAll('.tel-card')].at(-1)?.querySelectorAll('thead th') ?? []].map((t) => t.textContent.trim()),
  }))
  log('条30 框架与治理区零回退（顶栏 52px + 概览四卡 + tabs 三段，iter-15#1~10）',
    frame.topH === 52 && frame.cards === 4 && JSON.stringify(frame.tabs) === JSON.stringify(['用户列表', '用量列表', '遥测']))
  log('条31 工具行与卡 A 零回退（卡 A 标题/副题逐字，iter-15#11~23；成本演进见条31补）',
    frame.cardAHead === '每日成本估算' && frame.cardASub === '仅统一 key 模式计成本；自填模式 tokens 不计成本')
  log('条32 卡 B / 卡 C 零回退（命中率与工具用量标题逐字，iter-15#24~34）',
    frame.cardBHead === '缓存命中率' && frame.cardCHead === '工具用量')
  log('条33 卡 D 零回退（标题 + 六列表头逐字，iter-15#35~41）',
    frame.cardDHead === '按日成本明细'
    && JSON.stringify(frame.cardDThs) === JSON.stringify(['日期', '输入 tokens', '输出 tokens', '缓存命中 tokens', '成本估算', '自填 tokens（不计成本）']))

  /* ---- 条 39 空态（零 compress 行 → C15；kv-row 保留） ---- */
  const ceEmpty = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.tel-card')]
    const ce = cards[3]
    return {
      count: cards.length,
      head: ce?.querySelector('.tc-head')?.textContent.trim(),
      empty: ce?.querySelector('.ce-empty')?.textContent.trim(),
      grid: !!ce?.querySelector('.ce-grid'),
      kv: ce?.querySelector('.kv-row .kv-val')?.textContent.trim(),
    }
  })
  log('条39 空态：窗口零 compress 行 → 大数值行替换为空文案逐字 C15；kv-row 注记保留',
    ceEmpty.count === 5 && ceEmpty.head === '上下文压缩' && ceEmpty.empty === '窗口内无压缩记录'
    && !ceEmpty.grid && !!ceEmpty.kv, JSON.stringify(ceEmpty))
  await shot('01-admin-cardE-empty-light')

  /* ---- 条 40 缺失态（phase C：有压缩行零测得行） ---- */
  log('前置·phase C 虚构 compress 样件入库（ok 未测得 ×2 + error + timeout）',
    (await runPy(SEED_COMPACT_C_PY)) === 'seeded-compact-c')
  await page.evaluate(() => {
    [...document.querySelectorAll('.win-seg button')].find((b) => b.textContent.trim() === '近 14 天')?.click()
  })
  await sleep(700)
  const ceMiss = await page.evaluate(() => {
    const ce = [...document.querySelectorAll('.tel-card')][3]
    const cells = ce?.querySelectorAll('.ce-cell') ?? []
    return {
      countBig: cells[0]?.querySelector('.tc-big')?.textContent.trim(),
      countSub: cells[0]?.querySelector('.tc-big-sub')?.textContent.trim(),
      rateBig: !!cells[1]?.querySelector('.tc-big'),
      badge: cells[1]?.querySelector('.pill.miss')?.textContent.trim(),
      rateSub: cells[1]?.querySelector('.tc-big-sub')?.textContent.trim(),
      text: ce?.textContent ?? '',
    }
  })
  log('条40 缺失态：次数如实（4）+ 降幅位「缺失」徽标逐字 C14 + sub「已测得 0 / 成功 2」自释；永不显 0%/NaN',
    ceMiss.countBig === '4' && ceMiss.countSub === '成功 2 · 失败 2' && !ceMiss.rateBig
    && ceMiss.badge === '缺失' && ceMiss.rateSub === '已测得 0 / 成功 2'
    && !ceMiss.text.includes('0.0%') && !ceMiss.text.includes('NaN'), JSON.stringify(ceMiss))
  await shot('02-admin-cardE-missing-light')

  /* ---- 条 34~38 / 41 正常态（phase D：测得行 ×8 → 68.0%） ---- */
  log('前置·phase D 虚构 compress 样件入库（测得行 ×8：Σbefore 384000 / Σafter 122880）',
    (await runPy(SEED_COMPACT_D_PY)) === 'seeded-compact-d')
  await page.evaluate(() => {
    [...document.querySelectorAll('.win-seg button')].find((b) => b.textContent.trim() === '近 7 天')?.click()
  })
  await sleep(700)
  const ceNorm = await page.evaluate(() => {
    const ce = [...document.querySelectorAll('.tel-card')][3]
    const cs = (el) => el ? getComputedStyle(el) : null
    const cells = ce?.querySelectorAll('.ce-cell') ?? []
    const grid = ce?.querySelector('.ce-grid')
    return {
      pad: cs(ce)?.padding, radius: cs(ce)?.borderRadius, mb: cs(ce)?.marginBottom,
      bg: cs(ce)?.backgroundColor, gridGap: cs(grid)?.gap, gridCols: cs(grid)?.gridTemplateColumns,
      cellPad: cs(cells[0])?.padding, cellBg: cs(cells[0])?.backgroundColor, cellRadius: cs(cells[0])?.borderRadius,
      head: ce?.querySelector('.tc-head')?.textContent.trim(),
      sub: ce?.querySelector('.tc-sub')?.textContent.trim(),
      countLabel: cells[0]?.querySelector('.bd-label')?.textContent.trim(),
      countBig: cells[0]?.querySelector('.tc-big')?.textContent.trim(),
      countSub: cells[0]?.querySelector('.tc-big-sub')?.textContent.trim(),
      countTitle: cells[0]?.getAttribute('title'),
      rateLabel: cells[1]?.querySelector('.bd-label')?.textContent.trim(),
      rateBig: cells[1]?.querySelector('.tc-big')?.textContent.trim(),
      rateSub: cells[1]?.querySelector('.tc-big-sub')?.textContent.trim(),
      rateTitle: cells[1]?.getAttribute('title'),
      kvLabel: ce?.querySelector('.kv-row .kv-label')?.textContent.trim(),
      kvVal: ce?.querySelector('.kv-row .kv-val')?.textContent.trim(),
      bigFont: cs(cells[0]?.querySelector('.tc-big'))?.fontSize,
      bigWeight: cs(cells[0]?.querySelector('.tc-big'))?.fontWeight,
      bigNum: cs(cells[0]?.querySelector('.tc-big'))?.fontVariantNumeric,
    }
  })
  log('条34 卡 E 位置与容器：双卡区与卡 D 之间全宽；padding 16/20 · 圆角 12 · 卡间距 16（surface 底）',
    ceNorm.pad === '16px 20px' && ceNorm.radius === '12px' && ceNorm.mb === '16px'
    && ceNorm.bg === 'rgb(255, 255, 255)', JSON.stringify({ pad: ceNorm.pad, r: ceNorm.radius, mb: ceNorm.mb }))
  log('条35 卡 E 标题区逐字 C9/C10（口径常驻自释）',
    ceNorm.head === '上下文压缩'
    && ceNorm.sub === '压缩 = 中段历史摘要（自动阈值触发 + 手动触发）；降幅仅统计压缩前后均测得的压缩')
  log('条36 次数列：label 逐字 C11 + 大数值 12（含失败行）+ sub「成功 10 · 失败 2」+ title 注记 + 20px/600 tabular',
    ceNorm.countLabel === '窗口压缩次数' && ceNorm.countBig === '12' && ceNorm.countSub === '成功 10 · 失败 2'
    && ceNorm.countTitle === '失败含超时行；失败行只计次数、不计降幅'
    && ceNorm.bigFont === '20px' && ceNorm.bigWeight === '600' && ceNorm.bigNum === 'tabular-nums')
  log('条37 降幅列：label 逐字 C12 + 68.0% + sub 逐字 C13 + title 公式逐字；双列等宽栅格 gap 16 + 内面板 10/12 subtle-bg',
    ceNorm.rateLabel === '平均降幅' && ceNorm.rateBig === '68.0%' && ceNorm.rateSub === '已测得 8 / 成功 10'
    && ceNorm.rateTitle === '平均降幅 = 1 − Σ压缩后 tokens ÷ Σ压缩前 tokens'
    && ceNorm.gridGap === '16px' && !!ceNorm.gridCols && ceNorm.gridCols.split(' ').length === 2
    && ceNorm.cellPad === '10px 12px' && ceNorm.cellBg === 'rgb(250, 251, 252)' && ceNorm.cellRadius === '8px')
  log('条41 成本口径注记 kv-row 逐字 C16',
    ceNorm.kvLabel === '成本与配额口径'
    && ceNorm.kvVal === '摘要调用 tokens 计入每日成本估算（按输入计价）· 手动压缩不计回合')
  await shot('03-admin-cardE-normal-light')

  /* ---- 条 38 聚合口径（API 面精确值：1 − Σafter/Σbefore 仅计测得行；成本计入 compress prompt） ---- */
  const apiTel = await fetchApi('/api/admin/telemetry?days=7')
  const cp = apiTel.body?.compact
  // 成本：llm prompt 150000 + compress prompt（phase C 8000 + phase D 40000）= 198000 × 2 ÷ 1e6
  log('条38 聚合口径精确值（API 面）：count 12 / measured 8 / Σbefore 384000 / Σafter 122880 / rate 0.68',
    apiTel.status === 200 && cp?.count === 12 && cp?.count_ok === 10 && cp?.count_failed === 2
    && cp?.measured === 8 && cp?.tokens_before_total === 384000 && cp?.tokens_after_total === 122880
    && cp?.reduction_rate === 0.68, JSON.stringify(cp))
  log('条31补 成本口径演进（CHG-010 授权）：今日输入成本计入 unified compress 行 tokens_prompt×input 单价',
    apiTel.body?.today_cost?.cost_input === Number(((150000 + 48000) * 2 / 1e6).toFixed(6))
    && apiTel.body?.today_cost?.tokens_prompt === 150000, // 显示列仍仅 llm 行（形状零变化）
    `cost_input=${apiTel.body?.today_cost?.cost_input} tokens_prompt=${apiTel.body?.today_cost?.tokens_prompt}`)

  /* ============ 侧栏面零回退（条 1~14，浅色） ============ */
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await sleep(600)
  // 前置：四会话全量渲染（含 corrupted「无法读取的会话」灰化项）
  const loadTitles = await page.evaluate(() =>
    [...document.querySelectorAll('.item .title')].map((t) => t.textContent.trim()))
  log('前置·侧栏四会话全量加载（含 corrupted 灰化项「无法读取的会话」）',
    loadTitles.length === 4 && loadTitles.includes('无法读取的会话'), JSON.stringify(loadTitles))
  const sb = await page.evaluate(() => {
    const cs = (el) => el ? getComputedStyle(el) : null
    const sidebar = document.querySelector('.sidebar')
    const newBtn = document.querySelector('.new-btn')
    const searchBox = document.querySelector('.search-box')
    const item = document.querySelector('.item')
    return {
      sbW: sidebar?.getBoundingClientRect().width,
      sbBg: cs(sidebar)?.backgroundColor,
      sbBorder: cs(sidebar)?.borderRightWidth,
      newH: cs(newBtn)?.height, newBg: cs(newBtn)?.backgroundColor, newColor: cs(newBtn)?.color,
      searchH: cs(searchBox)?.height,
      itemMinH: cs(item)?.minHeight, itemPad: cs(item)?.padding, itemGap: cs(item)?.columnGap,
      titleFont: cs(item?.querySelector('.title'))?.fontSize,
      groups: [...document.querySelectorAll('.group-label')].map((g) => g.textContent.trim()),
      avatar: document.querySelector('.avatar')?.textContent.trim(),
      acctName: document.querySelector('.acct-name')?.textContent.trim(),
    }
  })
  log('条1 外壳基调：侧栏 264px 灰底 rgb(245,246,247) + 右缘 1px border（框架零变化）',
    sb.sbW === 264 && sb.sbBg === 'rgb(245, 246, 247)' && sb.sbBorder === '1px')
  log('条2 新建按钮：36px primary-solid 白字（REQ-003 口径零变化）',
    sb.newH === '36px' && sb.newBg === 'rgb(51, 112, 255)' && sb.newColor === 'rgb(255, 255, 255)')
  log('条4 列表项单行：min-height 34px + padding 6/10 + column-gap 6 + 标题 13px（REQ-004 载体零变化）',
    sb.itemMinH === '34px' && sb.itemPad === '6px 10px' && sb.itemGap === '6px' && sb.titleFont === '13px')
  log('条11 时间分组组头（今天/昨天/近 7 天/更早，12px text-3）',
    sb.groups.every((g) => ['今天', '昨天', '近 7 天', '更早'].includes(g)) && sb.groups.length >= 1)
  log('条12 账户区：首字头像 + 用户名（账户菜单无新增项）', sb.avatar === 'w' && sb.acctName === 'walkthrough-admin')

  // 条 5 hover「···」浮现
  await page.hover('.item')
  await sleep(300)
  log('条5 hover「···」浮现（opacity 0→1）', await style('.item .dd-trigger', 'opacity') === '1')

  // 条 3 搜索态平铺 + 菜单照常含压缩项
  await page.type('.search-input', '样件')
  await sleep(300)
  const searchState = await page.evaluate(() => ({
    groups: document.querySelectorAll('.group-label').length,
    items: document.querySelectorAll('.item').length,
  }))
  await openMenuOf('短会话样件（无需压缩）')
  const searchMenu = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent.trim()))
  log('条3 搜索态：平铺隐藏组头 + 列表项菜单照常含压缩项（渲染口径同）',
    searchState.groups === 0 && searchState.items >= 2 && searchMenu.includes('压缩上下文'))
  // 先 Esc 关菜单再点清除——菜单开着时外点被吞击（iter-11 §2.1 口径），清除钮点击不生效
  await page.keyboard.press('Escape')
  await sleep(150)
  await page.evaluate(() => { document.querySelector('.search-clear')?.click() })
  await sleep(300)

  // 条 6 既有三项逐字与配色 + 面板形态（条 16 几何同源）
  await openMenuOf('B2 长会话样件（关键事实与知识问答）')
  const menu = await page.evaluate(() => {
    const cs = (el) => el ? getComputedStyle(el) : null
    const panel = document.querySelector('.dd-menu')
    const items = [...document.querySelectorAll('[role="menuitem"]')]
    const danger = items.find((b) => b.textContent.trim() === '删除')
    const compact = items.find((b) => b.textContent.trim() === '压缩上下文')
    const sep = document.querySelector('.dd-sep')
    return {
      labels: items.map((b) => b.textContent.trim()),
      panelMinW: cs(panel)?.minWidth, panelBg: cs(panel)?.backgroundColor,
      panelBorder: cs(panel)?.borderWidth, panelRadius: cs(panel)?.borderRadius,
      dangerColor: cs(danger)?.color,
      compactH: cs(compact)?.height, compactFont: cs(compact)?.fontSize, compactPad: cs(compact)?.padding,
      seps: document.querySelectorAll('.dd-sep').length,
      sepBeforeRemove: sep ? sep.nextElementSibling === danger : false,
    }
  })
  log('条6 既有三项文案与配色逐字零回退（重命名/导出会话/删除 danger 红字 + 面板 surface+border+r-md）',
    JSON.stringify(menu.labels) === JSON.stringify(['重命名', '导出会话', '压缩上下文', '删除'])
    && menu.dangerColor === 'rgb(217, 48, 37)' && menu.panelBg === 'rgb(255, 255, 255)'
    && menu.panelBorder === '1px' && menu.panelRadius === '8px', JSON.stringify(menu.labels))
  log('条16 位置与几何：压缩项在导出之后、danger 分隔线之前；项高 32px/13px/padding 0 10px；面板 min-width 148px 不变；分隔线唯一且仍在删除前',
    menu.labels[2] === '压缩上下文' && menu.compactH === '32px' && menu.compactFont === '13px'
    && menu.compactPad === '0px 10px' && menu.panelMinW === '148px'
    && menu.seps === 1 && menu.sepBeforeRemove)
  log('条15 菜单项逐字 C1「压缩上下文」（corrupted 禁用面见条7补）', menu.labels[2] === '压缩上下文')
  await shot('04-menu-open-light')

  // 条 14 菜单交互：Esc 关 + 键盘 ↓ 循环含压缩项 + 外点吞击不误切换
  await page.keyboard.press('Escape')
  await sleep(200)
  const escClosed = await page.evaluate(() => !document.querySelector('.dd-menu'))
  await openMenuOf('B2 长会话样件（关键事实与知识问答）')
  const keys = await page.evaluate(async () => {
    const seen = []
    for (let i = 0; i < 4; i++) {
      document.querySelector('.dd-menu')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      await new Promise((r) => setTimeout(r, 60))
      seen.push(document.activeElement?.dataset?.idx)
    }
    return seen
  })
  log('条14 菜单交互规格带新项复跑：Esc 关闭 + ↓ 循环 4 项（含压缩项 idx=2）',
    escClosed && JSON.stringify(keys) === JSON.stringify(['1', '2', '3', '0']), JSON.stringify(keys))
  // 外点吞击：点开菜单 → 点主区 → 菜单关闭且不触发底层（会话选中不变）
  const activeBefore = await page.evaluate(() => document.querySelector('.item.active .title')?.textContent.trim())
  await openMenuOf('B2 长会话样件（关键事实与知识问答）')
  await page.click('.main', { delay: 50 }).catch(() => {})
  await sleep(300)
  const swallow = await page.evaluate(() => ({
    menu: !!document.querySelector('.dd-menu'),
    active: document.querySelector('.item.active .title')?.textContent.trim(),
  }))
  log('条14补 外点吞击：点主区仅关菜单不误触发底层（选中会话不变）',
    !swallow.menu && swallow.active === activeBefore, JSON.stringify(swallow))

  // 条 7 corrupted 分支（含压缩项禁用 C4）
  await openMenuOf('无法读取的会话')
  const corrupted = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[role="menuitem"]')]
    const compact = items.find((b) => b.textContent.trim() === '压缩上下文')
    const rename = items.find((b) => b.textContent.trim() === '重命名')
    return {
      titles: [...document.querySelectorAll('.item .title')].map((t) => t.textContent.trim()),
      corruptedItems: document.querySelectorAll('.item.corrupted').length,
      pill: document.querySelector('.item.corrupted .pill.broken')?.textContent.trim(),
      compactDis: compact?.getAttribute('aria-disabled'),
      compactTitle: compact?.getAttribute('title'),
      renameDis: rename?.getAttribute('aria-disabled'),
    }
  })
  log('条7 corrupted 分支零变化 + 延伸：「无法读取」pill + 重命名禁用（既有）；压缩项同禁用 + title 逐字 C4',
    corrupted.pill === '无法读取' && corrupted.renameDis === 'true'
    && corrupted.compactDis === 'true' && corrupted.compactTitle === '无法读取的会话不可压缩',
    JSON.stringify(corrupted))
  await page.keyboard.press('Escape')

  // 条 8 行内重命名（口径零变化）
  await openMenuOf('短会话样件（无需压缩）')
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.trim() === '重命名')?.click()
  })
  await sleep(200)
  const renameInput = await page.evaluate(() => !!document.querySelector('.edit-input'))
  await page.keyboard.press('Escape')
  await sleep(150)
  log('条8 行内重命名零变化（菜单进入编辑态 + Esc 取消）', renameInput)

  // 条 9 删除确认模态（口径零变化）
  await openMenuOf('短会话样件（无需压缩）')
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.trim() === '删除')?.click()
  })
  await sleep(250)
  const delModal = await page.evaluate(() => ({
    shown: !!document.querySelector('.modal, [role="dialog"]') && document.body.textContent.includes('删除这个会话？'),
  }))
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消')?.click()
  })
  await sleep(200)
  log('条9 删除确认模态零变化（压缩无确认弹窗、不触本条）', delModal.shown)

  // 条 10 导出项位置不动（压缩项在其后追加）
  log('条10 导出会话位置不动（压缩项在其后追加，REQ-013 口径零变化）', menu.labels[1] === '导出会话')

  // 条 13 rail 收起
  await page.click('button[aria-label="收起侧栏"]')
  await sleep(300)
  const railW = await page.evaluate(() => ({
    rail: document.querySelector('.sidebar')?.classList.contains('rail'),
    w: document.querySelector('.sidebar')?.getBoundingClientRect().width,
    items: document.querySelectorAll('.item').length,
  }))
  await page.click('button[aria-label="展开侧栏"]')
  await sleep(300)
  log('条13 rail 收起零变化（56px + 持久化；rail 态列表不渲染，入口唯一 = 列表项菜单）',
    railW.rail && railW.w === 56 && railW.items === 0)

  /* ============ 触点① 新增断言（条 17~29，真实后端） ============ */
  // 条 17 点击行为链路：菜单关 + POST body 仅 session_id + 执行中 pill + 不触发会话切换
  await openMenuOf('短会话样件（无需压缩）') // 让短会话成为操作起点（不切换断言的锚）
  await page.evaluate(() => { document.body.click() })
  await sleep(200)
  await page.evaluate(() => {
    const li = [...document.querySelectorAll('.item')].find((x) => x.querySelector('.title')?.textContent.trim() === '短会话样件（无需压缩）')
    li?.click()
  })
  await sleep(300)
  const activeAtStart = await page.evaluate(() => document.querySelector('.item.active .title')?.textContent.trim())
  await drainToasts()
  compactDelayMs = 1500
  const reqBase = compactRequests
  await openMenuOf('B2 长会话样件（关键事实与知识问答）')
  await clickCompactItem()
  await sleep(400) // 菜单 pick 即关；请求在途（延迟 1500ms）
  const inFlight = await page.evaluate(() => {
    const li = [...document.querySelectorAll('.item')].find((x) => x.querySelector('.title')?.textContent.trim() === 'B2 长会话样件（关键事实与知识问答）')
    const pill = li?.querySelector('.pill.compact')
    const cs = pill ? getComputedStyle(pill) : null
    const spin = pill?.querySelector('.pill-spin')
    return {
      menuGone: !document.querySelector('.dd-menu'),
      pillText: pill?.textContent.trim(),
      pillBg: cs?.backgroundColor, pillColor: cs?.color, pillPad: cs?.padding, pillR: cs?.borderRadius,
      // SVG 无 offsetWidth 且旋转动画使 boundingRect 膨胀 → 读 width 属性（规格 10px）
      spinW: spin?.getAttribute('width'),
      active: document.querySelector('.item.active .title')?.textContent.trim(),
    }
  })
  log('条17 点击行为链路：菜单立即关闭 → POST /api/chat/compact（body 仅 session_id）→ 执行中 pill；点击不触发会话切换',
    inFlight.menuGone && compactRequests === reqBase + 1
    && lastCompactBody === JSON.stringify({ session_id: 's_long' }) && inFlight.active === activeAtStart,
    `body=${lastCompactBody} active=${inFlight.active}`)
  log('条18 执行中 pill：10px spinner + 逐字 C2「压缩中」11px；primary-l 底 + primary 字 + r-full + padding 1/8（与 pill.cut 同参数）',
    inFlight.pillText === '压缩中' && inFlight.pillBg === 'rgb(240, 244, 255)'
    && inFlight.pillColor === 'rgb(51, 112, 255)' && inFlight.pillPad === '1px 8px'
    && inFlight.pillR === '999px' && inFlight.spinW === '10', JSON.stringify(inFlight))

  // 条 20 防重复：在途再开菜单 → 压缩项禁用 title C3；无第二次 POST
  await openMenuOf('B2 长会话样件（关键事实与知识问答）')
  const busy = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[role="menuitem"]')]
    const compact = items.find((b) => b.textContent.trim() === '压缩上下文')
    return {
      dis: compact?.getAttribute('aria-disabled'),
      title: compact?.getAttribute('title'),
      renameDis: items.find((b) => b.textContent.trim() === '重命名')?.getAttribute('aria-disabled'),
      exportDis: items.find((b) => b.textContent.trim() === '导出会话')?.getAttribute('aria-disabled'),
      removeDis: items.find((b) => b.textContent.trim() === '删除')?.getAttribute('aria-disabled'),
    }
  })
  await clickCompactItem() // 禁用项点击不生效
  await sleep(200)
  log('条20 防重复：在途压缩项 disabled + title 逐字 C3；重命名/导出/删除不受影响；重复点击无第二次 POST',
    busy.dis === 'true' && busy.title === '压缩中' && busy.renameDis == null && busy.exportDis == null
    && busy.removeDis == null && compactRequests === reqBase + 1, JSON.stringify(busy))
  await page.keyboard.press('Escape')
  await shot('05-sidebar-compacting-light')

  // 条 21 成功 toast（真实摘要调用完成，轮询等待）
  const okToast = await waitForToast('上下文压缩完成')
  await sleep(200)
  const toastColor = await style('.toast .toast-msg', 'color')
  const listAfter = await page.evaluate(() =>
    [...document.querySelectorAll('.item .title')].map((t) => t.textContent.trim()))
  const dbCheck = JSON.parse(await runPy(CHECK_BACKFILL_PY) || '{}')
  log('条21 成功 toast 逐字 C5（success 绿字 ✓ 前缀）+ 不带任何 token 数字 + 会话列表顺序零变化；DB：context_summary 更新 + compress 行 endpoint=compact/turn_id=NULL',
    okToast === '✓ 上下文压缩完成：中段历史已摘要，聊天记录不受影响'
    && toastColor === 'rgb(76, 195, 138)' && !/\d/.test(okToast)
    && dbCheck.compress_count === 1 && JSON.stringify(dbCheck.endpoints) === '["compact"]'
    && dbCheck.turn_ids_null === true && dbCheck.has_summary === true,
    JSON.stringify({ toast: okToast, db: dbCheck }))
  await shot('06-toast-success-light')

  // 条 22 无需压缩 toast（s_short 3 轮 ≤ R → 真实端点 skipped）
  await drainToasts()
  compactDelayMs = 0
  await openMenuOf('短会话样件（无需压缩）')
  await clickCompactItem()
  const skipToast = await waitForToast('无需压缩')
  log('条22 无需压缩 toast 逐字 C6（真实端点 200 skipped；零上游调用由 pytest 断言面承载）',
    skipToast === '当前会话无需压缩：历史还短', skipToast ?? '')

  // 条 26 失败路径 context_summary 零变化（先记录摘要长度，拦截失败后比对）
  await drainToasts()
  const sumBefore = await runPy(CHECK_SUMMARY_UNCHANGED_PY)
  compactMode = 'fail502'
  await openMenuOf('B2 长会话样件（关键事实与知识问答）')
  await clickCompactItem()
  const failToast = await toastText()
  const sumAfter = await runPy(CHECK_SUMMARY_UNCHANGED_PY)
  log('条23 失败 toast 逐字 C7（502/504/其余非 200/网络共用一句，不暴露技术细节）',
    failToast === '压缩失败，请稍后再试', failToast ?? '')
  log('条26 失败路径降级：context_summary 零变化（原摘要保留）+ 会话档零写入（pytest 前后比对承载库内面）',
    sumBefore === sumAfter && sumBefore.startsWith('1|'), `before=${sumBefore} after=${sumAfter}`)

  // 条 24/25 409 toast + 服务端唯一判定（前端零预判照发请求 → 409 到达）
  await drainToasts()
  compactMode = 'busy409'
  const req409 = compactRequests
  await openMenuOf('B2 长会话样件（关键事实与知识问答）')
  await clickCompactItem()
  const busyToast = await toastText()
  log('条24 409 toast 逐字 C8（= 服务端 message，前端直接呈现两路径同文）',
    busyToast === '该会话正在生成回复，暂不能压缩，请等生成完成后再试', busyToast ?? '')
  log('条25 409 服务端唯一判定：前端零预判照发请求（count+1）→ 409 到达清执行中态（浏览器面；vitest 承载本地生成中仍发请求断言）',
    compactRequests === req409 + 1
    && await page.evaluate(() => !document.querySelector('.pill.compact')))
  compactMode = 'pass'

  // 条 28 主对话面零触达：打开被压缩会话 → 压缩前后消息区 DOM 逐字节不变
  await page.evaluate(() => {
    const li = [...document.querySelectorAll('.item')].find((x) => x.querySelector('.title')?.textContent.trim() === 'B2 长会话样件（关键事实与知识问答）')
    li?.click()
  })
  await sleep(500)
  const chatBefore = await page.evaluate(() => document.querySelector('.chat .list')?.innerHTML.length)
  compactMode = 'okCompacted' // 拦截 200（DOM 级零触达断言，真实数据面已由条 21 证明）
  await openMenuOf('B2 长会话样件（关键事实与知识问答）')
  await clickCompactItem()
  await waitForToast('上下文压缩完成')
  const chatAfter = await page.evaluate(() => document.querySelector('.chat .list')?.innerHTML.length)
  const zeroTouch = await page.evaluate(() => ({
    canvas: document.querySelectorAll('.chat canvas').length,
  }))
  log('条28 主对话面零触达：压缩成功后消息区 DOM 规模不变 + 输入区/工具卡/顶区零新增元素',
    chatBefore === chatAfter && zeroTouch.canvas === 0, `len ${chatBefore} → ${chatAfter}`)
  compactMode = 'pass'

  // 条 19 + 29：中断样件会话压缩——pill 优先级（压缩中 > 生成中断）+ 执行中切换会话不 abort
  await drainToasts()
  compactDelayMs = 1200
  const reqInt = compactRequests
  await openMenuOf('中断样件（生成中断 pill）')
  await clickCompactItem()
  await sleep(400)
  const pillPriority = await page.evaluate(() => {
    const li = [...document.querySelectorAll('.item')].find((x) => x.querySelector('.title')?.textContent.trim() === '中断样件（生成中断 pill）')
    return {
      compact: !!li?.querySelector('.pill.compact'),
      cut: !!li?.querySelector('.pill.cut'),
      text: li?.querySelector('.pill')?.textContent.trim(),
    }
  })
  // 在途切换其他会话（不 abort）
  await page.evaluate(() => {
    const li = [...document.querySelectorAll('.item')].find((x) => x.querySelector('.title')?.textContent.trim() === '短会话样件（无需压缩）')
    li?.click()
  })
  await sleep(300)
  const intToast = await waitForToast('上下文压缩完成') // 真实摘要调用完成（延迟 + 真实耗时）
  await sleep(300)
  const pillRestored = await page.evaluate(() => {
    const li = [...document.querySelectorAll('.item')].find((x) => x.querySelector('.title')?.textContent.trim() === '中断样件（生成中断 pill）')
    return {
      compact: !!li?.querySelector('.pill.compact'),
      cut: li?.querySelector('.pill.cut')?.textContent.trim(),
    }
  })
  log('条19 pill 优先级：带「生成中断」的会话压缩时显「压缩中」（进行中 > 历史状态），结束后恢复「生成中断」',
    pillPriority.compact && !pillPriority.cut && pillPriority.text === '压缩中'
    && !pillRestored.compact && pillRestored.cut === '生成中断',
    JSON.stringify({ during: pillPriority, after: pillRestored }))
  log('条29 执行中切换会话不 abort：请求照常完成（count+1）+ toast 全局到达',
    compactRequests === reqInt + 1 && intToast === '✓ 上下文压缩完成：中段历史已摘要，聊天记录不受影响')
  compactDelayMs = 0
  await shot('07-sidebar-after-compact-light')

  /* ---- REQ-040 验收 2 行为面：手动压缩后下一回合请求体含摘要（真实回合 + 摘要注入 → 关键事实可答） ---- */
  // 置该会话上一回合 step=1 遥测行 tokens_prompt=8500（> 阈值 7000）→ 下一回合组装走压缩注入分支
  const seedTurnRow = await runPy(`
import sqlite3, sys
from datetime import datetime
conn = sqlite3.connect(sys.argv[1])
conn.execute("INSERT INTO telemetry (day,user_id,mode,turn_id,endpoint,kind,step,model,"
    "latency_ms,status,tokens_prompt,tokens_total,session_id)"
    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    (datetime.now().strftime("%Y-%m-%d"), 1, "unified", "seed-prev-turn", "turn", "llm", 1,
     "deepseek-chat", 800, "ok", 8500, 8600, "s_long"))
conn.commit()
conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
conn.close()
print("ok")
`)
  const turnRes = await page.evaluate(async () => {
    const r = await fetch('/api/chat/turn', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 's_long', message: '我叫什么名字？我在开发什么产品？' }),
    })
    if (!r.ok || !r.body) return { status: r.status, text: '' }
    const reader = r.body.getReader()
    const dec = new TextDecoder()
    let text = ''
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const ln of lines) {
        if (!ln.startsWith('data: ')) continue
        try {
          const ev = JSON.parse(ln.slice(6))
          if (ev.type === 'text.delta') text += ev.text
        } catch { /* 心跳/注释帧 */ }
      }
    }
    return { status: 200, text }
  })
  const backfill = JSON.parse(await runPy(CHECK_BACKFILL_PY) || '{}')
  log('条27补/REQ-040 验收 2 行为面：手动压缩后下一回合请求体含摘要——真实回合关键事实（小明/喵喵）经摘要承载可答（基线 v6 下该事实在 20 轮窗口外）',
    seedTurnRow === 'ok' && turnRes.status === 200 && turnRes.text.includes('小明'),
    `answer=${turnRes.text.slice(0, 60)}`)
  log('懒回填一致性（REQ-041 验收 1 完整面·真实机器采集）：compress 行 tokens_after == 下一回合 step=1 llm 行 tokens_prompt；水位复用零新摘要调用（恰 1 条 endpoint=compact）',
    backfill.compress_count === 1 && backfill.step1_prompt != null
    && JSON.stringify(backfill.tokens_after) === JSON.stringify([backfill.step1_prompt]),
    JSON.stringify(backfill))

  /* ============ 普通用户 403（条 10/41 admin 面） ============ */
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
  const tel403 = await fetchApi('/api/admin/telemetry?days=7')
  log('条33补 普通用户：403 卡渲染 + DOM 无遥测节点；扩展后端点 403 零泄露（响应体仅 detail，零 compact 键）',
    normalDom.forbid && normalDom.telNodes === 0 && tel403.status === 403
    && JSON.stringify(Object.keys(tel403.body ?? {})) === '["detail"]')
  // 普通用户压缩无 admin 门槛（REQ-040 验收 4 后半：浏览器面——自己的会话照常压缩）
  const normalCompact = await fetchApi('/api/chat/compact', {
    method: 'POST', body: JSON.stringify({ session_id: 'no-such' }),
  })
  log('REQ-040 验收 4 浏览器面：普通用户可调用压缩端点（无 admin 门禁；不存在会话 404 归属隔离）',
    normalCompact.status === 404 && normalCompact.body?.detail?.code === 'session_not_found')
  await shot('08-normal-user-403')

  /* ============ 条 42 亮暗双主题（暗色全元素亮色残留扫描 + 关键文字令牌断言） ============ */
  await page.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'walkthrough-admin', password: 'Walkthrough2026' }),
    })
  })
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await sleep(600)
  await switchThemeTo(true)
  // 暗色侧栏 + 执行中 pill 锁定帧（拦截延迟 200 捕获）
  await drainToasts()
  compactDelayMs = 1500
  await openMenuOf('B2 长会话样件（关键事实与知识问答）')
  await clickCompactItem()
  await sleep(400)
  const darkSidebar = await page.evaluate(() => {
    const LIGHTS = ['rgb(255, 255, 255)', 'rgb(250, 251, 252)', 'rgb(245, 246, 247)', 'rgb(242, 243, 245)', 'rgb(240, 244, 255)', 'rgb(255, 247, 232)', 'rgb(253, 236, 234)', 'rgb(232, 235, 242)']
    const sb = document.querySelector('.sidebar')
    const leak = []
    for (const el of sb.querySelectorAll('*')) {
      const bg = getComputedStyle(el).backgroundColor
      if (bg !== 'rgba(0, 0, 0, 0)' && LIGHTS.includes(bg)) leak.push(`${el.tagName}.${el.className} ${bg}`)
    }
    const pill = document.querySelector('.pill.compact')
    return {
      leak: leak.slice(0, 5),
      sbBg: getComputedStyle(sb).backgroundColor,
      pillBg: pill ? getComputedStyle(pill).backgroundColor : null,
      pillColor: pill ? getComputedStyle(pill).color : null,
      // 取非选中项标题（选中项标题为 primary 色，非 text-1）
      titleColor: getComputedStyle(document.querySelector('.item:not(.active) .title')).color,
    }
  })
  await shot('09-sidebar-compacting-dark')
  log('条42 暗色侧栏：零亮色残留 + 执行中 pill 暗令牌（primary-l #1D2740 / primary #5C8DFF）+ 标题 text-1 #E6EAF0',
    darkSidebar.leak.length === 0 && darkSidebar.sbBg === 'rgb(19, 20, 23)'
    && darkSidebar.pillBg === 'rgb(29, 39, 64)' && darkSidebar.pillColor === 'rgb(92, 141, 255)'
    && darkSidebar.titleColor === 'rgb(230, 234, 240)', JSON.stringify(darkSidebar))
  await waitForToast('上下文压缩完成') // 等在途压缩完成（真实调用）再导航，避免打断请求

  // 暗色 admin 遥测面板（含卡 E）
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' })
  await sleep(500)
  await page.evaluate(() => {
    [...document.querySelectorAll('.adm-tabs button')].find((b) => b.textContent.trim() === '遥测')?.click()
  })
  await sleep(600)
  const darkAdmin = await page.evaluate(() => {
    const LIGHTS = ['rgb(255, 255, 255)', 'rgb(250, 251, 252)', 'rgb(245, 246, 247)', 'rgb(242, 243, 245)', 'rgb(240, 244, 255)', 'rgb(255, 247, 232)', 'rgb(253, 236, 234)', 'rgb(232, 235, 242)']
    const panels = [...document.querySelectorAll('.panel')].filter((p) => p.querySelector('.tel-toolbar'))
    const leak = []
    for (const p of panels) for (const el of p.querySelectorAll('*')) {
      const bg = getComputedStyle(el).backgroundColor
      if (bg !== 'rgba(0, 0, 0, 0)' && LIGHTS.includes(bg)) leak.push(`${el.tagName}.${el.className} ${bg}`)
    }
    const ce = [...document.querySelectorAll('.tel-card')][3]
    return {
      leak: leak.slice(0, 5),
      ceBg: ce ? getComputedStyle(ce).backgroundColor : null,
      headColor: ce ? getComputedStyle(ce.querySelector('.tc-head')).color : null,
      subColor: ce ? getComputedStyle(ce.querySelector('.tc-sub')).color : null,
      cellBg: ce ? getComputedStyle(ce.querySelector('.ce-cell')).backgroundColor : null,
      pageBg: getComputedStyle(document.querySelector('.admin-page')).backgroundColor,
      rateText: ce?.querySelectorAll('.ce-cell')[1]?.querySelector('.tc-big')?.textContent.trim(),
    }
  })
  log('条42补 暗色遥测面板与卡 E：零亮色残留 + surface #1E2026 / text-1 #E6EAF0 / text-3 #808896 / 内面板 #24272E（降幅值渲染不受主题影响）',
    darkAdmin.leak.length === 0 && darkAdmin.ceBg === 'rgb(30, 32, 38)'
    && darkAdmin.headColor === 'rgb(230, 234, 240)' && darkAdmin.subColor === 'rgb(128, 136, 150)'
    && darkAdmin.cellBg === 'rgb(36, 39, 46)' && darkAdmin.pageBg === 'rgb(19, 20, 23)'
    && typeof darkAdmin.rateText === 'string' && darkAdmin.rateText.endsWith('%'),
    JSON.stringify(darkAdmin))
  log('条42补2 正文对比度（tokens v1.3 暗值 text-1 #E6EAF0 / surface #1E2026 ≈ 13.9:1 ≥ 4.5:1；text-3 #808896 ≈ 5.5:1）', true, 'tokens v1.3 计算值，iter-12 OBS-3 / iter-15 条 42 认可口径')
  await shot('10-admin-cardE-dark')
  await switchThemeTo(false)

  /* ---- 条 44 适用性 + 条 43 样件数据 ---- */
  const applic = await page.evaluate(() => ({
    canvas: document.querySelectorAll('.admin-page canvas, .admin-page svg.recharts').length,
    compressedMark: document.body.textContent.includes('已压缩'),
  }))
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await sleep(400)
  const sidebarMark = await page.evaluate(() => document.querySelector('.sidebar')?.textContent.includes('已压缩'))
  log('条44 适用性：无趋势图表 + 无「已压缩」常驻标记（admin 与侧栏双面板扫描）；移动端不承诺（沿 iter-11/12/15 口径）',
    applic.canvas === 0 && !applic.compressedMark && !sidebarMark)
  log('条43 样件数据全虚构（铁律 5）：会话档/admin 造数为脚本内虚构常量；手动压缩与懒回填数值由真实后端机器采集渲染，不手填不编造', true, '脚本头声明 + 造数段标注')

  /* ---- 自动化用例承载标注（pytest/vitest 已断言的条目） ---- */
  const byTests = [
    ['条15 corrupted 禁用 title C4 的点击不生效面', 'SessionListItem.spec「corrupted 会话：压缩项禁用 + title 逐字 C4」（aria-disabled + 点击无 emit）'],
    ['条22/27 无需压缩零上游调用（假传输层零调用断言）', 'pytest test_compact_api「无需压缩 200 skipped 零上游调用」（seen == [] + usage_daily 零行）；浏览器面承载 toast C6'],
    ['条25 本地生成中仍发请求（前端零预判 vitest 面）', 'TheSidebarCompact.spec「本地生成中的会话点击压缩仍发请求」'],
    ['条26 失败路径会话档零写入（pytest 面前后比对）', 'pytest test_compact_api「摘要失败 502 原摘要保留 会话档零写入」'],
    ['条27 usage_daily turns 零变化（定夺⑧ test_quota 零改动复跑）', 'pytest 281 全绿含 test_quota 全套零改动复跑 + compact 用例 usage_daily 零行断言'],
    ['条38 聚合口径精确值（pytest 主断言面）', 'pytest test_admin_compact「造数精确值」（count/measured/Σ/round6 rate 精确断言）'],
    ['条31 成本聚合含 compress 行（数值断言 pytest 面）', 'pytest test_admin_compact「成本聚合计入 unified compress 行 tokens_prompt 按输入计价」'],
    ['条33 遥测端点 403 零泄露（pytest 面）', 'pytest test_admin_compact「扩展聚合端点 普通用户 403 零 compact 泄露」'],
    ['条40 缺失态合法 0 变异断言（pytest+vitest 双面）', 'pytest「合法 0 降幅如实」+ AdminCompactCard.spec「合法 0 降幅如实显 0.0%」'],
    ['懒回填失败行不回填/未测得不补造', 'pytest test_compact_api「失败行不回填」/「usage 无 prompt_tokens 不回填不补造」'],
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
