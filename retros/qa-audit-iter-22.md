# QA 审计报告 — ai-chat iter-22（2026-08-23）

> QA 员工（subagent）只读审计产出；git/环境取证由主会话代核（见文末「主会话补证」节）。整改闭环见文末「关闭记录」。

## 结论：有条件符合（2 项不符合）

iter-22 交付面整体质量高：REQ-053 全要素在案（spec 正文/验收 6 条/异常分支 5 项/基线 v13 沿革/暂缓池移出/REQ-030 验收 6 改写与 REQ-031/035 注记），CHG-016 六定夺+影响评估+CEO 批准+落地清单 4 项全 ✅（v1.4.20 符号规范遵守）；计划纪律（Σ4 与定夺⑤一致、T0→T2 严格串行经 git 时序实证、ISO 周 W34 自检、备砍序/风险 3 条/容量校准表）齐备；实现与台账对得上——weather.py 148 城表/T0 模板逐字/白名单动态化/门控在代码逐处可指认，test_weather 断言面抽查（降级文案逐字、Host 不一致拒绝、门控正反例）全部属实，demo_weather 退役映射 8 行逐条与代码 diff 一致；DEF-041/042 当轮四件套齐批、根因/取证/教训完整；v1.1.0 版本三处落位、冒烟真凭据端到端在案。**主要问题有二：其一，台账三处将 test_weather 新增数记为 19，机器实测 20（RTM 行内分解自加亦为 20，自相矛盾），违反 testing.md §4b 子项计数机器采集条款（iter-17 OBS-1 同型复发）；其二，releases/v1.1.0.md 全文落盘晚于部署与冒烟动作，与 release.md §3「发布记录在发布动作之前写好」字面不符（缓解要件见 NCR-002）。**

## 不符合项清单

| 编号 | 违反条款 | 证据（文件路径:行） | 整改建议 | 状态 |
|------|---------|----------------|---------|------|
| NCR-iter22-001 | testing.md §4b（v1.4.16 C：verify/周报测试计数子项归属以 `--collect-only` 机器输出为准，不手数不心算——iter-17 OBS-1「子项 19+11 实为 18+12」同型复发且系该条款首次再犯） | 台账三处记「19 test_weather 纯新增」：plans/iter-22-verify.md:133、plans/weekly-W34.md:300、requirements/rtm.md:60（REQ-053 行）与 rtm.md:61（全局回归基线行）。机器实测（本轮审计只读执行 `pytest --collect-only -q`）：backend/tests/test_weather.py 收集 **20** 例；且 rtm.md:60 行内分解「定位 5 / 端到端与网关 4 / 降级 6 / 出网治理 3 / 门控 2」自加 = 20，与自身「19」矛盾。真实算术 = 363 存量 − 1（demo_weather 枚举例移除，verify §3 第 1 行）+ 20 新增 = 382——总量 382 机器值正确，「+19」为净值被误记为新增数（另超计划预估 10~15 上限，佐证落笔时未跑机器计数） | 当轮三处（verify/周报/RTM 两行）改为「20 test_weather 纯新增 − demo_weather 枚举 1 例移除 = 净 +19（363→382）」；随 iter-22 收口提交落盘 | 待整改 |
| NCR-iter22-002 | release.md §3「发布记录在发布动作之前写好，不是事后补」 | releases/v1.1.0.md 全文首现于 b52165b（2026-08-23 00:32:20，+38 行新建）；而部署与冒烟动作在前——版本落位 6a9a8a3 为 00:25:59，线上天气回合观测 00:26、冒烟完成 00:2x（v1.1.0.md:21-25 自记）。v1.0.0 先例未沿（05c3ad6 先落记录、4bcab6f 仅回填实录）。**缓解在案**：发布要件（本版包含/部署形态/冒烟验证点五项/回退）已先行承载于 6a9a8a3 同批的 plans/weekly-W34.md:316-320 v1.1.0 节并明示「结果随部署执行回填本节与 releases/v1.1.0.md」，CEO G3 批准（「你先发布部署吧」）在案——非无预宣告的事后编造 | 呈 CEO 定夺：①登记口径裁剪（周报发布节先行 = 「记录先行」的等价载体，落 tailoring），或 ②下轮起恢复先落 releases/vX.Y.Z.md（要件版）→ 执行 → 回填实录的两段式（沿 v1.0.0 先例） | 待定夺 |

## 观察项（不构成违规，但值得注意）

1. **「退役映射 4 文件 8 处」文件数不精确**：verify §3 原表（plans/iter-22-verify.md:98-109）实为 **3 个既有测试文件 × 8 行映射**（test_agent_tools 4 / test_turn 2 / test_search 2），与代码 diff 逐条核对一致（8/8 属实）；「4 文件」疑把纯新增的 test_weather.py 计入（T2 提交 stat 触及 4 个测试文件）。表本体准确，汇总措辞（weekly:300、rtm.md:60/61）口径欠精确——与 NCR-001 同族（文档计数面），建议随整改顺手收口。
2. **vitest 终态 428 未落台账**：静态实测 `it(` 计 428（= 423 + DEF-041 批 MessageList.spec +3 + DEF-042 批 SettingsPaneCssContract.spec +2，两 spec 亲核属实）；weekly DEF-042 节（weekly-W34.md:313）仅写「+2 用例」未写 426→428，RTM 与发布记录均无 428 字样。DEF 批不属于 REQ 行收口面，但建议 iter-22 G4 收口时补记机器计数（testing.md §4b 精神）。
3. **走查「9 PASS」含 1 条非断言步**：scripts/e2e-walkthrough-22.mjs:103 登录留档步为固定 `true`，条 1~5 实际断言 8 处（3+2+1+1+1）；条目名已按 v1.4.20「条 N」编号命名（对照闭环达标），仅知悉 PASS 总数口径即可。
4. **v1.1.0.md 无独立「已知问题」节**（v1.0.0.md:28 有）：以「注记」节（v1.1.0.md:29-33）承载 GeoAPI 未启用/冒烟账号/流程独立三则——release.md §3 模板字段弱化，内容实质未缺。
5. **工作区 backend/uv.lock 有未提交改动**（git status 实测，本地跑测试的环境性变更，非任何任务交付物）——提请收口时处理，避免提交防漏核对噪音。
6. **verify §8 自登记两条观察项认可**：前端 flaky 一例（本批零前端改动 + 连续两次复跑全绿，判定依据充分）、test_usage_api `_TODAY` 跨点竞态（iter-21 既有边界、非本批触达面）——不入 DEF 判定正确；`_TODAY` 调用时求值加固建议随 iter-22 复盘承载。

## 符合面摘要（证据索引）

- **需求件**：spec.md:1083-1106 REQ-053（用户故事/描述/主流程 4 步/异常分支 5 项/验收 6 条/P1/涉及页面=不涉及）齐备；spec.md:3 头部基线沿革含 v13；spec.md:1137 暂缓池「真实天气工具」移出注记（含 08-17/08-18 沿革）；spec.md:622 REQ-030 验收 6 改写 + :598 描述注记；spec.md:629 REQ-031 白名单新模式注记；REQ-035 CHG-016 复用注记（bind/unbind/白名单/DNS/ToolError/逐字文案先例）在案。changes.md:5-38 CHG-016：影响评估（Σ3~4/受影响需求/测试影响/风险 4 条）、六定夺全按推荐、CEO「全部按推荐」批准记录、落地核对清单 4 项全 ✅（v1.4.20 只用 ✅/☐——changes.md 全文 grep 无 ⬜/◻ 残留，门禁 C 通过一致）。
- **RTM**：rtm.md:60 REQ-053 行（已实现/已达成/状态/iter-22）与代码实态一致（weather.py 326 行 148 城表、tools.py gate 注册、config.py:42-43 两字段、proxy.py:278 weather 键、main.py:17/55-56/73 lifespan 绑定逐一核对）；rtm.md:61 全局回归基线行「天气面（CHG-016）」收口措辞与 verify 同源（唯 19/20 计数问题见 NCR-001）。
- **计划纪律**：plans/iter-22.md——估算依据（planning.md §2 M 定义类比，:73-77）、不做清单 6 项（:150-157）、风险 3 条（:161-188）、备砍序 3 项+底线（:122-126）、串行口径 v1.4.15 适配（:96-100，定夺④明文）、容量校准表（:113-121）、ISO 周头部自检（:13，W34 与周报一致；实际提交 08-23 00:01 仍属 W34 周日）；Σ4 = S1+M2+余量 1 与 CHG-016 定夺⑤「Σ3~4」一致（:104-107）。
- **开发与台账**：verify T0 段五项（GeoAPI 定案回退径行/坐标 6 城样例/逐字文案定稿/额度口径/机制写实）+ T0 验收对照 3 ✅；T2 段验收 1~6 对照表、实现级决策 5 项（verify:113-119，含 .env 凭据撤出改进程环境注入——第 4 项承载本轮偏离）、改写映射 8 行、观察项 2 条齐登。weekly-W34.md:295-302 iter-22 节、:304-314 DEF-041/042 节、:316-321 v1.1.0 发布节齐备。defects.md DEF-041（:53）/DEF-042（:54）：根因（微任务竞态/scoped 边界）、修复（输入意图先行/显式对齐三组 class）、取证（e2e-def041-scroll 6 PASS / e2e-def042-style-audit 逐分区计算样式）、教训四要素完整。三方数字：pytest 382 处处一致；走查 9 PASS/0 FAIL 处处一致（verify:123/weekly:300/RTM:60）；vitest 423 复跑背书为 T2 时点口径一致（终态 428 见 OBS-2）。
- **测试**：test_weather.py 20 例断言面抽查属实——降级文案逐字（:148-194，四类 error + body code 402 + 3d 缺 daily）、白名单拒绝（:204-213 他域 + 三内网 IP「不在白名单」）、DNS 解析内网连接前拒绝（:216-222）、门控正反例（:227-237）、T0 模板逐字断言（:45-52/113-115 与 weather.py assemble_text 逐字一致）。test_agent_tools.py 退役映射与 verify §3 表一致（枚举例移除/枚举外取值改 t_enum :24-37/可见性 :126-131/payload :133-137 均 `["echo"]`）；test_turn.py:125-127/496、test_search.py:435/439/497 同步改写属实。MessageList.spec.ts +3（:99 上滚轮即时脱离含 <120px 回归面 / :117 向下不脱离 / :132 触屏下滑）；SettingsPaneCssContract.spec.ts 2 例（:25 跨组件 14px/600 一致 / :37 复用 class 防漂移）；MemoryPane.vue:316-330 修复实态在案。
- **发布**：releases/v1.1.0.md 本版包含（四批含提交号）/部署实录 4 步/冒烟 checklist 5 项全勾（含真凭据天气回合端到端与 DEF-042 契约规则线上核验）/回退方案（服务级 + 版本级零迁移）/冒烟账号注记齐备。版本号三处落位实测：package.json:4 / backend/pyproject.toml:3 / backend/app/main.py:76 均 1.1.0（6a9a8a3）。semver minor 论证在案（REQ-053 功能新增）。
- **偏离与上轮闭环**：NCR-iter21-001 整改在案——changes.md CHG-015 落地核对清单第 5/6 项已回填 ✅ 并注明交付证据（proto 6c048cf / 计划 d612956）；NCR-iter21-002 整改在案——scripts/hooks/pre-commit.sh:48-59 门禁 C 符号匹配已扩 ⬜/☐/◻ 并集（清单行锚定 `^\s*\d+\.\s*[⬜☐◻]`），v1.4.20 制度化 + tailoring 版本行同批（tailoring.md:4）。上轮 OBS：OBS-1 触发条件未出现（本地 backend/.env 变量名实测无 SEARCH/WEATHER 配置）、OBS-2 留档、OBS-3 已落 v1.4.20「走查输出编号对照」且 walkthrough-22 条目名合规、OBS-4 延续自洽（iter-22 开发期零 DEF 属实，DEF-041/042 为上线后缺陷批）。本轮新偏离（本地 .env 凭据撤出改进程环境注入）由 verify T2 §4 第 4 项 + weekly:301 插曲段承载，处理得当（门禁拦截实证、无 DEF 合理）。
- **复盘件**：retros/ iter-1 ~ iter-21 共 21 件齐全（+ qa-audit iter-1~21 存档）；iter-22 待 G4 属正常。

## 主会话补证（2026-08-23，git 取证）

1. **tag 远端在案**：`git ls-remote` 核实 req-baseline-v13 → 70f5392、v1.1.0 → 6a9a8a3；本轮审计本地复核两 tag 均为 annotated tag（tag 对象 544afb8/d5681ba），peel 后 commit 与主会话取证一致，tag message 含基线/发布语义，无漂移。
2. **串行时序实证**：计划批准 caac620（08-22 23:34:58）→ T0 留档 02c4377（23:38:13，仅 plans/iter-22-verify.md +77 行、零代码）→ T2 交付 5aad421（08-23 00:01:49）——T0 留档先于 T2 开发提交，v1.4.15 串行纪律（定夺④适配口径）成立；T0 提交零产品代码改动与计划验收标准一致。
3. **T2 五件套同批**：5aad421 单笔 stat 含代码（backend/app 5 文件 + backend/tests 4 文件 + scripts 2 件）+ verify + 周报 + RTM；defects.md 零变更 = 当轮零 DEF，符合制度「如有 DEF 同批」口径（非滞后同型）。
4. **缺陷批四件套**：DEF-041 批 30255d0（MessageList.vue + spec + e2e-def041-scroll.mjs + defects.md + 周报）、DEF-042 批 624b9e7（MemoryPane.vue + SettingsPaneCssContract.spec + e2e-def042-style-audit.mjs + defects.md + 周报）——修复代码、登记、周报、取证脚本同批齐整，stat 亲核。
5. **版本与发布链**：v1.1.0 三处版本号落位于 6a9a8a3（含周报 v1.1.0 发布节先行要件）；发布实录回填于 b52165b（00:32:20，releases/v1.1.0.md 新建 + 周报 1 行）——落盘时序与发布动作的关系见 NCR-iter22-002（要件先行承载于周报节、记录文件本体后置）。

## 关闭记录（2026-08-23 CEO 定夺「整改」，随整改批回填）

- **NCR-iter22-001 已整改闭环**：四处台账口径统一为「**20 test_weather 新增 − demo_weather 枚举 1 例退役 = 净 +19（363−1+20=382，--collect-only 机器计数）**」——iter-22-verify.md §2 表/§6 度量、weekly-W34.md iter-22 节、rtm.md REQ-053 行与全局回归基线行；OBS-1 措辞（3 个既有测试文件 × 8 处）随批收口。
- **NCR-iter22-002 定夺 = 按建议②**（CEO 2026-08-23「整改」）：**下轮发布起恢复两段式**——先落 releases/vX.Y.Z.md 要件版（本版包含/部署形态/冒烟验证点/回退）→ 执行部署 → 回填实录（沿 v1.0.0 先例）；本轮 v1.1.0 以同批周报 v1.1.0 节先行承载要件为缓解在案，不回溯重写。**无 tailoring 裁剪登记**（制度口径维持原文）。
- **OBS 处置**：OBS-1 ✅ 随 NCR-001 收口；OBS-2 ✅ vitest 终态 428 补记（weekly DEF 节 + RTM 天气面行）；OBS-3 知悉（走查 PASS 口径，条目编号对照已达 v1.4.20 要求）；OBS-4 知悉（注记节承载，内容实质未缺）；OBS-5 ✅ uv.lock 变更为版本落位合法配套（1.0.0→1.1.0 自身版本记录，随整改批提交收口）；OBS-6 认可（_TODAY 加固建议随 G4 复盘承载）。
