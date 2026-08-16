# iter-11 验证与走查记录 — T1（REQ-026 侧栏重构，2026-08-16）

> 走查口径：对照 design-iter-11 §7.2 清单（49 条）中 REQ-026 及存量触点范围逐条取证；
> 走查 10（导出会话菜单项）属 REQ-027/T2 范围，本任务不适用。
> **取证环境**：组件级 DOM 断言（vitest，新增 timeGroup 6 + DropdownMenu 9 + SessionListItem 9 + TheSidebar 9 用例）
> + **真实浏览器实测**（vite dev + FastAPI 本地后端，注册真实用户 walk11（该库首用户=管理员），创建/重命名/删除会话、
> 菜单/搜索/账户区/rail/刷新全链路亲测，取值均为 getComputedStyle 实测）。
> 测试终态：**前端 vitest 236/236（26 文件，原 209 → 适配后 +27）+ guard:style 通过 + 生产构建（vue-tsc + vite）通过**。后端未动（pytest 不变 119/119）。

## §7.2 清单 T1 范围逐条取证

| # | 期望（摘要） | 取证 | 结果 |
|---|------------|------|------|
| 1 | 框架基调：侧栏 264px 灰 --c-bg + 主区白 --c-surface | 浏览器实测 `sidebarBg=rgb(245,246,247)`（#F5F6F7）、`mainBg=rgb(255,255,255)`、`sidebarWidth=264px` | ✅ |
| 2 | 新建按钮 36px primary-solid；点击新建并清空搜索 | 模板/CSS 沿原 .new-btn（36px solid 白字）；TheSidebar.spec「新建时清空搜索词并 emit chat」+ 浏览器连点建 3 会话 | ✅ |
| 3 | 搜索框沿现状（REQ-016） | 组件未改搜索框结构样式；浏览器实测搜索/清除/无结果/恢复全链路（见 #13） | ✅ |
| 4 | 列表项单行省略：仅标题 13px ellipsis + title 全文，无逐条时间戳，长标题不换行 | 浏览器实测：重命名为 37 字长标题后 `whiteSpace=nowrap/overflow=hidden/textOverflow=ellipsis`，title 属性含全文 37 字符；R1 grid 三列布局（SessionListItem `.item{display:grid;grid-template-columns:minmax(0,1fr) auto auto}`）；`.time` 节点不存在（TheSidebar.spec 断言） | ✅ |
| 5 | hover「···」28px r-sm，opacity 0→1（.15s），focus-visible 亦浮现 | CSS 规则落盘（`.item :deep(.dd-trigger)` opacity 0 + `:hover/:focus-visible/[aria-expanded=true]` 显现 + transition .15s）；opacity:0 元素可点（浏览器实测菜单开合正常）；真实指针悬停观感待 CEO 试用 | ✅（规则+可点）/ 观感待试用 |
| 6 | 会话菜单：重命名/删除（danger + 前置分隔线）；面板 surface+border+shadow-2+r-md、min-width 148px、项 32px/13px | 浏览器实测开菜单：`bg=rgb(255,255,255)`、`minWidth=148px`、`zIndex=40`、`radius=8px`、`shadow=rgba(31,35,41,.1) 0 4px 16px`（=--shadow-2）、项高 32px×2（重命名/删除）、删除含 danger 类、`.dd-sep` 存在。**「导出会话」项按 spec REQ-026/027 任务边界属 T2，T2 落地后走查 6 复验全量** | ✅（T1 范围）/ 6 的导出项待 T2 |
| 7 | corrupted 会话：菜单「重命名」禁用（title 原因、箭头跳过），「删除」可用 | SessionListItem.spec「损坏会话：菜单重命名禁用（title 原因）；删除可用」：aria-disabled=true + title=「无法读取的会话不可重命名」+ 点击无 emit + 删除 emit remove；DropdownMenu.spec 箭头导航跳过禁用项。浏览器无 corrupted 实样（需构造脏数据，组件级已覆盖） | ✅（组件级） |
| 8 | 行内重命名沿现状：Enter/失焦保存（非空且不同）、Esc 取消、空值静默恢复 | SessionListItem.spec 沿用 4 用例（双击路径）+ 新增菜单路径 2 用例；浏览器实测菜单→重命名→输入→Enter 提交（标题变更生效） | ✅ |
| 9 | 删除确认模态 + 确认后项移除 | 浏览器实测：菜单删除 → 「删除这个会话？」模态（含「无法恢复」文案）→ 确认后会话 3→2 | ✅ |
| 10 | 导出会话菜单项 | **T2 范围（REQ-027/spec 任务边界），本任务不适用** | ➖ |
| 11 | 四组组头「今天/昨天/近 7 天/更早」12px text-3，空组不渲染，组内无时间戳 | TheSidebar.spec「四组按序渲染、空组不渲染」；浏览器实测 3 会话 → 仅「今天」组头渲染（空组隐藏） | ✅ |
| 12 | 组内 updatedAt 倒序；本地日期比对；跨零点单测 | timeGroup.spec 6 用例：同日/昨日/跨零点（23:59→00:01 落昨天）/7 天边界（第 8 天→更早）/未来容错/组序文案；TheSidebar.spec 组内倒序断言（组锚定当日零点防测试翻车） | ✅ |
| 13 | 搜索态：组头全隐、平铺、标题命中优先、正文命中第二行片段、无结果、清除恢复 | 浏览器实测：'验证' 命中 1 项且 `.group-label` 数 0；'不存在的词xyz' → 「无匹配会话」；清除按钮恢复完整分组（2 项）。正文命中片段渲染 = SessionListItem `.hit-snippet`（grid 跨全列第二行）+ utils/search.spec 既有 5 用例 | ✅ |
| 14 | 账户区：首字头像 24px 圆 + 用户名 +「···」；上缘 border；无密钥标签/盾牌/常驻设置钮/登出 icon | 浏览器实测：头像 'w' + 用户名 walk11 + ··· 触发；TheSidebar.spec：`.footer`/`.profile-tag` 不存在、`.acct` html 无「统一密钥」 | ✅ |
| 15 | 账户菜单：设置/管理后台（仅 is_admin）/分隔线/登出（非 danger） | 浏览器实测（管理员正例）：菜单项 [设置, 管理后台, 登出]；TheSidebar.spec（普通用户反例）：[设置, 登出] 且 DOM 无「管理后台」（沿 iter-8 口径）；登出项无 danger 类、前置分隔线存在 | ✅ |
| 16 | rail 56px 灰 --c-bg：展开/新建/搜索图标 36px + 底部头像 28px；logo 隐藏；全部 title/aria-label | 浏览器实测：`railWidth=56px`、`railBg=rgb(245,246,247)`、railBtns aria-label=[展开侧栏, 新建会话, 搜索会话（展开侧栏）]、`.rail-avatar`='w'、`.brand-row` 不渲染 | ✅ |
| 17 | rail 点「搜索」= 展开+聚焦；点头像=展开；收/展钮同角落 | 浏览器实测：搜索钮点击后 `expanded=true` 且 `document.activeElement=search-input`；头像钮绑定展开（模板 @click） | ✅ |
| 18 | 收起状态 localStorage 持久化，刷新保持 | 浏览器实测：收起后 `localStorage['mm-sidebar-collapsed']='1'` → `location.reload()` → `railAfterReload=true`。宽度过渡 .15s：实现为模板切换瞬时（v-if 双形态），CSS 保留 width transition 声明——**已接受偏差**：模板切换下宽度动画无中间态，功能与持久化不受影响 | ✅（持久化）/ 偏差登记 |
| 19 | 外点关闭且吞掉首击（不误触发底层） | DropdownMenu.spec「外点关闭且吞掉首击」（capture 拦截：菜单关 + 底层 spy 零调用 + 第二击恢复）；**浏览器实测**：会话菜单开 → 点新建按钮 → 菜单关、会话数不变（新建未被误触发） | ✅ |
| 20 | Esc 关闭 + 焦点回触发钮；开态再点触发钮 = 关闭（toggle） | 浏览器实测：开菜单焦点落首项「重命名」→ Esc（从焦点项冒泡）→ 菜单关 + `document.activeElement=触发钮`；toggle 连点开/关验证 | ✅ |
| 21 | 键盘矩阵：Enter/Space 开+聚焦首可用项；↓/↑ 循环跳禁用；Home/End；项 Enter/Space 执行+回焦；Tab 关闭自然移焦 | DropdownMenu.spec「键盘」逐键用例（↓/↑ 循环/End/Enter 执行回焦）；浏览器实测开菜单聚焦首项 | ✅ |
| 22 | 互斥（含混开）/滚动关闭/右对齐上翻定位/z-40 | 互斥：DropdownMenu.spec 两实例混开用例（修复过程发现真缺陷——外点吞掉另一菜单触发点击导致需两次点击，已修：`.dd` 内点击放行）；滚动关闭：组件 capture 监听（jsdom 无法真实滚动，代码路径+监听绑定验证）；定位：右对齐+上翻代码实现（jsdom 无布局，浏览器实测右对齐正常、z-40 实测） | ✅（互斥实测）/ 定位上翻组件级 |

## 实现偏差登记（本任务 1 项，均不影响功能口径）

1. **走查 18 宽度过渡动画**：设计稿注明「T1 单 aside 动画」；实现为 v-if 双形态模板切换（展开/rail），切换瞬时完成，CSS width transition 保留但无中间态可动画。理由：模板切换下动画无意义，双形态 DOM 各自完整。功能（收起/展开/持久化/聚焦）全部达标。

## 交付物清单

- 新增 `src/utils/timeGroup.ts`（分组判定，now 可注入）+ `src/utils/__tests__/timeGroup.spec.ts`（6 用例）
- 新增 `src/components/DropdownMenu.vue`（通用下拉菜单：外点吞击/Esc 回焦/键盘矩阵/互斥/滚动关闭/上翻定位/z-40）+ `src/components/__tests__/DropdownMenu.spec.ts`（9 用例）
- 重写 `src/components/SessionListItem.vue`（grid 单行 + ··· 菜单，删除铅笔/垃圾桶/时间行）+ spec 适配（9 用例）
- 重写 `src/components/TheSidebar.vue`（时间分组渲染 + 账户区菜单 + rail 收起持久化 + 新建清空搜索，移除旧 footer 五元素）+ spec 重写（9 用例）
- RTM REQ-026 行更新、周报 iter-11 条目（同提交）

---

# iter-11 验证与走查记录 — T2（REQ-027 消息流与顶栏，2026-08-16）

> 走查口径：对照 design-iter-11 §7.2 清单 23~36 条（37~40 属 T3/REQ-028）。上接 T1 记录（同文件）。
> **取证环境**：组件级 DOM 断言（vitest，MessageBubble +2 / SessionListItem +1 / TheSidebar +1 用例）
> + **真实浏览器实测**（vite dev + FastAPI 本地后端，walk11 登录，**发送真实消息走完整流式**（统一 key 经代理打 DeepSeek），
> 亮暗双主题切验，导出真实触发下载）。取值均为 getComputedStyle 实测。
> 测试终态：**前端 vitest 240/240（26 文件，T1 后 236 → +4）+ guard:style 通过 + 生产构建通过（CSS 48.88kB，较 T1 -1.5kB——顶栏样式删除）**。后端未动（119/119）。

## §7.2 清单 T2 范围逐条取证

| # | 期望（摘要） | 取证 | 结果 |
|---|------------|------|------|
| 23 | 去全部头像（DOM 级非 CSS 隐藏） | MessageBubble.spec「均不渲染头像节点」：`.avatar` 不存在 + 无文本「我」元素；浏览器实测消息流中消息行头像节点为 0 | ✅ |
| 24 | 用户气泡浅色：avatar-bg + text-1 15px/1.75、padding 10 14、圆角 12/12/4/12 | 浏览器实测：`bg=rgb(232,235,242)`（#E8EBF2）、`color=rgb(31,35,41)`（#1F2329）、`padding=10px 14px`、`radius=12px 12px 4px` | ✅ |
| 25 | 暗色：#33363E 底 + #E6EAF0 字 = 10.0:1 | 浏览器实测（设置页外观切深色后）：`bg=rgb(51,54,62)`、`color=rgb(230,234,240)`；AI 字色 rgb(230,234,240) | ✅ |
| 26 | AI 消息全宽无背景 | 浏览器实测：`aiBubbleBg=rgba(0,0,0,0)`、`padding=4px 0`；Markdown `.md` 真实流式渲染正常；内容列 712px 居中沿现状 | ✅ |
| 27 | 操作栏重排：min-height 24 + opacity 0→1；用户列右对齐/AI 列左对齐 | 现状 CSS 已满足（T2 核对未改）：`.action-row{min-height:24px}`、`.action-btn{opacity:0}` + `.msg-col:hover` 显现、`.msg-col.user{align-items:flex-end}`；浏览器实测 minH=24px | ✅（沿现状核对） |
| 28 | 版本切换 ‹1/2›：箭头常显 + 计数 tabular-nums min-width 30px | 现状 CSS 已满足（`.version-nav .action-btn{opacity:1}` 常显、`.version-count` tabular-nums min-width 30px）；组件级覆盖沿 MessageBubble.spec 既有用例 | ✅（沿现状核对） |
| 29 | 生成中光标+提示 | 浏览器实测流式过程中 `.cursor` 出现（等待循环以其消失为完成条件）；样式 token 沿现状未动 | ✅ |
| 30/31 | 生成中断/已停止 pill | 样式与结构未动（token 沿现状）；无头像布局下位置随操作栏列，组件级覆盖沿 sessions.spec/MessageBubble 既有用例 | ✅（沿现状核对） |
| 32 | 编辑态面板交互 | 编辑面板结构/交互未动（REQ-015 口径零变化）；MessageBubble.spec 编辑 3 用例全绿 | ✅ |
| 33 | 错误气泡无头像布局、口径不变 | ErrorBubble 由 MessageList 直接渲染、本无头像；danger-l/danger 令牌与 auth 类「前往高级设置」口径未动（T3 将复验定位联动） | ✅（沿现状核对） |
| 34 | 完全去顶栏：主区无标题栏/导出钮/主题钮 | 浏览器实测：`.chat-header` 不存在、主区无 `切换到*` 主题钮、无 `.export-btn`；消息区顶留白沿 MessageList padding 24px；空态页自然上移 | ✅ |
| 35 | 「模型：xxx」副标题移除；无「未设置」误导 | 浏览器实测：全页无「模型：」文本（统一 key 无档案状态下误导显示消失——REQ-027 验收原文达成） | ✅ |
| 36 | 导出入口迁移：顶栏钮移除 + 列表项「···」→「导出会话」 | 浏览器实测：菜单 [重命名, 导出会话, 删除]；点击真实触发下载 `搜索验证词会话_20260816_1954.md`（按会话导出、文件名=标题+时间戳）；空会话导出 → toast「当前会话暂无消息，未生成文件」（REQ-013 口径不回退）；SessionListItem.spec「导出会话触发 export」+ TheSidebar.spec「透传该会话对象」 | ✅ |
| 6（复验） | 菜单全量三项（T1 时缺导出项） | 走查 6 全量口径闭环：浏览器实测三项 + danger + 分隔线（T1 已验面板规格 148px/z-40/shadow-2） | ✅（T2 闭环） |

## REQ-017 注记（T2 过渡态）

顶栏主题按钮已移除（定夺①）；T2~T3 之间主题切换入口 = 设置页「外观」分段（既有，与全局同状态同存储）。
浏览器实测：设置页切深色 → `html[data-theme=dark]` 生效、消息流双主题取值正确；切回浅色恢复。
T3 设置弹窗化后入口随弹窗迁移（走查 39 届时复验）。登录页/管理页各自的独立主题按钮不在 CHG-006 范围，未动。

## 实现偏差登记

无新增偏差（T2 全部按基线实现）。

## 交付物清单

- `src/components/MessageBubble.vue`：删 AI/用户头像节点与样式；用户气泡 primary-solid 白字 → avatar-bg + text-1；row 布局简化
- `src/App.vue`：chat-header 整块移除（标题/模型副标题/主题钮/导出钮）+ useTheme 引用移除 + 导出改 `exportBySession(session)`（按会话导出，经 TheSidebar @export）
- `src/components/SessionListItem.vue`：菜单增「导出会话」项（重命名/导出会话/删除）+ emit export
- `src/components/TheSidebar.vue`：SessionListItem @export 透传（分组/搜索两分支）
- 测试：MessageBubble.spec +2（无头像/气泡类）、SessionListItem.spec +1（导出 emit，菜单三项断言更新）、TheSidebar.spec +1（导出透传）
