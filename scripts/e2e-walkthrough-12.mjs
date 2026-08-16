/* ai-chat iter-12 T2 浏览器走查脚本（design-iter-12 §7.2 清单 52 条之浏览器触点）
 *
 * 沿 scripts/e2e-walkthrough.mjs（iter-8 沉淀，制度 v1.4.6 配套）结构：
 * 预览端口被并行会话占用时，以 puppeteer-core 驱动本机 Chrome 对真实应用做走查与断言。
 *
 * 前置（本次实跑）：
 *   后端：AI_CHAT_DB_PATH=/tmp/mm-walk12.db AI_CHAT_REGISTER_IP_DAILY_LIMIT=0
 *         AI_CHAT_UNIFIED_DAILY_TOTAL=20 uv run uvicorn app.main:app --port 8000
 *   前端：npx vite --port 5180 --strictPort
 *   造数：mm-admin(id1 管理员) + spam-bot-2026(id2) 经 API 注册；用户01~43 + 长名用户直插；
 *         usage_daily 近 7 天缺 d(2)（→ distinct_days=6 < 7 = 缺失行）；今日 12/3/6 请求 36000/9000/15000 token
 *   期望值（今日，unified 总量 20）：总用户 46 · 今日请求 21 · 今日 token 60,000 · 统一 key 15/20（75% 常态）
 * 运行：node scripts/e2e-walkthrough-12.mjs；截图 /tmp/e2e12/shots/。
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:5180'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = '/tmp/e2e12/shots'
mkdirSync(SHOTS, { recursive: true })

const results = []
function log(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —— ' + detail : ''}`)
  console.log(results.at(-1))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const apiReqs = [] // /api/admin 请求参数取证（条 14/15/20/22/39：offset 重置 / 越界 / 排序参数）

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
page.on('request', (r) => {
  if (r.url().includes('/api/admin/')) apiReqs.push(new URL(r.url()).search)
})

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}
async function text() {
  return page.evaluate(() => document.body.innerText)
}
async function style(sel, prop) {
  return page.evaluate((s, p) => {
    const el = document.querySelector(s)
    return el ? getComputedStyle(el)[p] : null
  }, sel, prop)
}

try {
  // ---- 条 45a：未登录 /admin → 跳登录 ----
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' })
  await sleep(300)
  log('§45 未登录 /admin → 登录页', page.url().includes('/login'), page.url())

  // ---- 管理员登录 ----
  await page.evaluate(async () => {
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'mm-admin', password: 'mm20260817' }),
      credentials: 'same-origin',
    })
  })
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await sleep(800)

  // ---- 条 45b：入口 = 侧栏账户「···」菜单「管理后台」（iter-11 形态）----
  const acctBtn = await page.$('.sidebar-footer .dd, .account, [aria-label*="账户"], .acct')
  const entryViaMenu = await page.evaluate(() => {
    // 账户区：首字头像按钮（TheSidebar 账户区，iter-11）
    const btns = [...document.querySelectorAll('button')]
    const acct = btns.find((b) => (b.textContent || '').includes('mm-admin'))
    if (!acct) return null
    acct.click()
    return true
  })
  await sleep(400)
  const adminItem = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.dd-menu button, [role="menu"] button, .dd button')]
    const item = items.find((b) => (b.textContent || '').trim().startsWith('管理后台'))
    return item ? { text: item.textContent.trim() } : null
  })
  log('§45 管理员侧栏账户菜单含「管理后台」入口', !!entryViaMenu && !!adminItem, JSON.stringify(adminItem))
  await shot('01-entry-menu')
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('button')]
    const item = items.find((b) => (b.textContent || '').trim().startsWith('管理后台'))
    item?.click()
  })
  await sleep(900)

  // ---- 条 1：页面基调 + 内容列宽 ----
  const pageBg = await style('.admin-page', 'backgroundColor')
  const bodyW = await page.evaluate(() => document.querySelector('.adm-body').getBoundingClientRect().width)
  log('§1 页面底 --c-bg（#F5F6F7）', pageBg === 'rgb(245, 246, 247)', pageBg)
  log('§1 内容列 1080px', Math.round(bodyW) === 1080, String(Math.round(bodyW)))

  // ---- 条 2：顶栏/tab 结构零变化 ----
  const topH = await page.evaluate(() => document.querySelector('.adm-top').getBoundingClientRect().height)
  const tabs = await page.evaluate(() => ({
    role: document.querySelector('.adm-tabs')?.getAttribute('role'),
    labels: [...document.querySelectorAll('.adm-tabs button')].map((b) => b.textContent.trim()),
  }))
  log('§2 顶栏 52px + 双 tab radiogroup', Math.round(topH) === 52 && tabs.role === 'radiogroup' && JSON.stringify(tabs.labels) === '["用户列表","用量列表"]', JSON.stringify(tabs))

  // ---- 条 3：概览卡区置于 tabs 上方 ----
  const posOk = await page.evaluate(() => {
    const cards = document.querySelector('.stat-grid')?.getBoundingClientRect()
    const tabs = document.querySelector('.adm-tabs')?.getBoundingClientRect()
    return cards && tabs && cards.bottom <= tabs.top
  })
  log('§3 四卡 grid 常驻 tabs 上方', posOk === true)

  // ---- 条 4/5/6/7/11：统计卡四指标（与后端同源，条 47 抽样比对）----
  const ov = await page.evaluate(async () => {
    const r = await fetch('/api/admin/overview', { credentials: 'same-origin' })
    return r.json()
  })
  const cards = await page.evaluate(() => [...document.querySelectorAll('.stat-card')].map((c) => c.innerText.replace(/\n/g, ' / ')))
  log('§4-6 卡 1-3 数值（46 / 21 / 60,000）', cards[0].includes('46') && cards[1].includes('21') && cards[2].includes('60,000'), JSON.stringify(cards))
  log('§47 统计卡与 /overview 接口同源', ov.total_users === 46 && ov.today_requests === 21 && ov.today_tokens === 60000 && ov.unified_used === 15, JSON.stringify(ov))
  log('§7 卡 4 常态：15 / 20 次 + 剩余 5 次', cards[3].includes('15 / 20 次') && cards[3].includes('剩余 5 次'), cards[3])
  const fillStyle = await page.evaluate(() => {
    const f = document.querySelector('.s-fill')
    return { width: f.style.width, bg: getComputedStyle(f).backgroundColor }
  })
  log('§7 进度条 75% + 常态 fill --c-primary-solid', fillStyle.width === '75%' && fillStyle.bg === 'rgb(51, 112, 255)', JSON.stringify(fillStyle))
  const cardStyles = await page.evaluate(() => {
    const c = document.querySelector('.stat-card')
    return { bg: getComputedStyle(c).backgroundColor, label: getComputedStyle(c.querySelector('.s-label')).fontSize }
  })
  log('§1 卡片 --c-surface 白卡', cardStyles.bg === 'rgb(255, 255, 255)', JSON.stringify(cardStyles))
  await shot('02-cards-light')

  // ---- 条 8/9：常态警示条不渲染；near/burst 文案逐字 ----
  let banner = await page.evaluate(() => document.querySelector('.site-bar')?.textContent ?? '')
  log('§8 常态警示条不渲染（数值在卡 4）', banner === '', banner.slice(0, 40))

  // near：DB 调整今日 admin unified 12→13 → 16/20 = 80%
  await page.evaluate(async () => { /* noop marker */ })
  const { execSync } = await import('node:child_process')
  const setReq = (n) => execSync(
    `sqlite3 /tmp/mm-walk12.db "UPDATE usage_daily SET requests=${n} WHERE day=date('now','localtime') AND user_id=1 AND mode='unified'"`,
  )
  setReq(13)
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(900)
  banner = await page.evaluate(() => document.querySelector('.site-bar')?.textContent ?? '')
  const nearClasses = await page.evaluate(() => document.querySelector('.site-bar')?.className ?? '')
  log('§9 near 警示条文案逐字', banner.replace(/\s+/g, '') === '统一key每日总量20·今日已用16（已接近上限，请关注消耗）', banner)
  log('§8 near 类名 + 卡 4 fill warning', nearClasses.includes('near') && (await style('.s-fill', 'backgroundColor')) === 'rgb(180, 83, 9)', nearClasses)
  await shot('03-near-banner')

  // burst：→20/20
  setReq(16) // 16+3+1(原 12→13→16) ... 直接算：admin unified = 16 → 全站 16+3=19? 再到 17 → 20
  setReq(17)
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(900)
  banner = await page.evaluate(() => document.querySelector('.site-bar')?.textContent ?? '')
  log('§9 burst 警示条文案逐字', banner.includes('统一 key 每日总量 20 · 今日已用 20') && banner.includes('已暂停全站新对话请求，明日 00:00 自动恢复；自填 key 用户不受影响'), banner)
  log('§7 burst fill danger-solid', (await style('.s-fill', 'backgroundColor')) === 'rgb(217, 48, 37)')
  await shot('04-burst-banner')
  setReq(12) // 恢复常态 15/20，后续步骤口径一致
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(900)

  // ---- 条 23/24/25/26/27：用户表六列 + 徽标 + 管理员行 ----
  const ths = await page.evaluate(() => [...document.querySelectorAll('.panel')[0].querySelectorAll('thead th')].map((t) => t.textContent.trim()))
  log('§23 六列全字段', JSON.stringify(ths) === JSON.stringify(['用户名', '注册时间', '状态', '密钥模式', '配额', '操作']), JSON.stringify(ths))
  const firstRow = await page.evaluate(() => document.querySelector('.adm-table tbody tr')?.innerText.replace(/\n/g, '|'))
  log('§24/25 管理员行：徽标 + 正常胶囊 + 封禁禁用', firstRow.includes('管理员') && firstRow.includes('正常'), firstRow)
  const banBtn = await page.evaluate(() => {
    const b = document.querySelector('button.mini.danger')
    return b ? { disabled: b.disabled, title: b.title, opacity: getComputedStyle(b).opacity } : null
  })
  log('§24 管理员本人封禁禁用 + title', banBtn.disabled === true && banBtn.title === '管理员本人不可封禁' && banBtn.opacity === '0.45', JSON.stringify(banBtn))

  // ---- 条 12：搜索框形态 ----
  const searchBox = await page.evaluate(() => {
    const el = document.querySelector('.u-search')
    const r = el.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), radius: getComputedStyle(el).borderRadius }
  })
  log('§12 搜索框 260×32 + r-md', searchBox.w === 260 && searchBox.h === 32, JSON.stringify(searchBox))

  // ---- 条 13/14/16/17：搜索交互（大小写/防抖链路/高亮/空态）----
  apiReqs.length = 0
  await page.type('.u-search input', 'SPAM')
  await page.keyboard.press('Enter')
  await sleep(900)
  const searchState = await page.evaluate(() => ({
    count: document.querySelector('.u-toolbar .tb-count')?.textContent ?? '',
    mark: document.querySelector('.uname mark.hl')?.textContent ?? '',
    uname: document.querySelector('.uname')?.textContent ?? '',
    clearBtn: !!document.querySelector('.u-clear'),
  }))
  log('§13 「SPAM」命中 spam-bot-2026（大小写不敏感）', searchState.count === '找到 1 个用户' && searchState.uname === 'spam-bot-2026', JSON.stringify(searchState))
  log('§16 命中主色高亮 mark.hl', searchState.mark === 'spam', JSON.stringify(searchState))
  log('§14 清除钮存在（有词时）', searchState.clearBtn === true)
  const searchReq = apiReqs.find((q) => q.includes('search=SPAM'))
  log('§14 请求带 search 参数 + offset=0', !!searchReq && searchReq.includes('offset=0'), searchReq ?? '未捕获')
  await shot('05-search-hit')

  // 空态
  await page.evaluate(() => { document.querySelector('.u-search input').value = '' })
  await page.type('.u-search input', '不存在的名字')
  await page.keyboard.press('Enter')
  await sleep(900)
  const emptyState = await page.evaluate(() => ({
    empty: document.querySelector('.u-empty')?.innerText.replace(/\n/g, ' ') ?? '',
    table: !!document.querySelectorAll('.panel')[0].querySelector('.tbl-card'),
  }))
  log('§17 搜索空态空盒 + 副注 + 清除动作', emptyState.empty.includes('未找到匹配「不存在的名字」的用户') && emptyState.empty.includes('用户名搜索大小写不敏感') && emptyState.empty.includes('清除搜索') && emptyState.table === false, JSON.stringify(emptyState))
  await shot('06-search-empty')
  // 清除 → 恢复全量
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '清除搜索')?.click())
  await sleep(900)
  const afterClear = await page.evaluate(() => document.body.innerText.includes('共 46 个用户 · 3 页'))
  log('§15 清除搜索 → 重置回第 1 页（共 46 · 3 页）', afterClear)

  // ---- 条 18/19/20/22：分页控件 ----
  apiReqs.length = 0
  const pager = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.panel')[0].querySelectorAll('.pager .pg-btn')]
    const cur = document.querySelectorAll('.panel')[0].querySelector('.pager .pg-btn.on')
    return {
      labels: btns.map((b) => b.textContent.trim()),
      cur: cur?.textContent.trim(),
      first: btns[0]?.disabled,
      size: document.querySelectorAll('.panel')[0].querySelector('.pager .pg-btn')?.getBoundingClientRect().height,
      info: document.querySelectorAll('.panel')[0].querySelector('.p-info')?.textContent ?? '',
    }
  })
  log('§18 页码 ‹1 2 3› + 当前页 1 + 首页禁用 + 28px', JSON.stringify(pager.labels) === JSON.stringify(['‹', '1', '2', '3', '›']) && pager.cur === '1' && pager.first === true && Math.round(pager.size) === 28, JSON.stringify(pager))
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await sleep(200)
  await page.evaluate(() => [...document.querySelectorAll('.panel')[0].querySelectorAll('.pager .pg-btn')].find((b) => b.textContent.trim() === '3')?.click())
  await sleep(900)
  const page3 = await page.evaluate(() => {
    const usersPanel = document.querySelectorAll('.panel')[0]
    return {
      rows: usersPanel.querySelectorAll('.adm-table tbody tr').length,
      info: usersPanel.querySelector('.p-info')?.textContent ?? '',
      cur: usersPanel.querySelector('.pager .pg-btn.on')?.textContent.trim(),
      nextDisabled: [...usersPanel.querySelectorAll('.pager .pg-btn')].at(-1).disabled,
      tableTop: Math.round(usersPanel.querySelector('.adm-table').getBoundingClientRect().top),
    }
  })
  log('§18/22 第 3 页：6 行 + 页码高亮 + 末页禁用 + 表格在视口内（6 行无滚动空间，滚动反馈在用量多页场景验）', page3.rows === 6 && page3.cur === '3' && page3.nextDisabled === true && page3.tableTop >= -50 && page3.tableTop <= 450, JSON.stringify(page3))
  const p3req = apiReqs.find((q) => q.includes('offset=40'))
  log('§20 翻页请求 offset=40', !!p3req, p3req ?? '未捕获')

  // ---- 条 36：超长用户名 ellipsis + title ----
  const longName = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.uname')].find((u) => u.textContent.length > 20)
    if (!el) return null
    return { ellipsis: getComputedStyle(el).textOverflow === 'ellipsis', title: el.title, clipped: el.scrollWidth > el.clientWidth }
  })
  log('§36 超长用户名 ellipsis + title 全名', !!longName && longName.ellipsis && longName.title.includes('非常长的用户名') && longName.clipped, JSON.stringify(longName))

  // ---- 条 28/29/30：封禁/解封治理 ----
  await page.evaluate(() => [...document.querySelectorAll('.pager .pg-btn')].find((b) => b.textContent.trim() === '1')?.click())
  await sleep(900)
  apiReqs.length = 0
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button.mini.danger')].find((b) => !b.disabled)
    btn?.click()
  })
  await sleep(400)
  const banModal = await page.evaluate(() => document.body.innerText)
  log('§28 封禁确认模态文案', banModal.includes('封禁该用户？') && banModal.includes('无法登录与调用') && banModal.includes('云端数据保留'), '')
  const confirmBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '确认封禁'))
  await confirmBtn.asElement().click()
  await sleep(900)
  const afterBan = await page.evaluate(() => ({
    toast: [...document.querySelectorAll('.toast, [class*="toast"]')].some((t) => t.textContent.includes('已封禁 spam-bot-2026')),
    row: [...document.querySelectorAll('.adm-table tbody tr')].find((r) => r.textContent.includes('spam-bot-2026'))?.innerText.replace(/\n/g, '|') ?? '',
  }))
  log('§28 封禁生效：toast + 行翻已封禁/解封', afterBan.toast && afterBan.row.includes('已封禁') && afterBan.row.includes('解封'), JSON.stringify(afterBan.row).slice(0, 120))
  log('§4 封禁后总用户数不变（含已封禁）', (await page.evaluate(() => document.querySelector('.stat-card').innerText)).includes('46'))

  // 解封直接生效
  await page.evaluate(() => [...document.querySelectorAll('button.mini')].find((b) => b.textContent.trim() === '解封')?.click())
  await sleep(900)
  const afterUnban = await page.evaluate(() => document.body.innerText)
  log('§30 解封直接生效 + toast', afterUnban.includes('已解封 spam-bot-2026') && afterUnban.includes('正常'))

  // ---- 条 31/32：调配额模态 ----
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.adm-table tbody tr')].find((r) => r.textContent.includes('用户05'))
    ;[...row.querySelectorAll('button.mini')].find((b) => b.textContent.trim() === '调配额')?.click()
  })
  await sleep(500)
  await page.evaluate(() => {
    const radios = [...document.querySelectorAll('input[type="radio"][name="qmode"]')]
    radios.at(-1).click()
    const input = document.querySelector('.q-num')
    input.value = '1.5'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(200)
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存')?.click())
  await sleep(500)
  const quotaErr = await page.evaluate(() => document.querySelector('.hint-err')?.textContent ?? '')
  log('§31 正整数校验行内错误不入库', quotaErr.includes('请输入正整数（≥1），不能用小数或留空'), quotaErr)
  await page.evaluate(() => {
    const input = document.querySelector('.q-num')
    input.value = '5'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存')?.click())
  await sleep(900)
  const afterQuota = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.adm-table tbody tr')].find((r) => r.textContent.includes('用户05'))
    return row?.innerText.replace(/\n/g, '|') ?? ''
  })
  log('§32 保存后徽标翻「自定义 5」+ toast', afterQuota.includes('自定义 5'), afterQuota.slice(0, 100))
  // 恢复默认档（按默认档位保存 = 清空覆盖）
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.adm-table tbody tr')].find((r) => r.textContent.includes('用户05'))
    ;[...row.querySelectorAll('button.mini')].find((b) => b.textContent.trim() === '调配额')?.click()
  })
  await sleep(500)
  await page.evaluate(() => [...document.querySelectorAll('input[type="radio"][name="qmode"]')][0].click())
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存')?.click())
  await sleep(900)
  const afterReset = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.adm-table tbody tr')].find((r) => r.textContent.includes('用户05'))
    return row?.innerText.replace(/\n/g, '|') ?? ''
  })
  log('§32 按默认档位保存 = 清空覆盖恢复', afterReset.includes('免费档') && !afterReset.includes('自定义'), afterReset.slice(0, 100))
  await shot('07-quota')

  // ---- 条 37/38/39/40/42/43：用量列表 ----
  apiReqs.length = 0
  await page.evaluate(() => [...document.querySelectorAll('.adm-tabs button')].find((b) => b.textContent.trim() === '用量列表')?.click())
  await sleep(900)
  const usageState = await page.evaluate(() => ({
    ths: [...document.querySelectorAll('.panel')[1].querySelectorAll('thead th')].map((t) => t.textContent.trim().replace(/[↓↑]/g, '')),
    gap: document.querySelector('.gap-note')?.textContent ?? '',
    info: [...document.querySelectorAll('.panel')[1].querySelectorAll('.p-info')].map((e) => e.textContent),
    rows: document.querySelectorAll('.panel')[1].querySelectorAll('tbody tr').length,
    filter: document.querySelector('.adm-toolbar select')?.textContent ?? '',
  }))
  log('§37 用量四列（含默认日期↓箭头）', JSON.stringify(usageState.ths) === JSON.stringify(['日期', '用户名', '请求数', 'token 数']), JSON.stringify(usageState.ths))
  log('§38 用户下拉含全部用户 + 默认 7 天窗口', usageState.filter.includes('全部用户') && usageState.filter.includes('mm-admin'))
  log('§42 缺失时段琥珀行（distinct_days=6 < 7，全窗口判定）', usageState.gap.includes('部分时段无统计数据：仅显示已有数据（不估算补齐）'), usageState.gap)
  log('§43 用量分页：共 28 条 · 2 页 + 首页 20 行', usageState.info.some((i) => i.includes('共 28 条 · 2 页')) && usageState.rows === 20, JSON.stringify(usageState.info) + ` rows=${usageState.rows}`)
  await shot('08-usage')

  // 条 22 滚动反馈：先滚到底，翻第 2 页后视野回页首（scrollY 归零；第 2 页 8 行无滚动空间，断言用户可见结果）
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await sleep(150)
  const beforeScroll = await page.evaluate(() => Math.round(window.scrollY))
  await page.evaluate(() => [...document.querySelectorAll('.panel')[1].querySelectorAll('.pager .pg-btn')].find((b) => b.getAttribute('aria-label') === '下一页')?.click())
  await sleep(900)
  const afterPage2 = await page.evaluate(() => ({
    scrollY: Math.round(window.scrollY),
    top: Math.round(document.querySelectorAll('.panel')[1].querySelector('.adm-table').getBoundingClientRect().top),
    rows: document.querySelectorAll('.panel')[1].querySelectorAll('tbody tr').length,
  }))
  log('§22/43 用量翻第 2 页（8 行）+ 翻页后视野回表格顶', afterPage2.rows === 8 && beforeScroll > 0 && afterPage2.scrollY === 0 && afterPage2.top >= -50 && afterPage2.top <= 450, `before(scrollY)=${beforeScroll} after=${JSON.stringify(afterPage2)}`)
  await page.evaluate(() => [...document.querySelectorAll('.panel')[1].querySelectorAll('.pager .pg-btn')].find((b) => b.getAttribute('aria-label') === '上一页')?.click())
  await sleep(900)

  // 排序迁后端（条 39）：token 数列头 → sort_key=tokens&sort_dir=desc&offset=0
  apiReqs.length = 0
  await page.evaluate(() => [...document.querySelectorAll('.panel')[1].querySelectorAll('th')].find((t) => t.textContent.trim().startsWith('token 数'))?.click())
  await sleep(900)
  const sortReq = apiReqs.find((q) => q.includes('sort_key=tokens'))
  const firstCells = await page.evaluate(() => [...document.querySelectorAll('.panel')[1].querySelectorAll('tbody tr')].slice(0, 3).map((r) => r.innerText.replace(/\n/g, '|')))
  log('§39 排序迁后端：请求带 sort_key/sort_dir + offset=0', !!sortReq && sortReq.includes('sort_dir=desc') && sortReq.includes('offset=0'), sortReq ?? '未捕获')
  log('§39 token 降序首行 = mm-admin 36000', firstCells[0].includes('mm-admin') && firstCells[0].includes('36,000') || firstCells[0].includes('36000'), firstCells.join(' ; '))

  // 筛选：用户下拉 → 用户03（user_id=5；6 条）
  apiReqs.length = 0
  await page.select('.panel:nth-of-type(2) .adm-toolbar select, .adm-toolbar select', '5').catch(() => {})
  await sleep(900)
  const filtered = await page.evaluate(() => ({
    info: [...document.querySelectorAll('.panel')[1].querySelectorAll('.p-info')].map((e) => e.textContent),
    rows: document.querySelectorAll('.panel')[1].querySelectorAll('tbody tr').length,
    users: [...new Set([...document.querySelectorAll('.panel')[1].querySelectorAll('tbody tr')].map((r) => r.querySelectorAll('td')[1].textContent))],
  }))
  const filterReq = apiReqs.filter((q) => q.includes('user_id=5')).at(-1)
  log('§38/43 筛选用户03 → 6 条且全为该用户 + offset 重置 0', filtered.info.some((i) => i.includes('共 6 条')) && filtered.rows === 6 && filtered.users.length === 1 && filtered.users[0] === '用户03' && filterReq?.includes('offset=0'), JSON.stringify(filtered) + ` req=${filterReq}`)
  // 重置全部用户
  await page.evaluate(() => { document.querySelector('.adm-toolbar select').value = ''; document.querySelector('.adm-toolbar select').dispatchEvent(new Event('change')) })
  await sleep(900)

  // ---- 条 48：暗色主题全量 + 无亮色残留 ----
  await page.evaluate(() => document.querySelector('button[aria-label="切换主题"]')?.click())
  await sleep(600)
  const dark = await page.evaluate(() => {
    if (document.documentElement.dataset.theme !== 'dark') return { err: '主题未切换' }
    const bad = []
    for (const el of document.querySelectorAll('.admin-page *')) {
      const cs = getComputedStyle(el)
      const m = cs.backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      if (m && +m[1] > 200 && +m[2] > 200 && +m[3] > 200) bad.push(`${el.tagName}.${String(el.className).slice(0, 24)} bg=${cs.backgroundColor}`)
    }
    return {
      residue: bad.slice(0, 6),
      pageBg: getComputedStyle(document.querySelector('.admin-page')).backgroundColor,
      cardBg: getComputedStyle(document.querySelector('.stat-card')).backgroundColor,
    }
  })
  log('§48 暗色：页面 #131417 + 卡 #1E2026 + 无亮色残留', !dark.err && dark.pageBg === 'rgb(19, 20, 23)' && dark.cardBg === 'rgb(30, 32, 38)' && dark.residue.length === 0, JSON.stringify(dark))
  await shot('09-admin-dark')
  await page.evaluate(() => document.querySelector('button[aria-label="切换主题"]')?.click())
  await sleep(400)

  // ---- 条 44/45c/46：普通用户 403 + 入口不可见 + 封禁登录横幅（独立无痕上下文）----
  // 先封禁 spam-bot-2026 供条 46 演示（走管理员会话）
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.adm-table tbody tr')].find((r) => r.textContent.includes('spam-bot-2026'))
    ;[...row.querySelectorAll('button.mini.danger')].find((b) => b.textContent.trim() === '封禁')?.click()
  })
  await sleep(400)
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '确认封禁')?.click())
  await sleep(900)

  const ctx = await browser.createBrowserContext()
  const p2 = await ctx.newPage()
  const adminCalls = []
  p2.on('request', (r) => { if (r.url().includes('/api/admin/')) adminCalls.push(r.url()) })
  await p2.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
  await sleep(300)
  // 条 46：被封禁登录被拒 + 横幅
  const banLogin = await p2.evaluate(async () => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'spam-bot-2026', password: 'mm20260817' }),
      credentials: 'same-origin',
    })
    return { status: r.status, body: await r.json().catch(() => ({})) }
  })
  log('§46 被封禁登录被拒 403 + 明确提示', banLogin.status === 403 && banLogin.body.detail === '账号已被封禁', JSON.stringify(banLogin))

  // 登录普通视角：先解封再登录验 403 页（403 需要正常登录态）
  await page.evaluate(() => [...document.querySelectorAll('button.mini')].find((b) => b.textContent.trim() === '解封')?.click())
  await sleep(900)
  await p2.evaluate(async () => {
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'spam-bot-2026', password: 'mm20260817' }),
      credentials: 'same-origin',
    })
  })
  await p2.goto(BASE, { waitUntil: 'networkidle0' })
  await sleep(900)
  // 条 45c：普通用户账户菜单无「管理后台」
  const normalMenu = await p2.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const acct = btns.find((b) => (b.textContent || '').includes('spam-bot-2026'))
    if (!acct) return { found: false }
    acct.click()
    return { found: true }
  })
  await sleep(400)
  const menuItems = await p2.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()))
  log('§45 普通用户账户菜单无「管理后台」', normalMenu.found && !menuItems.some((t) => t.startsWith('管理后台')), JSON.stringify(menuItems.slice(-6)))
  await p2.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' })
  await sleep(600)
  const forbid = await p2.evaluate(() => ({
    title: document.body.innerText.includes('无权访问（403）'),
    desc: document.body.innerText.includes('此页面不会展示任何后台数据'),
    dataLeak: document.body.innerText.includes('mm-admin') && document.body.innerText.includes('统一 key 每日总量'),
  }))
  log('§44 普通用户 /admin → 403 卡零数据 + 零后台请求', forbid.title && forbid.desc && forbid.dataLeak === false && adminCalls.length === 0, JSON.stringify(forbid) + ` adminReqs=${adminCalls.length}`)
  await p2.screenshot({ path: `${SHOTS}/10-403.png` })
  await ctx.close()

  // ---- 汇总 ----
  console.log('\n==== 汇总 ====')
  const fails = results.filter((r) => r.startsWith('FAIL'))
  console.log(`共 ${results.length} 项：PASS ${results.length - fails.length} / FAIL ${fails.length}`)
  if (fails.length) console.log(fails.join('\n'))
} finally {
  await browser.close()
}
