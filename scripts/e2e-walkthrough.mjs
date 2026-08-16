/* ai-chat 浏览器走查脚本（iter-8 复盘沉淀，制度 v1.4.6 配套项目级动作）
 *
 * 用途：testing.md §5「AI 用浏览器打开实现页面」的标准备选——开发预览环境不可用时
 * （如预览端口被并行会话占用），以 puppeteer-core 驱动本机 Chrome 对真实应用做
 * 全流程走查与断言（iter-8 实测 30/30，见 plans/iter-8-verify.md）。
 *
 * 前置：
 *   1. 后端：cd backend && AI_CHAT_DB_PATH=/tmp/walk.db uv run uvicorn app.main:app --port 8000
 *      （务必用临时库——脚本会注册用户/封禁/导入数据）
 *   2. 前端：npx vite --port 5180 --strictPort
 *   3. 依赖：npm i -D puppeteer-core（无浏览器下载，使用本机 Chrome）
 *   4. 运行：node scripts/e2e-walkthrough.mjs
 * 截图输出 /tmp/e2e8/shots/（目录常量可按需修改 BASE/SHOTS）。
 */
/* iter-8 浏览器观感走查（真实 Chrome，puppeteer-core 驱动）：
   覆盖 iter-8-verify.md「待浏览器复核」6 项 + 走查 29 封禁横幅实测。 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:5180'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = '/tmp/e2e8/shots'
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

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}
async function text() {
  return page.evaluate(() => document.body.innerText)
}

try {
  // ---- 1. 未登录访问 /admin → 跳登录（走查 3 浏览器实测）----
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' })
  await sleep(300)
  log('未登录 /admin → 登录页（redirect 或 expired 参数均可——见观察项：boot 期 401 钩子先于守卫落 expired=1）', page.url().includes('/login'), page.url())

  // ---- 2. 注册首个用户（管理员，走 API 保确定性；201=新建首管理员，409=已存在则登录）----
  const regAdmin = await page.evaluate(async () => {
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '猫南北', password: 'password123' }),
      credentials: 'same-origin',
    })
    const body = await r.json().catch(() => ({}))
    return { status: r.status, isAdmin: body.is_admin }
  })
  log('首注册用户为管理员（API，201=新建/409=已存在）', (regAdmin.status === 201 && regAdmin.isAdmin === true) || regAdmin.status === 409, JSON.stringify(regAdmin))
  await page.evaluate(async () => {
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '猫南北', password: 'password123' }),
      credentials: 'same-origin',
    })
  })
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await sleep(800)
  const onMain = await page.evaluate(() => !!document.querySelector('.sidebar, aside'))
  log('管理员登录进主界面', onMain, page.url())

  // ---- 3. 管理员侧栏盾牌入口（走查 1）----
  const adminBtn = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="管理后台"]')
    return b ? { title: b.title, order: !!b } : null
  })
  log('管理员盾牌入口存在（title=管理后台（仅管理员可见））', !!adminBtn && adminBtn.title.includes('仅管理员可见'))

  await shot('01-admin-sidebar-shield')

  // ---- 4. 进入管理后台：六列 + 全站条 + 管理员行禁用（走查 5/6/7/9）----
  await page.evaluate(() => document.querySelector('button[aria-label="管理后台"]').click())
  await sleep(800)
  const ths = await page.evaluate(() => [...document.querySelectorAll('thead th')].map((t) => t.textContent.trim()))
  log(
    '后台六列',
    JSON.stringify(ths) === JSON.stringify(['用户名', '注册时间', '状态', '密钥模式', '配额', '操作']),
    JSON.stringify(ths),
  )
  const siteBar = await page.evaluate(() => document.querySelector('.site-bar')?.textContent ?? '')
  log('全站条常态文案', siteBar.includes('统一 key 每日总量 2,000') && siteBar.includes('今日已用 0'), siteBar.slice(0, 60))
  const banDisabled = await page.evaluate(() => {
    const b = document.querySelector('button.mini.danger')
    return b ? { disabled: b.disabled, title: b.title } : null
  })
  log('管理员行封禁禁用 + title', !!banDisabled && banDisabled.disabled && banDisabled.title === '管理员本人不可封禁')

  await shot('02-admin-light')

  // ---- 5. 暗色：后台整页亮色残留扫描（走查 42 浏览器口径 = 找亮色残留）----
  await page.evaluate(() => {
    document.querySelector('button[aria-label="切换主题"]')?.click()
  })
  await sleep(400)
  const residue = await page.evaluate(() => {
    if (document.documentElement.dataset.theme !== 'dark') return ['主题未切换']
    const bad = []
    for (const el of document.querySelectorAll('.admin-page *')) {
      const cs = getComputedStyle(el)
      const m = cs.backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      if (m && +m[1] > 200 && +m[2] > 200 && +m[3] > 200) bad.push(`${el.tagName}.${el.className?.toString().slice(0, 30)} bg=${cs.backgroundColor}`)
    }
    return bad.slice(0, 8)
  })
  log('后台暗色无亮色残留（扫描 .admin-page 全元素）', residue.length === 0, residue.join(' | '))
  const darkSurface = await page.evaluate(() => getComputedStyle(document.querySelector('.adm-table')).backgroundColor)
  log('暗色表格底 = surface 令牌', darkSurface === 'rgb(30, 32, 38)', darkSurface)

  await shot('03-admin-dark')

  // 回浅色，注册长名用户做 ellipsis（走查 22）
  await page.evaluate(() => document.querySelector('button[aria-label="切换主题"]')?.click())
  await sleep(300)
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
  await sleep(300)
  const longName = '一'.repeat(32) // 32 字符中文用户名（规则上限）
  const reg = await page.evaluate(async (name) => {
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name, password: 'password123' }),
      credentials: 'same-origin',
    })
    return r.status
  }, longName)
  log('32 字符用户名注册（201=新建/409=已存在/429=限频实测均可）', reg === 201 || reg === 409 || reg === 429, `${reg}${reg === 429 ? '（REQ-024 注册限频真实浏览器触发）' : ''}`)
  // 关键：register 会顶掉 cookie——必须重登管理员并刷新页面，否则后续 /admin 请求 403
  await page.evaluate(async () => {
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '猫南北', password: 'password123' }),
      credentials: 'same-origin',
    })
  })
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await sleep(800)
  await page.evaluate(() => document.querySelector('button[aria-label="管理后台"]').click())
  await sleep(800)
  const ellipsis = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.uname')].find((u) => u.textContent.length > 10)
    if (!el) return null
    const cs = getComputedStyle(el)
    return { text: cs.textOverflow, maxW: cs.maxWidth, ow: el.offsetWidth, sw: el.scrollWidth, title: el.title }
  })
  log(
    '超长用户名 ellipsis + title',
    !!ellipsis && ellipsis.text === 'ellipsis' && ellipsis.maxW === '150px' && ellipsis.ow < ellipsis.sw && ellipsis.title.length === 32,
    JSON.stringify(ellipsis),
  )
  await shot('04-longname-ellipsis')

  // 封禁 + 解封真实操作（走查 14/16 视觉）
  const banBtnExists = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button.mini.danger')].filter((b) => !b.disabled)
    if (!btns.length) return false
    btns[0].click()
    return true
  })
  await sleep(300)
  const modalText = await text()
  log('封禁确认模态（后果与可逆文案）', banBtnExists && modalText.includes('封禁该用户？') && modalText.includes('云端数据保留'))
  await shot('05-ban-modal')
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '确认封禁')?.click()
  })
  await sleep(800)
  const bannedPill = await page.evaluate(() => document.body.innerText.includes('已封禁') && !!document.querySelector('.pill.banned'))
  log('封禁生效：状态胶囊翻已封禁', bannedPill)
  const unbanOk = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button.mini')].find((x) => x.textContent.trim() === '解封')
    if (!b) return false
    b.click()
    return true
  })
  let unbanned = false
  for (let i = 0; i < 8 && !unbanned; i++) {
    await sleep(400)
    unbanned = await page.evaluate(() => !document.body.innerText.includes('已封禁'))
  }
  log('解封直接生效（无确认）', unbanOk && unbanned)

  // 调配额模态（走查 17 视觉）
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button.mini')].find((x) => x.textContent.trim() === '调配额')?.click()
  })
  await sleep(300)
  const qModal = await text()
  log('调配额模态（默认档/自定义）', qModal.includes('调整配额') && qModal.includes('按默认档位') && qModal.includes('自定义每日'))
  await shot('06-quota-modal')
  await page.keyboard.press('Escape')
  await sleep(200)

  // ---- 6. 普通用户视角：无盾牌 + 403 卡（走查 2/4）----
  await page.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
  })
  await sleep(300)
  const reg2 = await page.evaluate(async () => {
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'spam-bot-2026', password: 'password123' }),
      credentials: 'same-origin',
    })
    return r.status
  })
  log('普通用户注册（201/409/429 均可，429=限频实测）', reg2 === 201 || reg2 === 409 || reg2 === 429, String(reg2))
  // 必须显式登录为 spam（register 429/409 时不会种会话）
  await page.evaluate(async () => {
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'spam-bot-2026', password: 'password123' }),
      credentials: 'same-origin',
    })
  })
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await sleep(1200)
  const normalUser = await page.evaluate(() => !!document.querySelector('.sidebar, aside'))
  log('普通用户登录进主界面', normalUser, page.url())
  const noShield = await page.evaluate(() => !document.querySelector('button[aria-label="管理后台"]'))
  log('普通用户 DOM 无盾牌入口', noShield)
  await shot('07-normal-user-sidebar')
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' })
  await sleep(500)
  const t403 = await text()
  log('普通用户 /admin → 403 卡', t403.includes('无权访问（403）') && t403.includes('不会展示任何后台数据'))
  await shot('08-admin-403')

  // ---- 7. 存量迁移：种子数据 → 双条堆叠 → 导入 → 本地清除（走查 30/33/35/37/38/40 + REQ-014 浏览器全量口径）----
  // 登出，种入旧 localStorage 档案 + 旧 IndexedDB 会话，再以管理员登录触发检测
  await page.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
  })
  await sleep(300)
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => {
    localStorage.setItem(
      'ai-chat:settings',
      JSON.stringify({
        systemPrompt: '保留我',
        profiles: [
          { id: 'p1', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: 'sk-legacy-key-alpha' },
          { id: 'p2', name: 'GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4', apiKey: 'sk-legacy-key-beta' },
        ],
        activeProfileId: 'p1',
      }),
    )
    // 旧 IndexedDB 会话 ×3
    return new Promise((resolve) => {
      const req = indexedDB.open('ai-chat', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('sessions', { keyPath: 'id' })
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('sessions', 'readwrite')
        const store = tx.objectStore('sessions')
        for (let i = 1; i <= 3; i++) {
          store.put({
            id: `legacy-${i}`,
            title: `旧版本地会话${i}`,
            createdAt: 1755000000000 + i,
            updatedAt: 1755000001000 + i,
            messages: [{ id: `m${i}`, role: 'user', content: `旧消息${i}`, status: 'done' }],
          })
        }
        tx.oncomplete = () => resolve(true)
      }
      req.onerror = () => resolve(false)
    })
  })
  // 管理员登录（API 种 cookie）→ 重新进入触发 App 挂载检测 → 双条
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
  await sleep(300)
  await page.evaluate(async () => {
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '猫南北', password: 'password123' }),
      credentials: 'same-origin',
    })
  })
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await sleep(1500)
  const migText = await text()
  const banners = await page.evaluate(() => document.querySelectorAll('.mig-banner').length)
  log('迁移双条堆叠（会话条+档案条）', banners === 2, `banners=${banners}`)
  log('会话条文案（新增不覆盖/只读30天）', migText.includes('3 个本地会话') && migText.includes('不覆盖云端已有会话') && migText.includes('30 天后自动清除'))
  log('档案条三要点（未经确认不上传）', migText.includes('2 套供应商档案') && migText.includes('未经你的确认不会上传') && migText.includes('不覆盖云端已有档案'))
  await shot('09-migration-banners-stacked')

  // 档案导入 → 完成 → 本地清除 + key 检索不到（REQ-014 浏览器全量口径销账）
  await page.evaluate(() => {
    const zones = [...document.querySelectorAll('.mig-banner')]
    const profileBanner = zones.find((z) => z.textContent.includes('供应商档案'))
    ;[...profileBanner.querySelectorAll('button')].find((b) => b.textContent.trim() === '导入到云端')?.click()
  })
  await sleep(1500)
  const afterProfile = await text()
  log('档案导入完成态（本地不再保存说明）', afterProfile.includes('已导入 2 套供应商档案') && afterProfile.includes('本地已不再保存任何档案与密钥数据'))
  const keyScan = await page.evaluate(() => {
    const ls = JSON.stringify(localStorage)
    return { lsHasLegacyKey: ls.includes('sk-legacy-key'), systemPromptKept: JSON.parse(localStorage.getItem('ai-chat:settings') ?? '{}').systemPrompt === '保留我' }
  })
  log('REQ-014 浏览器全量口径：localStorage 无 key（systemPrompt 保留）', !keyScan.lsHasLegacyKey && keyScan.systemPromptKept, JSON.stringify(keyScan))
  await shot('10-profile-import-done')

  // 会话导入 → 完成 → 云端可见
  await page.evaluate(() => {
    const zones = [...document.querySelectorAll('.mig-banner')]
    const s = zones.find((z) => z.textContent.includes('本地会话'))
    ;[...s.querySelectorAll('button')].find((b) => b.textContent.trim() === '导入到云端')?.click()
  })
  await sleep(2000)
  const afterSessions = await text()
  log('会话导入完成态（只读备份说明）', afterSessions.includes('已导入 3 个会话') && afterSessions.includes('只读备份'))
  const cloudSessions = await page.evaluate(async () => {
    const r = await fetch('/api/sessions', { credentials: 'same-origin' })
    const list = await r.json()
    return list.filter((s) => s.id.startsWith('legacy-')).length
  })
  log('云端可见 3 个导入会话', cloudSessions === 3, String(cloudSessions))
  const idbStillThere = await page.evaluate(() =>
    new Promise((resolve) => {
      const req = indexedDB.open('ai-chat', 1)
      req.onsuccess = () => {
        const tx = req.result.transaction('sessions', 'readonly')
        const rq = tx.objectStore('sessions').getAll()
        rq.onsuccess = () => resolve(rq.result.length)
      }
      req.onerror = () => resolve(-1)
    }),
  )
  log('本地 IndexedDB 保留只读备份（3 条未清）', idbStillThere === 3, String(idbStillThere))
  const purgeKey = await page.evaluate(() => localStorage.getItem('ai-chat:idb-purge-at'))
  log('30 天清除键已设', !!purgeKey && Number(purgeKey) > Date.now(), purgeKey ?? '')
  await shot('11-sessions-import-done')
  await page.evaluate(() => {
    localStorage.setItem('ai-chat-theme', 'dark')
    location.reload()
  })
  await sleep(1500)
  const darkMig = await page.evaluate(() => document.documentElement.dataset.theme)
  await shot('12-main-dark-after-migration')
  log('主界面暗色（应用自身机制：localStorage → reload → data-theme）', darkMig === 'dark', darkMig)
  await page.evaluate(() => {
    localStorage.setItem('ai-chat-theme', 'light')
    location.reload()
  })
  await sleep(1200)

  // ---- 8. 在线被封禁：封禁 spam-bot → 其会话被踢出 → 登录横幅（走查 29 浏览器实测）----
  // 管理员封禁 spam-bot
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' })
  await sleep(800)
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')]
    const row = rows.find((r) => r.textContent.includes('spam-bot'))
    ;[...row.querySelectorAll('button.mini.danger')].filter((b) => !b.disabled)[0]?.click()
  })
  await sleep(300)
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '确认封禁')?.click()
  })
  await sleep(800)
  // 登出 → 被封禁用户登录 → warning 横幅
  await page.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
  })
  await sleep(300)
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
  await sleep(300)
  await page.type('input[name="username"]', 'spam-bot-2026')
  await page.type('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await sleep(1200)
  const banLogin = await text()
  log('被封禁用户登录 → warning 横幅（iter-6 定稿文案）', banLogin.includes('账号已被封禁'), banLogin.includes('无法使用') ? '' : '文案缺「无法使用」')
  await shot('13-banned-login-banner')
} finally {
  await browser.close()
  console.log('\n===== 走查结果汇总 =====')
  console.log(results.join('\n'))
  const fails = results.filter((r) => r.startsWith('FAIL')).length
  console.log(`\n${results.length - fails}/${results.length} PASS`)
}
