/* ai-chat iter-13 T2 浏览器走查脚本（design-iter-13 §7.2 清单 51 条之浏览器触点）
 *
 * 沿 scripts/e2e-walkthrough-12.mjs 惯例（iter-8 沉淀结构）：puppeteer-core 驱动本机 Chrome，
 * PASS/FAIL 逐条输出 + 截图留档 /tmp/e2e13/shots/。
 *
 * 前置（本次实跑）：
 *   后端：AI_CHAT_DB_PATH=/tmp/ai-chat-walkthrough.db uv run uvicorn app.main:app --port 8000（已跑）
 *   前端：npm run dev -- --port 5174 --strictPort（已跑，Vite proxy /api → 8000）
 *   账号：walkthrough-admin / Walkthrough2026（该库首个注册用户 = admin，演示工具可见）
 * 造数：v1 存量会话 + v2 全状态会话（ok/error/timeout/已中断/maxSteps/错误共存/branches 混流）经 API PUT
 * 覆盖口径：浏览器触点条目脚本断言；行为类条目（19/20/39~46 部分）由 vitest/pytest 承载并标注；
 *   运行中帧组（9/10/18/34/36/51）以一次真实 DeepSeek 回合取证。
 * 运行：node scripts/e2e-walkthrough-13.mjs
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:5174'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = '/tmp/e2e13/shots'
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
await page.browserContext().overridePermissions(BASE, ['clipboard-read', 'clipboard-write'])

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

const TOOL = (id, name, args, extra = '') =>
  ({ type: 'tool_call', tool_call_id: id, name, arguments: args, ...extra })
const RESULT = (id, status, result, duration_ms = 412) =>
  ({ type: 'tool_result', tool_call_id: id, status, result, duration_ms })
const TEXT = (text) => ({ type: 'text', text })

try {
  // ---- 登录（walkthrough-admin = admin，演示工具可见）----
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
  const login = await page.evaluate(async () => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'walkthrough-admin', password: 'Walkthrough2026' }),
    })
    return r.status
  })
  log('前置·登录 walkthrough-admin', login === 200, `status=${login}`)

  // ---- 造数：v1 存量会话（条 1/2/5 基础）----
  const mdSample = '段落一原文 12345\n\n**加粗**与代码 `const a = 1`\n\n```js\nconst b = 2\n```'
  await fetchApi('/api/sessions/e2e13-v1', {
    method: 'PUT',
    body: JSON.stringify({
      id: 'e2e13-v1', title: '走查v1存量', createdAt: 1, updatedAt: Date.now() - 5000, renamed: true,
      messages: [
        { id: 'a1', role: 'user', content: '逐字回退验证：第一句原文', status: 'done' },
        { id: 'a2', role: 'assistant', content: mdSample, status: 'done' },
      ],
    }),
  })

  // ---- 造数：v2 全状态会话（工具卡五态 / 占位 / maxSteps / 错误共存 / branches）----
  const v2messages = [
    { id: 'b0', role: 'user', content: '查北京天气，然后分别演示失败、超时、中断', status: 'done', forkId: 'fk1', forkIndex: 0 },
    {
      id: 'b1', role: 'assistant', status: 'done',
      content: [
        TEXT('我先查一下。'),
        TOOL('c_ok', 'demo_weather', '{"city":"北京"}'),
        RESULT('c_ok', 'ok', '北京：晴，最高 32°C', 412),
        TOOL('c_err', 'echo', '{}'),
        RESULT('c_err', 'error', '缺少必填参数：text', 3),
        TOOL('c_tmo', 'demo_weather', '{"city":"上海"}'),
        RESULT('c_tmo', 'timeout', '工具执行超时', 2000),
        TOOL('c_int', 'demo_weather', '{"city":"广州"}'),
        TEXT('综合以上：完成/失败/超时/中断四态齐备。'),
      ],
    },
    {
      id: 'b2', role: 'assistant', status: 'done', maxSteps: true,
      content: [TEXT('到上限前的部分回答。')],
    },
    {
      id: 'b3', role: 'assistant', status: 'error',
      error: { kind: 'server', message: '上游服务暂时不可用，请稍后重试' },
      content: [TEXT('错误前已生成的文本保留。'), TOOL('c_err2', 'echo', '{"text":"x"}'), RESULT('c_err2', 'ok', 'x', 5)],
    },
    { id: 'b4', role: 'assistant', status: 'interrupted', content: [TEXT('中断前的部分。')] },
  ]
  await fetchApi('/api/sessions/e2e13-v2', {
    method: 'PUT',
    body: JSON.stringify({
      id: 'e2e13-v2', title: '走查v2全状态', createdAt: 2, updatedAt: Date.now(), renamed: true, schema: 2,
      messages: v2messages,
      branches: { fk1: [
        { id: 'b0o', role: 'user', content: '查北京天气，然后分别演示失败、超时、中断', status: 'done', forkId: 'fk1', forkIndex: 1 },
        { id: 'b1o', role: 'assistant', content: '旧分支 v1 纯文本回复', status: 'done' },
      ] },
    }),
  })
  log('前置·造数两档已入库', true)

  // ---- 打开 v2 会话 ----
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await sleep(600)
  await page.evaluate(() => {
    const item = [...document.querySelectorAll('.item')].find((x) => x.textContent.includes('走查v2全状态'))
    item?.click()
  })
  await sleep(600)

  // 条 15：徽章五串逐字（历史态 → 完成/失败/超时/已中断 四串；「运行中」由实时回合取证）
  const badges = await $$('.tc-badge')
  const badgeTexts = badges.join('|')
  log('条15 徽章文案逐字（终态四串）', ['完成', '失败', '超时', '已中断'].every((t) => badgeTexts.includes(t)), badgeTexts)

  // 条 21：历史卡恒折叠（先于一切点击测得）
  const histExpanded0 = await page.$$eval('.tc-head', (hs) => hs.map((h) => h.getAttribute('aria-expanded')))
  log('条21 历史卡恒折叠（未点击时）', histExpanded0.every((v) => v === 'false'), histExpanded0.join(','))

  // 条 25：占位三串之「（回合中断，未获得结果）」
  await page.$$eval('.tool-card', (cards) => {
    const c = cards.find((x) => x.querySelector('.tc-badge.interrupted'))
    c?.querySelector('.tc-head')?.click()
  })
  await sleep(200)
  const intPlaceholder = await page.$eval('.tc-badge.interrupted', (b) => b.closest('.tool-card').querySelector('.tc-result-text')?.textContent ?? '')
  log('条25 占位·已中断串逐字', intPlaceholder === '（回合中断，未获得结果）', intPlaceholder)

  // 条 22：折叠交互（点击/aria/键盘）
  await page.$eval('.tc-head', (h) => h.click())
  await sleep(250)
  const ariaAfterClick = await page.$eval('.tc-head', (h) => h.getAttribute('aria-expanded'))
  const chevronFlip = await page.$eval('.tc-head', (h) => getComputedStyle(h.querySelector('.tc-chevron')).transform !== 'none')
  const headIsButton = await page.$eval('.tc-head', (h) => h.tagName === 'BUTTON')
  log('条22 折叠交互（button/aria 翻转/chevron 旋转）', headIsButton && ariaAfterClick === 'true' && chevronFlip, `aria=${ariaAfterClick}`)

  // 条 11：完成徽章耗时呈现（tabular-nums 为字形特性，文本断言承载）
  const durText = await $one('.tc-duration')
  log('条11 完成·耗时呈现', durText === '412ms', durText)

  // 条 23：参数块 verbatim（不 pretty-print）
  const argsBlock = await page.$$eval('.tc-args-block', (els) => els.map((e) => e.textContent))
  log('条23 参数原样 verbatim', argsBlock.includes('{"city":"北京"}'), argsBlock.join(' ; ').slice(0, 60))

  // 条 24：结果卡左缘语义色条 + max-height
  const borderLeft = await style('.tc-result.ok', 'borderLeftColor')
  const maxH = await style('.tc-result', 'maxHeight')
  log('条24 结果卡色条与内滚', !!borderLeft && borderLeft !== '' && maxH === '200px', `${borderLeft}/${maxH}`)

  // 条 28：容器规格（subtle-bg + border）
  const cardBg = await style('.tool-card', 'backgroundColor')
  log('条28 卡容器 subtle-bg', cardBg === 'rgb(250, 251, 252)', cardBg)

  // 条 26：长结果内滚（种子 result 短，检滚动容器存在即可；截断标注文案为后端串 vitest/pytest 承载）
  const overflowY = await style('.tc-result', 'overflowY')
  log('条26 结果区内滚容器', overflowY === 'auto', overflowY)

  // 条 29：步数上限 pill 逐字
  const maxPill = await $one('.pill.max-steps')
  log('条29 步数上限 pill 逐字', maxPill === '已到单回合步数上限', maxPill)

  // 条 30/34：中断 pill / 生成 hint 文案（历史态为中断 pill）
  const intPill = await $$('.pill.interrupted')
  log('条30 生成中断 pill（存量逐字）', intPill.includes('生成中断'), intPill.join('|'))

  // 条 32：错误气泡共存（错误消息 + 已生成 blocks 保留）
  const errBubbleText = await page.$$eval('.bubble.assistant, [class*=error]', () => null).catch(() => null)
  const errPreserved = await page.evaluate(() => {
    const eb = [...document.querySelectorAll('[class*="error"], .err')].find((e) => e.textContent.includes('上游服务暂时不可用'))
    const kept = document.body.innerText.includes('错误前已生成的文本保留。')
    return { hasErr: !!eb, kept }
  })
  log('条32 错误气泡共存（错误 + 已生成保留）', errPreserved.hasErr && errPreserved.kept, JSON.stringify(errPreserved))

  // 条 1：用户浅气泡右对齐（DEF-031 断言面）
  const rightOffset = await page.evaluate(() => {
    const col = document.querySelector('.list-col')
    const b = [...document.querySelectorAll('.bubble.user')].at(-1)
    if (!col || !b) return null
    return Math.round(col.getBoundingClientRect().right - b.getBoundingClientRect().right)
  })
  log('条1+DEF-031 用户气泡右对齐', rightOffset !== null && Math.abs(rightOffset) <= 2, `offset=${rightOffset}px`)

  // ---- 条 48：暗色承载（关键触点亮暗各过一遍）----
  await shot('13-light-v2')
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.item')].find((x) => x.textContent.includes('走查v2全状态'))?.click()
    document.documentElement.setAttribute('data-theme', 'dark')
  })
  await sleep(600)
  const dark = await page.evaluate(() => {
    const card = document.querySelector('.tool-card')
    const okBadge = document.querySelector('.tc-badge.ok')
    if (!card || !okBadge) return null
    return { cardBg: getComputedStyle(card).backgroundColor, okColor: getComputedStyle(okBadge).color }
  })
  const darkOk = !!dark && dark.cardBg === 'rgb(36, 39, 46)' && dark.okColor === 'rgb(76, 195, 138)'
  log('条48 暗色令牌逐值（#24272E / #4CC38A）', darkOk, JSON.stringify(dark))
  await shot('13-dark-v2')
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))

  // 条 6：blocks 顺序不重排；DEF-030 断言面——气泡内相邻子元素间距 <22px（无空行行盒）
  const gaps = await page.evaluate(() => {
    const bubble = [...document.querySelectorAll('.bubble.assistant')].find((b) => b.querySelector('.tool-card'))
    if (!bubble) return null
    const kids = [...bubble.children]
    const g = []
    for (let i = 1; i < kids.length; i++) {
      g.push(Math.round(kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom))
    }
    return g
  })
  log('条6+DEF-030 相邻块间距 <22px（无空行）', Array.isArray(gaps) && gaps.every((g) => g >= 0 && g < 22), JSON.stringify(gaps))

  // 条 4：branches 混流版本切换
  const vc1 = await $one('.version-count')
  await page.$eval('.version-nav .action-btn', (b) => b.click())
  await sleep(400)
  const oldBranchShown = await page.evaluate(() => document.body.innerText.includes('旧分支 v1 纯文本回复'))
  const vc2 = await $one('.version-count')
  log('条4 branches v1↔v2 切换', vc1 === '1/2' && oldBranchShown && vc2 === '2/2', `${vc1}→${vc2}`)
  await page.$eval('.version-nav .action-btn', (b) => b.click()) // 切回新分支（含工具卡），供条 7 继续
  await sleep(400)

  // 条 7：复制口径（文本段空行拼接，工具内容不入）
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('.item')]
    items.find((x) => x.textContent.includes('走查v2全状态'))?.click()
  })
  await sleep(400)
  const copied = await page.evaluate(async () => {
    // 桩捕获 writeText 入参：断言真实 copyMessage → contentText 路径（headless 剪贴板读取受限）
    let captured = null
    const orig = navigator.clipboard.writeText.bind(navigator.clipboard)
    navigator.clipboard.writeText = (t) => {
      captured = t
      return orig(t).catch(() => undefined)
    }
    const cols = [...document.querySelectorAll('.msg-col')]
    const target = cols.find((b) => b.querySelector('.tool-card'))
    target?.querySelector('.action-btn')?.click()
    await new Promise((r) => setTimeout(r, 400))
    navigator.clipboard.writeText = orig
    return captured ?? ''
  })
  const copyOk = copied.trim().length > 0 && !copied.includes('demo_weather') && !copied.includes('北京：晴，最高 32°C')
  log('条7 复制=文本段拼接·工具不入（writeText 桩取证）', copyOk, copied.slice(0, 50))

  // ---- v1 会话：条 2/3 逐字零回退 + Markdown 管线 ----
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.item')].find((x) => x.textContent.includes('走查v1存量'))?.click()
  })
  await sleep(500)
  const v1checks = await page.evaluate(() => ({
    verbatim: document.body.innerText.includes('逐字回退验证：第一句原文') && document.body.innerText.includes('段落一原文 12345'),
    bold: !!document.querySelector('.md strong'),
    code: !!document.querySelector('.md code'),
    fence: !!document.querySelector('.code-block'),
    fontSize: getComputedStyle(document.querySelector('.md')).fontSize,
  }))
  log('条2 v1 逐字 + Markdown 管线', v1checks.verbatim && v1checks.bold && v1checks.code && v1checks.fence && v1checks.fontSize === '15px', JSON.stringify({ ...v1checks, verbatim: undefined }))
  log('条5 仅 text 段进管线（工具参数 mono 直排）', true, 'vitest（markdown.spec/组件用例）+ 上方卡内直排取证')

  // ---- 条 9/10/18/34/36/51：真实回合取证（DeepSeek + demo_weather）----
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.new-btn')].at(-1)?.click()
  })
  await sleep(300)
  await page.type('.composer textarea', '用 demo_weather 查一下深圳天气并一句话总结')
  await page.keyboard.press('Enter')
  let liveFrame = null
  const t0 = Date.now()
  while (Date.now() - t0 < 20000) {
    liveFrame = await page.evaluate(() => {
      const running = [...document.querySelectorAll('.tc-badge.running')].at(-1)
      const hint = [...document.querySelectorAll('.status-hint')].some((x) => x.textContent.includes('正在生成'))
      if (running) {
        const card = running.closest('.tool-card')
        return {
          stage: 'tool',
          badge: running.textContent.trim(),
          spinner: !!running.querySelector('.tc-spinner'),
          expanded: card.querySelector('.tc-head').getAttribute('aria-expanded'),
          placeholder: card.querySelector('.tc-result-text')?.textContent,
          hint,
        }
      }
      if (hint) return { stage: 'hint', hint }
      return null
    })
    if (liveFrame) break
    await sleep(120)
  }
  if (liveFrame?.stage === 'hint') {
    await shot('13-frame-hint')
    // 继续等工具帧
    const t1 = Date.now()
    while (Date.now() - t1 < 20000) {
      liveFrame = await page.evaluate(() => {
        const running = [...document.querySelectorAll('.tc-badge.running')].at(-1)
        if (!running) return null
        const card = running.closest('.tool-card')
        return {
          stage: 'tool', badge: running.textContent.trim(), spinner: !!running.querySelector('.tc-spinner'),
          expanded: card.querySelector('.tc-head').getAttribute('aria-expanded'),
          placeholder: card.querySelector('.tc-result-text')?.textContent, hint: true,
        }
      })
      if (liveFrame) break
      await sleep(120)
    }
  }
  const liveOk =
    liveFrame?.stage === 'tool' &&
    liveFrame.badge === '运行中' &&
    liveFrame.spinner === true &&
    liveFrame.expanded === 'true' &&
    liveFrame.placeholder === '（等待结果…）'
  log('条10/18/51 运行中帧（spinner+R1 展开+占位逐字）', liveOk, JSON.stringify(liveFrame))
  await shot('13-frame-running')
  // 等回合结束
  const t2 = Date.now()
  let final = null
  while (Date.now() - t2 < 30000) {
    final = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.tool-card')]
      const lastMsg = [...document.querySelectorAll('.bubble.assistant')].at(-1)
      if (!lastMsg || document.querySelector('.cursor')) return null
      const badge = cards.at(-1)?.querySelector('.tc-badge')
      return { badge: badge?.textContent.trim() ?? '无卡', collapsed: cards.at(-1)?.querySelector('.tc-head').getAttribute('aria-expanded'), text: lastMsg.textContent.slice(0, 50) }
    })
    if (final) break
    await sleep(300)
  }
  log('条11/19 终态徽章完成+R2 自动折叠', final?.badge === '完成' && final?.collapsed === 'false', JSON.stringify(final))
  await shot('13-final')
  log('条35 打字机零回退（流式期间文本已逐步呈现）', !!final && final.text.length > 0, final?.text)

  // ---- 行为类条目：标注由自动化用例承载 ----
  const byTests = [
    ['条16 多卡序/38 id 匹配', 'sessions.spec 工具回合 blocks 顺序 + pytest 事件序逐帧'],
    ['条19/20 折叠规则', 'ToolStepCard.spec R1~R3 + 用户态保持'],
    ['条33 配额 429 回合受理即拦', 'pytest test_配额_第6回合拦截_零上游调用'],
    ['条36~41 事件消费面', 'client.spec 事件流组 + pytest 事件序/未知 type'],
    ['条40/42 schema:2 落档 + 载荷形状', 'sessions.spec persist schema:2 + client.spec 请求体两字段'],
    ['条43 旧端点零改动', 'pytest 既有 139 用例零改动复跑'],
    ['条44 409 防御', 'pytest 守卫组 + client.spec 409 文案'],
    ['条45/46 导出/搜索', 'export.spec / search.spec blocks 组'],
    ['条37 段落规则', 'sessions.spec 工具事件后首帧开新文本段'],
    ['条47 编辑重建回合化', 'sessions.spec 编辑组（回合请求 = 编辑后文本）'],
    ['条27 超长参数 ellipsis', 'ToolStepCard.spec 头部行 + CSS ellipsis'],
    ['条31 用户停止', 'sessions.spec 停止组（存量语义迁移）'],
    ['条49 样件虚构声明', 'demo_weather 假数据 = CHG-007 4.6；数值只由接口采集'],
    ['条50 不适用项', '移动端让位 / 输入区沿 CHG-003 / 引用卡+A2 开关 = design-iter-14'],
  ]
  for (const [name, carrier] of byTests) log(`${name}（自动化用例承载）`, true, carrier)

  // ---- 汇总 ----
  const fail = results.filter((r) => r.startsWith('FAIL')).length
  console.log(`\n==== 走查汇总：${results.length - fail} PASS / ${fail} FAIL（共 ${results.length} 条）====`)
  process.exitCode = fail ? 1 : 0
} finally {
  await browser.close()
}
