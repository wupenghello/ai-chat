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

---

# iter-11 验证与走查记录 — T3（REQ-028 设置弹窗化，2026-08-16）

> 走查口径：对照 design-iter-11 §7.2 清单 37~40 + 定夺⑤⑥落形 + 「前往高级设置」定位联动（§4.3）。
> **取证环境**：组件级 DOM 断言（settings-form.spec 新增 7 用例：弹窗结构/分区切换/方向键/locateAdv 直达/未保存拦截×2/Esc）
> + **真实浏览器实测**（账户菜单开弹窗全链：分区导航、模式卡跨分区跳转、未保存拦截双路径、三关闭方式、焦点回落、外观全局联动、1280px 视口下 720px 规格值）。
> 测试终态：**前端 vitest 247/247（26 文件，T2 后 240 → +7）+ guard:style 通过 + 生产构建通过**。后端未动（119/119）。

## §7.2 清单 T3 范围逐条取证

| # | 期望（摘要） | 取证 | 结果 |
|---|------------|------|------|
| 37 | 打开/尺寸/分区 | 浏览器实测：账户「···」→设置 → 弹窗打开、焦点落关闭钮；1280px 视口 `modalW=720px`（677px 窄视口收缩 645px = max-width calc(100vw-32px) 防溢出口径，符合规格）；五分区 [外观/密钥模式/高级设置/对话设置/账号] 一次只显示一个；导航点击与 ↑↓ 方向键切换实测（账号→ArrowUp→对话设置）；切分区不丢表单状态（浏览器：草稿跨分区保留 + 组件用例）；遮罩 z-100、nav 168px 实测 | ✅ |
| 38 | 五分区完整、只改容器不改逻辑 | settings-form.spec 全量 **24 用例弹窗容器下全绿**（既有 17 档案/改密/注销用例零改动通过 + 新增 7）；字段与整页版一致（v-show 分区保持 DOM，4.1 对照表口径不变） | ✅ |
| 39 | 外观分段同步联动 | 浏览器实测：弹窗「外观」切深色 → `html[data-theme=dark]` 全局生效、消息流双主题随动（T2 取值复验）；切回浅色恢复。REQ-017 顶栏按钮条款已按 §8-① 改写：T2 移除顶栏钮 + T3 弹窗外观区承载，闭环 | ✅ |
| 40 | 关闭三方式 + 焦点回触发入口 | 浏览器实测：Esc（弹窗 keydown）✓ / 遮罩点击（干净状态直接关）✓ / 关闭钮 ✓；关闭后焦点回账户触发钮（aria-label=账户操作）实测——含修复：回焦须在 App v-if 卸载前同步执行（close() 内联） | ✅ |
| 定夺⑥ | 未保存条件拦截 | 浏览器实测双路径：提示词输草稿 → 关闭钮/Esc → 「有未保存的修改」确认层（z-120）；「取消」→ 弹窗保持；「直接关闭」→ 关闭。改密字段非空亦拦（组件用例）。**重开草稿清零**（App v-if 卸载重建兑现「关闭后将丢失」承诺——常驻挂载会残留草稿，已修）；外观/密钥模式即时生效不参与判定 | ✅ |
| §4.3 | 「前往高级设置」定位联动 | 模式卡「在高级设置中添加自有密钥」→ 跨分区直达 adv + 标题主色高亮（浏览器实测）；locateAdv prop（open+locateAdv 同帧）→ 挂载即落 adv 分区（组件用例，watch immediate 覆盖 App 同帧置双 ref 场景）。错误气泡真实 auth 场景（上游 401）需真实密钥错误，链路其余环节全验，**端到端复验随 iter 末整体走查/巡检** | ✅（除 auth 端到端留 iter 末） |

## REQ-017 注记（T3 闭环）

走查 39 由 T2（移除顶栏按钮）+ T3（弹窗外观区承载）共同闭环；设置弹窗成为主题切换唯一入口（登录页/管理页独立按钮不在 CHG-006 范围）。

## 开发中发现并修复的缺陷（2 个，均浏览器实测暴露）

1. **DropdownMenu 聚焦自吞**：开菜单聚焦首项 `focus()` 引发祖先容器滚动（侧栏会话多时账户菜单在底部）→ 触发自身「底层滚动即关」监听 → 菜单开即被关（T1/T2 会话少未暴露，T3 会话变多后必现）。修复：`focus({ preventScroll: true })`（focusIndex/doClose 两处），键盘可达性不受影响。
2. **设置草稿跨开关残留**：SettingsForm 常驻挂载使「直接关闭」丢弃的草稿在重开时复活，违背确认层「关闭后将丢失」承诺。修复：App 侧 `v-if` 卸载重建（每次打开干净表单态）；焦点回落移至 close() 同步执行（赶在卸载前）。

## 实现偏差登记

无新增偏差（窄视口宽度收缩为规格内 max-width 行为，非偏差）。

## 交付物清单

- `src/components/SettingsForm.vue`：整页视图 → 720px 模态弹窗（z-100）：头部（标题+关闭钮）+ 左导航 168px（role=tablist、方向键）+ 五分区面板（v-show 单显、独立滚动）；attemptClose/isDirty/dirty-confirm（z-120）；locateAdv 分区直达 + flash；内层 .modal-mask 提升至 z-110。表单字段与保存逻辑零改动
- `src/App.vue`：view 切换模型 → settingsOpen 叠加模型（chat 常驻）；SettingsForm v-if 卸载重建；openSettings(locate) 语义不变
- `src/components/DropdownMenu.vue`：focus preventScroll 修复（2 处）
- `src/stores/__tests__/settings-form.spec.ts`：mountForm 传 open:true + 直挂载点适配 + 新增 T3 describe（7 用例）

---

# R2 修订复验（2026-08-16 CEO 试用反馈两条，iter-11 收尾前）

> CEO 试用反馈：① 底部账户区头像+用户名+「···」全挤左侧；② 设置弹窗高度随内容变化，要求固定高度（参考 DeepSeek）。
> 处置：① 为实现偏差（基线本意「···」靠右）——TheSidebar 加 `.acct :deep(.dd){flex:1}`（DropdownMenu 包裹 span 未拉伸致 width:100% 失效）；② 为基线级调整——design-iter-11 落 **R2 修订**（§4.2 尺寸行 + 演示件 .smodal 同步），实现侧 `height: 560px`（max-height calc(100vh-64px) 仅矮视口保护）。
> 测试终态：前端 247/247 + guard:style + 生产构建（R2 后复跑全绿）。

| 项 | 取证 | 结果 |
|---|------|------|
| footer 整行布局 | 浏览器实测（1280px）：触发钮宽 = 账户区宽（差 <6px）、「···」svg 右缘贴合账户区右缘（<40px）、头像居左（8px 内边距） | ✅ |
| 弹窗固定高度 | 浏览器实测：外观（内容最少）/账号（改密+注销）/高级设置（档案列表，内容最多）三分区切换，`height` 恒 **560px**；高级设置面板 overflow-y:auto 独立滚动 | ✅ |

---

# iter 末整体走查（NCR-iter11-002 整改，2026-08-16）

> 整改范围：§7.2 清单 43~49 补齐 + iter-2 走查 15 场景复跑（auth 端到端）+ 设计稿条 37 R2 同步。
> 取证环境：vite dev + FastAPI 本地后端 + 真实浏览器（1280×900）；用户 walk11（管理员）/delme（注销用丢弃账号）。
> 测试终态：247/247 + guard:style + 生产构建（整改后复跑全绿）。

| # | 期望（摘要） | 取证 | 结果 |
|---|------------|------|------|
| 43 | 内层级叠 z-110 + Esc 先关最上层 | z 序实测：内层档案模态 mask z=110 > 弹窗 z=100 ✓。**Esc 分层缺口实测发现并当场修复（DEF-027）**：档案编辑模态原本无 Esc——onModalKey 改分层（未保存确认 > 档案编辑 > 外层）后实测：内层 Esc 关闭且外层弹窗保持 ✓；注销模态 Esc（组件自有监听）关内层保外层 ✓ | ✅（含 DEF-027 修复） |
| 44 | 注销二次确认全流程 | 丢弃账号 delme 实测：模态文案含「全部云端数据/不可恢复」✓；空密码「永久注销」disabled ✓；错误密码 → 行内「密码不正确」不删除 ✓；正确密码 → 清凭据跳登录页 + 成功绿 toast ✓（沿 iter-9 基线零变化） | ✅ |
| 45 | 滚动行为 | 内层模态打开时外层分区面板滚动锁定（wheel 事件 scrollTop 不变）✓；分区面板细滚动条 `scrollbar-color: rgb(213,217,224)`（=--c-scrollbar）✓；弹窗整体 720×560 不溢出视口（R2 已验，窄视口 max-width 收缩）✓ | ✅ |
| 46 | 全局亮暗双主题 | 暗色切换实测（关键触点 getComputedStyle）：侧栏 #131417/主区·弹窗·菜单面板 #1E2026/组头字 #808896/账户名字 #A2A9B6/菜单字 #E6EAF0 全中令牌暗值 ✓；导航选中态 #F0F4FF 底 + #3370FF 字 + 500 字重（**经 CDP inspect 通道证实**——页内 eval 曾读出透明系 transition 读值竞态，非缺陷）；浅色恢复 ✓。正文对比度沿 tokens v1.3 计算值口径（走查 46 注） | ✅ |
| 47 | 不回退汇总 | REQ-003（新建清搜索）/004（切换不中断）/005（删除确认+顺延）/012（重命名口径）/013（导出 Markdown+空会话 toast）/016（搜索命中/无结果/恢复）/019（版本切换常显）交互口径均未变——T1/T2 逐条留档在案；对应 spec 适配（settings-form/session/TheSidebar/MessageBubble 等 247 用例）全绿；spec 涉及页面指针已随 NCR-iter11-003 整改同步 | ✅ |
| 48 | 样件数据口径（铁律 5） | 走查全部账号（walk11/delme）与档案（无效密钥测试，已删）为浏览器实测用测试数据；真实统一 key 仅存后端 .env（不入 git）；额度数值只由 GET /api/quota 接口采集，未取到保持占位——无手编度量 | ✅ |
| 49 | 不适用项注明 | 移动端主界面不承诺（弹窗窄屏不溢出已验，45 条）；ComposerBox 未改（CHG-003 定案，计划「本迭代不做」已列）；Markdown/代码块沿 iter-3 基线不重画；REQ-029 管理后台重构排 iter-12（CHG-006 定案） | ✅ |
| 15（复跑） | iter-2 走查 15：错误气泡 →「前往高级设置」→ 定位高级设置 | **auth 端到端实测**：自填无效 key（sk-invalid-…）档案设为当前 → 发消息 → 上游 DeepSeek 真实 401 → 代理 502 upstream_auth → client 映射 auth 类 → 错误气泡「密钥未授权/API 密钥无效」**只显「前往高级设置」不显重试**（DEF-016 口径延续）→ 点击 → 设置弹窗打开并**直达高级设置分区**（locateAdvanced 语义闭环）→ 走查后回退统一密钥并删除测试档案（现场恢复） | ✅ |

设计稿条 37 已随 R2 同步（固定高 560px 口径取代 ≤80vh，NCR-iter11-002 ③）。
