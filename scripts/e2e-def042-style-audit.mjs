import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SHOTS = '/tmp/style-audit'
mkdirSync(`${SHOTS}/shots`, { recursive: true })
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport: { width: 1440, height: 900 } })
const page = await browser.newPage()
await page.goto('http://localhost:5174/login', { waitUntil: 'networkidle0' })
await page.evaluate(async () => {
  const reg = await fetch('/api/auth/register', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'style-audit', password: 'Walkthrough2026' }) })
  if (!reg.ok) await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'style-audit', password: 'Walkthrough2026' }) })
})
await page.goto('http://localhost:5174/', { waitUntil: 'networkidle0' })
await page.waitForSelector('.composer textarea', { timeout: 15000 })
// 侧栏账户「···」（dd-trigger）→ 设置菜单项
const triggers = await page.$$eval('.sidebar .dd-trigger, .dd-trigger', els => els.map((e, i) => ({ i, text: e.textContent.trim() })))
console.log('dd-triggers:', JSON.stringify(triggers))
await page.click('.dd-trigger') // 侧栏仅账户一处 dd？先点第一个再核对菜单
await sleep(500)
const items = await page.$$eval('.dd-item', els => els.map((e, i) => ({ i, text: e.textContent.trim() })))
console.log('菜单项:', JSON.stringify(items))
const target = items.findIndex(x => x.text.includes('设置'))
if (target >= 0) await page.click(`.dd-item:nth-of-type(${target + 1})`)
await sleep(600)
await page.screenshot({ path: `${SHOTS}/shots/00-modal-open.png` })
const tabs = await page.$$eval('.sm-nav [role="tab"]', els => els.map((e, i) => ({ i, text: e.textContent.trim() })))
console.log('分区:', JSON.stringify(tabs))
for (const t of tabs) {
  await page.click(`.sm-nav [role="tab"]:nth-of-type(${t.i + 1})`)
  await sleep(400)
  const file = `pane-${t.i}-${t.text}.png`
  await page.screenshot({ path: `${SHOTS}/shots/${file}` })
  const hist = await page.evaluate(() => {
    const counts = {}
    const samples = []
    document.querySelectorAll('.sm-body *').forEach(el => {
      if (!el.offsetParent) return
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
      if (!own) return
      const cs = getComputedStyle(el)
      const key = `${cs.fontSize}/${cs.fontWeight}`
      counts[key] = (counts[key] || 0) + 1
      if (samples.length < 30) samples.push(`${(el.className?.toString() || el.tagName).slice(0, 28)}→${cs.fontSize}/${cs.fontWeight}「${el.textContent.trim().slice(0, 8)}」`)
    })
    return { counts, samples }
  })
  console.log(`\n=== 分区 ${t.i}「${t.text}」 ===`)
  console.log('分布:', JSON.stringify(hist.counts))
  console.log('样件:', hist.samples.join('  ').slice(0, 1200))
}
await browser.close()
