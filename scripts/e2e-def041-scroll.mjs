/* ai-chat DEF-041 缺陷修复取证脚本（真实 Chrome，2026-08-23）：
 * 流式生成中用户上滚不再被程序滚底拽回（DEF-034 残留竞态的回归面）。
 *
 * 前置：后端 .venv/bin/python -m uvicorn app.main:app --port 8000（backend/ 下，本地 .env）；
 *       前端 npm run dev -- --port 5174 --strictPort；账号 walkthrough-admin / Walkthrough2026。
 * 运行：node scripts/e2e-def041-scroll.mjs
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:5174'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = '/tmp/e2e-def041/shots'
mkdirSync(SHOTS, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
const results = []
const log = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —— ' + detail : ''}`)
  console.log(results.at(-1))
}
const metrics = () =>
  page.$eval('.list', (n) => ({
    top: n.scrollTop, h: n.scrollHeight, ch: n.clientHeight,
    dist: n.scrollHeight - n.scrollTop - n.clientHeight,
    btn: !!document.querySelector('.tb-btn'),
  }))

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
  await page.evaluate(async (u, p) => {
    const reg = await fetch('/api/auth/register', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })
    if (!reg.ok) await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })
  }, 'walkthrough-admin', 'Walkthrough2026')
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.composer textarea', { timeout: 15_000 })

  // 长生成请求（内容须显著溢出视口，给上滚留出空间）
  await page.type('.composer textarea', '请写一篇约一千二百字的散文《夏夜》，分十二段，每段不少于八十字。')
  await page.keyboard.press('Enter')
  // 等流式内容溢出视口（距底可滚 >400px 才具备取证前提）
  let overflowed = false
  for (let i = 0; i < 120 && !overflowed; i++) {
    await sleep(250)
    overflowed = await page.$eval('.list', (n) => n.scrollHeight - n.clientHeight > 400)
  }
  log('流式生成中且内容已溢出视口（距底可滚 >400px）', overflowed)
  const m0 = await metrics()
  log('流式中贴底跟随（跟随态，无浮钮）', m0.dist < 150 && !m0.btn, `dist=${m0.dist.toFixed(0)}px`)

  // 用户上滚（真实滚轮事件；鼠标先悬停消息流中部，确保事件落在 .list 滚动容器上）
  await page.mouse.move(700, 420)
  await page.mouse.wheel({ deltaY: -700 })
  await sleep(250)
  await page.mouse.wheel({ deltaY: -400 })

  // 采样 1.8s：逐样本距底 = scrollHeight(当刻) - scrollTop - clientHeight
  let minDist = Infinity, sawBtn = false, streamingSamples = 0
  for (let i = 0; i < 12; i++) {
    const m = await metrics()
    minDist = Math.min(minDist, m.dist)
    sawBtn = sawBtn || m.btn
    const hint = await page.$$eval('.status-hint', (els) => els.some((e) => e.textContent.includes('正在生成')))
    if (hint) streamingSamples++
    await sleep(150)
  }
  log('采样窗口内流式仍在进行（取证有效性前提）', streamingSamples > 0, `streaming=${streamingSamples}/12`)
  log('上滚后 1.8s 内未被程序滚底拽回（逐采样距底恒 >150px）', minDist > 150, `minDist=${minDist.toFixed(0)}px`)
  log('「回到底部」浮钮出现', sawBtn)
  await page.screenshot({ path: `${SHOTS}/def041-scroll-free.png` })

  // 点浮钮回底 → 恢复跟随
  if (sawBtn) {
    await page.click('.tb-btn')
    await sleep(500)
    const m2 = await metrics()
    log('点「回到底部」恢复跟随贴底', m2.dist < 150 && !m2.btn, `dist=${m2.dist.toFixed(0)}px`)
    await page.screenshot({ path: `${SHOTS}/def041-back-bottom.png` })
  }
} catch (e) {
  log('取证异常中断', false, String(e))
} finally {
  const fail = results.filter((r) => r.startsWith('FAIL')).length
  console.log(`\n=== def041-scroll：${results.length - fail} PASS / ${fail} FAIL ===`)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
