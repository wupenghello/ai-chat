# iter-12 验证与走查留档 — T1（后端）+ T2（前端）

> 依据：design-iter-12 §7 走查清单 52 条（v1.4.4 任务级门槛）+ plans/iter-12.md T1/T2 验收标准。
> 环境：真实 Chrome（puppeteer-core，scripts/e2e-walkthrough-12.mjs，沿 iter-8 沉淀方法）；
> 后端 FastAPI 临时库（AI_CHAT_UNIFIED_DAILY_TOTAL=20 便于三态走查）+ vite 5180（预览端口被并行会话占用，v1.4.6 备选路径）。
> 造数：mm-admin（管理员）+ spam-bot-2026 经 API 注册；用户01~43 + 超长名用户直插（46 用户 → 3 页）；
> usage_daily 近 7 天缺 1 天（distinct_days=6 < 7 → 缺失行）+ 今日 21 请求 / 60,000 token（全模式）。
> 截图：/tmp/e2e12/shots/（10 张：入口菜单/卡片浅色/near/burst/搜索命中/搜索空态/调配额/用量/暗色/403）。

## 测试终态

- 前端 vitest **254/254**（26 文件，247→254：AdminView.spec 15→22 用例——既有 REQ-025 用例按定夺⑤登记适配为
  新载体断言，spec 适配≠口径回退，复验以 §7.2 条 7/8/9 为准）+ guard:style + 生产构建全绿
- 后端 pytest **139/139**（119→139：test_admin 新增 20 用例）+ ruff clean；**既有 19 用例零改动复跑**（§7.2 条 52 兼容门槛）
- 浏览器走查脚本 **49/49 PASS**（node scripts/e2e-walkthrough-12.mjs，2026-08-17）

## T1 后端（2026-08-17，f114b25）

| design-iter-12 §4.3 T1 用例清单 | 结果 | 取证 |
|---|---|---|
| 分页：首页/中间页/末页/越界钳制返回末页与真实 total | ✅ | test_首页中间页末页_真实total / test_越界钳制到最后一页（floor 公式逐值断言） |
| 分页：limit=0 或 >100 / offset<0 → 422 | ✅ | test_参数非法_422（parametrize 3 组） |
| 搜索：命中 / 大小写不敏感「SPAM」 / 空结果 total=0 / 含 % _ 字面量化 / 空串=不筛选 / 与分页组合 offset 重置 | ✅ | TestUsersSearch 5 用例（「a_b」不命中「axb」、直插「a%b」验 % 字面量） |
| 信封触发边界：无参数纯列表形状逐字段等价现状 | ✅ | test_无参数_纯列表形状等价现状（10 字段 set 断言 + created_at,id 序） |
| 排序：三键升降 / tie-break 稳定 / 非法 sort_key 422 | ✅ | test_排序三键升降与tie_break（alice<bob 同值）+ test_非法排序与分页参数_422 |
| distinct_days 正确性 | ✅ | test_分页total与distinct_days不受翻页影响（翻页不变/用户过滤收窄 2 天/空窗口 0） |
| overview 聚合：跨零点归属请求日 / 无记录=0 / 含自填模式 | ✅ | TestOverviewStats 2 用例（昨日不计入=归属日口径；无记录 0 含封禁与管理员；self 模式计入合计） |
| 既有 19 用例零改动复跑 + ruff clean | ✅ | `make check` 139 passed / ruff 零输出 |

## T2 前端（2026-08-17，本提交）

### 浏览器走查（design-iter-12 §7.2 → 脚本 49 断言，全部 PASS）

| 条目 | 走查点 | 结果 | 取证（脚本断言值） |
|---|---|---|---|
| 1 | 页面底 --c-bg + 内容列 1080px + 卡片 surface 白卡 | ✅ | rgb(245,246,247) / 1080px / rgb(255,255,255)，getComputedStyle 实测 |
| 2 | 顶栏 52px + 双 tab radiogroup 结构零变化 | ✅ | 52px / ['用户列表','用量列表'] |
| 3 | 四卡 grid 常驻 tabs 上方（boundingRect 上下序） | ✅ | cards.bottom ≤ tabs.top |
| 4/5/6 | 卡 1-3 数值 46 / 21 / 60,000（fmtNum 千分位） | ✅ | 与造数真值一致 |
| 7 | 卡 4：15/20 次 + 剩余 5 次 + 进度条 75% 常态 #3370FF | ✅ | width=75% bg=rgb(51,112,255) |
| 8/9 | 常态警示条不渲染；near/burst 页面级警示条 + 文案逐字 + fill 变色 | ✅ | near=banded #B45309 文案逐字；burst 含「已暂停全站新对话请求，明日 00:00 自动恢复；自填 key 用户不受影响」+ #D93025；DB 调值 16/20、17/20 实测后恢复 |
| 11 | 无记录即 0 不估算（卡片真值同源） | ✅ | 见 47；pytest 无记录=0 用例背书 |
| 12 | 搜索框 260×32 + r-md + 清除钮 | ✅ | 260×32 radius 8px |
| 13 | 「SPAM」命中 spam-bot-2026（大小写不敏感） | ✅ | 找到 1 个用户 |
| 14 | Enter 立即 + 请求带 search&offset=0（网络面板取证） | ✅ | `?search=SPAM&limit=20&offset=0`（防抖 300ms 由 vitest fake timers 用例背书） |
| 15 | 清除搜索 → 重置回第 1 页 | ✅ | 恢复「共 46 个用户 · 3 页」 |
| 16 | 命中主色高亮 mark.hl（REQ-016 语法复用 highlightSegments） | ✅ | mark 文本 'spam' |
| 17 | 搜索空态空盒 + 副注 + 清除搜索动作（非错误态） | ✅ | 三段文案 + 表格不渲染 |
| 18 | 页码 ‹1 2 3› + 当前页高亮 + 首末页禁用 + 28px | ✅ | labels/cur/disabled/height 全中 |
| 19 | 单页隐藏分页控件 | ✅ | vitest「单页隐藏」用例 + 搜索 1 命中时无 pager |
| 20 | 翻页请求 offset=40（越界钳制由服务端 + 信封 offset 回写） | ✅ | 网络面板 `?limit=20&offset=40`；钳制公式 pytest 背书 |
| 21 | 空页空态非错误 / 参数非法 422 | ✅ | pytest 越界钳制与空窗口空页 + 参数 422 用例 |
| 22 | 翻页后视野回表格顶（scrollIntoView；用户表 6 行/用量第 2 页 8 行均无滚动空间，断言 scrollY 归零 + 表格在视口内） | ✅ | before(scrollY)>0 → after scrollY=0 |
| 23 | 六列全字段 | ✅ | ['用户名','注册时间','状态','密钥模式','配额','操作'] |
| 24 | 管理员本人行徽标 + 封禁禁用 + title | ✅ | disabled + title + opacity 0.45 |
| 25 | 状态胶囊正常/已封禁 | ✅ | 封禁演示中「已封禁」胶囊实测（06 号截图段） |
| 26/27 | 档位徽标免费/自填/自定义 N；今日 x/N 与用尽 | ✅ | vitest 档位徽标用例 + 调配额后「自定义 5」实测 |
| 28 | 封禁确认模态 → toast + 列表与统计卡重载 | ✅ | 模态文案 + toast + adminUsersPage/adminOverview 各 2 次（网络取证） |
| 29 | 自封禁双侧拒绝 | ✅ | UI 禁用实测；后端 400 pytest 背书 |
| 30 | 解封直接生效 + toast | ✅ | 「已解封 spam-bot-2026」+ 行翻「正常」 |
| 31 | 调配额正整数校验不入库 | ✅ | 1.5 → 行内错误文案逐字 |
| 32 | 自定义 N 生效 + 按默认档位保存 = 清空覆盖 | ✅ | 「自定义 5」→ 恢复「免费档」 |
| 33 | 用户表加载态 spinner | 沿用 | state-hint/spinner 模板与 iter-8 逐字相同（零改动沿用，本地毫秒级加载不可观测；vitest err-banner/重试用例背书失败分支） |
| 34 | 失败 banner + 重试不清状态 | ✅ | vitest「拉取失败：错误 banner + 重试」用例 |
| 35 | 仅管理员一人单行呈现 + 分页隐藏 | ✅ | vitest「单页隐藏」+ 造数 46 用户对照（小部署口径同构） |
| 36 | 超长用户名 ellipsis + title 全名 | ✅ | ellipsis/textOverflow + scrollWidth>clientWidth + title 全名 |
| 37 | 用量四列（默认日期↓箭头） | ✅ | 四列表头实测 |
| 38 | 筛选沿用：用户下拉（全量数据源）+ 日期默认 7 天 + 共 N 条 | ✅ | 下拉含全部用户/mm-admin；默认窗口 2026-08-11~08-17 |
| 39 | 排序迁后端：列头点击带 sort_key/sort_dir + offset=0 | ✅ | `?...sort_key=tokens&sort_dir=desc&limit=20&offset=0` + 首行 mm-admin 36,000 |
| 40 | 用量空态文案 | ✅ | vitest 空态用例（浏览器造数有数据不适用） |
| 41 | 用量加载/失败态 | 沿用 | 同 33（模板零改动 + vitest 失败分支） |
| 42 | 缺失时段琥珀行（distinct_days=6 < 7 全窗口判定） | ✅ | 「部分时段无统计数据：仅显示已有数据（不估算补齐）」逐字 |
| 43 | 用量分页同口径：共 28 条 · 2 页 + 筛选/排序 offset 重置 0 | ✅ | 首页 20 行；筛选用户03 → 6 条 + offset=0（网络取证） |
| 44 | 普通用户 /admin → 403 卡零数据 + 零后台请求（request 监听 0 条） | ✅ | 无痕上下文独立会话实测 |
| 45 | 入口：管理员账户菜单含「管理后台」/普通用户无/未登录跳登录 | ✅ | 三态实测（菜单项 DOM 取证） |
| 46 | 被封禁登录 403「账号已被封禁」 | ✅ | API 403 + detail 逐字 |
| 47 | 统计卡/用量/配额同源 usage_daily（卡值 = /overview 接口值 = DB 造数真值） | ✅ | 46/21/60000/15 四值三口径一致 |
| 48 | 亮暗双主题：暗色 #131417/#1E2026 + 全元素亮色残留扫描 0 条 | ✅ | residue=[]（.admin-page 全元素扫描）；浅色 02 截图 |
| 49 | 线上数值只由接口采集渲染 | ✅ | 全部卡片/表格值来自 /api/admin 响应（脚本同源断言） |
| 50 | 不适用注明：移动端不做（模态 max-width 不溢出已沿 REQ-028；表格卡 overflow-x 横滚保护）/趋势图不做/用户表无列排序=现状 | ✅ | 模板 max-width: calc(100vw - 32px) + .tbl-card overflow-x:auto 落地 |
| 51 | 六端点零回退：ban/unban/quota 零改动 + users/usage 可选参数 + overview 加法 | ✅ | git diff（admin.py 三治理端点未动）+ pytest 19 用例零改动 |
| 52 | test_admin 19 用例零改动通过 | ✅ | pytest 139/139 含 19 既有用例原样通过 |

### 走查脚本迭代说明（诚实登记）

首轮 40/48：8 项 FAIL 全部为**脚本断言问题**（选择器全局匹配两表/四列期望未算排序箭头/`startsWith` 未 trim 模板缩进前导空格致列头点击未执行/筛选下拉 id 对应关系错），非产品缺陷；逐项修正后 49/49。脚本与截图一并入库（scripts/e2e-walkthrough-12.mjs）。

### 既有 REQ-025 用例适配登记（定夺⑤，spec 适配≠口径回退）

- AdminView.spec「全站配额条三态」→ 适配为：常态警示条不存在 + 卡 4 fill 类名 + near/burst 警示条文案逐字（§7.2 条 8/9 复验口径）
- 「统一 key 每日总量 2,000 · 今日已用 100」常态文案断言 → 卡 4「100 / 2,000 次」+「剩余 1,900 次」（等价信息新载体）
- 用量排序用例 → 后端化断言（请求参数 sort_key/sort_dir + 服务端序直渲染）；「3 条」计数 → 信封 total「共 3 条」
- adminUsers/adminUsage mock → adminUsers（下拉全量）+ adminUsersPage/adminUsagePage（信封）

## QA 审计整改段（2026-08-17，审计报告 retros/qa-audit-iter-12.md）

**结论：有条件通过（2 NCR + 7 OBS）；CEO 定夺：NCR-001 整改 / NCR-002 登记已接受偏差 / OBS-1、2、6 顺手修 / OBS-3、4、5 入复盘。**

### NCR-iter12-001 整改：spec 涉及页面指针补更新 + CHG-006 承诺全项落地复核

- spec.md REQ-029「涉及页面」已由「待基线」更新为「已基线（2026-08-17）」（本整改提交内落盘）
- **CHG-006 影响评估承诺清单逐项落地复核**（对照 requirements/changes.md CHG-006）：

| 承诺项 | 落地状态 | 证据 |
|---|---|---|
| REQ-003/004/005/012/016 spec 触点描述随 design-iter-11 同步 | ✅ 已落（iter-11 NCR-003 整改 10 处，本轮抽查在案） | dfa093c + spec 正文 |
| REQ-013 导出入口迁移措辞 | ✅ 已落（iter-11 同上） | spec REQ-013 行 |
| REQ-007「前往设置页」→「打开设置弹窗」措辞 | ✅ 已落（iter-11 同上） | spec REQ-007 行 |
| REQ-017 顶栏按钮条款随基线改写（design-iter-11 定夺①移除） | ✅ 已落（随 design-iter-11 基线同步） | spec REQ-017 + RTM 行 |
| REQ-021 账号区块迁弹窗触达路径 | ✅ 已落（iter-11 T3） | RTM REQ-021 行 |
| REQ-025 由 REQ-029 增强体验、六端点零回退 | ✅ 已落（iter-12 §5 映射 + pytest 19 用例零改动 + 三端点函数体逐字节零改动） | qa-audit 补证 1/2 |
| REQ-029 spec 涉及页面随 design-iter-12 基线更新 | ✅ **本轮整改补落**（NCR-001，同型第 3 次复发的存量清偿） | 本提交 |
| design-iter-11 基线承载 REQ-026~028 | ✅ 已基线（2026-08-16，tag 推远端） | RTM |
| design-iter-12 基线承载 REQ-029 | ✅ 已基线（2026-08-17，tag→ae08fc7 推远端，qa-audit 补证 5） | RTM + ls-remote |
| design/proto 维持历史资产不动 | ✅ 未动 | git log（区间无 proto 改动） |

- 防线失守复盘材料：v1.4.9 C 条要求「承诺同步项须在首个任务提交内落盘」——本迭代首个任务提交（T0 基线 ae08fc7）更新了 RTM 与周报，漏了 spec 指针列；根因（核对清单颗粒度：RTM/周报有触发、spec「涉及页面」列无触发）带入复盘四问

### NCR-iter12-002 登记：DEF-028 已接受偏差

- plans/defects.md 已登记（CEO 定夺 2026-08-17）：接受理由 = 30/500 为部署可配置项，写死数值在自定义部署下失真；值无关措辞（免费档/高档）语义与基线一致。引入时点补证：iter-8 T2（2f91e45），当轮走查未覆盖选项副文案（iter-8 走查盲区一并留档）
- 配套动作登记：下轮走查脚本补「模态选项副文案」断言面

### OBS 顺手修记录（OBS-1 / OBS-2 / OBS-6）

- OBS-1：design-iter-12 正文徽标/§7.1 状态列/§8 标题已随基线刷新（「待 CEO 评审基线」→「已基线」、☐→☑×2、「待定夺」→「已定案」）
- OBS-2：design-system/components.md v1.1 两处登记值已修正（统计卡进度条 4px→**6px** 对齐基线 §1.2 与 .s-bar 实现；分页总数文案「靠右」→**左信息行**对齐 §2.1 与 .page-row 实现）——company-os 仓库本整改一并提交
- OBS-6：首轮走查 40/48 与终版 49 条的差额 = 修正期新增 1 条断言（「§22 用量翻第 2 页滚动反馈」为修正期补入，首轮 48 条中无此条），特此注明

### OBS-3/4/5 转复盘

- OBS-3（双主题走查承载方法口径化）、OBS-4（走查脚本自迭代 FAIL 是否入 DEF 的口径）、OBS-5（加载态运行时取证与证据措辞对齐）——三条均为流程口径问题，已登记待复盘四问讨论定案

### OBS-7 跟进

- Code Review 全量材料（a60ec8a..d42ba36）随本整改提交产出，入周报 W34「Code Review」节，待 CEO 过目落痕（G4 硬前置）
