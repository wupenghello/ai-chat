# QA 审计报告 — ai-chat iter-12（2026-08-17）

> 审计执行：qa 员工（只读）。审计基准：`process/` v1.4.9 + 项目 `tailoring.md`（v1.4.9，CEO 确认 2026-08-15）。审计范围：iter-12（REQ-029 管理后台体验重构）——提交链 `9ce71b3`（iter-11 G4 关闭）→ `a60ec8a`（计划批准，08-16 23:56）→ `ae08fc7`（design-iter-12 基线，tag 已核）→ `f114b25`（T1 后端）→ `d42ba36`（T2 前端，HEAD）。Git 取证来源：项目仓库 `.git/refs/tags/*`、`.git/logs/HEAD`（refs 直读，非臆断）。
> **主会话补证回填（2026-08-17）**：报告末节「主会话补证」6 项已全部代核完毕，结论见文末补证回填节；本报告据此定稿。

## 审计结论

**有条件通过（NCR 2 项）**

一句话理由：本迭代的工程交付与取证质量是十二轮里最高的一档——测试计数三方（verify/周报/RTM）与静态逐文件计数**一分不差**（前端 254/26 文件、后端 127 函数 + 12 参数化展开 = 139），走查 49 条断言逐条可判定、首轮 8 项 FAIL 的"脚本问题非产品缺陷"归因与脚本内修复痕迹互证成立，v1.4.9 三条新制度首次执行基本达标（components.md v1.1 兑现、提交带 [REQ-029] 尾缀、零缺陷结论有据）；但 **spec「涉及页面」指针再次未随基线同步（同型第 3 次复发，恰是 v1.4.9 新设防线的首战失守）**，且**调配额模态一处基线文案偏差既未修正也未登记**，与 verify/RTM 的"零偏差"自评矛盾。两项均文档级，不动摇代码与测试的真实性。

## 符合项（摘要，含证据指针）

1. **基线与 tag**：`design-iter-12` tag 存在且指向 `ae08fc7`（refs 直读核得）；`req-baseline-v4` → `522967d` 仍在。提交链顺序合规（计划 → 设计基线 → T1 → T2），三提交均带 `[REQ-029]` 尾缀（iter-11 OBS-2 的 format 漂移已自愈）。
2. **planning.md §1/§2**：`plans/iter-12.md` 三任务均有合法判定依据（T0 类比 design-iter-8 / T1 拆解单模块三组改动 / T2 拆解+类比 iter-8 T2）；Σ8 附"iter-6~11 六轮零偏差校准、留余量"说明；排除项 4 条带理由；风险 3 条带应对；T2 验收含走查留档（v1.4.4）。实际交付 T0/T1/T2 = Σ8，零范围增减。
3. **REQ-025 零回退（重点核查项 1，静态部分）**：`backend/app/routers/admin.py` ban/unban/quota 三端点（L136~171）实现完整、与 iter-8 口径一致；`test_admin.py` 既有 19 用例（15 函数 + 2 处 parametrize×3）全部在案，新增 20 用例（16 函数）分组算术与周报"搜索 5/分页 6/排序分页 7/统计 2"逐组合吻合；`test_无参数_纯列表形状等价现状`（L370）+ `test_仅既有三过滤参数_纯列表现状默认序`（L479）正面锁死定夺①兼容承诺。逐行"零改动"须 diff 取证（补证 1/2 ✅ 已回填）。
4. **度量真实性（铁律 5，重点核查项 6）**：前端 `it(` 静态计数 **254 / 26 文件**（AdminView.spec 实数 22，15→22 成立）；后端 **127 def test_ + 参数化展开 12 = 139**（119+20 算术自洽）；与 verify、周报 W34、RTM 三处完全一致。e2e 脚本实数 **49 条 log() 断言**，与"49/49"一致。
5. **走查留档质量（重点核查项 2）**：`plans/iter-12-verify.md` 52 条逐条有判定与取证值；44 实测 + 6 背书 + 2 沿用 = 52 对账成立；**首轮 40/48 的 8 项 FAIL 归因可信**——所列 4 类脚本问题（两表选择器串扰/列头箭头字符/前导空格/下拉 id 映射）在入库脚本的最终代码中均有对应修复痕迹（`.panel[n]` 作用域、`.replace(/[↓↑]/g,'')`、`.trim().startsWith`、`page.select(...,'5')`，`scripts/e2e-walkthrough-12.mjs` L347/L376/L385 等），"脚本自迭代"而非掩盖产品缺陷的判断成立；脚本同源断言（§47 卡值=接口值=造数真值）落实铁律 5。
6. **v1.4.9 首次执行（重点核查项 3）**：① 零缺陷结论有支撑——defects.md 无新增属"无缺陷可登"，8 项 FAIL 判定归因透明登记于 verify（边界口径见 OBS-4）；② **components.md v1.1 已兑现**（2026-08-17 三形态登记，iter-11 OBS-3 同型欠账本次未复发）；③ Code Review 未做但周报如实标注"未到节点"，G4 前置待办清晰（按指示列为观察，不预判）。
7. **CHG-006 承诺同步（重点核查项 5，部分）**：REQ-029 的 RTM 行五列证据链完整（含 T1/T2 用例明细与状态如实"已实现"而非抢跑"已验证"）；REQ-025 spec 正文无需变更（CHG-006 未承诺正文改动，六端点口径由 §5 映射承载）；唯 spec 指针滞后（见 NCR-001）。
8. **设计与实现一致性抽查（重点核查项——T1/T2 vs 基线）**：admin.py 分页信封/越界钳制 floor 公式/ESCAPE 转义/Literal 白名单 422/tie-break username/distinct_days 全窗口聚合与 §4 逐条对得上；AdminView 四卡常驻 tabs 上方、三态着色阈值（≥0.8/用尽/总量≤0）、警示条文案逐字、搜索 260×32/防抖 300ms/Enter/清除重置/mark.hl、分页单页隐藏/>7 折叠/越界信封 offset 回写/scrollIntoView、hasGap 全窗口比对均落地且与 §7.2 对应条目可核。
9. **裁剪**：无未登记偏离——vite 5180 备选路径复用 iter-8 已登记并闭账的 tailoring 条目；AdminView.spec 适配在基线定夺⑤中**预先**登记（实现前登记，非事后追认）。
10. **周报（v1.4.5）**：W34 随 T0/T1/T2 增量成形，三任务条目齐全，含定夺全录与测试数字。

## 不符合项（NCR）

| 编号 | 条款 | 事实（证据） | 整改建议 | 严重度 |
|------|------|-------------|---------|--------|
| NCR-iter12-001 | requirements.md §3 第 5 条（v1.4.9 变更承诺同步项落地核对）| spec REQ-029「涉及页面」仍写 **"design-iter-12（待基线，随 iter-12 启动）"**（`requirements/spec.md:578`），而 design-iter-12 已于 08-17 基线（tag→`ae08fc7` 已核）、RTM 行已更新、周报已登记——唯 spec 指针滞后至 T2 之后仍未落。CHG-006 影响评估明列"design-iter-12 承载 REQ-029"；v1.4.9 要求同步项"须在首个任务提交内落盘"。**同型第 3 次复发**（iter-9 NCR-002 → iter-11 NCR-003 → 本条），且是 v1.4.9 新防线的首次执行失守 | 更新 spec:578 指针为"已基线（2026-08-17 CEO 批准）"；对照 CHG-006 影响评估做一次全项落地复核并在 verify 或整改记录留痕；复盘分析为何新防线（提交防漏核对中的 CHG 承诺项）未拦住 | 违规（文档滞后，行为口径未受影响） |
| NCR-iter12-002 | development.md §1 第 4 步（v1.4.4：偏差要么修正要么先登记再提交）+ testing.md §3 | 调配额模态选项副文案偏离基线：实现为"统一 key = 免费档 · 自填 key = **高档**（部署配置默认值）"（`src/views/AdminView.vue:613`，无数值），而 design-iter-8 基线样件（`design/iter-8/index.html:533`"免费档 **30 次/日** · 自填 key = **500 次/日**"）与 design-iter-12 §1.1 样件（同数值）及 §7.2 条 31 期望（"随密钥模式 30/500"）均为带数值口径；走查条 31 取证仅断言错误文案逐字，未覆盖该选项文案，defects.md 无对应登记，verify/RTM 的"零偏差"自评与此矛盾。引入时点待 diff 判定（**补证 4 已回填：iter-8 T2 提交 `2f91e45` 引入，iter-12 原样继承——同时构成 iter-8 走查盲区**） | 二选一：回基线文案（补 30/500 数值），或按 DEF-020/021 惯例登记"已接受偏差"入 defects.md；顺带把"模态/样件文案是否逐字断言"列入下轮走查脚本断言面 | 违规（文案级偏差未登记，"零偏差"结论失真） |

## 观察项（不判违规，供 CEO/复盘参考）

| 编号 | 现象 | 建议 |
|------|------|------|
| OBS-1 | design-iter-12 正文状态未随基线刷新：badge 仍写"待 CEO 评审基线"（`design/iter-12/index.html:374`）、§7.1 多处"☐ 待批准"、§8 标题"待基线拍板"——与头部注释"已基线（2026-08-17 批准 + tag）"并存。权威登记链（头部注释+tag+RTM）完整，属正文 UI 卫生问题（iter-11 NCR-002③ 同型降级） | 随整改顺手刷新正文徽标与 §7.1 状态列 |
| OBS-2 | **components.md v1.1 两处登记值与基线不符**：统计卡"4px 进度条"vs design-iter-12 §1.2 与 AdminView 实现的 6px（`.s-bar`）；分页"总数文案靠右"vs §2.1"左信息右控件"（实现 `.page-row` space-between，信息在左）。组织级资产错值会跨项目传播 | 修正 components.md 两处；登记值入库前对照基线稿复核一遍 |
| OBS-3 | **双主题走查以系统性扫描替代逐条暗色复跑**：清单自声明"所有条目须浅/暗各过一遍"，实际为亮色逐条 + 暗色一页全元素亮色残留扫描 + 关键值断言（条 48，residue=[]）。残留扫描对"漏改裸色值"这一最高风险失效模式覆盖力强于逐条复跑，但暗色下文字类令牌（如命中高亮 #5C8DFF）无显式断言 | 可接受；建议下轮设计稿把"双主题要求由 X 方法承载"写进清单口径，避免声明与执行的颗粒度差 |
| OBS-4 | **走查脚本自迭代 FAIL 是否入 DEF 的口径未定**：8 项脚本断言问题以 verify"诚实登记"节承载、未入 defects.md（按"非产品缺陷"处理）。与 iter-11 NCR-001 的"任务内自愈缺陷须登记"存在边界模糊——脚本是任务交付物之一 | 复盘定夺口径（建议：交付前脚本自迭代免登，交付后发现须登），写入 tailoring 或 testing 惯例注记 |
| OBS-5 | 走查条 33/41（加载态）以"模板与 iter-8 逐字相同零改动 + vitest 失败分支背书"判定，加载态无运行时取证；条 19 证据写"搜索 1 命中时无 pager"但脚本未显式断言该点（由 vitest 单页隐藏用例承载）——证据措辞略强于实际断言面 | 下轮脚本在 mock 慢响应下补加载态一帧断言；证据措辞与断言一一对齐 |
| OBS-6 | verify"首轮 40/48"与终版 49 条断言数差 1（约一条断言为修正期新增），未注明；周报/RTM 转述为"40/48" | verify 补一句"修正期新增 1 条断言"即可 |
| OBS-7 | Code Review（development.md §3 / G4 v1.4.9）本迭代尚未执行——周报已如实标注"未到节点，T1/T2 完成后出材料交 CEO 过目"。**G4 关闭前必须完成全量 review（`a60ec8a..d42ba36`）+ CEO 过目落痕入周报**，否则将构成 iter-9/10 同型第 4 次 | G4 前置跟踪项 |

## 上一轮 NCR 闭环核对（iter-11，4 项）

| 项 | 结论 |
|----|------|
| NCR-iter11-001（缺陷登记） | **闭环**：DEF-022~027 已入 `plans/defects.md`（含修复提交号回填 baf987d/53f5437/f577531）；制度落 v1.4.9（`process/CHANGELOG.md:130` + development.md §1 第 6 步），本迭代提交防漏核对已实际运转（见符合项 6） |
| NCR-iter11-002（走查尾段 7 条 + iter-2 复跑 + 条 37） | **闭环**：`plans/iter-11-verify.md:151~168` 整改段在案（43~49 补齐 + auth 端到端 + 条 37 随 R2 同步），整改提交 dfa093c 在 reflog 可核 |
| NCR-iter11-003（spec 同步 8 处） | 存量已闭环（dfa093c "spec 10 处同步"），**但同型增量复发为本轮 NCR-iter12-001**——iter-11 整改修了存量、v1.4.9 设了防线，防线首战未拦住 |
| NCR-iter11-004（Code Review） | **闭环**：6c93ff8 材料入周报 + ffa67c2 CEO 过目落痕；制度 v1.4.9 已把 Code Review 入复盘采集/G4。本迭代待办见 OBS-7 |
| iter-11 OBS-2（提交尾缀漂移） | 已自愈：本迭代三提交均带 [REQ-029] |

## 主会话补证回填（2026-08-17，全部完成）

| # | 代核项 | 结果 |
|---|--------|------|
| 1 | ban/unban/quota 三治理端点零改动 | ✅ **逐字节零改动**——两版函数体（各 39 行，`@router.post ban` 至 `@router.get usage` 区间）diff 为空 |
| 2 | test_admin 既有 19 用例零改动 | ✅ **删除行 0**（`git diff 9ce71b3..d42ba36` 全部 297 行为新增；此前 QA 计数的 1 条"删除行"系 `---` 文件头误计） |
| 3 | 任务验收提交含 RTM + 周报（+verify） | ✅ f114b25 = admin.py + test_admin + weekly + rtm 四文件；d42ba36 = 8 文件含 rtm + weekly + iter-12-verify.md |
| 4 | NCR-002 文案偏差引入时点 | ✅ **iter-8 T2 提交 `2f91e45` 引入**（`git log -S '自填 key = 高档（部署配置默认值）'`）——iter-12 原样继承，同时构成 iter-8 走查盲区（当轮条 17 未覆盖选项副文案） |
| 5 | design-iter-12 tag 远端 | ✅ `git ls-remote --tags origin`：design-iter-12 → ae08fc7、req-baseline-v4 → 522967d 均在远端 |
| 6 | 运行时复跑 | ✅ 全绿复现：前端 vitest **254/254**（26 文件）+ guard:style + 生产构建；后端 `make check` **139/139** + ruff clean；e2e 走查脚本**新库重建造数复跑 49/49**（2026-08-17） |

## 各输入文件核对记录

已读：`process/{README,planning,development,lifecycle,requirements,tailoring}.md`、`process/CHANGELOG.md`（v1.4.9 条目）；项目 `tailoring.md`、`plans/iter-12.md`、`plans/iter-12-verify.md`、`plans/weekly-W34.md`（+W33 相关行）、`plans/defects.md`、`requirements/spec.md`（REQ-024/025/026~029 与非功能节，L458~620）、`requirements/rtm.md`（全文）、`requirements/changes.md`（CHG-006 全文）、`design/iter-12/index.html`（全文 1381 行）、`design/iter-8/index.html`（调配额模态相关行）、`retros/qa-audit-iter-11.md`、`plans/iter-11-verify.md`（整改段）；代码 `backend/app/routers/admin.py`、`backend/tests/test_admin.py`、`src/views/AdminView.vue`、`src/views/__tests__/AdminView.spec.ts`、`src/api/backend.ts`（admin 节）、`scripts/e2e-walkthrough-12.mjs`（全文）；git 取证 `.git/refs/tags/*`、`.git/logs/HEAD`、`.git/refs/tags/design-iter-12|req-baseline-v4` 内容；组织资产 `design-system/components.md`。静态计数：src 26 文件 `it(`=254、backend 7 文件 `def test_`=127、parametrize 展开=12。

## 给 CEO 的直话

这一轮代码、测试、走查取证是迄今最扎实的一次：计数一分不差、零回退兼容策略从设计到用例全程锁死、首轮走查失败诚实归因且可在脚本里找到对应修复痕迹——v1.4.9 三条新制度里两条（components 兑现、提交尾缀）首战即达标。但两条 NCR 恰好都打在"刚立的防线上"：spec 指针同步是 v1.4.9 CHG 承诺核对的第一仗，没拦住，已是同型第 3 次；"零偏差"的自评里藏着一条两个基线都对不上的模态文案。模式很清楚：**面向功能的纪律在变强，面向文档细节的自查仍是盲区**——建议整改时把"CHG 承诺项"和"样件文案逐字"做成提交前可勾选的两行清单，别再让制度靠记性执行。另：G4 关闭前 Code Review + 您过目落痕仍是硬前置（OBS-7）。
