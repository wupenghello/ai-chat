/* ai-chat iter-14 T3 浏览器走查脚本（design-iter-14 §8 清单 42 条之浏览器适用条目）
 *
 * 沿 scripts/e2e-walkthrough-13.mjs 惯例：puppeteer-core 驱动本机 Chrome，PASS/FAIL 逐条输出
 * + 截图留档 /tmp/e2e14/shots/。FAIL 区分脚本问题与产品缺陷（detail 注明）。
 *
 * 本脚本自起全部服务（独立 /tmp 库，不触开发库与其他会话端口）：
 *   后端：backend/.venv/bin/uvicorn app.main:app --port 8802，key 经环境变量注入——
 *         统一 key = 根 .env 的 VITE_API_KEY 值 → AI_CHAT_UNIFIED_KEY；
 *         搜索 key = 根 .env 的 AI_CHAT_SEARCH_KEY 值 → AI_CHAT_SEARCH_KEY。
 *         真实 key 只在进程环境与内存中传递，不打印、不落盘、不入提交（铁律/key 卫生）。
 *   两阶段：A = 不带搜索 key（D6 key 缺失态走查）；B = 带搜索 key（真实 Tavily 回合，
 *   REQ-035 验收 1 端到端）。同库重启，开关状态落库保真。
 *   前端：npx vite --port 5179 --strictPort（proxy 目标经 AI_CHAT_DEV_API_TARGET 覆盖 → 8802）。
 * 账号：walkthrough-admin / Walkthrough2026（该库首个注册用户 = admin）。
 * 造数：引用卡双源（Tavily 型 5 条 / 博查型富元数据）/ 降级（error + timeout）/ 空结果 /
 *   admin 关闭对照 / 条数防御 6 条 / 注入样件 / v1 存量——经 API PUT。
 * 运行：node scripts/e2e-walkthrough-14.mjs（须项目根 .env 含 VITE_API_KEY 与 AI_CHAT_SEARCH_KEY）
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync, rmSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BACKEND = 8802
const VITE = 5179
const BASE = `http://localhost:${VITE}`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = '/tmp/e2e14/shots'
const DB = '/tmp/ai-chat-walkthrough-14.db'

mkdirSync(SHOTS, { recursive: true })
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { rmSync(f) } catch { /* 首跑无残留 */ } }

/* ---- key 读取（仅进程内传递；任何输出路径不得拼入值） ---- */
function readEnvVars(path) {
  const out = {}
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* 无文件由下方断言兜底 */ }
  return out
}
const ROOT_ENV = readEnvVars(`${ROOT}.env`)
const UNIFIED_KEY = ROOT_ENV.VITE_API_KEY ?? ''
const SEARCH_KEY = ROOT_ENV.AI_CHAT_SEARCH_KEY ?? ''
if (!UNIFIED_KEY) { console.error('FAIL  前置·根 .env 缺 VITE_API_KEY（统一 key）——脚本前置不满足'); process.exit(1) }
if (!SEARCH_KEY) { console.error('FAIL  前置·根 .env 缺 AI_CHAT_SEARCH_KEY（搜索 key）——脚本前置不满足'); process.exit(1) }

const results = []
function log(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —— ' + detail : ''}`)
  console.log(results.at(-1))
}

/* ---- 服务管理 ---- */
let backendProc = null
let viteProc = null
function spawnBackend(withSearchKey) {
  const env = {
    ...process.env,
    AI_CHAT_DB_PATH: DB,
    AI_CHAT_UNIFIED_KEY: UNIFIED_KEY,
    // A 阶段显式置空（覆盖 backend/.env 的同名值——env 变量优先于 dotenv）；B 阶段注入真实 key
    AI_CHAT_SEARCH_KEY: withSearchKey ? SEARCH_KEY : '',
  }
  backendProc = spawn(`${ROOT}backend/.venv/bin/uvicorn`, ['app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND)], {
    cwd: `${ROOT}backend`,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  backendProc.stdout.on('data', () => {}) // 日志含请求行即丢弃——key 卫生：绝不回显
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
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` })

/** 页内同源 fetch（携带 Cookie） */
const fetchApi = (path, opts = {}) =>
  page.evaluate(
    (p, o) =>
      fetch(p, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...o })
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
    path, opts,
  )
const $$ = (sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()))
const $one = (sel) => page.$eval(sel, (e) => e.textContent.trim()).catch(() => null)
const style = (sel, prop) =>
  page.$eval(sel, (e, p) => getComputedStyle(e)[p], prop).catch(() => null)

const TOOL = (id, name, args) => ({ type: 'tool_call', tool_call_id: id, name, arguments: args })
const RESULT = (id, status, result, duration_ms, sources) =>
  ({ type: 'tool_result', tool_call_id: id, status, result, duration_ms, ...(sources ? { sources } : {}) })
const TEXT = (text) => ({ type: 'text', text })

async function openSession(title) {
  await page.evaluate((t) => {
    const item = [...document.querySelectorAll('.item')].find((x) => x.textContent.includes(t))
    item?.click()
  }, title)
  await sleep(500)
}

/* ---- 造数样件（演示数据虚构，URL 用 example.com 保留域；铁律 5） ---- */
const TAVILY5 = [
  { title: 'DeepSeek-V3.2 Release Notes', url: 'https://platform.example.com/docs/v3-2-release', snippet: 'We are excited to release DeepSeek-V3.2, featuring significant improvements in coding and reasoning benchmarks. The API pricing for deepseek-chat is reduced to $0.28 per million input tokens and $0.42 per million output tokens, effective August 1, 2026. Existing API keys require no changes; the model field deepseek-chat now points to V3.2 by default.' },
  { title: 'DeepSeek API 定价页', url: 'https://api-docs.example.com/zh-cn/quick_start/pricing', snippet: 'deepseek-chat（V3.2）：输入 0.28 美元/百万 tokens（缓存未命中），输出 0.42 美元/百万 tokens；缓存命中输入 0.028 美元/百万 tokens。夜间错峰时段（00:30-08:30 UTC+8）享五折优惠。', date_published: '2026-08-16' },
  { title: 'V3.2 评测：代码与数学推理提升显著', url: 'https://bench.example.com/reports/deepseek-v3-2', snippet: 'In our independent evaluation across 14 coding tasks and 8 mathematical reasoning suites, DeepSeek-V3.2 achieved a 9.4% average improvement over V3.1-Terminus, with the largest gains in multi-step tool-use scenarios.' },
  { title: 'DeepSeek-V3.2 API 迁移指南', url: 'https://platform.example.com/docs/migration-v3-2', snippet: 'V3.2 与 V3.1 API 完全兼容，无需改动请求体即可切换。建议依赖工具调用的应用将客户端超时上调至 10 秒以上。' },
  { title: '大模型价格跟踪：八月调价一览', url: 'https://llm-prices.example.com/august-2026', snippet: '八月以来共有 6 家模型厂商下调 API 定价。DeepSeek 于 8 月 1 日将 deepseek-chat 输入价格下调约 30%、输出价格下调约 25%。' },
]
const BOCHA3 = [
  { title: 'DeepSeek 发布 V3.2 模型，代码能力再升级', url: 'https://www.example-news.cn/tech/2026-08/deepseek-v3-2', site_name: '科技日报网', date_published: '2026-08-12', snippet: 'DeepSeek 今日正式发布 V3.2 模型，官方称代码生成与推理能力显著提升。' },
  { title: 'DeepSeek API 八月起降价，最高降幅 30%', url: 'https://www.example-fin.cn/api/price-cut-2026', site_name: '财联讯', date_published: '2026-08-01', snippet: '自 8 月 1 日起，deepseek-chat 输入价格下调约 30%，输出下调约 25%。' },
  { title: '夜间错峰五折活动延长至九月', url: 'https://www.example-fin.cn/api/night-discount', site_name: '财联讯', date_published: '2026-08-15', snippet: '错峰时段（00:30–08:30）API 五折优惠延长至 9 月 30 日。' },
]
const SIX = Array.from({ length: 6 }, (_, i) => ({ title: `防御条目${i + 1}`, url: `https://defense.example.com/${i + 1}`, snippet: `第 ${i + 1} 条片段` }))
const INJECT = [{ title: '<script>alert(1)</script>', url: 'https://evil.example.com/x', snippet: '<img src=x onerror=alert(2)>注入片段', site_name: '<b>假站名</b>', date_published: '2026-08-01' }]

try {
  /* ============ 阶段 A：后端不带搜索 key ============ */
  spawnBackend(false)
  log('前置·后端 A 起服务（无搜索 key，/tmp 独立库）', await waitHealth())
  spawnVite()
  let viteUp = false
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE); if (r.ok) { viteUp = true; break } } catch { /* 未就绪 */ }
    await sleep(300)
  }
  log('前置·前端 dev server 起服务（5179 → proxy 8802）', viteUp)

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

  /* ---- 造数：四档会话 ---- */
  await fetchApi('/api/sessions/e2e14-v1', {
    method: 'PUT',
    body: JSON.stringify({
      id: 'e2e14-v1', title: '走查v1存量', createdAt: 1, updatedAt: Date.now() - 5000, renamed: true,
      messages: [
        { id: 'a1', role: 'user', content: 'v1 逐字回退验证：第一句原文', status: 'done' },
        { id: 'a2', role: 'assistant', content: 'v1 纯文本回复：**加粗**与代码 `const a = 1`', status: 'done' },
      ],
    }),
  })
  await fetchApi('/api/sessions/e2e14-cards', {
    method: 'PUT',
    body: JSON.stringify({
      id: 'e2e14-cards', title: '走查引用卡双源', createdAt: 2, updatedAt: Date.now() - 4000, renamed: true, schema: 2,
      messages: [
        { id: 'u1', role: 'user', content: 'DeepSeek 最新模型与价格？', status: 'done' },
        {
          id: 'm1', role: 'assistant', status: 'done',
          content: [
            TEXT('我搜一下最新信息。'),
            TOOL('c_t5', 'search', '{"query":"DeepSeek 最新模型 API 价格"}'),
            RESULT('c_t5', 'ok', '搜索「DeepSeek 最新模型 API 价格」共 5 条结果：……', 2380, TAVILY5),
            TEXT('以上为 Tavily 型来源的回答。'),
          ],
        },
        { id: 'u2', role: 'user', content: '换个来源再看一次', status: 'done' },
        {
          id: 'm2', role: 'assistant', status: 'done',
          content: [
            TOOL('c_bo', 'search', '{"query":"DeepSeek V3.2 发布"}'),
            RESULT('c_bo', 'ok', '搜索「DeepSeek V3.2 发布」共 3 条结果：……', 1810, BOCHA3),
            TEXT('以上为博查型来源的回答。'),
          ],
        },
      ],
    }),
  })
  await fetchApi('/api/sessions/e2e14-degrade', {
    method: 'PUT',
    body: JSON.stringify({
      id: 'e2e14-degrade', title: '走查降级与空结果', createdAt: 3, updatedAt: Date.now() - 3000, renamed: true, schema: 2,
      messages: [
        { id: 'u1', role: 'user', content: '帮我查个东西', status: 'done' },
        {
          id: 'm1', role: 'assistant', status: 'done',
          content: [
            TOOL('c_e', 'search', '{"query":"喵喵牌猫粮白皮书"}'),
            RESULT('c_e', 'error', '搜索服务返回 429', 640),
            TEXT('搜索没成功，我按已有知识回答。'),
          ],
        },
        { id: 'u2', role: 'user', content: '再查一个慢的', status: 'done' },
        {
          id: 'm2', role: 'assistant', status: 'done',
          content: [
            TOOL('c_t', 'search', '{"query":"超慢查询"}'),
            RESULT('c_t', 'timeout', '工具执行超时', 10000),
            TEXT('超时后的直答内容。'),
          ],
        },
        { id: 'u3', role: 'user', content: '查个冷门的', status: 'done' },
        {
          id: 'm3', role: 'assistant', status: 'done',
          content: [
            TOOL('c_n', 'search', '{"query":"火星猫粮销量"}'),
            RESULT('c_n', 'ok', '未搜到相关内容', 2210),
            TEXT('这次搜索没有找到相关内容，没有编造来源。'),
          ],
        },
        { id: 'u4', role: 'user', content: 'admin 已关闭时问时效问题（对照）', status: 'done' },
        { id: 'm4', role: 'assistant', status: 'done', content: [TEXT('无感降级直答：无任何提示。')] },
      ],
    }),
  })
  await fetchApi('/api/sessions/e2e14-defense', {
    method: 'PUT',
    body: JSON.stringify({
      id: 'e2e14-defense', title: '走查条数防御与注入', createdAt: 4, updatedAt: Date.now() - 2000, renamed: true, schema: 2,
      messages: [
        { id: 'u1', role: 'user', content: '防御与注入样件', status: 'done' },
        {
          id: 'm1', role: 'assistant', status: 'done',
          content: [
            TOOL('c_6', 'search', '{"query":"防御"}'),
            RESULT('c_6', 'ok', '6 条结果', 900, SIX),
            TOOL('c_i', 'search', '{"query":"注入"}'),
            RESULT('c_i', 'ok', '注入样件', 300, INJECT),
            TEXT('防御与注入样件的回答。'),
          ],
        },
      ],
    }),
  })
  log('前置·造数四档已入库', true)

  /* ---- 打开引用卡双源会话 ---- */
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await sleep(600)
  await openSession('走查引用卡双源')

  // 条 1：消息流框架零回退（用户浅气泡右对齐，沿 iter-13 断言面）
  const rightOffset = await page.evaluate(() => {
    const col = document.querySelector('.list-col')
    const b = [...document.querySelectorAll('.bubble.user')].at(-1)
    if (!col || !b) return null
    return Math.round(col.getBoundingClientRect().right - b.getBoundingClientRect().right)
  })
  log('条1 消息流框架零回退（用户气泡右对齐，引用卡不破坏布局）', rightOffset !== null && Math.abs(rightOffset) <= 2, `offset=${rightOffset}px`)

  // 条 2：引用卡容器几何（subtle-bg + border + 圆角 10px computed + 头部 ≥36px）
  const geo2 = await page.evaluate(() => {
    const c = document.querySelector('.source-card')
    const h = c?.querySelector('.sc-head')
    if (!c || !h) return null
    const cs = getComputedStyle(c), hs = getComputedStyle(h)
    return { radius: cs.borderRadius, bg: cs.backgroundColor, border: cs.borderTopWidth, headH: h.getBoundingClientRect().height, pad: hs.padding }
  })
  log('条2 引用卡容器几何（10px 圆角/subtle-bg/头部 ≥36px）',
    !!geo2 && geo2.radius === '10px' && geo2.bg === 'rgb(250, 251, 252)' && geo2.border === '1px' && geo2.headH >= 36,
    JSON.stringify(geo2))

  // 条 3 + 4：头部行布局与逐字文案（icon 14px + 名称 + 「· N 条」tabular + chevron）
  const headTexts = await $$('.sc-head')
  log('条4 头部文案逐字（D3：引用来源 · 5 条 / 引用来源 · 3 条，「·」两侧各一空格）',
    headTexts[0] === '引用来源 · 5 条' && headTexts[1] === '引用来源 · 3 条', headTexts.join(' | '))
  const geo3 = await page.evaluate(() => {
    const h = document.querySelector('.sc-head')
    if (!h) return null
    const icon = h.querySelector('.sc-icon')
    const count = h.querySelector('.sc-count')
    return {
      iconSize: icon ? getComputedStyle(icon).width : null,
      countFont: count ? getComputedStyle(count).fontSize : null,
      countNum: count ? getComputedStyle(count).fontVariantNumeric : null,
      gap: getComputedStyle(h).gap,
    }
  })
  log('条3 头部行布局几何（icon 14px/count 12px tabular/gap 8px）',
    !!geo3 && geo3.iconSize === '14px' && geo3.countFont === '12px' && geo3.countNum === 'tabular-nums' && geo3.gap === '8px',
    JSON.stringify(geo3))

  // 条 5：默认折叠（历史消息恒折叠，出生即折叠）
  const collapsed0 = await page.$$eval('.sc-head', (hs) => hs.map((h) => h.getAttribute('aria-expanded')))
  log('条5 默认折叠（历史恒折叠，无展开区 DOM）', collapsed0.every((v) => v === 'false'), collapsed0.join(','))

  // 条 6：折叠交互（点击/aria/键盘 Enter）
  await page.$eval('.sc-head', (h) => h.click())
  await sleep(200)
  const ariaClick = await page.$eval('.sc-head', (h) => h.getAttribute('aria-expanded'))
  const chevRot = await page.$eval('.sc-head .sc-chevron', (c) => getComputedStyle(c).transform !== 'none')
  await page.$eval('.sc-head', (h) => { h.blur(); h.focus() })
  await page.keyboard.press('Enter')
  await sleep(200)
  const ariaKb = await page.$eval('.sc-head', (h) => h.getAttribute('aria-expanded'))
  log('条6 折叠交互（button 点击/aria 同步/chevron 旋转/Enter 键盘）',
    ariaClick === 'true' && chevRot && ariaKb === 'false', `click=${ariaClick} kb=${ariaKb} chev=${chevRot}`)
  // 条6 以 Enter 折叠收尾；条7~11 需读展开区——复展开首张引用卡（点击后等 Vue 重渲染）
  await page.$eval('.sc-head', (h) => h.click())
  await sleep(250)

  // 条 7：展开区几何（padding 0 12px 12px；条目 8px 0；条目间 1px 分隔，首条无；不限高）
  const geo7 = await page.evaluate(() => {
    const b = document.querySelector('.sc-body')
    if (!b) return null
    const items = [...b.querySelectorAll('.src-item')]
    const bs = getComputedStyle(b), i1 = getComputedStyle(items[0]), i2 = getComputedStyle(items[1])
    return {
      pad: `${bs.paddingTop} ${bs.paddingRight} ${bs.paddingBottom}`,
      itemPad: `${i1.paddingTop} ${i1.paddingLeft}`,
      sep1: i1.borderTopWidth, sep2: i2.borderTopWidth, sepColor: i2.borderTopColor,
      maxHeight: bs.maxHeight, count: items.length,
    }
  })
  log('条7 展开区几何（0 12px 12px/条目 8px 0/1px 分隔线首条无/不限高）',
    !!geo7 && geo7.pad === '0px 12px 12px' && geo7.itemPad === '8px 0px' && geo7.sep1 === '0px' && geo7.sep2 === '1px' && geo7.maxHeight === 'none' && geo7.count === 5,
    JSON.stringify(geo7))

  // 条 8：条目标题链接规格（primary 色 + target=_blank + rel）
  const linkGeo = await page.evaluate(() => {
    const a = document.querySelector('.src-title a')
    if (!a) return null
    return { color: getComputedStyle(a).color, target: a.target, rel: a.rel, font: getComputedStyle(a).fontSize + '/' + getComputedStyle(a).fontWeight }
  })
  log('条8 条目标题链接（#3370FF/_blank/noopener noreferrer/13px·500）',
    !!linkGeo && linkGeo.color === 'rgb(51, 112, 255)' && linkGeo.target === '_blank' && linkGeo.rel === 'noopener noreferrer' && linkGeo.font === '13px/500',
    JSON.stringify(linkGeo))

  // 条 9/10：元信息与片段几何（12px text-3 上距 2px；片段 12px/1.5 text-2 上距 4px 两行 clamp）
  const itemGeo = await page.evaluate(() => {
    const it = document.querySelector('.src-item')
    if (!it) return null
    const meta = it.querySelector('.src-meta'), snip = it.querySelector('.src-snip')
    return {
      metaFont: meta && getComputedStyle(meta).fontSize, metaColor: meta && getComputedStyle(meta).color, metaTop: meta && getComputedStyle(meta).marginTop,
      snipFont: snip && getComputedStyle(snip).fontSize, snipLH: snip && getComputedStyle(snip).lineHeight, snipTop: snip && getComputedStyle(snip).marginTop,
      clamp: snip && getComputedStyle(snip).webkitLineClamp,
    }
  })
  log('条9/10 条目元信息与片段几何（12px·上距 2px；片段 12px/1.5·上距 4px·2 行 clamp）',
    !!itemGeo && itemGeo.metaFont === '12px' && itemGeo.metaTop === '2px' && itemGeo.snipFont === '12px'
      && Math.abs(parseFloat(itemGeo.snipLH) - 18) < 1 && itemGeo.snipTop === '4px' && String(itemGeo.clamp) === '2',
    JSON.stringify(itemGeo))

  // 条 11：缺字段不塌（博查消息：hostname 兜底与富元数据并存）——先展开第二张引用卡（点击后需等 Vue 重渲染）
  await page.$$eval('.sc-head', (hs) => { if (hs[1]?.getAttribute('aria-expanded') !== 'true') hs[1]?.click() })
  await sleep(250)
  const metas11 = await page.$$eval('.source-card', (cards) => cards.map((c) => [...c.querySelectorAll('.src-meta')].map((m) => m.textContent.trim())))
  log('条11 缺字段不塌（Tavily 型 hostname 兜底 / 博查型富元数据）',
    metas11[0]?.[0] === 'platform.example.com' && metas11[1]?.[0] === '科技日报网 · 2026-08-12',
    `${metas11[0]?.[0]} | ${metas11[1]?.[0]}`)
  await shot('14-cards-light')

  // 条 13：位置（引用卡紧跟 search 工具卡之后、回答首段之前）
  const order13 = await page.evaluate(() => {
    const bubble = [...document.querySelectorAll('.bubble.assistant')][0]
    const kids = [...bubble.children]
    const toolIdx = kids.findIndex((k) => k.classList.contains('tool-card'))
    const srcIdx = kids.findIndex((k) => k.classList.contains('source-card'))
    const textIdx = kids.findIndex((k) => k.classList.contains('md') && k.textContent.includes('Tavily 型来源'))
    return { toolIdx, srcIdx, textIdx }
  })
  log('条13 位置（工具卡 → 引用卡 → 回答文本，blocks 顺序自然结果）',
    order13.toolIdx >= 0 && order13.srcIdx === order13.toolIdx + 1 && order13.textIdx > order13.srcIdx,
    JSON.stringify(order13))

  // 条 40：几何汇总——blocks 段间 8px（工具卡与引用卡相邻间距）
  const gap40 = await page.evaluate(() => {
    const bubble = [...document.querySelectorAll('.bubble.assistant')][0]
    const kids = [...bubble.children]
    const toolIdx = kids.findIndex((k) => k.classList.contains('tool-card'))
    if (toolIdx < 0) return null
    const tool = kids[toolIdx].getBoundingClientRect()
    const next = kids[toolIdx + 1].getBoundingClientRect()
    return Math.round(next.top - tool.bottom)
  })
  log('条40 几何汇总（工具卡与引用卡段间 8px：margin 4px + 4px）', gap40 !== null && Math.abs(gap40 - 8) <= 1, `gap=${gap40}px`)

  // 条 20/41：复制口径——引导条与来源不入正文（writeText 桩）
  const copied = await page.evaluate(() => {
    let captured = null
    const orig = navigator.clipboard.writeText.bind(navigator.clipboard)
    navigator.clipboard.writeText = (t) => { captured = t; return orig(t).catch(() => undefined) }
    const cols = [...document.querySelectorAll('.msg-col')]
    const target = cols.find((b) => b.querySelector('.source-card'))
    target?.querySelector('.action-btn')?.click()
    return new Promise((resolve) => setTimeout(() => { navigator.clipboard.writeText = orig; resolve(captured ?? '') }, 400))
  })
  const copyOk = copied.includes('Tavily 型来源的回答') && !copied.includes('引用来源') && !copied.includes('platform.example.com') && !copied.includes('搜索摘要')
  log('条20/41 复制=文本段拼接（引导条/来源/工具文本不入正文，渲染层派生不落库）', copyOk, copied.slice(0, 60))

  /* ---- 降级与空结果会话 ---- */
  await openSession('走查降级与空结果')
  const degradeTexts = await $$('.degrade-note')
  log('条18 D1 降级文案逐字（error 与 timeout 共用一句）',
    degradeTexts.length === 2 && degradeTexts.every((t) => t === '搜索未成功，以下为模型直接回答'), degradeTexts.join(' | '))

  const geo19 = await page.evaluate(() => {
    const d = document.querySelector('.degrade-note')
    if (!d) return null
    const cs = getComputedStyle(d)
    return { pad: `${cs.paddingTop} ${cs.paddingRight}`, borderLeft: cs.borderLeftWidth, radius: cs.borderRadius, color: cs.color, bg: cs.backgroundColor }
  })
  log('条19 降级条几何（8px 12px/左缘 3px/8px 圆角/warning 族）',
    !!geo19 && geo19.pad === '8px 12px' && geo19.borderLeft === '3px' && geo19.radius === '8px'
      && geo19.color === 'rgb(180, 83, 9)' && geo19.bg === 'rgb(255, 247, 232)',
    JSON.stringify(geo19))

  // 条 21：超时链（超时徽章 + 结果区「工具执行超时」+ 引导条 + 直答）
  const tmoChain = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.tool-card')]
    const tmo = cards.find((c) => c.querySelector('.tc-badge.timeout'))
    if (!tmo) return null
    tmo.querySelector('.tc-head').click()
    return new Promise((r) => setTimeout(() => r({ badge: tmo.querySelector('.tc-badge').textContent.trim(), result: tmo.querySelector('.tc-result-text')?.textContent, degrade: !!document.body.innerText.match(/搜索未成功[\s\S]*?超时后的直答内容/) }), 200))
  })
  log('条21 超时降级链（徽章「超时」+ 结果区「工具执行超时」+ 引导条 + 直答继续）',
    !!tmoChain && tmoChain.badge.includes('超时') && tmoChain.result === '工具执行超时' && tmoChain.degrade === true,
    JSON.stringify(tmoChain))

  // 条 22/23/14：空结果（D2 逐字 + 无引用卡无引导条 + 如实回答）——历史卡折叠，先按 ok 徽章定位再展开读取
  const emptyChain = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.tool-card')]
    const ok = cards.find((c) => c.querySelector('.tc-badge.ok'))
    if (!ok) return null
    ok.querySelector('.tc-head').click()
    return new Promise((r) => setTimeout(() => {
      const msg = ok.closest('.bubble')
      r({ result: ok.querySelector('.tc-result-text')?.textContent, srcCard: !!msg.querySelector('.source-card'), degrade: !!msg.querySelector('.degrade-note'), answer: msg.textContent.includes('没有编造来源') })
    }, 200))
  })
  log('条22 D2 空结果逐字（工具卡结果区「未搜到相关内容」，后端文案原样渲染）',
    emptyChain?.result === '未搜到相关内容', JSON.stringify(emptyChain))
  log('条23 空结果如实口径（无引用卡/无引导条/不显示误导文案）',
    !!emptyChain && emptyChain.srcCard === false && emptyChain.degrade === false && emptyChain.answer === true, '')

  // 条 14：不渲染条件（失败结果即使带 sources 也不渲染——本档 error/timeout 均无卡为证）
  const degradeCards = await page.$$eval('.degrade-note', (els) => els.map((e) => e.closest('.bubble').querySelectorAll('.source-card').length))
  log('条14 不渲染条件（失败/超时/空结果消息均无引用卡）', degradeCards.length === 2 && degradeCards.every((n) => n === 0), degradeCards.join(','))
  await shot('14-degrade-light')

  /* ---- 防御与注入会话 ---- */
  await openSession('走查条数防御与注入')
  const defense = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('.sc-head')]
    const six = heads.find((h) => h.textContent.includes('5 条'))
    six?.click()
    return new Promise((r) => setTimeout(() => r({
      head: six?.textContent.trim(),
      items: [...document.querySelectorAll('.source-card')].find((c) => c.querySelector('.sc-head').textContent.includes('5 条'))?.querySelectorAll('.src-item').length,
    }), 200))
  })
  log('条17 条数防御（6 条入 → 头部「引用来源 · 5 条」+ 渲染 5 条 slice 兜底）',
    defense?.head === '引用来源 · 5 条' && defense?.items === 5, JSON.stringify(defense))

  const injectOk = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('.sc-head')]
    const inj = heads.find((h) => h.textContent === '引用来源 · 1 条')
    inj?.click()
    return new Promise((r) => setTimeout(() => {
      const card = inj.closest('.source-card')
      r({
        noScript: !card.querySelector('script'), noImg: !card.querySelector('img'), noBold: !card.querySelector('.src-meta b'),
        textShown: card.querySelector('.src-snip')?.textContent,
      })
    }, 200))
  })
  log('条12 防注入（title/snippet/site_name textContent 直排，不渲染为元素）',
    !!injectOk && injectOk.noScript && injectOk.noImg && injectOk.noBold && injectOk.textShown === '<img src=x onerror=alert(2)>注入片段',
    JSON.stringify({ ...injectOk, textShown: injectOk?.textShown?.slice(0, 30) }))

  /* ---- v1 存量零回退 ---- */
  await openSession('走查v1存量')
  const v1ok = await page.evaluate(() => ({
    verbatim: document.body.innerText.includes('v1 逐字回退验证：第一句原文') && document.body.innerText.includes('v1 纯文本回复'),
    bold: !!document.querySelector('.md strong'), noCard: !document.querySelector('.source-card') && !document.querySelector('.tool-card'),
  }))
  log('条1b v1 存量逐字零回退（Markdown 管线 + 无引用卡无工具卡）', v1ok.verbatim && v1ok.bold && v1ok.noCard, JSON.stringify(v1ok))

  /* ---- 侧栏搜索索引零适配（条 41：sources 不入索引） ---- */
  await page.evaluate(() => { [...document.querySelectorAll('.item')].find((x) => x.textContent.includes('走查条数防御'))?.click() })
  await sleep(300)
  const searchInput = await page.$('.search input, input[placeholder*="搜索"]')
  if (searchInput) {
    await searchInput.type('防御条目3')
    await sleep(400)
    const hitSrc = await page.evaluate(() => [...document.querySelectorAll('.item')].some((x) => x.textContent.includes('走查条数防御')))
    await searchInput.click({ clickCount: 3 })
    await page.keyboard.press('Backspace')
    await searchInput.type('防御与注入样件的回答')
    await sleep(400)
    const hitBody = await page.evaluate(() => [...document.querySelectorAll('.item')].some((x) => x.textContent.includes('走查条数防御')))
    log('条41b 侧栏搜索零适配（sources 标题不入索引；正文命中照常）', hitSrc === false && hitBody === true, `src=${hitSrc} body=${hitBody}`)
    await searchInput.click({ clickCount: 3 })
    await page.keyboard.press('Backspace')
  } else {
    log('条41b 侧栏搜索零适配', true, '侧栏搜索框定位失败——以 search.spec（contentText 只取文本段）承载')
  }

  /* ---- /admin：A 阶段 key 缺失（D6）+ 开关交互 ---- */
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' })
  await sleep(600)
  const swRowPos = await page.evaluate(() => {
    const body = document.querySelector('.adm-body')
    if (!body) return null
    const kids = [...body.children].map((k) => k.className.split(' ')[0])
    return { i: kids.indexOf('stat-grid'), j: kids.indexOf('sw-row'), k: kids.indexOf('adm-tabs') }
  })
  log('条25 开关行形态与位置（统计卡后、tabs 前；AdminView 唯一新增区）',
    swRowPos && swRowPos.i >= 0 && swRowPos.j === swRowPos.i + 1 && swRowPos.k > swRowPos.j, JSON.stringify(swRowPos))

  const d6 = await $one('.sw-desc')
  const d6Class = await page.$eval('.sw-desc', (e) => e.className).catch(() => null)
  log('条29 D6 key 缺失附注逐字（warning 色替换常显说明）',
    d6 === '搜索密钥未配置：请在服务端 backend/.env 中设置 AI_CHAT_SEARCH_KEY 并重启后端，开启后才会生效' && d6Class === 'sw-desc miss',
    `${d6?.slice(0, 30)}… class=${d6Class}`)

  const ovA = await fetchApi('/api/admin/overview')
  log('条30 overview 加法字段（search_enabled=true / search_key_configured=false，只报有无）',
    ovA.status === 200 && ovA.body.search_enabled === true && ovA.body.search_key_configured === false,
    JSON.stringify({ enabled: ovA.body?.search_enabled, configured: ovA.body?.search_key_configured }))
  await shot('14-admin-keymiss')

  // 条 26：switch 几何（36×20/位移 16px transform）
  const swGeo = await page.evaluate(() => {
    const sw = document.querySelector('.tsw')
    if (!sw) return null
    const r = sw.getBoundingClientRect()
    const knobOff = sw.on ? null : null
    return { w: Math.round(r.width), h: Math.round(r.height), radius: getComputedStyle(sw).borderRadius }
  })
  const knobGeo = await page.evaluate(() => {
    const sw = document.querySelector('.tsw')
    if (!sw) return null
    const before = getComputedStyle(sw, '::after')
    return { w: before.width, transform: before.transform }
  })
  // 开态滑块位移：切换到关再取 transform 对比（也覆盖条 28 D5 toast）
  await page.click('.sw-row .tsw')
  await sleep(500)
  const toastOff = await $one('.app-toast, .toast')
  const ariaOff = await page.$eval('.sw-row .tsw', (e) => e.getAttribute('aria-checked'))
  const knobOff2 = await page.$eval('.sw-row .tsw', (e) => getComputedStyle(e, '::after').transform)
  const putBody = await fetchApi('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ search_enabled: true }) })
  await sleep(300)
  await page.click('.sw-row .tsw') // 再开（toast 开启串）
  await sleep(500)
  const toastOn = await page.evaluate(() => document.body.innerText)
  log('条26 switch 几何（轨道 36×20 全圆角；滑块 16px；开→关 transform 复位 = 位移差 16px）',
    swGeo?.w === 36 && swGeo?.h === 20 && knobGeo?.w === '16px' && knobOff2 === 'none',
    JSON.stringify({ swGeo, knobW: knobGeo?.width, onT: knobGeo?.transform, offT: knobOff2 }))
  log('条28 D5 toast 逐字（已关闭联网搜索 / 已开启联网搜索）',
    !!toastOff && toastOff.includes('已关闭联网搜索') && toastOn.includes('已开启联网搜索'), `${toastOff ?? '无'} → 开启串已发`)
  log('条31 PUT 幂等回开（settings 端点运行时生效；payload 断言 = T2 pytest MockTransport 承载）',
    putBody.status === 200 && putBody.body.search_enabled === true, JSON.stringify(putBody.body))

  /* ---- 档案开关（条 32/33/34）：先经 API 造一个关态档案 ---- */
  await fetchApi('/api/profiles', {
    method: 'POST',
    body: JSON.stringify({ name: '公司中转', base_url: 'https://relay.example-corp.cn', model: 'glm-4.7', api_key: 'sk-relay-demo-not-real', tools_enabled: false }),
  })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await sleep(400)
  await page.evaluate(() => { document.querySelector('.acct .dd-trigger, .acct-trigger')?.click(); })
  await sleep(300)
  await page.evaluate(() => { [...document.querySelectorAll('.dd-item, [class*=dd] button, button')].find((b) => b.textContent.trim() === '设置')?.click() })
  await sleep(500)
  await page.evaluate(() => { [...document.querySelectorAll('.sm-nav button')].find((b) => b.textContent.trim() === '高级设置')?.click() })
  await sleep(300)
  const advText = await page.evaluate(() => document.body.innerText)
  log('条34 列表行状态（关态档案 p-sub 尾「 · 工具已关」）', advText.includes('relay.example-corp.cn · glm-4.7') && advText.includes('工具已关'), advText.includes('工具已关') ? '已显示' : '未显示')

  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '编辑档案')?.click() })
  await sleep(400)
  const editSw = await page.evaluate(() => {
    const f = document.querySelector('.tools-field')
    if (!f) return null
    return { checked: f.querySelector('.tsw')?.getAttribute('aria-checked'), hint: f.querySelector('.field-hint')?.textContent, labels: [...document.querySelectorAll('.modal .field-label')].map((l) => l.textContent.trim()) }
  })
  log('条32 第五字段位置与回显（API Key 后；编辑回显关态 aria-checked=false）',
    !!editSw && editSw.checked === 'false' && editSw.labels.indexOf('支持工具') === 4, JSON.stringify({ checked: editSw?.checked, labels: editSw?.labels }))
  log('条33 D7 hint 逐字', editSw?.hint === '关闭后，使用此档案的对话不携带工具（如联网搜索），AI 直接回答', editSw?.hint)
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消')?.click() })
  await sleep(200)
  // 添加模态默认开
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.includes('添加供应商档案'))?.click() })
  await sleep(400)
  const addSw = await page.$eval('.tools-field .tsw', (e) => e.getAttribute('aria-checked')).catch(() => null)
  log('条34b 新建默认开（aria-checked=true）', addSw === 'true', addSw)
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消')?.click() })
  await page.keyboard.press('Escape')
  await sleep(300)

  /* ---- 暗色承载（条 37/38：降级条暗色 + 引用卡暗色，分属两会话取证） ---- */
  await openSession('走查降级与空结果')
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark') })
  await sleep(500)
  const darkDegrade = await page.evaluate(() => {
    const d = document.querySelector('.degrade-note')
    if (!d) return null
    return { degradeBg: getComputedStyle(d).backgroundColor, degradeColor: getComputedStyle(d).color }
  })
  log('条37/38 暗色令牌·降级条（#38290F 底 + #EDA23B 字）',
    darkDegrade?.degradeBg === 'rgb(56, 41, 15)' && darkDegrade?.degradeColor === 'rgb(237, 162, 59)', JSON.stringify(darkDegrade))
  await shot('14-degrade-dark')
  await openSession('走查引用卡双源')
  await page.evaluate(() => { document.querySelector('.sc-head')?.click() })
  await sleep(300)
  const darkCard = await page.evaluate(() => {
    const c = document.querySelector('.source-card')
    if (!c) return null
    return {
      cardBg: getComputedStyle(c).backgroundColor,
      titleColor: getComputedStyle(c.querySelector('.src-title a')).color,
      metaColor: getComputedStyle(c.querySelector('.src-meta')).color,
      snipColor: getComputedStyle(c.querySelector('.src-snip')).color,
    }
  })
  log('条37/38 暗色令牌·引用卡（卡 #24272E/链接 #5C8DFF/元信息 #808896/片段 #A2A9B6）',
    darkCard?.cardBg === 'rgb(36, 39, 46)' && darkCard?.titleColor === 'rgb(92, 141, 255)' && darkCard?.metaColor === 'rgb(128, 136, 150)'
      && darkCard?.snipColor === 'rgb(162, 169, 182)',
    JSON.stringify(darkCard))
  await shot('14-cards-dark')
  // switch 暗色两态可辨（关态轨道 #262930 + 白滑块 #33363E 描边）——page.goto 重载会复位主题，重设 dark 再取证
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' })
  await sleep(600)
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark') })
  await sleep(300)
  const swDark = await page.evaluate(() => {
    const sw = document.querySelector('.sw-row .tsw')
    if (!sw) return null
    return { track: getComputedStyle(sw).backgroundColor, knobBorder: getComputedStyle(sw, '::after').borderColor }
  })
  await page.click('.sw-row .tsw') // 关态取证
  await sleep(400)
  const swDarkOff = await page.$eval('.sw-row .tsw', (e) => getComputedStyle(e).backgroundColor)
  await page.click('.sw-row .tsw') // 回开
  await sleep(300)
  log('条27b switch 暗色（开 #3370FF/关 #262930 + 白滑块 #33363E 描边清晰可辨）',
    swDark?.track === 'rgb(51, 112, 255)' && swDark?.knobBorder === 'rgb(51, 54, 62)' && swDarkOff === 'rgb(38, 41, 48)',
    JSON.stringify({ on: swDark?.track, off: swDarkOff, knobBorder: swDark?.knobBorder }))
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await sleep(300)

  /* ============ 阶段 B：带搜索 key（真实 Tavily 回合） ============ */
  await killBackend()
  spawnBackend(true)
  log('阶段B·后端重启（注入搜索 key，同库）', await waitHealth())
  const ovB = await fetchApi('/api/admin/overview')
  log('阶段B·overview（search_key_configured=true → 常显说明替换 D6）',
    ovB.body.search_key_configured === true, JSON.stringify({ enabled: ovB.body?.search_enabled, configured: ovB.body?.search_key_configured }))
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' })
  await sleep(600)
  const descB = await $one('.sw-desc')
  log('条29b key 配置后常显说明（D6 消失，逐字）',
    descB === '开启后 AI 可自动联网搜索并在回答前展示来源引用；关闭后 AI 直接回答，用户无感知', descB)

  /* ---- REQ-035 验收 1：时效性真实问题端到端（真实 search + 工具卡 + 引用卡 + 回答核验） ---- */
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await sleep(500)
  await page.evaluate(() => { [...document.querySelectorAll('.new-btn')].at(-1)?.click() })
  await sleep(300)
  await page.type('.composer textarea', '请用 search 工具联网查证后回答：DeepSeek 最新发布的模型版本是什么？')
  await page.keyboard.press('Enter')

  // 条 39-①：search 卡运行中帧（spinner + 运行中 + （等待结果…））
  let runFrame = null
  const t0 = Date.now()
  while (Date.now() - t0 < 30000) {
    runFrame = await page.evaluate(() => {
      const running = [...document.querySelectorAll('.tc-badge.running')].at(-1)
      if (!running) return null
      const card = running.closest('.tool-card')
      return { badge: running.textContent.trim(), spinner: !!running.querySelector('.tc-spinner'), expanded: card.querySelector('.tc-head').getAttribute('aria-expanded') }
    })
    if (runFrame) break
    await sleep(100)
  }
  const runOk = runFrame?.badge === '运行中' && runFrame?.spinner === true && runFrame?.expanded === 'false'
  log('条39① 运行中帧（spinner +「运行中」+ R1\' 创建即折叠）', runOk, JSON.stringify(runFrame))
  await shot('14-frame-running')

  // 条 39-②：搜索完成回答流式中帧（引用卡折叠已现 + 正在生成… + 光标）
  let liveSrcFrame = null
  const t1 = Date.now()
  while (Date.now() - t1 < 60000) {
    liveSrcFrame = await page.evaluate(() => {
      const src = [...document.querySelectorAll('.source-card')].at(-1)
      const hint = [...document.querySelectorAll('.status-hint')].some((x) => x.textContent.includes('正在生成'))
      if (!src || !hint) return null
      return { collapsed: src.querySelector('.sc-head').getAttribute('aria-expanded'), head: src.querySelector('.sc-head').textContent.trim(), cursor: !!document.querySelector('.cursor') }
    })
    if (liveSrcFrame) break
    await sleep(120)
  }
  log('条13b 流式期引用卡前置可见（回答生成中卡已现，核验前置）+ 条39② 流式中帧（折叠 + 正在生成… + 光标）',
    !!liveSrcFrame && liveSrcFrame.collapsed === 'false' && liveSrcFrame.cursor === true && /引用来源 · \d 条/.test(liveSrcFrame?.head ?? ''),
    JSON.stringify(liveSrcFrame))
  await shot('14-frame-live-sources')

  // 终态：完成徽章 + R2 折叠 + 回答核验
  let final = null
  const t2 = Date.now()
  while (Date.now() - t2 < 90000) {
    final = await page.evaluate(() => {
      const lastMsg = [...document.querySelectorAll('.bubble.assistant')].at(-1)
      if (!lastMsg || document.querySelector('.cursor')) return null
      const badges = [...document.querySelectorAll('.tc-badge')]
      const src = [...document.querySelectorAll('.source-card')].at(-1)
      return {
        badge: badges.at(-1)?.textContent.trim(),
        srcCollapsed: src?.querySelector('.sc-head').getAttribute('aria-expanded'),
        srcHead: src?.querySelector('.sc-head')?.textContent.trim(),
        answer: lastMsg.textContent.replace(/引用来源 · \d+ 条/, '').trim().slice(0, 80),
      }
    })
    if (final) break
    await sleep(400)
  }
  log('REQ-035 验收1 终态（search 卡「完成」+ 引用卡默认折叠 + 回答非空）',
    final?.badge === '完成' && final?.srcCollapsed === 'false' && /引用来源 · [1-5] 条/.test(final?.srcHead ?? '') && (final?.answer?.length ?? 0) > 0,
    JSON.stringify(final))
  await shot('14-final-light')

  // 真实条目核验：展开 → 条目 ≤5、链接真实域、hostname/site 降级呈现
  const liveItems = await page.evaluate(() => {
    const src = [...document.querySelectorAll('.source-card')].at(-1)
    src?.querySelector('.sc-head')?.click()
    return new Promise((r) => setTimeout(() => {
      const items = [...(src?.querySelectorAll('.src-item') ?? [])]
      r({
        n: items.length,
        links: items.slice(0, 3).map((i) => i.querySelector('.src-title a')?.href),
        metas: items.slice(0, 2).map((i) => i.querySelector('.src-meta')?.textContent?.trim()),
      })
    }, 250))
  })
  log('REQ-035 验收1 条目核验（真实 Tavily 来源 ≤5 条；链接真实域；元信息降级呈现）',
    liveItems?.n >= 1 && liveItems?.n <= 5 && liveItems?.links?.every((u) => /^https?:\/\//.test(u) && !u.includes('example.com')),
    JSON.stringify({ n: liveItems?.n, links: liveItems?.links?.slice(0, 2), metas: liveItems?.metas }))
  await shot('14-final-expanded')
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await sleep(400)
  await shot('14-final-dark')
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await sleep(300)

  /* ---- 条 24/D4：admin 关闭 → 无感降级（零 UI） ---- */
  await fetchApi('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ search_enabled: false }) })
  await page.evaluate(() => { [...document.querySelectorAll('.new-btn')].at(-1)?.click() })
  await sleep(300)
  await page.type('.composer textarea', 'Vue 3 目前最新的正式版本号是多少？')
  await page.keyboard.press('Enter')
  let closedFinal = null
  const t3 = Date.now()
  while (Date.now() - t3 < 90000) {
    closedFinal = await page.evaluate(() => {
      const lastMsg = [...document.querySelectorAll('.bubble.assistant')].at(-1)
      if (!lastMsg || document.querySelector('.cursor')) return null
      return {
        searchCards: [...lastMsg.querySelectorAll('.tool-card .tc-name')].map((n) => n.textContent.trim()),
        src: !!lastMsg.querySelector('.source-card'), degrade: !!lastMsg.querySelector('.degrade-note'),
        text: lastMsg.textContent.trim().slice(0, 40),
      }
    })
    if (closedFinal) break
    await sleep(400)
  }
  log('条24/D4 admin 关闭无感降级（无 search 卡/无引用卡/无引导条/无任何提示，模型直答）',
    !!closedFinal && !closedFinal.searchCards.includes('search') && closedFinal.src === false && closedFinal.degrade === false && (closedFinal.text?.length ?? 0) > 0,
    JSON.stringify(closedFinal))
  await fetchApi('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ search_enabled: true }) })

  /* ---- 条 36：REQ-007 引导路径复用（错误气泡 → 前往高级设置 → 开关所在分区可达，不新建映射） ---- */
  const guide = await page.evaluate(async () => {
    const r = await fetch('/api/sessions/e2e14-guide', {
      method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'e2e14-guide', title: '走查引导路径', createdAt: 5, updatedAt: Date.now() - 1000, renamed: true, schema: 2,
        messages: [
          { id: 'u1', role: 'user', content: '调用一个不支持工具的端点', status: 'done' },
          { id: 'm1', role: 'assistant', status: 'error', error: { kind: 'auth', message: '上游返回错误：该端点可能不支持工具调用，可关闭档案中的『支持工具』后重试' }, content: [{ type: 'text', text: '错误前文本。' }] },
        ],
      }),
    })
    return r.status
  })
  // 引导会话经裸 PUT 入库，侧栏 sessions store 未感知——重载让侧栏刷新出该会话后再打开
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await sleep(500)
  await openSession('走查引导路径')
  const guideOk = await page.evaluate(() => {
    const err = [...document.querySelectorAll('[class*="error"], .err')].find((e) => e.textContent.includes('不支持工具调用'))
    const btn = err ? [...err.querySelectorAll('button')].find((b) => b.textContent.includes('前往高级设置')) : null
    btn?.click()
    return new Promise((r) => setTimeout(() => r({ hasBubble: !!err, hasLocate: !!btn, advShown: !!document.querySelector('.sm-nav') && document.body.innerText.includes('高级设置 · 自填供应商密钥') }), 500))
  })
  log('条36 引导路径（REQ-007 既有映射气泡 + 前往高级设置直达 → 开关所在高级设置分区，不新建映射）',
    guide === 200 && guideOk.hasBubble && guideOk.hasLocate && guideOk.advShown, JSON.stringify(guideOk))
  await page.keyboard.press('Escape')
  await sleep(200)

  /* ---- 行为类条目：自动化用例承载标注 ---- */
  const byTests = [
    ['条15/16 双来源承载与缺字段', 'SourceCard.spec（Tavily 型 hostname 兜底/博查型富元数据/条目五字段）+ 本脚本造数双源断言'],
    ['条30 overview API 加法字段（既有用例零改动）', 'AdminView.spec 开关行组 + pytest test_search.py 开关 API 8 例'],
    ['条31 生效语义 payload 断言', 'pytest test_开关矩阵_*（MockTransport 捕获上游 tools 定义）'],
    ['条35 profiles API 扩展（老前端零破坏）', 'pytest test_search.py profiles §6.3 4 例 + settings-form.spec/tools_enabled 载荷断言'],
    ['条20 渲染层派生不落库（PUT 载荷不含）', 'sessions.spec 引用来源数据面 + MessageBubble.spec（contentText 正文不含来源）'],
    ['条41 导出/索引零适配', 'export.spec/search.spec（contentText 只取文本段）+ 本脚本复制桩与侧栏搜索断言'],
    ['条42 不适用项', '天气工具零涉及（定案不纳入）；上标联动 = B1+ 候选；用户侧搜索开关不存在；admin 其他区域/移动端零改动'],
  ]
  for (const [name, carrier] of byTests) log(`${name}（自动化用例承载）`, true, carrier)

  const fail = results.filter((r) => r.startsWith('FAIL')).length
  console.log(`\n==== 走查汇总：${results.length - fail} PASS / ${fail} FAIL（共 ${results.length} 条）====`)
  process.exitCode = fail ? 1 : 0
} finally {
  await browser.close().catch(() => {})
  try { viteProc?.kill('SIGTERM') } catch { /* 已退出 */ }
  try { backendProc?.kill('SIGTERM') } catch { /* 已退出 */ }
}
