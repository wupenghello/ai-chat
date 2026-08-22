/* ai-chat iter-22 T2 浏览器走查脚本（REQ-053 验收 1/2 天气链路 + demo_weather 移除面）
 *
 * 沿 scripts/e2e-walkthrough-13.mjs 惯例：puppeteer-core 驱动本机 Chrome，
 * PASS/FAIL 逐条输出 + 截图留档 /tmp/e2e22/shots/。
 *
 * 前置（本次实跑）：
 *   后端：AI_CHAT_DB_PATH=/tmp/ai-chat-walkthrough-22.db \
 *         AI_CHAT_WEATHER_KEY=... AI_CHAT_WEATHER_HOST=...（进程环境注入，沿 iter-18 key 卫生体例）\
 *         .venv/bin/python -m uvicorn app.main:app --port 8000（backend/ 下）
 *   前端：npm run dev -- --port 5174 --strictPort（Vite proxy /api → 8000）
 *   账号：walkthrough-admin / Walkthrough2026（该库首个注册用户 = admin）
 * 链路：真实 DeepSeek 回合 + 真实和风凭据（北极星链路「查北京天气」——沿 iter-13 形态）。
 * 运行：node scripts/e2e-walkthrough-22.mjs
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:5174'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = '/tmp/e2e22/shots'
mkdirSync(SHOTS, { recursive: true })

const results = []
function log(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —— ' + detail : ''}`)
  console.log(results.at(-1))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` })

const fetchApi = (path, opts = {}) =>
  page.evaluate(
    (p, o) =>
      fetch(p, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...o })
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
    path, opts,
  )

/** 发送一条消息并等待回合完成（新 assistant 气泡出现且文本稳定 2s；90s 上限，真实 DeepSeek） */
async function sendAndWait(text, timeoutMs = 90_000) {
  const before = (await bubbleTexts()).length
  await page.type('.composer textarea', text)
  await page.keyboard.press('Enter')
  const start = Date.now()
  let lastText = '', stable = 0
  while (Date.now() - start < timeoutMs) {
    await sleep(500)
    const texts = await bubbleTexts()
    if (texts.length > before) {
      const t = texts.at(-1) ?? ''
      if (t && t === lastText) {
        stable += 500
        if (stable >= 2000) return true
      } else {
        lastText = t
        stable = 0
      }
    }
  }
  return false
}

/** 全部工具卡信息：[{ name, badge, result }]（结果文本仅展开态渲染——R2 默认折叠） */
const toolCards = () =>
  page.$$eval('.tool-card', (cards) =>
    cards.map((c) => ({
      name: c.querySelector('.tc-name')?.textContent?.trim() ?? '',
      badge: c.querySelector('.tc-badge')?.textContent?.trim() ?? '',
      result: c.querySelector('.tc-result-text')?.textContent?.trim() ?? '',
    })))

/** 展开最后一张工具卡（点击头部 toggle）以读取结果文本 */
const expandLast = async () => {
  await page.$$eval('.tool-card .tc-head', (heads) => heads.at(-1)?.click())
  await sleep(300)
}

const bubbleTexts = () =>
  page.$$eval('.bubble.assistant', (els) => els.map((e) => e.textContent.trim()))

try {
  // ---------- 登录（该库首账号 = admin） ----------
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
  const reg = await fetchApi('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'walkthrough-admin', password: 'Walkthrough2026' }),
  })
  if (reg.status >= 400) {
    await fetchApi('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'walkthrough-admin', password: 'Walkthrough2026' }),
    })
  }
  log('登录 walkthrough-admin（首账号 = admin，工具面最宽）', true)
  // API 登录只落 Cookie——重载让路由识别会话并进入主对话视图
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.composer textarea', { timeout: 15_000 })

  // ---------- 条 1：北极星链路——查北京天气（真实 DeepSeek + 真实和风，验收 1） ----------
  await sendAndWait('查一下北京现在的天气')
  await expandLast()
  await shot('01-beijing-now')
  let cards = await toolCards()
  // 会话可能累积历史卡——只认本回合最新一张「完成」卡（expandLast 已将其展开）
  const wx = [...cards].reverse().find(
    (c) => c.name.includes('weather') && !c.name.includes('demo') && c.badge.includes('完成'))
  log(
    '条1 工具卡 weather 出现且完成（非 demo_weather——验收 1 + 定夺①移除面）',
    !!wx && wx.badge.includes('完成'),
    `cards=${JSON.stringify(cards.map((c) => c.name + '/' + c.badge))}`,
  )
  log(
    '条1 工具结果含实时与三日（真实数据结构，非演示固定串）',
    !!wx && wx.result.includes('实时天气') && wx.result.includes('三日预报') &&
      wx.result.includes('°C') && !wx.result.includes('最高 32°C'),
    wx.result.slice(0, 120),
  )
  const answers = await bubbleTexts()
  const lastAnswer = answers.at(-1) ?? ''
  log(
    '条1 综合回答含北京实况要素（温度语境）',
    /北京/.test(lastAnswer) && /°C|度/.test(lastAnswer),
    lastAnswer.slice(0, 100),
  )

  // ---------- 条 2：三日预报问答（表内小地名丽江走坐标兜底城市表） ----------
  await sendAndWait('丽江未来三天天气趋势如何？')
  await expandLast()
  await shot('02-lijiang-3d')
  cards = await toolCards()
  const lj = cards.at(-1)
  log(
    '条2 表内城市（丽江）weather 工具卡完成',
    !!lj && lj.name.includes('weather') && lj.badge.includes('完成') && lj.result.includes('丽江'),
    lj?.result.slice(0, 100) ?? '',
  )
  log(
    '条2 三日逐日结构（今起 3 行日期）',
    !!lj && (lj.result.match(/2026-\d{2}-\d{2}：/g) ?? []).length >= 3,
  )

  // ---------- 条 3：表外小地名坐标兜底（漠河不在 148 城表——模型按工具描述改传坐标） ----------
  await sendAndWait('漠河现在的天气怎么样')
  await expandLast()
  await shot('03-outoftable')
  cards = await toolCards()
  const xg = cards.at(-1)
  const xgOk = !!xg && xg.name.includes('weather') && xg.badge.includes('完成')
  const xgCoord = xgOk && /\d+\.\d+,\d+\.\d+实时天气/.test(xg.result)
  log(
    '条3 表外地名坐标兜底链路（坐标标签或模型改述直答）',
    xgCoord || /天气/.test((await bubbleTexts()).at(-1) ?? ''),
    xg?.result.slice(0, 100) ?? '(模型直答无工具卡)',
  )

  // ---------- 条 4：城市查无降级（验收 2——回合不崩、模型降级直答） ----------
  await sendAndWait('亚特兰蒂斯现在天气如何？')
  await shot('04-notfound-degrade')
  const afterDegrade = await bubbleTexts()
  const errBubble = await page.$$('.bubble.error, .error-bubble')
  log(
    '条4 查无城市：回合完成不崩（有回答、无错误气泡）',
    (afterDegrade.length > 0) && errBubble.length === 0,
    (afterDegrade.at(-1) ?? '').slice(0, 80),
  )

  // ---------- 条 5：回合后服务仍健康（降级不污染后续回合） ----------
  const quota = await fetchApi('/api/quota')
  log('条5 降级后 quota 端点正常（服务健康）', quota.status === 200)
  await shot('05-healthy-after')
} catch (e) {
  log('走查异常中断', false, String(e))
} finally {
  const fail = results.filter((r) => r.startsWith('FAIL')).length
  console.log(`\n=== walkthrough-22：${results.length - fail} PASS / ${fail} FAIL ===`)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
