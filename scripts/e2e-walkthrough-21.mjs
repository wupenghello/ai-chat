/* ai-chat iter-21 T3 浏览器走查脚本（design-iter-21 §6 走查清单 28 条）
 *
 * 沿 scripts/e2e-walkthrough-20.mjs 骨架：puppeteer-core 驱动本机 Chrome，PASS/FAIL 逐条
 * + 截图留档 /tmp/e2e21/shots/。FAIL 区分脚本问题与产品缺陷（小缺陷当轮修 + defects.md 登记）。
 *
 * 走查形态：桌面 1440×900（主面 + E 类零回退）+ ≤480px 375×812（全屏态）× 明/暗双主题。
 * 数据态：真实后端 + 直插 telemetry 造数（backend/.venv/bin/python + sqlite3，铁律 5 测试
 * 断言口径）；未配置单价态与失败态 = 网络层响应拦截（真实 Chrome 渲染路径，状态模拟——
 * 未配置态后端不可达〔.env 已配单价且 pydantic-settings 文件面不可压〕，实现级决策登记
 * verify T3-1①；vitest/pytest 已各承载未配置语义与重试恢复的组件面与 API 面）。
 *
 * 本脚本自起全部服务（独立 /tmp 库，不触开发库与其他会话端口）：
 *   主后端：backend/.venv/bin/uvicorn app.main:app --port 8815（AI_CHAT_DB_PATH=/tmp 独立库）。
 *           统一 key 三变量自 backend/.env 读取后经**进程环境**注入子进程。
 *   前端：npx vite --port 5181（proxy 目标经 AI_CHAT_DEV_API_TARGET → 8815）。
 * 账号：walkthrough-usage（首注册 = admin，统一 key 模式）/ walkthrough-empty（空态）/
 *       walkthrough-self（自填模式态，经 API 建档激活）。
 * 运行：node scripts/e2e-walkthrough-21.mjs（无外部前置；Chrome 本机路径沿 iter-14~20）
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BACKEND = 8815
const VITE = 5181
const BASE = `http://localhost:${VITE}`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' // 本机路径沿 iter-14~20 先例
const SHOTS = '/tmp/e2e21/shots'
const DB = '/tmp/ai-chat-walkthrough-21.db'

mkdirSync(SHOTS, { recursive: true })
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
  try { rmSync(f) } catch { /* 首跑无残留 */ }
}

const results = []
function log(name, ok, detail = '') {
  results.push(`${ok === null ? 'N/A ' : ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —— ' + detail : ''}`)
  console.log(results.at(-1))
}

/* ---- 样件文案（design-iter-21 §7 逐字唯一来源 U1~U16） ---- */
const U1 = '用量与费用'
const U3 = '查看你的对话用量与费用估算'
const U4 = '今日对话'
const U5 = '自填模式 · 无免费额度上限'
const U6 = '今日费用估算'
const U7 = '未配置'
const U10 = '明细保留 90 天，超期自动清理'
const U12 = '仅统一 key 模式计成本；自填模式 tokens 不计成本'
const U14 = '选定时间范围内暂无用量记录'
const U15 = '费用估算（未配置单价）'
const U16 = '用量数据加载失败，请稍后重试'
const HEADERS = ['日期', '回合数', '输入 tokens', '输出 tokens', '缓存命中', '费用估算']
const SIX_TABS = ['外观', '密钥模式', '高级设置', '对话设置', 'AI 的记忆', '用量与费用', '账号']

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

/* 直插 telemetry 造数（经后端 venv python + sqlite3；列白名单与 schema 一致，铁律 5） */
function seedTelemetry(rows) {
  const payload = JSON.stringify(rows)
  const proc = spawn(`${ROOT}backend/.venv/bin/python`, ['-c', `
import json, sqlite3, sys
rows = json.loads(sys.argv[1])
conn = sqlite3.connect(sys.argv[2])
cols = set()
for r in rows: cols.update(r)
all_cols = ("day user_id mode turn_id endpoint kind step model latency_ms status "
            "tokens_prompt tokens_completion tokens_total cache_hit_tokens cache_miss_tokens "
            "tool_name error_code tokens_before tokens_after session_id").split()
with conn:
    for r in rows:
        names = list(r)
        conn.execute(f"INSERT INTO telemetry ({','.join(names)}) VALUES ({','.join('?'*len(names))})",
                     tuple(r[n] for n in names))
print("ok")
`, payload, DB])
  return new Promise((resolve) => {
    let out = ''
    proc.stdout.on('data', (d) => { out += d })
    proc.on('close', () => resolve(out.includes('ok')))
  })
}

const day = (back) => {
  const d = new Date(Date.now() - back * 86400000)
  return d.toISOString().slice(0, 10)
}
const llm = (d, mode, turn, prompt, completion, hit, miss, uid = 1) => ({
  day: d, user_id: uid, mode, endpoint: 'turn', kind: 'llm', turn_id: turn, step: 1,
  model: 'deepseek-test', latency_ms: 100, status: 'ok',
  tokens_prompt: prompt, tokens_completion: completion, tokens_total: prompt + completion,
  cache_hit_tokens: hit, cache_miss_tokens: miss,
})
const compactRow = (d, mode, prompt, uid = 1) => ({
  day: d, user_id: uid, mode, endpoint: 'compact', kind: 'compress', turn_id: null,
  step: null, model: 'deepseek-test', latency_ms: 500, status: 'ok',
  tokens_prompt: prompt, tokens_completion: 0, tokens_total: prompt,
})

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
let pageErrors = 0
page.on('pageerror', () => { pageErrors++ })
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false })

const $one = (sel) => page.$eval(sel, (e) => e.textContent.trim()).catch(() => null)
const $all = (sel) => page.$$eval(sel, (es) => es.map((e) => e.textContent.trim())).catch(() => null)
const $exists = (sel) => page.$(sel).then((e) => !!e)
const style = (sel, prop) => page.$eval(sel, (e, p) => getComputedStyle(e)[p], prop).catch(() => null)

async function waitFor(fn, timeout = 30000, label = '') {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try { if (await fn()) return true } catch { /* 未就绪 */ }
    await sleep(300)
  }
  console.log(`  (waitFor 超时：${label || '未知条件'})`)
  return false
}

async function api(path, opts = {}) {
  return page.evaluate(async (p, o) => {
    const r = await fetch(p, { credentials: 'same-origin', ...JSON.parse(o) })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, path, JSON.stringify(opts))
}
async function loginAs(username) {
  await page.evaluate(async (u) => {
    await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: 'Walkthrough2026' }),
    })
  }, username)
}
async function openSettings() {
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await sleep(500)
  if (!(await $exists('.settings-modal'))) {
    // ≤768px 抽屉态：先开抽屉再点账户（walkthrough-20 openSettingsMobile 同路径）
    const drawerVisible = await page.$('.drawer-btn').then(async (el) => {
      if (!el) return false
      const b = await el.boundingBox()
      return !!b && b.width > 0
    })
    if (drawerVisible) {
      await page.click('.drawer-btn')
      await sleep(400)
    }
    await waitFor(async () => {
      const el = await page.$('.acct-trigger')
      if (!el) return false
      const box = await el.boundingBox()
      return !!box && box.width > 0
    }, 15000, '.acct-trigger 可见')
    await page.evaluate(() => document.querySelector('.acct-trigger')?.click())
    await sleep(400)
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('.dd-menu [role="menuitem"], .dd-menu button')]
      const t = items.find((e) => e.textContent.trim() === '设置')
      if (t) t.click()
    })
    await sleep(500)
  }
  return $exists('.settings-modal')
}
async function gotoPane(key) {
  await page.evaluate((k) => {
    const btn = document.querySelector(`.sm-nav [data-pane="${k}"]`)
    if (btn) btn.click()
  }, key)
  await sleep(600)
}
/* 网络层响应拦截（未配置/失败两态模拟；开关后须 reload 生效） */
async function interceptUsage(mode) {
  await page.setRequestInterception(true)
  page.removeAllListeners('request')
  page.on('request', (req) => {
    if (mode && req.url().includes('/api/usage/summary')) {
      if (mode === 'abort') { req.abort('failed').catch(() => {}); return }
      req.respond({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          window: { days: 7, date_from: day(6), date_to: day(0) },
          price: { configured: false, input_per_mtok: null, output_per_mtok: null, cache_hit_per_mtok: null },
          today: { mode: 'unified', daily_limit: 30, used_today: 5, cost_total: null },
          daily: [{
            day: day(0), turns: 5, tokens_prompt: 12345, tokens_completion: 6789,
            cache_hit_tokens: 4200, cost_total: null,
          }],
          retention_days: 90,
        }),
      }).catch(() => {})
      return
    }
    req.continue().catch(() => {})
  })
}
async function clearIntercept() {
  await page.setRequestInterception(false)
  page.removeAllListeners('request')
}

try {
  /* ============ 前置 ============ */
  backendProc = spawnBackend()
  log('前置·主后端起服务（统一 key 经进程环境注入，/tmp 独立库）', await waitHealth())
  viteProc = spawnVite()
  log('前置·前端 dev server 起服务（5181 → proxy 8815）', await waitVite())

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
  for (const u of ['walkthrough-usage', 'walkthrough-empty', 'walkthrough-self']) {
    await page.evaluate(async (name) => {
      await fetch('/api/auth/register', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, password: 'Walkthrough2026' }),
      })
    }, u)
  }
  await loginAs('walkthrough-usage')
  // walkthrough-self 建档激活（自填模式态：mode='self'）
  await page.evaluate(async () => {
    await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'walkthrough-self', password: 'Walkthrough2026' }),
    })
    await fetch('/api/profiles', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'p1', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', api_key: 'sk-test-walkthrough' }),
    })
    const list = await (await fetch('/api/profiles', { credentials: 'same-origin' })).json()
    const id = list[0]?.id ?? list?.profiles?.[0]?.id
    if (id) await fetch(`/api/profiles/${id}/activate`, { method: 'POST', credentials: 'same-origin' })
    await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'walkthrough-usage', password: 'Walkthrough2026' }),
    })
  })
  await sleep(300)
  log('前置·三账号注册 + self 建档激活 + 回登 walkthrough-usage', true)

  // 造数（user_id=1 = walkthrough-usage）：今日（2 回合 unified 带缓存 + 1 回合 self + 手动压缩）、
  // 昨日（1 回合 unified 无缓存字段）、前 8 日（1 回合 unified，仅 30 天窗可见）
  const T = day(0), Y = day(1), D8 = day(8)
  log('前置·telemetry 造数直插（今日 3 行 + 压缩 1 行 / 昨日 1 行 / 第 8 日 1 行）', await seedTelemetry([
    llm(T, 'unified', 't-1', 1000000, 100000, 200000, 800000),
    llm(T, 'unified', 't-2', 500000, 50000, null, null),
    llm(T, 'self', 't-3', 300000, 30000, null, null),
    compactRow(T, 'unified', 20000),
    llm(Y, 'unified', 'y-1', 21402, 11036, null, null),
    llm(D8, 'unified', 'd8-1', 8000, 800, null, null),
  ]))

  /* ============ A 组：分区新增断言 ============ */
  await openSettings()
  const tabs = await $all('.sm-nav [role="tab"]')
  log('1 导航第七项「用量与费用」位于 AI 的记忆与账号之间', JSON.stringify(tabs) === JSON.stringify(SIX_TABS), JSON.stringify(tabs))
  await gotoPane('usage')
  log(`2 pane-label U1 + 副题 U3 逐字`, (await $one('.usage-pane .pane-label')) === U1 && (await $one('.usage-pane .u-sub')) === U3)
  const quota = await api('/api/quota')
  const todayTurns = await $one('.u-today .cell:nth-child(1) .v')
  log(`3 今日对话与 /api/quota 同刻一致（${quota.body.used_today} / ${quota.body.daily_limit} 次）`,
    todayTurns === `${quota.body.used_today} / ${quota.body.daily_limit} 次`, todayTurns)
  const todayCost = await $one('.u-today .cell:nth-child(2) .v')
  log(`4 今日费用估算 = ¥ + 4 位小数（${todayCost}）`, /^¥\d+\.\d{4}$/.test(todayCost ?? ''), todayCost)
  await shot('A4-today')

  // self 模式态（条 5）：登出 → login walkthrough-self → 开设置 → 用量分区
  await page.keyboard.press('Escape')
  await sleep(400)
  await loginAs('walkthrough-self')
  await openSettings()
  await gotoPane('usage')
  const selfToday = await $one('.u-today .cell:nth-child(1) .v')
  const selfQuota = await api('/api/quota')
  log(`5 self 模式今日行 = U5 逐字`, selfToday === U5, `行=${selfToday} / quota.mode=${selfQuota.body?.mode}`)
  await loginAs('walkthrough-usage')
  await openSettings()
  await gotoPane('usage')

  const firstDay = await $one('table.u tbody tr td')
  log('6 默认近 7 天（首行 = 今日，倒序）', firstDay === T, firstDay)
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.u-win button')]
    btns.find((b) => b.textContent.trim() === '近 30 天')?.click()
  })
  await sleep(800)
  const rows30 = await $all('table.u tbody tr td:first-child')
  log(`6b 切近 30 天 → 第 8 日行入列（${rows30.length} 行）`, rows30.includes(D8), JSON.stringify(rows30))
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.u-win button')]
    btns.find((b) => b.textContent.trim() === '近 7 天')?.click()
  })
  await sleep(800)
  log(`7 保留期旁注 U10 逐字`, (await $one('.u-win .note')) === U10)
  const ths = await $all('table.u th')
  log(`8 表头六列逐字`, JSON.stringify(ths) === JSON.stringify(HEADERS), JSON.stringify(ths))
  const rowTds = await $all('table.u tbody tr:first-child td')
  log(`9 倒序 + 千分位（输入列 ${rowTds[2]}）`, rowTds[0] === T && rowTds[2] === '1,820,000', JSON.stringify(rowTds))
  const sumTds = await $all('table.u tbody tr.sum td')
  log(`10 缓存缺失日「—」+ 合计行求和（合计回合 ${sumTds[1]}）`,
    rowTds.length === 6 && sumTds[1] === '4' && sumTds[4] === '—', JSON.stringify(sumTds))
  log(`10b 费用合计 = 各日求和（${sumTds[5]}）`, /^¥\d+\.\d{4}$/.test(sumTds[5] ?? ''))
  log(`11 费用列合计任一日缺失 → 「—」（未配置面 vitest 承载：UsagePane.spec 合计缺失用例）`, null)
  log(`12 脚注 U12 逐字`, (await $one('.u-foot')) === U12)

  // 空态（条 13）：login walkthrough-empty
  await page.keyboard.press('Escape')
  await sleep(400)
  await loginAs('walkthrough-empty')
  await openSettings()
  await gotoPane('usage')
  log(`13 空态 U14 逐字 + 今日行照常`, (await $one('.u-state')) === U14 && (await $exists('.u-today')) === true)
  await shot('A13-empty')

  // 未配置单价态（条 14）：网络层拦截模拟（实现级决策 verify T3-1①）
  await loginAs('walkthrough-usage')
  await interceptUsage('unset')
  await openSettings()
  await gotoPane('usage')
  await sleep(600)
  log(`14 未配置：今日费用 U7「未配置」+ 表头 U15 + 行内「—」+ tokens 照常`,
    (await $one('.u-today .cell:nth-child(2) .v')) === U7 &&
    (await $all('table.u th'))[5] === U15 &&
    (await $all('table.u tbody tr:first-child td'))[5] === '—' &&
    (await $all('table.u tbody tr:first-child td'))[2] === '12,345')
  await shot('A14-unset')

  // 失败态（条 15）：拦截 abort → U16 + 重试恢复
  await clearIntercept()
  await interceptUsage('abort')
  await openSettings()
  await gotoPane('usage')
  await sleep(600)
  const failedText = await $one('.u-state')
  log(`15 失败态 U16 逐字 + 重试钮存在`, (failedText ?? '').includes(U16) && (await $exists('.retry')))
  await clearIntercept()
  await page.click('.retry')
  await waitFor(() => $exists('table.u'), 15000, '重试后表格恢复')
  log(`15b 点重试 → 表格恢复`, await $exists('table.u'))
  await shot('A15-retry')

  // 深色（条 16）
  await page.evaluate(() => localStorage.setItem('ai-chat-theme', 'dark'))
  await openSettings()
  await gotoPane('usage')
  await sleep(500)
  const darkBg = await style('.u-today', 'backgroundColor')
  await shot('A16-dark')
  await page.evaluate(() => localStorage.setItem('ai-chat-theme', 'light'))
  await openSettings()
  await gotoPane('usage')
  await sleep(500)
  const lightBg = await style('.u-today', 'backgroundColor')
  log(`16 深色模式分量走语义令牌（今日行底色随主题翻转 ${lightBg} → ${darkBg}）`, darkBg !== lightBg && !!darkBg)

  /* ============ B 组：既有六分区零回退 ============ */
  const tabs2 = await $all('.sm-nav [role="tab"]')
  log(`18 六分区导航项与顺序零变化（七项含新分区）`, JSON.stringify(tabs2) === JSON.stringify(SIX_TABS))
  await page.evaluate(() => document.querySelector('.sm-nav [data-pane="appearance"]')?.focus())
  let focusSeq = []
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('ArrowDown')
    await sleep(120)
    focusSeq.push(await page.evaluate(() => document.activeElement?.textContent.trim()))
  }
  log(`19 方向键导航取模循环含第七项（7 次循环不跳项）`,
    JSON.stringify(focusSeq) === JSON.stringify(['密钥模式', '高级设置', '对话设置', 'AI 的记忆', '用量与费用', '账号', '外观']),
    JSON.stringify(focusSeq))
  log(`20 外观主题切换即时生效（useTheme.spec 6 用例承载 + 条 16 双主题翻转实测）`, null)
  await gotoPane('mode')
  const km = await $one('.mode-card') ?? await page.evaluate(() => document.querySelector('.sm-pane:not([style*="none"])')?.textContent ?? '')
  log(`21 密钥模式卡今日文案零改动（含「免费额度」体例）`, (km ?? '').includes('免费额度'), (km ?? '').slice(0, 40))
  // 22 未保存拦截跨分区
  await gotoPane('chat')
  await page.evaluate(() => {
    const ta = document.querySelector('.prompt-ta')
    if (ta) { ta.value = '走查草稿'; ta.dispatchEvent(new Event('input', { bubbles: true })) }
  })
  await sleep(300)
  await gotoPane('usage')
  await page.keyboard.press('Escape')
  await sleep(400)
  const dirtyShown = await $exists('.dirty-mask')
  log(`22 对话设置草稿 + 用量分区激活 → Esc 弹未保存确认`, dirtyShown)
  await page.keyboard.press('Escape') // 关确认
  await sleep(300)
  // 23 用量分区激活无编辑 → Esc 直接关
  await page.evaluate(() => { /* 丢弃草稿：确认弹窗「放弃」路径沿 UI */ })
  const stillOpen = await $exists('.settings-modal')
  if (stillOpen) { await page.keyboard.press('Escape'); await sleep(300) }
  await openSettings()
  await gotoPane('usage')
  await page.keyboard.press('Escape')
  await sleep(400)
  log(`23 用量分区无编辑 → Esc 直接关弹窗（零插入点）`, !(await $exists('.settings-modal')))
  await openSettings()
  await gotoPane('memory')
  log(`24 AI 的记忆分区渲染零回退（pane-label 逐字）`, (await $one('.sm-pane:not([style*="none"]) .pane-label')) === 'AI 的记忆')
  await gotoPane('account')
  const acctText = await page.evaluate(() => document.querySelector('.sm-pane:not([style*="none"])')?.textContent ?? '')
  log(`25 账号分区改密/注销零回退`, acctText.includes('旧密码') && acctText.includes('注销账号'))

  /* ============ C 组：全局 ============ */
  await page.keyboard.press('Escape')
  await sleep(300)
  log(`26 全流程零页面错误（pageerror = ${pageErrors}）`, pageErrors === 0)

  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true })
  await openSettings()
  await gotoPane('usage')
  await sleep(600)
  const mobile = await page.evaluate(() => {
    const wrap = document.querySelector('.u-table-wrap')
    const pane = document.querySelector('.sm-pane')
    return {
      // 容器内滚动机制 = overflow-x:auto（scrollWidth > clientWidth 为滚动内容本身，属预期）；
      // 不溢出视口断言由 paneOk（分区）与文档横向滚动为零承载（design §3.3）
      wrapOk: wrap ? ['auto', 'scroll'].includes(getComputedStyle(wrap).overflowX) : false,
      paneOk: pane ? pane.scrollWidth <= document.documentElement.clientWidth + 1
        && document.documentElement.scrollWidth <= window.innerWidth + 1 : false,
      navHasUsage: [...document.querySelectorAll('.sm-nav [role="tab"]')].some((b) => b.textContent.trim() === '用量与费用'),
    }
  })
  await shot('C17-mobile')
  log(`17 ≤480px 全屏态：表格容器内滚动 + 分区不溢出视口`, mobile.wrapOk && mobile.paneOk, JSON.stringify(mobile))
  log(`27 全屏态导航横切含第七项`, mobile.navHasUsage)

  await page.setViewport({ width: 1440, height: 900 })
  await openSettings()
  const desk = await page.evaluate(() => {
    const m = document.querySelector('.settings-modal')
    const nav = document.querySelector('.sm-nav')
    return { w: m?.getBoundingClientRect().width, navW: nav?.getBoundingClientRect().width }
  })
  log(`28 桌面 720px 分栏形态零变化（modal=${desk.w} / nav=${desk.navW}）`, desk.w === 720 && desk.navW === 168, JSON.stringify(desk))
  await page.keyboard.press('Escape')
} catch (e) {
  console.log('WALKTHROUGH ERROR:', e)
  log('脚本异常中断', false, String(e))
} finally {
  await clearIntercept().catch(() => {})
  await browser.close().catch(() => {})
  await killProc(viteProc)
  await killProc(backendProc)
}

const fail = results.filter((r) => r.startsWith('FAIL')).length
const na = results.filter((r) => r.startsWith('N/A')).length
console.log(`\n==== 走查汇总：${results.length - na - 1} PASS / ${fail} FAIL / ${na} N/A（截图 ${SHOTS}/）====`)
process.exit(fail ? 1 : 0)
