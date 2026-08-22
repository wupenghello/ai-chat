// 2026-08-23 样式走查：设置弹窗六项改动(CEO 直派)
// 1 section-label 无 border-top 2 控件缩小 3 消息块间距统一
// 4 账号分区改版 5 主题自动档 6 整页不可拖拽晃动
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SHOTS = '/tmp/style-walk-0823'
mkdirSync(`${SHOTS}`, { recursive: true })

const BASE = 'http://localhost:5199'
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`)
}

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
// 注册走查临时账号(已存在则登录;走查末尾经「注销账号」自清理)
await page.evaluate(async () => {
  const body = JSON.stringify({ username: 'walk-0823', password: 'Walk2026chat' })
  const reg = await fetch('/api/auth/register', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body })
  if (!reg.ok) await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body })
})
await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
await page.waitForSelector('.composer textarea', { timeout: 15000 })

// 打开设置弹窗:侧栏账户 ··· → 设置
await page.click('.dd-trigger')
await sleep(400)
const items = await page.$$eval('.dd-item', els => els.map((e, i) => ({ i, text: e.textContent.trim() })))
const setIdx = items.findIndex(x => x.text.includes('设置'))
if (setIdx < 0) throw new Error('未找到设置菜单项: ' + JSON.stringify(items))
await page.click(`.dd-item:nth-of-type(${setIdx + 1})`)
await sleep(500)

// ---- 检查 1:分区标题无 border-top + 无 20px padding-top(弹窗默认落「外观」) ----
const labelStyle = await page.evaluate(() => {
  const el = document.querySelector('.sm-pane .section-label')
  const cs = getComputedStyle(el)
  return { borderTopWidth: cs.borderTopWidth, paddingTop: cs.paddingTop, fontSize: cs.fontSize, marginBottom: cs.marginBottom }
})
ok('1a 分区标题无 border-top', labelStyle.borderTopWidth === '0px', JSON.stringify(labelStyle))
ok('1b 分区标题字号 14px', labelStyle.fontSize === '14px', labelStyle.fontSize)

// ---- 检查 5:外观分区三档 + 自动档行为 ----
const segBtns = await page.$$eval('.theme-seg .seg-btn', els => els.map(e => e.textContent.trim()))
ok('5a 外观三档(浅色/深色/自动)', JSON.stringify(segBtns) === JSON.stringify(['浅色', '深色', '自动']), JSON.stringify(segBtns))

// 系统浅色 → 自动解析浅色
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
await page.click('.theme-seg .seg-btn:nth-child(3)')
await sleep(300)
let dt = await page.evaluate(() => document.documentElement.dataset.theme)
ok('5b 自动档(系统浅色)→ data-theme=light', dt === 'light', dt)

// 系统切深色 → 实时跟随(不刷新页面)
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
await sleep(300)
dt = await page.evaluate(() => document.documentElement.dataset.theme)
ok('5c 自动档下系统切深色 → 实时 data-theme=dark', dt === 'dark', dt)
await page.screenshot({ path: `${SHOTS}/appearance-auto-dark.png` })

// 恢复浅色系统 + 显式深色不受系统影响
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
await sleep(200)
await page.click('.theme-seg .seg-btn:nth-child(2)') // 显式深色
await sleep(200)
dt = await page.evaluate(() => document.documentElement.dataset.theme)
ok('5d 显式深色不被系统(浅色)覆盖', dt === 'dark', dt)
// 收尾:回自动档(系统浅色)
await page.click('.theme-seg .seg-btn:nth-child(3)')
await sleep(200)

// ---- 检查 2:控件尺寸(输入框 13px/32px) ----
// 切到「高级设置」用档案编辑模态的输入框;或「对话设置」的系统提示词 textarea
await page.click('.sm-nav [role="tab"]:nth-of-type(4)') // 对话设置
await sleep(300)
const taStyle = await page.evaluate(() => {
  const el = document.querySelector('.prompt-ta')
  const cs = getComputedStyle(el)
  return { fontSize: cs.fontSize, padding: cs.padding }
})
ok('2a 系统提示词 textarea 13px', taStyle.fontSize === '13px', JSON.stringify(taStyle))
const btnStyle = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.sm-pane .btn')].find(b => b.offsetParent)
  const cs = getComputedStyle(el)
  return { fontSize: cs.fontSize, height: el.getBoundingClientRect().height }
})
ok('2b 按钮 32px 高/13px 字', btnStyle.height === 32 && btnStyle.fontSize === '13px', JSON.stringify(btnStyle))

// ---- 检查 4:账号分区改版 ----
await page.click('.sm-nav [role="tab"]:nth-of-type(7)') // 账号
await sleep(300)
const acct = await page.evaluate(() => ({
  hasAvatar: !!document.querySelector('.acct-avatar'),
  avatarText: document.querySelector('.acct-avatar')?.textContent.trim(),
  name: document.querySelector('.acct-name')?.textContent.trim(),
  hasPwdEntry: [...document.querySelectorAll('.as-title')].some(t => t.textContent.includes('修改密码')),
  pwdInputs: document.querySelectorAll('.pwd-form input[type="password"]').length,
  dangerTitleDanger: (() => {
    const d = document.querySelector('.acct-section.danger .as-title')
    return d ? getComputedStyle(d).color : null
  })(),
}))
ok('4a 账号身份卡(头像字+用户名)', acct.hasAvatar && acct.avatarText === 'W' && acct.name === 'walk-0823', JSON.stringify(acct))
ok('4b 改密收起态零输入框', acct.pwdInputs === 0, String(acct.pwdInputs))
await page.screenshot({ path: `${SHOTS}/account-collapsed.png` })
// 展开
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.acct-section .btn')].find(b => b.textContent.trim() === '修改')
  btn.click()
})
await sleep(300)
const pwdOpen = await page.evaluate(() => ({
  inputs: document.querySelectorAll('.pwd-form input[type="password"]').length,
  inputSize: (() => { const i = document.querySelector('.pwd-form input.input'); if (!i) return null; const cs = getComputedStyle(i); return { fontSize: cs.fontSize, height: i.getBoundingClientRect().height } })(),
  focusOnOld: document.activeElement?.autocomplete === 'current-password',
}))
ok('4c 「修改」展开三字段并聚焦旧密码', pwdOpen.inputs === 3 && pwdOpen.focusOnOld, JSON.stringify(pwdOpen))
ok('4d 改密输入框 13px/32px', pwdOpen.inputSize && pwdOpen.inputSize.fontSize === '13px' && pwdOpen.inputSize.height === 32, JSON.stringify(pwdOpen.inputSize))
await page.screenshot({ path: `${SHOTS}/account-expanded.png` })
// Esc 收起表单
await page.keyboard.press('Escape')
await sleep(300)
const afterEsc = await page.evaluate(() => ({
  modalOpen: !!document.querySelector('.settings-modal'),
  inputs: document.querySelectorAll('.pwd-form input').length,
}))
ok('4e Esc 先收起改密表单(弹窗仍在)', afterEsc.modalOpen && afterEsc.inputs === 0, JSON.stringify(afterEsc))
// 危险区按钮样式:透明底 + danger 文字
const dzBtn = await page.evaluate(() => {
  const b = document.querySelector('.dz-btn')
  const cs = getComputedStyle(b)
  return { bg: cs.backgroundColor, color: cs.color }
})
ok('4f 注销钮静默样式(danger 文字/透明底)', dzBtn.color !== 'rgb(31, 35, 41)' && dzBtn.bg === 'rgba(0, 0, 0, 0)', JSON.stringify(dzBtn))

// ---- 检查 3:消息块间距统一(全局样式面) ----
const mdSpacing = await page.evaluate(() => {
  const mk = (cls, parentCls) => {
    const parent = document.createElement('div')
    if (parentCls) parent.className = parentCls
    const el = document.createElement('div')
    el.className = cls
    parent.appendChild(el)
    document.body.appendChild(parent)
    const cs = getComputedStyle(el)
    const m = cs.marginTop + '/' + cs.marginBottom
    parent.remove()
    return m
  }
  return {
    code: mk('code-block'),
    // degrade-note 是 scoped(MessageBubble) — 以样式表文本核对
  }
})
ok('3a 代码块 margin 8px', mdSpacing.code === '8px/8px', mdSpacing.code)
const degradeMargin = await page.evaluate(() => {
  const sheet = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules] } catch { return [] } })
  // scoped 样式选择器带 data-v hash 后缀,按包含匹配
  const r = sheet.find(r => r.selectorText && r.selectorText.includes('.degrade-note'))
  return r ? r.style.margin : null
})
ok('3b 降级引导条 margin 8px 0', degradeMargin === '8px 0px' || degradeMargin === '8px 0', String(degradeMargin))

// ---- 检查 6:整页不可拖拽晃动 ----
const shell = await page.evaluate(() => {
  const html = getComputedStyle(document.documentElement)
  const body = getComputedStyle(document.body)
  return { htmlOverflow: html.overflow, bodyOverflow: body.overflow, bodyOverscroll: body.overscrollBehavior }
})
ok('6 html/body overflow hidden + overscroll none', shell.htmlOverflow.includes('hidden') && shell.bodyOverflow.includes('hidden') && shell.bodyOverscroll === 'none', JSON.stringify(shell))

// ---- 全弹窗分区块照 ----
const tabs = await page.$$eval('.sm-nav [role="tab"]', els => els.map((e, i) => ({ i, text: e.textContent.trim() })))
for (const t of tabs) {
  await page.click(`.sm-nav [role="tab"]:nth-of-type(${t.i + 1})`)
  await sleep(350)
  await page.screenshot({ path: `${SHOTS}/pane-${t.i}-${t.text}.png` })
}

// ---- 清理:注销走查账号(验证 DeleteAccountModal 链路) ----
await page.click('.sm-nav [role="tab"]:nth-of-type(7)')
await sleep(300)
await page.click('.dz-btn')
await sleep(400)
const delModal = await page.evaluate(() => !!document.querySelector('[aria-label="注销账号"], .del-modal, [role="alertdialog"]'))
ok('4g 注销二次确认模态弹出', delModal, String(delModal))
await page.screenshot({ path: `${SHOTS}/delete-modal.png` })
const pwdInput = await page.$('[role="alertdialog"] input, .modal input[type="password"]')
if (pwdInput) {
  await pwdInput.type('Walk2026chat')
  const confirmBtn = await page.evaluateHandle(() => {
    const dlg = document.querySelector('[role="alertdialog"]') || document.body
    return [...dlg.querySelectorAll('button')].find(b => /注销|删除|确认/.test(b.textContent))
  })
  await confirmBtn.asElement().click()
  await sleep(800)
}
const loggedOut = await page.evaluate(() => location.pathname.includes('login') || !!document.querySelector('.auth-page'))
ok('4h 注销成功回登录页(账号自清理)', loggedOut, String(loggedOut))

await browser.close()
const fails = results.filter(r => !r.pass)
console.log(`\n==== ${results.length - fails.length}/${results.length} PASS ====`)
if (fails.length) { console.log('FAIL 项:', JSON.stringify(fails, null, 2)); process.exit(1) }
