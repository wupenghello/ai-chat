# 需求变更记录 — ai-chat

每条变更一节，按时间倒序追加。没有记录的需求改动视为未发生（铁律 1）。

## CHG-015 普通用户用量与费用面板（个人用量可视化，设置弹窗新分区）

- 日期：2026-08-22
- 类型：新增（含波及注记；无存量 REQ 行为语义改写）
- 状态：**已批准（2026-08-22 CEO「全部按推荐」——整体批准 + 六定夺全按推荐定案：① 设置弹窗第七分区 ② 7/30 天二档默认 7 ③ 成本沿 REQ-038 定夺⑥原口径 ④ /api/quota 与 KeyModeCard 零改动、面板首行另呈今日 ⑤ 顺手项不搭班 ⑥ design-iter-21 设计基线前置；spec/RTM 同日同批落盘，tag req-baseline-v12 由主会话执行）**
- 原因/依据：iter-20 已于 2026-08-22 关闭（移动端主界面适配收官，基线 req-baseline-v11；复盘「下一候选待 CEO 定夺」）。**直接依据：CEO 2026-08-22 选定 iter-21 方向 = 普通用户用量/费用面板**（暂缓池候选比较结论：数据面地基已就绪 / 上线前配额体系对用户不再是黑盒 / 纯加法低风险；RAG 与移动端后续面留池等需求信号）。spec §4 暂缓池条目拉项：「用量与费用统计面板——**面向普通用户**的个人用量/费用可视化」（与 REQ-025 管理员治理后台的边界：REQ-025 已随 CHG-004 纳入，本条为普通用户个人面板）。CHG 编号顺延 = **CHG-015**，批准后出基线 req-baseline-v12。
- **现状代码取证（2026-08-22 逐项核实，非推测）**：
  - **数据面就绪**：telemetry 明细表（db.py 迁移 v8/v9）含 `user_id`/`mode`/`endpoint`（turn/research/compact/memory）/`kind`（llm/tool/compress/memory_extract）/token 三分项（prompt/completion/total）/缓存命中两列——按 user_id 过滤即可聚合个人面；**无成本列**，成本按单价现算（admin.py `_cost6` L392-401 为可复用先例：`(tokens×单价)/1e6`，单价 config.py L42-44 三变量 `AI_CHAT_PRICE_INPUT/OUTPUT/CACHE_HIT`，未配置全 null 不估算——铁律 5）。保留 90 天（telemetry.py L29）。
  - **普通用户侧现状**：GET /api/quota（proxy.py L477-501）仅返回**当日快照**（mode/daily_limit/used_today/reset_at/research_available），无历史、无 token 明细、无费用；前端 KeyModeCard.vue L29-30 以纯文本行呈现。**usage_daily/telemetry 的历史查询端点全部 admin-only**（admin.py L29 get_admin_user 403 门禁；/api/admin/usage L186、/api/admin/telemetry L313）——普通用户个人历史端点需**新增**。
  - **前端入口先例**：SettingsForm.vue 六分区（外观/密钥模式/高级设置/对话设置/AI 的记忆/账号），第五分区「AI 的记忆」即 CHG-011/REQ-043 加分区先例（左导航 tablist + 右面板 v-show）；侧栏账户「···」菜单（TheSidebar.vue L114-124）= 设置/管理后台/登出，无独立面板入口。
  - **成本口径先例**：REQ-038 定夺⑥——成本仅计 mode='unified'（服务端统一 key）LLM 行 + compress 行 tokens_prompt 按输入计价；自填 key（mode='self'）成本用户自担不计。admin 遥测卡「缓存缺失显 null 不显 0」为铁律 5 呈现先例。
- 内容：
  - **REQ-052 普通用户用量与费用面板〔CHG-015〕**（用户故事：作为用户，我要在设置里看到自己近期每日的对话用量与费用估算，以便了解配额消耗节奏、决定是否需要自填 key。描述：新增普通用户个人用量端点 `GET /api/usage/summary?days=N`（本人 user_id 从会话凭证解析，不得查他人——403/数据隔离面新增用例）；数据源 = telemetry 按 user_id 聚合（每日回合数/token 三分项/缓存命中/费用估算，成本口径沿 REQ-038 定夺⑥：仅 unified 计费、自填 key 行显示 token 不计费用、单价未配置全 null 不估算、缺失显 null 不显 0）；时间窗 7/30 天可切换（上限不超保留期 90 天）；今日快照（现 /api/quota 数字）并入面板分区首行呈现。前端 = 设置弹窗第七分区「用量与费用」（账号分区之前，REQ-043 加分区先例），零新增路由零新增弹窗形态，桌面/移动端（≤480px 全屏态）双态可用；零自造色值零新增令牌（沿 tokens v1.3 禁令）。主流程 = 打开设置 → 切「用量与费用」分区 → 选时间窗 → 看每日列表与费用估算。异常分支 = 遥测数据缺失时段显示已有数据并标注（不编造）；未配置单价 → 费用列显「未配置」不显 0；数据为空 → 空态文案；跨用户访问 → 403。验收标准：① 普通用户可查本人近 7/30 天每日回合数与 token 数，与 telemetry 表抽样比对一致（机器采集口径）② 费用估算仅 unified 模式计入、口径与 admin 遥测卡同一单价同一体例（admin.py `_cost6` 复用或同构提取）③ 用户 A 的任何界面/接口取不到用户 B 的用量（403 面新用例）④ 单价未配置时费用列显「未配置」非 0（铁律 5）⑤ 设置既有六分区与 /api/quota 既有形状零回退（test_quota 17 例零改动复跑，REQ-037 验收 3 红线）⑥ ≤480px 全屏态分区可用（REQ-050 全屏容器内不横向溢出）⑦ vitest 新增分区用例 + pytest 新端点用例全绿。优先级 P1；涉及页面 = SettingsForm（新分区）+ 后端 routers/proxy.py 或新 router（个人用量端点）。
- 定夺项（呈报 CEO，均附推荐）：
  - **① 入口形态**：推荐 = **设置弹窗第七分区**（REQ-043 加分区先例，零新路由零新弹窗形态、桌面/移动全屏态天然可用、与 KeyModeCard 今日快照同域就近）；备选 = 侧栏「···」菜单独立面板页（需新路由 + 移动端新面适配，成本 +M）。
  - **② 时间窗**：推荐 = **7/30 天二档切换**（默认 7；覆盖配额周节奏与月趋势，不超 90 天保留期）；备选 = 仅 7 天单档（更简但月趋势不可见）。
  - **③ 成本口径**：推荐 = **沿 REQ-038 定夺⑥原口径**（仅 unified 计费、自填 key 显示 token 不计费用、未配置显 null）——与 admin 面板同一体例，用户/管理员两侧数字可互证；备选 = 自填 key 也按单价估算（会虚构用户自担成本，违背「度量不编造」精神，不推荐）。
  - **④ 今日快照归位**：推荐 = **/api/quota 端点与 KeyModeCard 既有呈现零改动**，面板分区首行另呈「今日」行（数据同源不重复请求改造）——零回退面最小；备选 = KeyModeCard 文案并入新分区（波及 REQ-021 密钥模式卡与 2 例既有用例）。
  - **⑤ 顺手项搭班**：推荐 = **不搭**（deep-research 护栏 admin 只读显示 S 级、QA OBS-4 M40 复验均维持「非承诺顺手项」口径，iter-21 触相应环境时按池内登记处置，不进本 CHG 范围）；备选 = 护栏只读显示并入本迭代（+S0.5）。
  - **⑥ 设计基线前置**：推荐 = **design-iter-21 设计基线为全部开发任务前置**（v1.4.15 串行纪律；含 UI 新分区走 T1 设计 → T2/T3 开发标准路径，参考 DeepSeek 用量页形态由设计稿定夺）。
- 影响评估：
  - **工作量**：预估 Σ6 = T1 设计（M2）+ T2 后端端点与聚合（M2）+ T3 前端分区与走查收口（M2）——沿 iter-13~20 定级口径（S=1/M=2/L=3~4）；「默认不顶格」第五例（iter-14/17/18/20 先例），容量上限 Σ≤10 维持。细分依据：后端 = 1 端点 + 聚合查询 + 403 面用例（类比 test_admin_telemetry 8 例体量，M 有余）；前端 = 1 分区 + 双态适配 + vitest 15~20 新增（类比「AI 的记忆」分区先例）。
  - **进度**：iter-21 承载（iter-20 已关闭，容量校准连续十五轮零偏差）；不顶格 Σ6 留治理余量。
  - **受影响的其他需求**：REQ-028（设置弹窗）波及注记——分区数 6→7、导航项加一，行为语义零改写；REQ-024（配额）展示面引用注记（数据消费不改配额逻辑）；REQ-037（遥测）复用注记——telemetry 表零改动、写入点零改动、test_quota 零改动复跑红线；REQ-038 数据源同源注记（admin 与个人面同一表同一单价体例）。零 REQ 删除、零 REQ 语义改写。
  - **测试影响**：pytest 预估 +12~18（端点聚合一致性/403 跨用户/未配置单价/空态；347 存量零回退）；vitest 预估 +15~20（分区渲染/时间窗切换/空态与未配置态/移动全屏态；411 存量零回退）；走查新增 scripts/e2e-walkthrough-21.mjs。
  - **交互原型与设计稿同步（逐项）**：`design/proto/index.html` ——设置弹窗分区结构演示控制需加「用量与费用」分区示意（随 design-iter-21 设计基线同批，不单独先行）；`design/iter-21/` ——新建，本 CHG 的 UI 承载体（T1 设计基线，定夺⑥）；`design/iter-20/` 及更早——零同步（零波及）。
  - **风险**：①个人数据泄露面（新端点必须本人-only，403 用例承载）②telemetry 聚合查询性能（user_id+day 索引核实，90 天窗口内单用户量级极小，预期无风险）③KeyModeCard/配额条耦合（定夺④零改动口径规避）。
- **落地核对清单（v1.4.10）**：
  1. ✅ spec.md 新增 REQ-052 正文 + §4 暂缓池「用量与费用统计面板」条目移出注记 + REQ-028/024/037/038 波及/复用注记（2026-08-22 同批；头部基线注记 v12 同批）
  2. ✅ rtm.md 新增 REQ-052 行（设计稿/实现/测试/状态列）+ 全局回归基线行「用量面（CHG-015）」注记（pytest 347 / vitest 411 基线口径，2026-08-22 同批）
  3. ✅ changes.md 本条状态更新为已批准 + 定夺结果回填（2026-08-22 同批）
  4. ✅ tag req-baseline-v12（2026-08-22 主会话执行）
  5. ☐ design/proto 设置分区示意同步（随 design-iter-21 基线同批，不单独先行——本 CHG 影响评估承诺，T1 交付时兑现）
  6. ☐ plans/iter-21.md 依本 CHG 定夺起草（/mm-iteration-plan，Σ6 口径——T1 后随即起草）

## CHG-014 移动端主界面适配（主对话/设置弹窗响应式 + 触摸交互）

- 日期：2026-08-22
- 类型：新增（含波及注记与非功能兼容行正式改写；无存量 REQ 行为语义改写）
- 状态：**已批准（2026-08-22 CEO「全部按照推荐」——整体批准 + 八定夺全按推荐定案；spec/RTM 同日同批落盘，tag req-baseline-v11 由主会话执行）**
- 原因/依据：iter-19（D2）已于 2026-08-22 交付并关闭（七期 agent 路线 A1→A2→B1→B2→C→D1→D2 全部收官；rtm.md 全局回归基线 D2 面收口：后端 pytest 347 + 前端 vitest 378 + 走查 PASS；QA 审计整改闭环 + 复盘落制度，registry 已登记关闭；基线现为 **req-baseline-v10**，REQ-001~043 + REQ-045~048，REQ-044 永久留档不复用）。**直接依据：CHG-013 定夺⑦（2026-08-22 CEO「全部按推荐」定案）——移动端不与 D2 搭班，独立 CHG-014 + iter-20，设计基线前置**；spec §4 暂缓池「移动端主界面适配」条目（L1031：CHG-006 审计列为上线前决策项 → CHG-007 定序让位 → CHG-013 定夺⑦定案下一候选）拉项，CHG 编号顺延 = **CHG-014**，批准后出基线 req-baseline-v11。非功能现状（spec §3 兼容行 L1016）：仅登录/注册页承诺 ≤480px 移动端可用（仅此两页，其余页面维持现状不承诺；CEO 定 2026-08-15，随 design-iter-6 基线批准）；REQ-028 异常分支（L565）：窄屏（<480px）主界面移动端适配不承诺，但弹窗不得溢出视口。预估参考：CHG-013 定夺⑦容量算术引用「移动端预估 Σ5~7（主对话/设置/管理后台三面响应式 + 设计 + 断点走查）」。**现状代码取证（2026-08-22 逐项核实，非推测；全前端仅登录页存在 1 处媒体查询——`@media (max-width: 480px)` LoginView.vue L467，其余页面零断点零响应式）**：
  - **主界面骨架（App.vue L224-249）**：`.app` 纵向 flex 双列（侧栏 + `.main`），零断点；`.composer-row` 固定 padding `16px 24px 20px`（L244），≤480px 下左右各 24px 无收缩；`.composer-col` `max-width: 712px; margin: 0 auto`（L247）——移动端可用但纵向挤压，非本 CHG 主矛盾（矛盾在侧栏，见下条）。
  - **侧栏（TheSidebar.vue）**：固定 `width: 264px; flex: none`（L276），收起 rail 56px（L289，`mm-sidebar-collapsed` localStorage 持久化，L59-70）——**264px + rail 56px 双形态均为常驻占位列，≤480px 视口下 rail 56px 仍占 11.7% 宽度、展开态 264px 占 55%，会话列表与正文列被刚性挤压；无 overlay/抽屉形态，无媒体查询**。侧栏内会话列表项「···」菜单触发钮 28px 且 **hover 行时才浮现**（SessionListItem.vue L167/L175：`.item:hover :deep(.dd-trigger)` 显隐）——触屏无 hover，重命名/导出/删除入口触屏不可达。
  - **消息流（MessageList.vue / MessageBubble.vue）**：正文列 `max-width: 712px`（MessageList.vue L127），气泡 `max-width: 80%`（MessageBubble.vue L234）——相对宽度移动端天然适配；但**消息下方操作栏（复制/修改）为 hover 才显示**（MessageBubble.vue L319/L341：`.msg-col:hover .action-btn` 显隐，icon-only + hover 出 tooltip）——触屏无 hover，复制/修改入口触屏不可达；操作钮 24px（L330）小于触控推荐目标。
  - **ComposerBox（ComposerBox.vue）**：发送钮 `36px × 36px`（L182-183）小于 44px 触控推荐目标；信息行左右布局（开关簇 + 右对齐 hint，L149-179）窄屏下两端文案挤压换行无断点处理；hint 文案「Enter 发送 · Shift+Enter 换行」（L37）为桌面键盘口径，移动端无实体 Enter 语义提示；textarea 自适应高亮护栏 160px（L45/L139）移动端可用。
  - **设置弹窗（SettingsForm.vue）**：弹窗容器 `width: 720px; max-width: calc(100vw - 32px)`（L745-746）——≤480px 下物理收窄至视口宽-32px，但**内部为 168px 左侧导航 + 右侧表单的固定左右分栏（L812/L852），窄屏下表单列被压至 <280px，输入行/KeyModeCard 布局挤压；弹窗体 `overflow: hidden`（L757）+ 内层各自滚动，480px 下高度未全屏化，长表单双滚动**；内嵌二级弹窗（改密/注销）`width: 440px; max-width: calc(100vw - 48px)`（L1191-1192）同型挤压。REQ-028 既有承诺「弹窗不得溢出视口」（L565）现状靠 max-width 兜底未破，但「可用」不成立。
  - **管理后台（AdminView.vue）**：内容体 `width: min(1080px, calc(100% - 48px))`（L1072）；表格容器已有 `overflow-x: auto` 横向滚动兜底（L1246），表头 `white-space: nowrap`（L1262）；侧栏（985 `width: 360px; max-width: calc(100vw - 32px)`）与 win-seg/win 窗口切换为桌面信息密度设计，零断点——**现状 = 桌面优先 + 横向滚动兜底，不溢出视口但未承诺移动端可用**（是否纳入承诺面为定夺⑤）。
  - **触摸交互全局**：`:hover` 依赖显隐/提示共 32 处（TheSidebar 6 / MessageBubble 6 / SessionListItem 3 / SettingsForm 9 / AdminView 8），其中**功能入口级 hover 依赖 = 2 处**（SessionListItem「···」、MessageBubble 操作栏，触屏不可达，见上）；其余为视觉反馈级（hover 变色），触屏降级为 active 态可用。
  - **设计令牌（App.vue L130-206）**：语义令牌体系（tokens v1.3）+ `[data-theme='dark']` 根变量覆盖（REQ-017）——主题切换只覆盖根变量、组件一律引用语义令牌，响应式改动复用既有令牌即可承载（零新增令牌定夺⑦的代码依据）；**无断点令牌**（登录页 480 为就地媒体查询，非令牌）。
  - **测试基线**：pytest 347 + vitest 378 + 走查（iter-19 终态）；本 CHG 纯前端，后端零改动，pytest 347 回归即全绿预期。
- 内容（对 spec 的拟改，spec 级详细度——沿 CHG-007/009/010/011/012/013 呈批详度口径，批准后按拟文落 spec/RTM。除内容 4 汇总的定夺项外，其余口径本 CHG 定死）：
  1. **新增 REQ 三条（spec 级拟稿要点，结构与 spec §2 既有 REQ 一致，批准后原样落 spec §2。编号自 REQ-049 顺延——049 紧接 048；REQ-044 永久留档不复用（CHG-012 定夺②），无交叉。拆分理由：按「面」拆——主对话面（骨架/侧栏/消息流/Composer 一个运行现场）、设置弹窗（独立容器独立验收面）、触摸交互（跨面横切口径单列防散落），沿 CHG-012「管道/入口/度量」式按面拆分先例；管理后台不入 REQ（定夺⑤推荐维持桌面优先））**：
    - **REQ-049 主对话面移动端适配〔CHG-014〕**（用户故事：手机上打开 ai-chat，能完成「找会话 → 看消息 → 发消息」全闭环；描述：≤768px 侧栏抽屉化（overlay + 遮罩 `--c-mask`，触发钮 ≥44px，开合不改变会话数据与 localStorage 桌面收起态；>768px 现行双列/rail 形态零变化）；≤480px 消息流与 Composer 收窄（正文列 padding 收窄、气泡 max-width 放宽至 ≤92%、composer-row 左右 padding 收窄至 12px；Enter hint 文案切换触控口径）；主流程 = 抽屉开 → 选会话 → 抽屉自动关 → 正文全宽；异常分支 = 抽屉开时点遮罩/Esc/选会话均关、生成中开合抽屉不断流（SSE 与抽屉零交互）；验收标准：① ≤768px 视口侧栏不占常驻宽度（抽屉关闭时正文列宽 = 视口宽 100%，DOM 断言）② ≤768px 抽屉展开覆盖正文（overlay，非挤压）+ 遮罩点击关闭 ③ >768px 布局与现行走查基线逐像素零变化（桌面回归）④ ≤480px 消息气泡不横向溢出视口（scrollWidth ≤ clientWidth）⑤ ≤480px Composer 左右 padding ≤12px 且发送/停止钮可点击 ⑥ 抽屉状态不写入 `mm-sidebar-collapsed`（桌面收起态零污染）⑦ 生成中开合抽屉 SSE 流不中断（vitest 断言流帧序不变）；优先级 P1；涉及页面 = 主界面（App/TheSidebar/MessageList/MessageBubble/ComposerBox）。
    - **REQ-050 设置弹窗移动端适配〔CHG-014〕**（用户故事：手机上能打开设置、改完保存、关回对话现场；描述：≤480px 弹窗全屏化（inset 0，占满视口，保留关闭钮/Esc/返回路径；桌面 >480px 现行 720px 左右分栏零变化）；全屏态左侧导航转横向滚动条或分段切换（design-iter-20 定案）；内嵌二级弹窗（改密/注销）同口径全屏化或 ≥ 视口宽-16px；主流程/异常分支沿 REQ-028 既有口径零逻辑改动（弹窗内登出/改密/校验全部沿用）；验收标准：① ≤480px 弹窗宽 = 100vw、高 = 100vh（DOM 断言）② 全屏态内层单滚动（表单列唯一滚动容器，无双重滚动）③ ≤480px 弹窗内容不横向溢出视口 ④ 既有 settings/settings-form/账号全部 spec 用例在全屏容器下全绿（逻辑零改动回归，沿 REQ-028 验收 1 口径）⑤ >480px 弹窗与现行走查基线零变化 ⑥ 「前往高级设置」定位（iter-2 走查 15）在全屏态复验通过；优先级 P1；涉及页面 = SettingsForm（含内嵌改密/注销二级弹窗）。
    - **REQ-051 移动端触摸交互〔CHG-014〕**（用户故事：触屏上所有功能入口不依赖 hover 即可达；描述：功能入口级 hover 依赖 2 处改造——会话列表项「···」与消息操作栏（复制/修改）在 `@media (hover: none)` 或触屏判定下常显（不依赖 hover 浮现），其余视觉反馈级 hover 保留（active 态兜底）；交互目标：触屏下可点击目标 ≥44px（发送钮 36→44px、操作栏 icon 钮 24px 扩热区至 ≥44px 命中区——视觉尺寸不变、热区扩大，或视觉放大由 design-iter-20 定案）；桌面 hover 行为零回退；验收标准：① 触屏（hover: none）下会话「···」与消息操作栏无 hover 即可见（vitest 模拟断言）② 触屏下发送/停止/「···」/操作栏钮可命中区 ≥44×44px ③ 桌面（hover: hover）hover 显隐行为与现行零变化 ④ 深色模式（[data-theme='dark']）下新增触屏态全部走语义令牌，双主题走查零裸色值（沿 tokens v1.3 禁令）⑤ 桌面 vitest 既有 378 用例零回退；优先级 P1；涉及页面 = 跨面（TheSidebar/SessionListItem/MessageBubble/ComposerBox/SettingsForm）。
  2. **存量需求处理（本 CHG 无存量 REQ 正式改写——三条新 REQ 为纯前端加法适配，不改变任何存量 REQ 的验收断言面；正式改写 0 条 + 非功能 1 行正式改写 + 波及登记 3 项 + 零波及明示 3 项）**：
    - **正式改写：0 条**（明示）。REQ-028 的「窄屏不承诺」表述随非功能兼容行改写同步更新（见下），属非功能行承载，不动 REQ-028 正文。
    - **非功能条款 1 行（正式改写）**：
      - 兼容行（spec §3 L1016）改写后（拟文）：「桌面浏览器优先：Chrome / Edge / Safari 最新及上一大版本（均需支持流式请求；IndexedDB 仅用于旧版本本地数据的一次性迁移）；移动端响应式布局为 P1 目标——**〔CHG-014〕主对话面与设置弹窗承诺 ≤768px/≤480px 移动端可用（REQ-049/050/051，断点与触控口径见 changes.md CHG-014）；管理后台维持桌面优先不承诺移动端（CHG-014 定夺⑤），现状横向滚动兜底不溢出视口；登录/注册页 ≤480px 承诺沿用（design-iter-6）**」。
      - 架构/数据/可观测行零变化明示：纯前端改动，后端零改动、零新表零迁移（SCHEMA_VERSION 维持 10）、遥测零变化。
    - **波及登记 3 项（简版对照，口径不变、spec 描述随注记同步）**：
      - REQ-028（设置弹窗）：异常分支「窄屏（<480px）：主界面移动端适配不承诺，但弹窗不得溢出视口」补注「**〔CHG-014〕窄屏承诺升级：弹窗 ≤480px 全屏化（REQ-050），『不承诺』句废止、『不溢出』承诺由全屏化承载**」；既有验收零回退（验收面随 REQ-050 验收 4 复跑背书）。
      - REQ-026（侧栏/rail，含 026.4）：描述补「**〔CHG-014〕≤768px 侧栏抽屉化（overlay 形态，REQ-049）；>768px 双列/rail 形态与 localStorage 收起态零变化**」；rail/走查 16~18 既有验收在桌面断点复跑零回退。
      - REQ-017（主题）：描述补「**〔CHG-014〕移动端新增触屏态/断点样式全部引用既有语义令牌（零新增设计令牌，CHG-014 定夺⑦），深色模式根变量覆盖机制零变化、双主题走查零回退**」。
    - **零波及明示 3 项（判断结论如实登记）**：
      - REQ-047/046（深度研究开关/编排）：ComposerBox 信息行断点收窄不改开关语义、状态机与三与门口径零变化（REQ-049 验收 5 与 REQ-051 验收 5 背书）。
      - REQ-030~031/048（回合管线/网关/hooks）：纯前端布局改动，SSE 事件流、回合主路径、后端全零交互（REQ-049 验收 7 断言生成中断面仅前端容器）。
      - REQ-025/038（admin 面）：管理后台零改动（定夺⑤），桌面布局零变化。
    - 其余需求（REQ-001~016/018~025/027/029/032~037/039~043/045）不受影响。
  3. **关键技术机制写实（本 CHG 定死的技术口径；属定夺的参数汇总于内容 4）**：
    - **3.1 断点体系（定夺②定死）**：双断点 `≤768px`（平板/窄桌面：侧栏抽屉化触发）+ `≤480px`（手机：弹窗全屏化/正文列收窄触发）——480 沿登录页既有口径（LoginView L467 先例）零新值；768 为本 CHG 新增唯一断点值（侧栏 264px + 正文最小可用 ~500px 的算术下限）。断点以就地媒体查询承载（沿登录页先例），**不设断点令牌**（tokens v1.3 无断点类令牌，零新增令牌定夺⑦）。
    - **3.2 侧栏抽屉机制（定夺③定死）**：≤768px 侧栏转 `position: fixed` overlay + 遮罩（`--c-mask`），入口钮 ≥44px 常驻顶栏或正文左上（形态由 design-iter-20 定案）；开合态为会话级瞬态**不持久化**（不写 `mm-sidebar-collapsed`，该键仅承载桌面收起态）；选会话/点遮罩/Esc 即关；>768px 现行 flex 双列 + rail 56px 形态与走查基线零变化。
    - **3.3 触摸判定（定夺⑥定死）**：功能入口显隐用 `@media (hover: none)` 媒体特性承载（触屏设备无 hover 能力即常显），不做 JS UA 嗅探；`hover: none` 下常显、`hover: hover` 下维持现行 hover 浮现——同一 CSS 面 双态零 JS 分叉。
    - **3.4 与既有面的关系（零交互逐条）**：后端全零改动（pytest 347 回归即绿，预计零新后端用例）；SSE 流/回合管线/hooks/遥测零交互；设计令牌零新增（仅复用既有语义令牌 + `--c-mask` 遮罩既有值）；深色模式零回退（REQ-051 验收 4 双主题断言）；`dist/` 构建产物随发布流程不随本 CHG。
  4. **定夺项清单（2026-08-22 呈报；CEO 批准「全部按照推荐」= ①~⑧ 全部按推荐定案）**：
    | # | 定夺项 | 推荐方案（待定夺） | 理由摘要 |
    |---|--------|-------------------|---------|
    | ① | CHG-014 整体批准 | **批准**（REQ-049~051 新增与优先级 P1、非功能兼容行改写、波及 3 项 + 零波及明示 3 项、暂缓池联动；基线 req-baseline-v11） | CHG-013 定夺⑦既定下一候选；登录页先例口径可全量复用；上线前决策项（CHG-006 审计）收口 |
    | ② | 断点体系 | **双断点 ≤768px（侧栏抽屉）/ ≤480px（弹窗全屏/正文收窄）；480 沿登录页既有口径零新值，768 为唯一新增断点；就地媒体查询、不设断点令牌** | 480 已是 CEO 定案值（2026-08-15）零口径分叉；仅一档 480 则 481~768px 平板窗口侧栏仍挤压（264px 常驻占位取证）；断点令牌无既有类目、单点断点不值得扩令牌面 |
    | ③ | 主对话面侧栏形态 | **≤768px 抽屉化（fixed overlay + 遮罩；开合瞬态不持久化、不污染桌面收起键；>768px 现行形态零变化）** | rail 56px 在 480px 下仍占 11.7% 且无会话名（不可用）；抽屉是移动 IM 成熟范式（参考 CEO 2026-08-16 点名 DeepSeek 参考）；桌面零回退是硬约束 |
    | ④ | 设置弹窗 | **≤480px 全屏化（100vw×100vh、单滚动、左侧导航转横向切换；>480px 现行 720px 分栏零变化；内嵌二级弹窗同口径）** | 现状 720px 分栏压至 <280px 表单列取证不可用；REQ-028「不溢出」承诺由全屏化彻底承载；半屏/底部 sheet 形态留给 design-iter-20 在全屏化前提下微调 |
    | ⑤ | **管理后台是否承诺移动端** | **维持桌面优先不承诺（零改动入本 CHG；现状 overflow-x 横向滚动兜底不溢出视口；移动化留暂缓池随需求浮现走 CHG）** | ① admin 为低频管理面，主对话/设置是每日高频面，价值密度不对等；② admin 信息密度（1080px 容器/多列 nowrap 表格/遥测面板）移动化 = 独立设计面，纳入即 Σ5~7 封顶或超；③ 现状横向滚动兜底已满足「不溢出」，无数据不可达；④ 三面同做违背「一个迭代不同时塞两条主线」同文原则的变体（一个 CHG 不同时塞两个设计域） |
    | ⑥ | 触摸交互口径 | **`@media (hover: none)` CSS 判定（无 JS 嗅探）；功能入口级 hover 依赖 2 处（会话「···」/消息操作栏）触屏常显，视觉反馈级 hover 保留；可点击目标命中区 ≥44px（视觉尺寸不变热区扩大为准，视觉放大与否随 design-iter-20）** | hover 媒体特性是能力判定非设备猜测，标准口径；2 处功能入口取证触屏不可达是硬伤必须改；44px 为 Apple HIG/Google Material 双标准通行值；热区扩大不动视觉零桌面回退 |
    | ⑦ | 令牌与主题 | **零新增设计令牌（复用既有语义令牌 + 既有 --c-mask），深色模式零回退（双主题断言入验收）** | tokens v1.3「组件一律引用语义令牌、禁止裸色值」禁令天然覆盖新增样式；断点/触屏态无令牌类目（3.1/3.3）；深色模式是 REQ-017 既有承诺面，移动端新样式不得开裸色值口子 |
    | ⑧ | 工作量与串行口径 | **Σ5~7（沿 CHG-013 定夺⑦预估参考）推荐 Σ6 不顶格；design-iter-20 设计基线为全部开发任务前置（v1.4.15 串行纪律，纯 UI 迭代标准路径：T1 设计 → T2 开发严格串行）；iter-20 排期由 PM 走 /mm-iteration-plan** | 移动端为三面中两面（主对话/设置）响应式 + 触摸横切 + 设计 + 双断点双主题走查，Σ5~7 中值取 6；「设计基线前置」是 CHG-013 定夺⑦原文要求；走查面含 ≤768px/≤480px × 明/暗双主题四象限（走查条目扩容计入 Σ） |
  5. **影响评估**：
    - **存量需求逐条**：见内容 2——正式改写 0 条（明示）；非功能 1 行正式改写（兼容行）；波及登记 3 项（REQ-028/026/017）；零波及明示 3 项。其余需求不受影响。
    - **设计资产承载（v1.4.1 逐项核对，「原型即需求」）**：`design/proto` 与 `design/iter-1` ~ `design/iter-19` 全部不同步——移动断点对既有桌面原型不可见（桌面形态零变化的机制化表达）；**新增 design-iter-20 设计任务（定夺⑧前置）**——产出：≤768px 抽屉形态与入口钮位置、≤480px 弹窗全屏态与导航切换形态、触屏常显态样式、hint 文案触控口径、断点走查四象限清单。
    - **架构变更说明**：纯前端改动——App.vue（骨架断点）/TheSidebar.vue（抽屉形态）/SessionListItem.vue + MessageBubble.vue（hover:none 常显 + 热区）/ComposerBox.vue（44px/文案/信息行收窄）/SettingsForm.vue（全屏态）；**后端零改动、零新表零迁移、零新增 API/事件**；vitest 新增预估 20~30 用例（三条 REQ 验收断言 DOM 级）+ 既有 378 复跑。
    - **工作量与排期**：CHG-013 定夺⑦预估参考 **Σ5~7**；拆解预估 = T1 设计 M（2：design-iter-20 双断点双面设计基线 + 走查四象限清单）+ T2 前端 L（3~4：三 REQ 落地 + vitest 新增 20~30 + 既有 378 复跑 + 走查四象限 + 波及 3 项桌面回归）+ T0 收口 S（0.5~1：pytest 347 回归确认 + 文档）——**Σ5.5~7，推荐 Σ6 不顶格**。**备砍序（容量紧张时）**：① 768px 断点收窄至仅 480px 单断点（侧栏在 481~768px 维持现状，Σ−1）② REQ-051 热区扩大部分收窄至仅 2 处功能入口常显（44px 热区全量改留池，Σ−0.5）③ 设置弹窗全屏收窄为「仅全屏、不做导航横切」（导航保留纵列滚动，Σ−0.5）。**底线 = REQ-049 侧栏抽屉 + REQ-050 弹窗不溢出可用 + 2 处 hover 功能入口触屏可达**。排期由 PM 走 `/mm-iteration-plan`（iter-20）；design-iter-20 为 T2 前置（定夺⑧）。
    - **测试基线**：pytest 347 / vitest 378 / 走查（iter-19 终态）；本 CHG 纯前端——pytest 347 回归即绿预期（零后端改动断言登记 verify）；vitest 既有 378 零回退 + 新增 20~30；走查扩容 = ≤768px/≤480px × 明/暗主题四象限 + 桌面基线全量复跑（零变化断言）。
    - **发布影响**：v0.5.0 仍独立卡服务器，不受本变更影响。
  6. **暂缓池联动（随 spec §4 同步落盘，批准后执行）**：
    - 移动端条目：划线移出 + 注记「CHG-014 移出，2026-08-XX：落地为 REQ-049~051（批准结论随定夺回填；基线 req-baseline-v11）——主对话/设置/触摸交互三面，管理后台维持桌面优先（定夺⑤）」。
    - 新增条目：「管理后台移动端适配（admin 三面板响应式/触控）：CHG-014 定夺⑤维持桌面优先不承诺；现状 overflow-x 兜底不溢出视口；需求浮现（真实移动运维场景）走 CHG」。
    - 新增条目：「移动端原生能力面（PWA 安装/推送/分享面板/软键盘视口高度 100dvh 等）：本 CHG 仅覆盖浏览器内响应式；原生体验深化走 CHG（沿『移动端 App/桌面端打包』既有条目口径分界）」。
    - 其余条目（RAG/天气/供应商对比/体验深化主题包①②③/同步精细合并/用量面板/裁决口径观察项/记忆抽取度量可见性/deep-research 独立开关/异步研究任务/护栏 admin 配置面/webhook hook/hooks 拦截能力/非回合子系统事件）零变化。
- 落地核对清单（v1.4.10 制度 A；CEO 批准后逐项落地勾验，首个任务提交内落盘）：
  | # | 承诺项 | 状态 | 落地证据 |
  |---|--------|------|---------|
  | 1 | spec §2 新增 REQ-049~051 全文（按内容 1 拟稿；编号 049 顺延、044 留档口径注记） | ✅ | 随 CHG-014 批准同批落盘（2026-08-22，本提交） |
  | 2 | 非功能兼容行正式改写 + 波及 3 项注记 + 零波及明示 3 项（内容 2 拟文） | ✅ | 同上（spec.md §3 兼容行 + REQ-028/026/017 注记） |
  | 3 | spec §4 暂缓池联动（移动端条目移出 + 两条新增，内容 6 拟文） | ✅ | 同上（spec.md §4） |
  | 4 | RTM 新增 REQ-049~051 行 + 变更备注表 CHG-014 行 + 全局回归基线移动端面说明 | ✅ | 同上（rtm.md，本提交；全局回归基线移动端面随 iter-20 收口再更新） |
  | 5 | 定夺项①~⑧结论回填本条 | ✅ | 见下方批准回填（八定夺全按推荐定案） |
  | 6 | registry.md 同步（主会话执行） | ✅ 由主会话执行 | 随 CHG-014 批准登记（company-os 提交，主会话执行） |

- CEO 批准：批准（2026-08-22，CEO 原话「全部按照推荐」——CHG-014 整体批准 + 八定夺全按推荐定案：①整体批准出基线 req-baseline-v11 ②双断点 ≤768px（侧栏抽屉）/≤480px（弹窗全屏/正文收窄），480 沿登录页既有口径零新值、768 为唯一新增断点，就地媒体查询、不设断点令牌 ③≤768px 侧栏抽屉化（fixed overlay + 遮罩，开合瞬态不持久化、不污染桌面收起键；>768px 现行形态零变化）④设置弹窗 ≤480px 全屏化（100vw×100vh、单滚动、左侧导航转横向切换；>480px 现行 720px 分栏零变化；内嵌二级弹窗同口径）⑤**管理后台维持桌面优先不承诺**（零改动入本 CHG；现状 overflow-x 横向滚动兜底不溢出视口；移动化留暂缓池随需求浮现走 CHG）⑥触摸交互 `@media (hover: none)` CSS 判定（无 JS 嗅探）；功能入口级 hover 依赖 2 处触屏常显，视觉反馈级 hover 保留；可点击目标命中区 ≥44px（视觉尺寸不变热区扩大为准，视觉放大与否随 design-iter-20）⑦零新增设计令牌（复用既有语义令牌 + 既有 --c-mask），深色模式零回退（双主题断言入验收）⑧Σ5~7 推荐 Σ6 不顶格 + design-iter-20 设计基线为全部开发任务前置（v1.4.15 串行纪律）+ iter-20 排期由 PM 走 /mm-iteration-plan；spec/RTM 同日同批落盘，tag req-baseline-v11 由主会话执行）
  | 7 | design-iter-20 设计基线（双断点双面 + 走查四象限清单）为 T2 开发前置（定夺⑧串行口径） | ✅ 已落地（2026-08-22 CEO「批准，全部按推荐」六定夺定案，fb0b667 + tag design-iter-20；NCR-iter20-001 整改回填） | design/iter-20 |

## CHG-013 架构升级第七期 D2：生命周期事件 hooks（进程内旁路回调）

- 日期：2026-08-22
- 类型：新增（含波及注记；无存量正式改写）
- 状态：**已批准（2026-08-22 CEO「全部按推荐」= 整体批准 + 八定夺全按推荐定案，基线 req-baseline-v10）**
- 原因/依据：iter-18（D1）已于 2026-08-21 交付并关闭（rtm.md 全局回归基线 D1 面收口：后端 pytest 332 + 前端 vitest 378 + 走查 41 PASS/0 FAIL；QA 审计整改闭环 + 复盘落制度 v1.4.17，registry 已登记关闭），七期路线 A1→A2→B1→B2→C→D1 ✅→**D2（最后一期，收官）**下一候选 = D2；spec §4 暂缓池「D2：hooks（生命周期事件进程内旁路回调先行，HTTP webhook 后置；可与移动端搭班）——agent 路线第 7 期」条目拉项（审核稿 §六.2「每期排期时走一条 CHG」模式，沿 CHG-007/009/010/011/012 先例；CHG 编号顺延 = **CHG-013**，批准后出基线 req-baseline-v10）。上游依据：已批准审核稿 `docs/architecture-upgrade-plan-2026-08-17.md`——§三要素 10「hooks 系统：**生命周期事件回调先行（消息到达/工具前后/回合结束，进程内旁路 function），HTTP webhook 后置**」；§四 D2 行「Σ4~6（小迭代，可与移动端搭班）：生命周期事件枚举 + 进程内旁路回调 + 后置 HTTP webhook + 配置面；验收口径示例：**先旁路不阻塞，防做成第二套循环**」；§九 D1/D2 行「hooks 留口子接通知/自动化」；§四顺序依赖「D 依赖 A 的工具网关」。前置依赖已就绪：A1/A2（iter-13/14）工具网关六项校验、ReAct 循环 run_turn、B1~D1 全部交付关闭，基线现为 req-baseline-v9（REQ-001~043 + REQ-045~047；REQ-044 永久留予 CHG-011 拟稿）。**现状代码取证（2026-08-22 逐项核实，非推测）**：
  - **回合受理管线（「消息到达」点位，proxy.py `chat_turn()` L180-375）**：会话归属 404（L193-198）→ 上游解析 503（L200-202）→ research 三与门 422（L208-212）→ 配额先查后计（L214-221，blocked 即返零上游调用）→ **turn_id 生成（L232）** → 组装链 snip→compact→记忆→research 注入（L233-259）→ 工具三与门下发（L266-269）→ logger.info「turn accepted」（L310-311）→ generating_sessions 登记（L315-317）→ SSE stream（L319）。**turn.accepted 埋点候选 = L232 之后（turn_id 可关联、组装开始前、配额已计——受理成立点）**；被拒回合（404/503/422/429）零 hook 事件——拒绝面已有日志（L220「chat blocked」等）与遥测承载。
  - **ReAct 循环（agent.py `run_turn()` L270-507，工具前后与终态点位）**：turn.start（L311）/ turn.step（L352）/ llm 遥测行先于后续 yield 落库（L420-423）/ 工具段 L452-491——**tool.call 事件 yield（L458-459）→ 未注册工具即 error result（L460-462）/ execute_tool 网关执行（L463-466）→ tool 遥测行（L468-470）→ tool.result 事件 yield（L474-481）→ 包裹回填（L484-488）**；终态 usage（L492）+ turn.end（L493，reason=done/max_steps/time_limit/error）；**断连取消 except (CancelledError, GeneratorExit)（L494-503）：补 cancelled llm 行后原样重抛、不产 turn.end 事件**——turn.cancelled 独立事件的代码依据；finally（L504-507）收尾 on_finish=record_usage→quota.record_tokens（L271-273）。**埋点定位：tool.before = L458 后 L463 前（覆盖未注册→error 路径，与 tool.call 事件同点位）；tool.after = L468-470 遥测行同点位（execution 三终态已知）；turn.end = L493 后（reason 与累计值已知）；turn.cancelled = L494 handler 内（fire-and-forget 后重抛，不引入新 await 点）**。
  - **心跳与 SSE 层零交互（proxy.py `stream()` L319-373）**：watchdog 事件任务竞速（ensure_future L348 / asyncio.wait timeout L350 / 空闲补注释帧 L356）+ finally 收尾（L366-373：next_ev.cancel + suppress await + agen.aclose）——hook 埋点全部位于 run_turn 生成器内（agent 侧单点，受理事件在 proxy 侧），与心跳层零交互；**该处的 fire-and-forget 任务管理与取消收尾 suppress 体例可直接复用于 hook 分发任务**。
  - **旁路写入与异常隔离先例（故障隔离的同型代码）**：telemetry.py `_write` 独立短连接 + 吞 sqlite 异常仅 warning（L57-81，REQ-037 验收 4 主路径隔离先例）；agent.py `_emit` sink 异常吞 + warning（L334-340）——hook 分发的故障隔离与此同型；run_turn 已有回调注入先例（telemetry_sink/on_finish 形参，L285-286）——hook dispatcher 注入方式（直接 import vs 回调参数注入）为实现级决策，T0 定案登记 verify。
  - **静态注册先例（tools.py / main.py）**：_REGISTRY + register_tool（tools.py L81-85）；main.py import 即静态注册（search，L16-17）——register_hook 同型；ToolDef.gate 运行时能力门（tools.py L59-61）+ app_settings KV 运行时开关（db.py kv_get/kv_set L238-249 + is_search_enabled L255-260）为未来 webhook 消费者开关预留形态参照（本 CHG 不启用，定夺④）。
  - **配置先例（config.py L8-69）**：Settings env_prefix `AI_CHAT_` 全参数 .env 可覆盖 + 「T0 定死值」注释体例；独立超时护栏先例 = summary_timeout 30s（L51）/ memory_extract_timeout 30s（L60）/ heartbeat_interval 20s（L69）——hook_timeout 同形态新增。
  - **「任务持久化」先例与「事件分发」的哲学分界（memory.py / main.py）**：lifespan 常驻扫描任务（main.py L52-59）+ scan_loop 异常自吞不杀循环（memory.py L392-404）+ memory_jobs 持久化重启恢复（scan_once L325-387）——这是**后台任务持久化**先例；hook 分发**不排队、不落库、不重试**（防第二套循环），与 memory_jobs 哲学分界明确（若未来 webhook 需要出站队列执行器，可循此先例走独立 CHG）。
  - **非回合子系统事件点位（评估后不入首版枚举，定夺②）**：记忆抽取触发（memory.py scan_once pending 落库 L375-385 / execute_job L196-299，已有 memory_extract 遥测行 L255-259）；压缩触发（proxy.py `_assemble_pipeline` 自动 L159-177 / `chat_compact` 手动 L446-455，已有 compress 行）——子系统事件已有遥测承载，hook 化无当前消费者，留池。
  - **迁移与测试基线**：db.py `SCHEMA_VERSION = 10`（L15），v1~v10 已占用——**D2 零新表零迁移（注册表为进程内代码态）**；pytest 332 + vitest 378 + 走查 41/0（iter-18 终态）。注：基线号 req-baseline-v10 与迁移 v10（user_memories）数字巧合、互不相干。
- 内容（对 spec 的拟改，spec 级详细度——沿 CHG-007/009/010/011/012 呈批详度口径，批准后按拟文落 spec/RTM。除内容 4 汇总的定夺项外，其余口径本 CHG 定死）：
  1. **新增 REQ 一条（spec 级拟稿全文，结构与 spec §2 既有 REQ 一致，批准后原样落 spec §2。编号自 REQ-048 顺延——048 紧接 047；REQ-044 永久留予 CHG-011 记忆度量拟稿（CHG-012 定夺②），无交叉。拆分理由：D2 新增实体唯一 = hook 机制本身（枚举/注册/分发/埋点/配置为其组成面，B2「管道/入口/度量」式拆分不适用）；HTTP webhook 为后置项不入 REQ（定夺⑥）；遥测零新增不设度量条（沿 CHG-011 定夺⑩ REQ-044 不立项先例）——故单条 REQ-048 承载）**：即 spec §2「REQ-048 生命周期事件 hooks（进程内旁路回调）〔CHG-013〕」全文（用户故事/描述/主流程/异常分支/验收标准 8 条/优先级 P0/涉及页面=不涉及）——正文以 spec §2 落盘稿为准，此处不重复。
  2. **存量需求处理（本 CHG 无正式改写——D2 不改变任何存量 REQ 的验收语义，全部为加法埋点与注记；正式改写 0 条 + 非功能 2 行 + 波及登记 1 项 + 零波及明示 8 项）**：
    - **正式改写：0 条**（明示）。D1 的 REQ-030/036 正式改写源于其描述句承载的行为变化（心跳帧/reason 枚举/注入序）；D2 埋点不改变 REQ-030~047 任何一条的验收断言面，故全部为波及注记级。
    - **波及登记 1 项（简版对照，口径不变、spec 描述随注记同步）**：
      - REQ-030：描述 CHG-012 注记段之后补：「**CHG-013/D2 起回合管线与受理点埋生命周期 hook 分发点（旁路 fire-and-forget，REQ-048）——SSE 事件流、三护栏、遥测与计费口径零变化；埋点失败不影响回合（旁路彻底性）。**」既有六条验收零回退（验收 1/4 随 REQ-048 验收 2/4 复跑背书）。
    - **非功能条款 2 行（正式改写）**：
      - 架构行补：「〔CHG-013〕agent 运行时增生命周期事件 hooks 旁路分发机制（进程内回调静态注册、闭合 5 事件枚举、fire-and-forget + 独立超时护栏、只观察不决策——技术口径见 changes.md CHG-013）。」
      - 可观测行补：「〔CHG-013〕hook 分发失败/超时记服务端 warning 日志（hook 名/事件名，不含消息内容与 key，机器可查）；hooks 不落遥测行（遥测 kind 枚举零变化）。」
      - 数据行**零变化明示**（不改动）：零新表零迁移（SCHEMA_VERSION 维持 10；注册表为进程内代码态，重启即随代码重建）。
    - **零波及明示 8 项（判断结论如实登记，不凑数）**：
      - REQ-031 工具网关：tool.before/tool.after 埋点位于 agent.py 调用侧（tool.call 事件点与 execute_tool 返回点），tools.py 网关零改动——六项校验与网关日志四字段口径零变化。
      - REQ-032 / REQ-047 前端：零前端改动、零新增 SSE 帧类型、零新增 block 类型——hook 事件不下发前端（前端零感知）。
      - REQ-033 / REQ-036 组装链：turn.accepted 在组装开始前受理点触发，不触碰组装管道与注入序——组装器输入输出单点收敛不破。
      - REQ-037 遥测：hooks 不落遥测行、kind/endpoint 枚举零变化、llm/tool 行形状零变化（hook 分发与遥测写入为两个独立旁路）。
      - REQ-039 / REQ-042 压缩与记忆子系统：子系统事件不入首版枚举（定夺②留池）——管道、抽取、注入零交互。
      - REQ-045 心跳：埋点全部位于 run_turn 生成器内与 proxy 受理点，与 stream() watchdog 零交互——心跳帧与事件序断言零变化。
      - REQ-046 deep-research：hooks 对 research 回合同管线天然生效（REQ-048 验收 6 承载）——编排、双护栏、注入、计费零变化，无特例分支。
      - REQ-024 / REQ-034 配额计费：turn.accepted 在配额通过后触发（被拒回合零事件，REQ-048 验收 7）——quota.py 零改动、usage_daily 落账零变化。
    - 其余需求（REQ-001~023/025~029/038/040/041/043/045）不受影响。
  3. **关键技术机制写实（本 CHG 定死的技术口径；属定夺的参数汇总于内容 4）**：
    - **3.1 事件点位表（T0 核对回填，实现以此为准）**：
      | 事件 | 落点（2026-08-22 取证） | 触发时点语义 |
      |---|---|---|
      | turn.accepted | proxy.py chat_turn：配额通过后、turn_id 生成后（L232 之后）、组装开始前 | 受理成立 = 消息确定进入处理（被拒回合零事件） |
      | tool.before | agent.py run_turn：tool.call 事件 yield 后（L458-459 后）、execute_tool 前（L463 前） | 模型发起工具调用（含未注册→error result 路径） |
      | tool.after | agent.py run_turn：tool 遥测行同点位（L468-470） | 工具执行终态已知（ok/error/timeout + duration_ms） |
      | turn.end | agent.py run_turn：turn.end 事件后（L493 后） | 回合终态（reason 四值 + 累计 requests/tokens） |
      | turn.cancelled | agent.py run_turn：取消处理器内（L494-503，补 cancelled 遥测行后、重抛前） | 断连/中止终态（现行口径不产 turn.end） |
    - **3.2 载荷 schema（元数据-only，frozen dataclass）**：公共字段 = event / turn_id / session_id / user_id / mode / timestamp；工具事件加 step / tool_name；tool.after 加 status / duration_ms；turn.end 加 reason / requests / tokens。**排除项（卫生口径）**：消息正文、工具入参全文与结果全文、任何 key、上游 base_url——一律不进载荷与 hook 日志。
    - **3.3 分发语义与任务生命周期（定死框架）**：dispatch(event) → hooks_enabled 为假或注册表空 → 短路返回（零任务创建）；否则逐命中 hook 创建独立任务（create_task + 强引用集合，任务终态自移除），任务内 wait_for(hook(event), hook_timeout)，异常/超时吞掉 + warning（hook 名/事件名）。**不排队、不落库、不重试、无序**——与 memory_jobs「任务持久化」哲学的分界（取证第 7 条）；若未来 webhook 需要出站队列，走独立 CHG 循常驻任务先例。hook dispatcher 注入 agent/proxy 的方式（模块级单例直接调用 vs 沿 telemetry_sink 回调形参注入）为 T0 定案的实现级决策，登记 verify 不走变更。
    - **3.4 配置与注册形态（定夺④定死）**：`AI_CHAT_HOOKS_ENABLED`（默认 true）/ `AI_CHAT_HOOK_TIMEOUT`（默认 5.0s，T0 定档授权 1~30s）经 config.py Settings 同形态新增；注册面 `hooks.register_hook(name, callback, events=None)` 部署侧代码调用（main.py 或部署自建模块 import 即注册，沿 search 先例）；**不启用 app_settings KV、不加 admin 端点与字段**——依据 spec §4「护栏属部署配置（低频、误配即失守）vs 开关属运行时配置（高频、binary）」口径：hook 注册本身是代码级部署配置，函数无法经运行时注册，运行时开关在消费者为零时无操作对象；待 webhook 等真实运行时消费者出现，其启停开关再按「开关属运行时配置」口径评估 app_settings KV（届时随该 CHG）。
    - **3.5 与既有面的关系（零交互逐条）**：SSE v2 事件协议零新增帧类型；遥测 kind/endpoint 枚举与行形状零变化；usage_daily/quota 零改动；心跳层零交互；research 编排零分叉（同管线天然覆盖）；blocks/schema:2/LWW 零交互（hook 不读写会话档）；前端零改动。
  4. **定夺项清单（2026-08-22 呈报；CEO 批准「全部按推荐」= ①~⑧ 全部按推荐定案）**：
    | # | 定夺项 | 定案（= 推荐，CEO「全部按推荐」） | 理由摘要 |
    |---|---|---|---|
    | ① | CHG-013 整体批准 | **批准**（REQ-048 新增与优先级 P0、波及 1 项 + 非功能 2 行 + 零波及明示 8 项、暂缓池联动；基线 req-baseline-v10） | 审核稿 D2 期既定路线收官项，A 工具网关与回合管线前置全就绪 |
    | ② | 事件枚举范围 | **闭合 5 事件**（turn.accepted / tool.before / tool.after / turn.end / turn.cancelled） | 审核稿点名「消息到达/工具前后/回合结束」= 4 项；**多纳入 turn.cancelled**：断连是真实生命周期终态且现行口径不产 turn.end（agent.py L494-503 取证），通知类消费者必须能区分「完成」与「中断」，缺失即枚举开洞、后续加法反要走变更。**不纳入**：步进 turn.step（SSE 已有事件、hook 化无消费者）、上游调用级（llm 遥测行已承载）、记忆抽取/压缩触发等子系统事件（已有遥测行承载，无当前消费者——留池，浮现走 CHG） |
    | ③ | hook 形态与分发语义 | **async callable + fire-and-forget 独立任务 + 独立超时 5s + 无序不重试 + 只观察不决策（无拦截/否决/改写语义）** | 同步内联调用会把 hook 耗时计入回合主路径，直接违背「旁路不阻塞」；队列/持久化/重试是 memory_jobs 式任务系统的面，事件分发做成第二套循环正是审核稿点名要防的形态；hook 无返回值消费 = 「只观察不决策」的机制化落实（拦截类需求浮现须先论证范围再走 CHG） |
    | ④ | 注册与配置归属（hooks 面向谁） | **部署者级：代码静态注册 + .env 两参数（hooks_enabled 默认开 / hook_timeout 默认 5s）；admin 运行时零新增配置面、普通用户不可见** | 函数只能随代码注册，admin 运行时注册无意义；沿 spec §4「护栏 vs 开关」口径，hooks 整体属部署配置域（注册即代码、启停低频）；默认开的依据 = 注册表空即无操作（机制惰性），开关仅为部署者免改码停用保留；webhook 等运行时消费者出现时其开关再评估 app_settings KV（沿搜索开关先例）。admin 只读显示不推荐：注册表内容是代码事实非运行配置，无运营属性 |
    | ⑤ | 载荷卫生 | **元数据-only：不含消息正文、工具结果全文、任何 key**（内容扩展留池） | 沿 REQ-037 验收 5 / REQ-042 验收 7 卫生先例——载荷进任意 hook 的日志/通知面，含内容即扩大泄漏面；元数据已满足通知/审计/自动化消费者的当前可预见需求 |
    | ⑥ | HTTP webhook | **本 CHG 零出网零外发，webhook 后置留暂缓池（独立 CHG）** | 审核稿要素 10 定案「HTTP webhook 后置」；webhook 面大（出网白名单/重试/签名/脱敏/队列），与首版机制无依赖关系，混入即超 Σ4~6 定级 |
    | ⑦ | **移动端主界面适配是否搭班 D2** | **不搭班：D2 单独 iter-19（Σ4~5 收官小迭代），移动端独立 CHG-014 + iter-20（设计基线前置）** | ① 审核稿同文原则「一个迭代不同时塞两条主线」（§四移动端注），「可与搭班」是许可以非指令；② 容量算术：D2 Σ4~5 + 移动端预估 Σ5~7（主对话/设置/管理后台三面响应式 + 设计 + 断点走查）= Σ9~12，贴顶或超 Σ≤10 硬约束，超 30% 砍范围纪律易触发；③ 回归面叠加：D2 触回合主路径（pytest 332 回归）+ 移动端触全前端布局（vitest 378 + 走查回归），QA/走查面翻倍；④ v1.4.15 串行纪律下「设计基线为全部开发任务前置」——搭班则 D2 纯后端开发须等移动端设计基线（长极拖快极），或另登 tailoring 偏离；⑤ D2 是路线收官，单独小迭代快速闭环后，移动端获得整迭代容量与专属设计 |
    | ⑧ | 工作量与串行口径 | **Σ4~5 不顶格；T0 技术基线（机制写实 = 事件点位表/载荷 schema/分发语义/T0 实测）为 T2 开发前置——零 UI 迭代的串行纪律适配：无设计稿任务（零 UI），T0 技术基线承担「基线先行」职能，T0→T2 严格串行，无未登记并行** | 沿「默认不顶格、顶格需三条理由」口径（retros/iter-17 §4）；v1.4.15 严戒的是「未登记的开发偷跑先于基线」（tailoring 2026-08-20），D2 以 T0 机制写实为基线载体满足串行目的，不构成偏离（QA 审计对照本条核对） |
  5. **影响评估**：
    - **存量需求逐条**：见内容 2——正式改写 0 条（明示）；非功能 2 行（架构/可观测；数据行零变化明示）；波及登记 1 项（REQ-030）；零波及明示 8 项。其余需求不受影响。
    - **设计资产承载（v1.4.1 逐项核对，「原型即需求」）**：`design/proto` 不同步——对 iter-1 核心闭环原型不可见（hooks 零 UI 零前端改动）；`design/iter-1` ~ `design/iter-18` 全部不同步——无任何 REQ 界面口径变化（D2 零新增界面、零交互变化）；**无新增 design-iter-19 设计任务**——D2 为纯后端零 UI 迭代（定夺⑧：T0 技术基线承担基线先行职能；若移动端搭班〔定夺⑦已定案不搭班〕则 design-iter-19 为移动端设计稿、随 CHG-014 立项）。
    - **架构变更说明**：后端新增 `backend/app/hooks.py` 薄模块（事件枚举 + HookEvent 载荷 + 注册表 + dispatch，预估 100~150 行，沿 research.py 薄模块先例）；agent.py run_turn 埋点 4 处 + proxy.py chat_turn 埋点 1 处（dispatcher 注入方式 T0 定案）；config.py +2 参数（hooks_enabled / hook_timeout）；main.py 留注册挂载点注释示例（部署者参照）；tests/test_hooks.py 新增（预估 15~20 用例）。**db.py / telemetry.py / quota.py / 前端全部零改动；零新表零迁移。**
    - **工作量与排期**：审核稿 D2 定级 **Σ4~6**；拆解预估 = T0 取证与技术基线 S（1：分发语义实测〔create_task 取消路径行为/任务强引用与 GC/wait_for 取消钩子〕+ 事件点位核对表 + hook_timeout 定档 + 机制写实文档）+ T1 无（零 UI 无设计任务）+ T2 后端 M~L（2~3：hooks.py + 5 埋点 + config + pytest 新增 + 存量 332 复跑〔REQ-030/045/046 回归面〕+ D2 面收口）——**Σ4~5，推荐 Σ4 不顶格**（T2 取 M 下沿 2：机制面小、复用面全在——注册/超时护栏/异常吞三先例现成）。**备砍序（容量紧张时）**：① turn.cancelled 事件收窄（枚举回 4 项，断连终态由 cancelled llm 遥测行承载，Σ−0.5）② hook_timeout 可配置性降为常量（Σ−0.5）③ turn.accepted 收窄（不推荐——「消息到达」是审核稿点名项）。**底线 = tool.before/tool.after/turn.end 三事件 + 旁路分发 + 故障隔离**（审核稿点名最小集）。排期由 PM 走 `/mm-iteration-plan`（iter-19 候选）；T0 为 T2 前置（定夺⑧）。
    - **测试基线**：pytest 332 / vitest 378 / 走查 41（iter-18 终态）；D2 面沿全局回归基线口径——存量全绿（预计零既有用例改写：埋点为纯加法旁路，事件序断言不含 hook 副作用——「改写映射为零」断言登记 verify）、功能性删除为零、度量数据全部机器采集（铁律 5）；无 UI 走查面（零 UI）。
    - **发布影响**：v0.5.0 仍独立卡服务器，不受本变更影响。
  6. **暂缓池联动（随 spec §4 同步落盘）**：
    - D2 条目：划线移出 + 注记「CHG-013 移出，2026-08-22：落地为 REQ-048（八定夺全按推荐定案；基线 req-baseline-v10）——七期路线收官」。
    - 新增条目：「HTTP webhook hook（事件外发消费者）：出网白名单/重试/签名/脱敏/队列面随其 CHG；其启停开关届时按『开关属运行时配置』口径评估 app_settings KV（CHG-013 定夺④⑥）」。
    - 新增条目：「hooks 拦截/改写能力（hook 否决/改写工具调用或回合行为）与载荷内容扩展（消息正文/工具结果进载荷）：首版只观察 + 元数据-only（设计原则『不做第二套循环』与卫生口径）；需求浮现须先论证范围再走 CHG（CHG-013 定夺③⑤）」。
    - 新增条目：「非回合子系统生命周期事件（记忆抽取触发/压缩触发/步进等）：首版枚举闭合于回合生命周期 5 事件，子系统事件已有遥测行承载；需求浮现走 CHG（CHG-013 定夺②）」。
    - 移动端条目按定夺⑦定案补注记：「D2 已单独收官排期（iter-19 候选），移动端主界面适配为下一候选（独立 CHG-014 + iter-20，设计基线前置）」。
    - 其余条目（RAG/天气/供应商对比/体验深化主题包①②③/同步精细合并/用量面板/裁决口径观察项/记忆抽取度量可见性/deep-research 独立开关/异步研究任务/护栏 admin 配置面）零变化。
- 落地核对清单（v1.4.10 制度 A；CEO 批准后逐项落地勾验，首个任务提交内落盘）：
  | # | 承诺项 | 状态 | 落地证据 |
  |---|--------|------|---------|
  | 1 | spec §2 新增 REQ-048 全文（按内容 1 拟稿；编号 048 顺延、044 留档口径注记） | ✅ | 随 CHG-013 批准同批落盘（2026-08-22，本提交） |
  | 2 | REQ-030 波及注记 + 非功能两行（架构/可观测）+ 数据行零变化明示（内容 2 拟文） | ✅ | 同上（spec REQ-030 描述段 + §3 两行） |
  | 3 | spec §4 暂缓池联动（D2 移出 + 三条新增 + 移动端条目按定夺⑦定案，内容 6 拟文） | ✅ | 同上（spec §4） |
  | 4 | RTM 新增 REQ-048 行 + REQ-030 波及注记 + 变更备注表 CHG-013 行 + 全局回归基线 D2 面说明（v1.4.11 C 行级收口 + v1.4.16 独立行同批收口） | ✅ | 同上（rtm.md，本提交） |
  | 5 | 定夺项①~⑧结论回填本条（含 hook_timeout 若 T0 定档非 5s 的回填） | ✅ | 本条内容 4（八定夺全按推荐定案；hook_timeout 维持 5s 拟值，T0 定档授权在案） |
  | 6 | registry.md 同步（主会话执行） | ✅ | 2026-08-22 随 CHG-013 批准登记（company-os 提交） |
  | 7 | T0 机制写实留档（事件点位表/载荷 schema/分发语义/T0 实测值，plans/iter-19-verify.md）为 T2 开发前置（定夺⑧串行口径） | ✅ 已交付（2026-08-22，0444fbb；NCR-iter19-001 整改回填——原漏勾） | plans/iter-19-verify.md T0 段（REQ-048 验收 8 载体） |
- CEO 批准：批准（2026-08-22，CEO 原话「全部按推荐」——CHG-013 整体批准 + 八定夺全按推荐定案：①整体批准出基线 req-baseline-v10 ②闭合 5 事件③fire-and-forget 旁路语义只观察不决策④部署者级注册与 .env 配置⑤元数据-only 载荷⑥webhook 后置留池⑦**移动端不搭班**（D2 单独 iter-19 收官，移动端独立 CHG-014 + iter-20）⑧Σ4~5 推荐 Σ4 + T0 技术基线承担串行基线职能；spec/RTM 同日同批落盘，tag req-baseline-v10 由主会话执行）

## CHG-012 架构升级第六期 D1：deep-research 子代理（含 SSE 心跳）

- 日期：2026-08-21
- 类型：修改 + 新增
- 状态：**已批准（2026-08-21 CEO「批准」= 整体批准 + 十定夺全按推荐定案，基线 req-baseline-v9）**
- 原因/依据：CEO 2026-08-21 指示「ai-chat 开启下一个任务」——iter-17（C 五层记忆）已于 2026-08-21 关闭 G4（retros/iter-17.md：基线 req-baseline-v8 全量达成 REQ-042~043〔REQ-044 按 CHG-011 定夺⑩不立项〕、pytest 312 + vitest 364 + 走查 34 PASS/0 FAIL、QA 2 NCR 整改闭环、复盘落制度 v1.4.16），七期路线 A1→A2→B1→B2→C✅→**D1**→D2 下一候选 = D1；spec §4 暂缓池「D1：deep-research 子代理（单子代理 in-process async 编排 + 进度事件；长回合连接保持『心跳 vs 轮询』T0 必须定夺）——agent 路线第 6 期」条目拉项（审核稿 §六.2「每期排期时走一条 CHG」模式，沿 CHG-007/009/010/011 先例；CHG 编号顺延 = **CHG-012**，批准后出基线 req-baseline-v9）。上游依据：已批准审核稿 `docs/architecture-upgrade-plan-2026-08-17.md`——§三要素 9「多 agent 编排（coordinator/in-process）：先做**单子代理 deep-research**（一次规划→多工具→综合），in-process async，不建通用编排框架」；§四 D1 行「Σ10：coordinator 编排（in-process async）+ 进度事件 + 步数/配额硬上限；**长回合连接保持（心跳 vs 轮询）T0 必须定夺，不定会返工**；验收口径示例：回合制+步数硬上限，防 2000/日熔断形同虚设」；§九 D1/D2 行「『深度研究』模式：丢一个开放问题，AI 自动拆解、多轮搜索、边做边给进度、交付带引用报告」；§五不采纳项 4「split-pane 多 agent 并行 UI：等 D1 验证价值后再议」。**迁移编号注记：审核稿 D1 行无迁移编号预判（与 CHG-011 需更正的「迁移 v7」情形不同，无需更正）；本 CHG 推荐方案零新表零迁移，若 CEO 定夺选轮询/后台任务方案，新表自迁移 v11 起（v10 已被记忆占用，取证见下）**。前置依赖已就绪（审核稿 §四：D 依赖 A 工具网关）：A1/A2/B1/B2/C（iter-13~17）全部交付关闭，基线现为 req-baseline-v8（REQ-001~043）；D1 复用面全在线——工具网关六项校验（tools.py）、search 工具与运行时门控（search.py/proxy.py）、ReAct 循环（agent.py run_turn）、引用来源卡（design-iter-14/SourceCard）、遥测行基建（telemetry.py）。**现状代码取证（2026-08-21 逐项核实，非推测）**：
  - **ReAct 循环与护栏现状（coordinator 复用基座）**：`backend/app/agent.py` `run_turn()`（L261-451）单实现承载回合循环：max_steps/step_timeout/tool_result_limit 形参（L268-272），默认值 config.py L29-31（agent_max_steps=10 / agent_step_timeout=120.0 / tool_result_limit=32 KiB）；事件下发 turn.start（L295）/ turn.step（L327，step+max_steps 负载）/ text.delta（L354）/ tool.call（L405）/ tool.result（L421-428，sources 可选数组 L426-427）/ usage（L436）/ turn.end（L437）/ error（L44-59 构造、L380-381 下发）——v2 九事件中 upstream_interrupted 帧现行后端未独立下发（backend 全目录 grep 零匹配），流中断由前端「连接中断」兜底（client.ts L186、L210）；断连取消 CancelledError 处理（L438-447）+ on_finish 已发生部分落账（L305-310）。**循环无任何回合总时长护栏**（仅步数 + 单步超时约束）——D1 时长护栏为新面。
  - **SSE 流与心跳现状（零心跳）**：回合 SSE = proxy.py `stream()`（L269-291）直接转发 run_turn 事件字节，**全 backend 无任何心跳/keepalive 机制**（grep 心跳|keepalive|ping 唯一命中 dev 调试端点 sse_echo，proxy.py L406-419，与回合流无关）；前端 `parseSse()`（client.ts L95-107）**逐行只认 `data:` 前缀**（L101-103）——SSE 标准注释帧（`:` 前缀）天然被跳过，**心跳注释帧对前端零改动的取证结论**。
  - **反代超时风险（心跳必要性取证）**：部署形态 = nginx 托管前端 dist + 反代 /api（iter-9 T3 全链路 Compose）；nginx 默认 proxy_read_timeout=60s，而上游单步超时 120s（config.py L30）> 60s——上游连接后长时间无首块/无 delta 的静默窗口超 60s 即被反代切连；普通回合已存在该窗口（DeepSeek 长 prompt 缓冲期），deep-research 检索循环步数多、放大暴露面。间隔参数以本地 nginx 实测定档（T0 取证，不凭文档臆断，沿 iter-14 T0 模式）。
  - **回合受理与门控现状（mode 字段挂载点）**：proxy.py `chat_turn()`（L151-291）受理管线 = 会话归属 404（L164-169）→ 上游解析 503（L171-173）→ 配额先查后计（L176-183）→ 组装管道（L192-212：snip → _assemble_pipeline → 记忆注入，五层注入序现状）→ **工具三与门（L218-222：tools_allowed = 档案 tools_enabled 或统一 key；gates={'search': is_search_enabled ∧ settings.search_key}）** → generating_sessions 登记（L265-267）→ StreamingResponse。TurnRequest 现三字段（L35-43：session_id/message/system_prompt）——mode 为加法可选字段，老前端不传零变化；deep-research 可用性判定与 search 下发门同源（一处读两用）。
  - **工具网关与 search 注册现状**：tools.py 六项校验链 `execute_tool()`（L192-230）+ ToolDef.gate 运行时能力门（L59-61）+ `tools_for_user()` 过滤（L88-104）；search 工具经 main.py L16-17 import 即静态注册（gate='search'）、出网白名单 api.tavily.com + DNS 解析期地址核验（app/search.py，iter-14 T2）——deep-research 复用网关执行工具，网关零改动。
  - **迁移体系现状**：db.py `SCHEMA_VERSION = 10`（L15），v1~v10 已占用（v10 = user_memories/memory_jobs/users.memory_enabled，L166-199）——**D1 推荐方案零新表零迁移；轮询方案任务表自迁移 v11 起**。
  - **遥测现状（research 行落点）**：telemetry.py kind 枚举 = llm/tool/compress/memory_extract（_COLUMNS 白名单 L33-40 + record_llm/record_tool/record_compress/record_memory_extract，L84-261）；endpoint 现值 turn/compact/memory（legacy 已随 B1 退役）——**research 回合行 = endpoint='research' 加法值，kind 枚举与行形状零变化**；llm 行 step 连续性口径（REQ-037 验收 1）不受影响。
  - **常驻后台任务先例（轮询方案参照，定夺④备选）**：main.py lifespan scan_task（L52-59）+ memory_jobs 持久化重启恢复（memory.py scan_once/execute_job，L325-387）——若④选轮询，任务表/执行器/恢复口径有完整先例可循（工作量仍 +Σ2~3，超容量须砍范围）。
  - **前端回合消费与入口现状**：client.ts `runChatTurn()`（L123-211）请求体三字段（L135-139）、TurnEvent 九类型 + 宽类型兜底（L64-73）、未知 type 静默跳过（文件头注释 L9 + 解析实现）；sessions.ts `generate()`（L252-330）——text.delta/tool.call/tool.result 驱动 blocks（L288-310），**其余事件（turn.start/turn.step/usage）不驱动 UI（L311 注释）**；ToolStepCard 状态徽章/折叠、SourceCard 引用卡（REQ-035/design-iter-14）——**进度与报告呈现零新增渲染面**。ComposerBox.vue（L1-67）单行 textarea + 发送/停止按钮，**无任何模式开关——deep-research 入口为纯加法**。
  - **blocks/落库/会话档零交互面**：Block 三类型（client.ts L13-45），报告 = text 段 + 既有 tool_call/tool_result 段；schema:2 标记/PUT/LWW 守卫现状（REQ-006/022）——mode 为回合瞬时属性不写入会话档，存量会话零迁移。
  - **测试基线**：pytest 312 + vitest 364（iter-17 终态，retros/iter-17.md §5）；MockTransport 假上游夹具现成（帧级断言基建沿用）。
- 内容（对 spec 的拟改，spec 级详细度——沿 CHG-007/009/010/011 呈批详度口径，批准后按拟文落 spec/RTM。除内容 4 汇总的定夺项外，其余口径本 CHG 定死）：
  1. **新增 REQ 三条（spec 级拟稿全文，结构与 spec §2 既有 REQ 一致，批准后原样落 spec §2。编号决定（定夺②）：**自 REQ-045 顺延，不复用 REQ-044**——REQ-044 曾在 CHG-011 拟稿中出现（记忆度量与可观测）但按定夺⑩不立项、编号从未进入基线与 spec 正文，其完整拟稿以「REQ-044 记忆度量与可观测〔…本段为拟稿留档〕」形态永久留档于 CHG-011 内容 1；一号一概念（检索 REQ-044 = 记忆度量），复用会使变更史交叉引用歧义，故 044 永久留予该拟稿、D1 自 045 起。拆分理由：D1 新增实体 = 连接层（心跳）/ 后端编排层 / 前端呈现层，与 B2「管道/入口/度量」、C「管道/UI/度量」三分同构；度量面零新增不设条——遥测 endpoint 加法区分入 REQ-046 承载、admin 聚合零改动（沿 CHG-011 定夺⑩ REQ-044 不立项先例）**）：
     **REQ-045 SSE 心跳与长回合连接保持**〔批次 D1（iter-18 候选）｜优先级：P0（建议，CEO 批准时确认——连接正确性 + deep-research 前置）｜不涉及设计稿（连接层，用户无感知）〕

     - **用户故事**：作为用户，我要 AI 回合（尤其深度研究这类多步长回合）在长时间思考与工具执行期间连接不被中间层掐断，以便研究进度不中断、长回答完整送达。
     - **描述**：回合 SSE 流新增**心跳机制**：服务端在流式响应中周期性下发 SSE 标准注释帧（`: ping\n\n`），间隔 `heartbeat_interval` 默认 20s（.env 可覆盖；T0 以本地 nginx 反代默认 proxy_read_timeout 60s 实测定档，取约 1/3 余量）。**注释帧不是事件**：前端 parseSse 只认 `data:` 行（client.ts L95-107 现状取证），注释帧天然跳过——前端零改动、blocks 与事件序零影响。心跳对**全部回合生效**（普通回合同样受益：上游单步超时 120s > 反代 60s 的静默窗口现状已存在，deep-research 步数多仅放大暴露面，连接层修复不分模式——定夺⑩推荐）。实现 = stream() 协程内 watchdog 周期补发注释帧（有事件产出的时段注释帧可省略或照常，帧本身无害；注释帧不参与事件序断言、不落遥测）。断连取消口径零变化（心跳不改变 CancelledError 传播，REQ-030 既有语义）。
     - **主流程**：
       1. 回合受理 → SSE 流建立 → watchdog 启动
       2. 事件产出间隔 < 心跳间隔：事件照常下发，watchdog 周期到点补注释帧（与事件帧交错）
       3. 客户端/反代在任意两个数据帧之间持续收到注释帧 → 空闲超时不触发 → 连接保持
     - **异常分支**：
       - watchdog 自身异常：不杀流（事件照常下发），warning 日志——心跳是尽力而为的保活，不构成回合成败要件
       - 心跳间隔配置非法（≤0）：按默认值 20s 处理（保守方向，不拒启动）
       - 断连：现行断连取消口径零变化（REQ-030），心跳随流终止
     - **验收标准（可判定）**：
       1. 静默保活：假上游 45s 无 delta 的回合 → SSE 原始字节流含 ≥2 个 `:` 前缀注释帧、相邻注释帧间隔 ≤ heartbeat_interval + 5s（pytest 原始字节断言；事件序断言不含注释帧）
       2. 前端零感知：同一字节流经 parseSse → 零事件产出、blocks 零变化（vitest；注释帧不进 TurnEvent）
       3. 普通回合零回退：delta 密集回合心跳在流中存在但事件序不变（REQ-030 验收 1 复跑全绿）
       4. 反代实测：本地 nginx（默认 proxy_read_timeout 60s）反代下 90s 静默流不断连（T0 取证留档 verify + 走查脚本一条）
     **REQ-046 deep-research 模式与 coordinator 编排（in-process async）**〔批次 D1（iter-18 候选）｜优先级：P0（建议）｜不涉及设计稿（纯后端；入口与呈现归 REQ-047）〕

     - **用户故事**：作为用户，我要丢一个开放问题给「深度研究」模式，AI 自动拆解问题、多轮联网搜索、边做边给进度，最后交付一份带引用来源的综合报告，以便开放式问题得到有依据、可核验的深度回答（审核稿 §九 D1/D2 效果叙事）。
     - **描述**：在 REQ-030 ReAct 循环、REQ-031 工具网关、REQ-035 搜索工具基础上，新增**单子代理 deep-research 编排**（in-process async，不建通用编排框架——审核稿 §三要素 9；定夺③推荐形态 = **受控 ReAct 变体**：同一循环结构换专用研究指令与独立护栏，不建结构化三段 coordinator）。**模式判定** = 回合端点 POST /api/chat/turn 请求体加法可选字段 `mode`（缺省 'chat' 行为零变化；'research' = 深度研究回合——定夺⑦推荐；受理管线[404/503/配额/组装/generating/telemetry sink]全复用零分叉）；**可用性门控** = 与 search 工具下发同源三与门（档案 tools_enabled 或统一 key ∧ admin search 开关 ∧ search_key 配置，proxy.py L218-222 现状一处读两用）——不满足时 research 模式受理即拒（422 research_unavailable，零上游调用、零事件流），**不新增独立 admin 开关**（定夺⑧推荐，独立开关入暂缓池）；**编排与注入** = 回合组装沿既有组装链（snip → compact → 记忆注入零变化）+ **research 指令 system 消息**注入 = 动态尾区（system[1]）之后、记忆消息之前（六层注入序，research 回合时：人设 → 动态尾区 → research 指令 → 记忆 → 摘要 → 历史；指令内容跨请求字节恒定，REQ-036 改写承载注入位）+ 专用研究 prompt（方法论：先输出研究计划（子问题分点）→ 逐项调用 search 收集证据（每子问题至少一次搜索或明示无需）→ 综合输出带引用标注的报告；文案后端拥有、T0 定稿、逐字断言面登记 verify——沿 SUMMARY_PROMPT R2/EXTRACT_PROMPT R1 先例；报告长度 prompt 约束 ≤3000 字）；**双护栏** = 步数硬上限 `max_research_steps`（推荐 16，独立于普通回合 10；T0 校准）+ 回合总时长护栏 `research_total_timeout`（推荐 900s，到顶 turn.end reason='time_limit'——**turn.end reason 枚举加法扩展**，前端 REQ-047 适配标注）；单步 120s/工具超时/断连取消沿用 REQ-030 既有护栏；**计费** = 1 次发起 = 1 回合（REQ-034「1 回合 = 一次用户发送触发」语义自然覆盖，tokens 如实累计含全部内部上游调用，步数/时长为回合内护栏不占配额——定夺⑤推荐，审核稿「回合制+步数硬上限，防 2000/日熔断形同虚设」验收口径的落实）；**事件** = 既有 v2 事件承载（text.delta 流式输出计划与报告、tool.call/tool.result 呈现每轮搜索、turn.step 步数进度），首版**不新增事件类型**（research.phase 阶段事件为 design-iter-18 可提案项，若提案按加法事件随 T0 定帧格式——定夺⑨附属）；**遥测** = llm/tool 行 endpoint='research' 加法区分（行形状零变化）；**产出** = 报告以 blocks 落库随会话 PUT（现状机制零变化），引用来源经 tool.result sources 数组前送 → 前端引用卡复用（REQ-035）。上游错误映射/配额拦截/断连取消全沿 REQ-030 既有异常分支，零新增口径。
     - **主流程**：
       1. 用户开启深度研究开关并发送开放问题（REQ-047）→ POST /api/chat/turn（mode='research'）
       2. 受理：三与门校验 → 配额按回合计（不足即 429 零上游调用）→ turn.start → 组装（五层 + research 指令）→ 循环开始（step 计数）
       3. 规划：模型流式输出研究计划（text.delta，子问题分点可见）
       4. 检索循环：模型自主发起 search（tool.call → 网关六项校验执行 → tool.result[ok/error/timeout + sources]）→ 结果回填 → 继续下一子问题或补充搜索（每步 turn.step，事件流实时呈现——边做边给进度）
       5. 综合：模型输出带引用标注的综合报告（text.delta 流式；≤3000 字 prompt 约束）
       6. 回合结束：usage（回合内累计）→ turn.end（done / max_steps / time_limit）→ 报告 blocks 落库（前端 PUT 现状）、usage_daily 落账（turns+1、tokens 累计）
     - **异常分支**：
       - 可用性门不满足（admin 关搜索 / key 缺失 / 档案工具开关关）：受理即 422 research_unavailable（零上游调用、零事件流），前端入口同步禁用（REQ-047）
       - 步数到顶：turn.end(reason=max_steps)，已生成计划/检索步骤/部分报告保留并落库，回复末尾标注「已到步数上限」（沿 REQ-030 体例，文案随 design-iter-18）
       - 时长到顶：turn.end(reason='time_limit')，已生成内容同样保留落库 + 标注（reason 加法枚举）
       - 检索全部失败（search error/timeout 连续）：error 结果回填模型，模型可降级直答（基于已有知识 + 明示「检索未成功」标注，沿 REQ-035 降级体例），回合不崩
       - 上游报错/中断/断连取消/配额拦截：沿 REQ-030 既有异常分支零新增（计费沿「已抵上游则计」既有定夺）
       - 自填端点不支持 tools（档案开关开但上游明确报错）：沿 REQ-014 定夺①既有引导（提示关闭开关），research 无特例
       - 报告超长：prompt 约束为主（≤3000 字），无硬截断（文本段自然落库；超长属 prompt 纪律问题，T0 冒烟校准）
     - **验收标准（可判定）**：
       1. 帧级断言：MockTransport 编排「规划 + 2×search + 综合」的 research 回合 → 事件序逐帧断言（turn.start → turn.step(1) → text.delta*（含计划要点）→ tool.call(search) → tool.result(ok, sources 非空) → turn.step(2) → … → usage → turn.end(done)），首步请求体含 research 指令 system 消息（位置 = system[1] 之后、记忆消息[如有]之前；内容 = T0 定稿逐字）且 system[0] 人设/时间行口径不回退（pytest，含记忆预置用例）
       2. 步数硬上限：max_research_steps=3 注入 + 编排需 4 步的假上游 → 第 3 步后 turn.end(reason=max_steps)、已生成内容保留、进程不悬挂（pytest，沿 REQ-030 验收 2 体例）
       3. 时长护栏：假工具拖超 research_total_timeout → turn.end(reason='time_limit')、无孤儿任务（pytest）
       4. 计费口径：一回合并 5 次上游调用（MockTransport）→ usage_daily 该日该用户 turns +1、tokens = 5 次调用 usage 之和（pytest 数值断言，沿 REQ-034 验收 2 体例——「回合制 + 步数硬上限」审核稿验收口径落成可判定条款）
       5. 门控拒绝：admin 关闭搜索 / key 缺失 / 档案工具关 → mode='research' 受理即 422、零上游调用、零事件流（pytest）；mode 缺省的普通回合不受影响（既有验收复跑）
       6. 网关复用：research 路径工具执行走 execute_tool 网关——非法入参 search（假上游发起）→ error tool.result 回填、回合继续；tool 行 endpoint='research' 落库断言（pytest）
       7. 断连取消：检索执行中断开 → 取消后零新增上游调用、工具协程终止、无孤儿任务（沿 REQ-030 验收 4）
       8. 卫生：research 指令文案/事件流/日志/遥测行检索不到 key（沿 REQ-037 验收 5 探针体例）
     **REQ-047 deep-research 前端模式入口与进度/报告呈现**〔批次 D1（iter-18 候选）｜优先级：P1（建议——可视层，功能口径依 REQ-046）｜涉及设计稿：design-iter-18（待基线，「原型即需求」；v1.4.15 串行纪律：设计基线为全部开发任务前置）〕

     - **用户故事**：作为用户，我要在输入框一键切换「深度研究」模式、实时看到 AI 研究到哪一步、收到带引用来源的报告，以便知道何时该用深研、进度可见、结论可核验。
     - **描述**：输入区新增模式开关（ComposerBox 加法，形态随 design-iter-18，候选输入框角落 toggle + 模式提示标签——定夺⑦推荐输入框开关而非会话类型：模式为**回合级属性**、同一会话可与普通回合混用）。开启时发送 → 回合请求体携带 mode='research'（client.ts runChatTurn 加法可选参数，缺省不传 = 现状零变化）；**发送后开关复位为普通模式**（防高成本模式误连发，定夺⑦附属推荐，design-iter-18 基线可定夺）。**进度与报告呈现 = 零新增渲染面**：研究计划/报告经 text.delta 流式渲染（现状打字机）、每轮搜索经既有 ToolStepCard 工具步骤卡（运行中→完成、可折叠、创建即折叠规则沿用）、来源经既有 SourceCard 引用卡（REQ-035/design-iter-14 复用）——**不新增 block 类型**（沿 CHG-011 内容 3.5 体例）；mode 不写入会话档（回合瞬时属性，消息模型与 schema:2 零变化）。research.phase 阶段条（规划中/检索中/综合中）为 design-iter-18 可提案增强：提案则后端加法事件 + 前端消费（帧格式 T0 定），不提案则工具步骤卡密度天然呈现进度（定夺⑨附属）。turn.end reason='time_limit' 标注态适配（沿 maxSteps 标注体例，文案随 design-iter-18）。**入口可用性**：GET /api/quota 端点加法字段 research_available（bool，= 三与门判定）为开关禁用态判定源；不可用时开关禁用 + 提示（文案随 design-iter-18）。既有交互零回退：REQ-001 发送/停止、REQ-010 停止生成、暗色主题全部保留。
     - **主流程**：
       1. 用户开启「深度研究」开关 → 输入开放问题 → 发送（请求体 mode='research'）
       2. 消息流：计划文本流式出现 → 搜索工具步骤卡依次运行/完成 → 报告流式生成 → 引用卡呈现 → 回合完成标注；开关复位
       3. 后续普通回合照常（同会话混用零切换成本）
     - **异常分支**：
       - 搜索不可用（三与门不满足）：开关禁用态 + 提示；已开启状态下可用性变化 → 发送时后端 422 → REQ-007 错误体系提示
       - 步数/时长到顶：回复末尾标注（沿 maxSteps 体例，文案随 design-iter-18）
       - 断连/中断：沿 REQ-001 既有分支（已生成部分保留、标注「生成中断」）
       - 生成中操作：沿 REQ-003（新建中断）/REQ-004（切换不中断）/REQ-001（发送禁用）既有语义，research 回合无特例
     - **验收标准（可判定）**：
       1. 开关与载荷：开启开关发送 → 请求体含 mode='research'；关闭发送 → 请求体不含 mode 字段；发送后开关复位（vitest 断言载荷形状与复位）
       2. 进度渲染：research 回合事件流（vitest 编排假事件序）→ 工具步骤卡序列 + 文本段累积正确、blocks 定型含 text/tool_call/tool_result 段
       3. 报告引用：含 sources 的 tool.result → 引用卡渲染（= REQ-035 渲染复用断言；SourceCard 既有用例零回退）
       4. time_limit 标注：reason='time_limit' → 回复末尾标注呈现（vitest + design-iter-18 走查）
       5. 前向兼容：未知 research 加法事件静默跳过零崩（vitest 宽类型断言，沿 parseSse 前向兼容原则）
       6. design-iter-18 走查清单留档（亮/暗双主题 + 开关态/禁用态 + 进度态 + 步数与时长到顶标注态 + 断连态）
  2. **存量需求改写（对照式：改写前 spec 原文 → 改写后拟文，批准后直接落 spec；正式改写 2 条 + 非功能 2 行 + 波及登记 9 项 + 零波及明示 8 项）**：
     - **REQ-030 工具调用框架与 ReAct 循环（正式改写——护栏参数化注记 + 心跳帧与 reason 枚举加法）**：
       - 改写前（描述句要点）：「三护栏：**最大步数 = 10**（一回合内上游调用次数上限）、**单步超时**（上游调用 120s、工具执行按各工具声明）、**断连取消**……」
       - 改写后（拟文）：「三护栏：**最大步数 = 10（普通回合；deep-research 回合独立上限 max_research_steps=16 与回合总时长护栏 900s——CHG-012/REQ-046，定夺⑥）**、**单步超时**（上游调用 120s、工具执行按各工具声明）、**断连取消**……」；描述末段（CHG-009/010 注记之后）补：「**CHG-012（基线 req-baseline-v9）：SSE 流新增心跳注释帧（`: ping`，连接层保活——非事件、前端零感知，REQ-045）；turn.end reason 枚举加法扩展 'time_limit'（deep-research 时长护栏终态，REQ-046）；事件类型枚举不变（deep-research 首版以既有九事件承载）。**」
       - 验收补注：验收 1 事件序断言不含注释帧（心跳帧不参与帧序——REQ-045 验收 1/3 双向引用）；既有六条验收零回退。
     - **REQ-036 prompt 静态/动态分割组装（正式改写——research 指令注入位）**：
       - 改写前（注入序句末）：「……五层注入序 = system[0] 人设 → system[1] 动态尾区 → 记忆消息（如有）→ 摘要消息（如有）→ 历史」
       - 改写后（拟文）：句末补：「**D1 起 deep-research 回合在动态尾区之后、记忆之前追加 research 指令 system 消息（CHG-012/REQ-046，内容跨请求字节恒定的静态指令；普通回合不含，注入序零变化）**——research 回合注入序为：人设 → 动态尾区 → research 指令 → 记忆 → 摘要 → 历史」
       - 验收零变化补指针：验收 1/2 断言面（system[0]/system[1] 内容与位置）不受 research 指令影响——指令消息在 system[1] 之后（CHG-012 注记，同摘要/记忆注记体例）。
     - **非功能条款 2 行（正式改写）**：
       - 架构行补：「〔CHG-012〕agent 运行时增 deep-research coordinator（in-process async 受控 ReAct 变体：专用研究指令注入 + 步数/时长双护栏 + endpoint='research' 遥测区分；SSE 流增心跳注释帧——技术口径见 changes.md CHG-012）。」
       - 可观测行补：「〔CHG-012〕deep-research 回合的 llm/tool 行以 endpoint='research' 加法区分（kind 枚举与行形状零变化），机器采集（铁律 5）；心跳为连接层行为不落遥测。」
       - 数据行**零变化明示**（不改动）：D1 推荐方案零新表零迁移（若定夺④选轮询方案，随定案补迁移 v11 拟稿——research_jobs 任务表沿 memory_jobs 体例，存档于本条内容 3.3）。
     - **波及登记 9 项（简版对照，口径不变、spec 描述随改写同步）**：
       - REQ-001：主流程 4 回合渲染补注「deep-research 回合的事件流渲染归 REQ-047（模式开关为 ComposerBox 加法）」——发送/停止交互零变化。
       - REQ-014：档案「支持工具」开关语义补注「开关关时 deep-research 模式同样不可用（research 可用性三与门之一，CHG-012/REQ-046）」。
       - REQ-025：admin 搜索开关语义补注「关闭搜索 = deep-research 同步不可用（三与门承载，CHG-012 定夺⑧不新增独立 deep-research 开关；独立开关入暂缓池）」。
       - REQ-031：描述补「deep-research 编排路径复用网关全套校验执行工具（CHG-012/REQ-046），六项校验与网关日志四字段口径零变化」。
       - REQ-032：描述补「deep-research 回合渲染复用工具步骤卡/引用卡，不新增 block 类型（CHG-012 注记，同 CHG-011 内容 3.5 体例）」。
       - REQ-033：描述补「deep-research 回合组装 = 既有组装链产物 + research 指令消息（注入位见 REQ-036 改写）；组装器输入输出单点收敛不破（CHG-012/REQ-046）」。
       - REQ-034：描述补「deep-research 一次发起 = 1 回合（含全部内部上游调用，tokens 如实累计；步数/时长为回合内护栏不占配额——CHG-012 定夺⑤）」——quota.py 零改动。
       - REQ-035：描述补「search 工具同时服务普通回合与 deep-research 多轮调用（CHG-012/REQ-046）；引用来源渲染两模式共用」。
       - REQ-037：描述补「endpoint 枚举加法值 'research'（deep-research 回合 llm/tool 行，CHG-012），kind 枚举与行形状零变化」。
     - **零波及明示 8 项（判断结论如实登记，不凑数）**：
       - REQ-002/033 窗口语义：deep-research 产出（计划/工具步骤/报告）以 blocks 落库、照常参与后续组装（20 轮窗口/snip/compact 管道处理）→ 窗口与管道口径零变化。
       - REQ-006/REQ-022：报告随会话 PUT 落库（schema:2 现状）、mode 不写入会话档 → LWW/409 守卫/整档透传/读时归一化零交互。
       - REQ-013/REQ-016：导出与搜索取消息文本段（报告为 text 段）→ 口径零变化。
       - REQ-024：配额数值与机制零变化（30/500/2000 沿用；deep-research 按回合计自然受档位与全站熔断约束）。
       - REQ-038：admin 遥测聚合零改动——research 行 tokens/工具用量天然入既有聚合（成本与工具用量视图自动涵盖；普通/深研用量区分可见性入暂缓池）。
       - REQ-039/REQ-040：压缩管道零变化；deep-research 回合同置 generating_sessions → 手动压缩 409 判定天然涵盖（行为正确零改动）。
       - REQ-042/REQ-043：记忆子系统零交互——deep-research 回合消息照常成为抽取素材（静默窗口扫描不分模式）、记忆照常注入 research 回合组装。
       - REQ-015/REQ-019：编辑重建/版本切换对 research 回合消息语义照常（blocks 消息通用口径），零新增分支。
  3. **关键技术机制写实（本 CHG 定死的技术口径；属定夺的参数汇总于内容 4）**：
     - **3.1 编排数据流（受控 ReAct 变体——定夺③处理方式，框架定死）**：
       ```
       回合受理（chat_turn，mode='research'）
        └─ 三与门校验（档案 tools ∧ admin search ∧ key；统一 key 恒工具可用）
           ├─ 不满足 → 422 research_unavailable（零上游调用、零事件流）
           └─ 通过 → 配额按回合计（REQ-034 零变化）→ 组装链（snip→compact→记忆注入 照常）
                + research 指令消息注入（system[1] 之后、记忆之前——REQ-036 改写承载）
                → 循环（复用 run_turn 结构：步数 16 / 单步 120s / 总时长 900s 三护栏）
                   ├─ 规划步：text.delta 流式输出研究计划
                   ├─ 检索步：tool.call(search) → 网关六项校验 → tool.result（sources 前送）
                   └─ 综合步：text.delta 流式输出带引用报告（prompt 约束 ≤3000 字）
                → usage → turn.end（done/max_steps/time_limit）→ blocks 落库（前端 PUT 现状）
       ```
       run_research 与 run_turn 的实现关系：**单实现优先**——首选 run_turn 参数化（可选 research 配置：独立 max_steps/总时长 deadline/reason 枚举扩展）；仅当参数化污染成本高于分叉时允许薄复制（实现级决策，T2 登记 verify，不走变更）。结构化三段 coordinator（后端解析 JSON 计划逐项执行）被否理由存档定夺③。
     - **3.2 research 指令 prompt（框架定死，文案 T0 定稿）**：方法论约束 = 先计划（子问题分点）后检索（每子问题至少一次 search 或明示无需）再综合（结论 + 分点论证 + 引用标注对应 sources 序号 + ≤3000 字 + 直接输出不前缀）；独立 system 消息、内容跨请求字节恒定（不文本化进 system[0] 人设、不与 tools 字段说明重复——沿 REQ-036 定夺③「tools 字段即结构化工具说明」哲学）；逐字断言面登记 verify（沿 SUMMARY_PROMPT R2 / EXTRACT_PROMPT R1 先例）。指令注入不改变 B1 前缀缓存收益面（system[0] 恒定语义不变，指令在其后）。
     - **3.3 心跳机制（定夺④处理方式，推荐方案定死）**：SSE 标准注释帧 `: ping\n\n`；间隔 heartbeat_interval 默认 20s（.env 覆盖；T0 本地 nginx 默认 proxy_read_timeout 60s 实测校准）；watchdog 于 stream() 协程内实现；注释帧不进事件序、不落遥测；对全部回合生效（连接层）。**备选轮询方案（若 CEO 定夺选 B，随定案启用）**：research_jobs 任务表（迁移 v11，沿 memory_jobs 体例：user_id/session_id/status/turn_id/created_at/updated_at）+ GET 进度端点 + 断连续跑——工作量另 +Σ2~3（超 Σ≤10 硬约束须砍 REQ-047 增强项）；否决理由与保留路径见定夺④，需求浮现时走 CHG（暂缓池「异步研究任务」）。
     - **3.4 计费与配额（定夺⑤定死）**：1 发起 = 1 回合（check_and_consume 门口既有点位零改动）；tokens on_finish 累计（含全部内部调用与既有 summary_tokens 口径同轨）；步数/时长为回合内护栏不占配额；统一 key 2000/日熔断按回合计。「回合制 + 步数硬上限」= 审核稿验收口径：单回合上游调用有界（≤16 步 × 单步 token 规模有界），按回合计的配额与熔断不因 deep-research 多轮内部调用而失真。
     - **3.5 与 blocks/schema/LWW 的关系（定死）**：零新增 block 类型；mode 为回合瞬时属性不写入会话档；报告与工具步骤随既有 blocks 落库路径（前端 PUT）；存量会话零迁移、老会话渲染零影响。
     - **3.6 可用性三与门与入口判定源（定夺⑧定死）**：research 可用 = tools_allowed（档案 tools_enabled 或统一 key）∧ is_search_enabled ∧ search_key 非空——与 proxy.py L218-222 search 下发门同源同判定（一处读两用，不新增配置面）；前端判定源 = GET /api/quota 加法字段 research_available（既有端点加法字段，KeyModeCard/开关共用数据面形态随 design-iter-18）。
     - **3.7 遥测与可见性（定死框架）**：llm/tool 行 endpoint='research'；admin 聚合零改动（research 行 tokens/工具用量天然入账）；「deep-research 独立开关与用量可见性」入暂缓池（沿 CHG-011 定夺⑩ REQ-044 不立项先例——遥测先行、可见性锦上添花）。
  4. **定夺项清单（2026-08-21 呈报；CEO 批准「批准」= ①~⑩ 全部按推荐定案）**：
     | # | 定夺项 | 推荐（2026-08-21） | 理由摘要 |
     |---|---|---|---|
     | ① | CHG-012 整体批准 | **批准**（含 REQ-045~047 新增与优先级 P0/P0/P1、正式改写 2 条 + 非功能 2 行、波及 9 项 + 零波及明示 8 项；基线 req-baseline-v9） | 审核稿 D1 期既定路线，A 工具网关前置已就绪 |
     | ② | REQ 编号起点 | **不复用 REQ-044、自 REQ-045 起** | 044 = CHG-011 记忆度量拟稿永久留档（定夺⑩不立项但拟稿在案）；一号一概念防交叉引用歧义 |
     | ③ | 编排形态 | **受控 ReAct 变体**（单循环 + 专用指令与独立护栏） | 复用 run_turn ~90% 结构、零新增解析故障面；结构化三段 coordinator（JSON 计划解析/计划失败重试/子问题调度）是新故障面且与「不建通用编排框架」审核稿口径相悖；「自动拆解/多轮搜索/边做边给进度/带引用报告」由 prompt + 既有事件完整承载 |
     | ④ | **长回合连接保持（审核稿点名 T0 必须定夺）** | **心跳：SSE 注释帧 20s（T0 实测校准），对全部回合生效** | parseSse 只认 data: 行 → 注释帧前端零改动（取证）；nginx 反代 60s read timeout vs 单步 120s 的静默窗口现状已存在，连接层修复不分模式；轮询方案（任务表 + 进度端点 + 断连续跑）改造面 +Σ2~3 且丢流式体验、与「回合」模型（断连取消/generating/409）全面分叉——「不定会返工」的风险点由本定夺关闭；轮询留暂缓池「异步研究任务」。**T0 回填（2026-08-21）**：实测坐实（默认 60s 配置静默流 60.0s 断连 / 20s 心跳下 100s 完整存活），**间隔 20s 定档定案**；另发现部署配置显式 proxy_read_timeout=300s（iter-9 T3），心跳价值口径修正为「不依赖部署配置的鲁棒性」，见 plans/iter-18-verify.md §2 |
     | ⑤ | 计费口径 | **1 次发起 = 1 回合、tokens 如实累计、步数/时长护栏兜底** | deep-research 是用户主动发起（与记忆抽取后台调用性质不同），REQ-034「1 回合 = 一次用户发送触发」语义自然覆盖、quota.py 零改动；按步折算 N 回合扭曲回合语义且用户不可解释；「回合制+步数硬上限」即审核稿防熔断失真验收口径 |
     | ⑥ | 护栏参数 | **max_research_steps=16（候选 12/16/20）+ research_total_timeout=900s + 单步 120s 沿用**；T0 校准授权 ±4 步 / ±300s 登记不走变更（沿 B2 定夺⑨ R±2 体例） | 16 步 ≈ 规划 + ~12 次检索 + 综合，兼顾研究深度与单回合成本有界；900s = 16 步 × 均值耗时上界的保守封顶；T0 真实冒烟校准。**T0 回填（2026-08-21）**：真实研究回合实测 3~5 步 / 22~27s / 6.2k~14.6k tokens，**16 步 + 900s 维持（授权内零调整）**——护栏为兜底非常态路径，见 plans/iter-18-verify.md §3 |
     | ⑦ | 模式入口形态与承载 | **输入框开关（回合级 mode、同会话可与普通回合混用、发送后复位）+ turn 端点加法 mode 字段（vs 独立端点）** | 审核稿 §九「丢一个开放问题」是对话内行为；会话类型需新会话模型概念、消息前缀指令不可发现；mode 字段使受理管线（配额/组装/门控/遥测）全复用零分叉，老前端不传零变化 |
     | ⑧ | 可用性门控与 admin 开关 | **三与门（与 search 下发同源）承载，不新增独立 deep-research admin 开关**（独立开关入暂缓池） | 零新增配置面（最小 MVP）；关闭搜索即关闭深研的语义对部署者可解释；若未来需「开搜索关深研」的成本分层再走 CHG |
     | ⑨ | 报告形态与 prompt 约束 | **报告 ≤3000 字 prompt 约束（无硬截断）+ 引用复用 REQ-035 引用卡（上标联动维持暂缓池 B1+ 候选）+ research.phase 阶段事件首版不加（design-iter-18 可提案，提案则加法事件 T0 定帧）+ turn.end reason 加法 'time_limit'** | 引用形态复用已基线资产零新渲染面；阶段条属体验增强（工具步骤卡已给进度感），设计稿提案权保留；time_limit 独立 reason 使护栏终态可观测可断言 |
     | ⑩ | 断连口径与心跳作用域 | **断连 = 现行取消口径（不做后台续跑/断连恢复；memory_jobs 式任务表留「异步研究任务」未来候选）；心跳对全部回合生效（vs 仅 research 回合）** | 后台续跑 = 轮询方案子集已被④否决路径；普通回合静默风险同在，连接层修复收窄作用域无收益且留双路径 |
  5. **影响评估**：
     - **存量需求逐条**：见内容 2——正式改写 2 条（REQ-030/036，对照式拟文可直接落 spec）+ 非功能 2 行（数据行零变化明示）；波及登记 9 项（REQ-001/014/025/031/032/033/034/035/037）；零波及明示 8 项。其余需求（REQ-003~005/007~012/017/018/020/021/023/026~029/041）不受影响。
     - **设计资产承载（v1.4.1 逐项核对，「原型即需求」）**：`design/iter-18` 新增——承载 REQ-047（模式开关形态/进度叙事/research.phase 提案权/禁用与到顶标注态）；D1 T0/T1 产出并基线（**v1.4.15 串行纪律：设计基线为全部开发任务[含非 UI]前置**）。`design/proto` 不同步（对 iter-1 核心闭环原型不可见）；其余 design/iter-* 不同步（无对应 REQ 界面口径变化）。
     - **架构变更说明**：后端新增 research.py 薄模块（编排参数/研究指令文案/护栏，预估 100~200 行）+ agent.py run_turn 参数化（或薄复制，3.1 单实现优先原则）+ proxy.py mode 字段/三与门拒绝/心跳 watchdog + config.py 加参数（max_research_steps/research_total_timeout/heartbeat_interval）+ telemetry endpoint='research' 加法值 + quota 端点 research_available 加法字段；前端 ComposerBox 开关 + client.ts mode 参数 + sessions.ts 事件消费适配 + time_limit 标注。**quota.py / db.py / usage_daily 数据面零改动（推荐方案）**。
     - **工作量与排期**：审核稿 D1 定级 **Σ10**；拆解预估 = T0 取证 S（1：research prompt 真实 DeepSeek「计划-检索-综合」冒烟 + nginx 反代 60s 心跳实测 + 步数/时长初校）+ T1 design-iter-18 基线 S~M（2）+ T2 后端 L（4：mode 字段/三与门/编排与双护栏/心跳/遥测区分 + 帧级 pytest）+ T3 前端 M（2~3：开关/载荷/渲染复用/time_limit 标注 + vitest + 走查）——**Σ9~10**。**推荐 Σ9 不顶格**（T3 取 M 下沿 2，进度呈现纯复用渲染；沿「默认不顶格、顶格需三条理由」口径——retros/iter-17 §4）；若 design-iter-18 提案 research.phase 阶段条等增强则回 Σ10 顶格（理由：① 审核稿原定级 Σ10（七期仅 A1/D1 同级）② D1 含首个「单回合多阶段长时编排」+ 连接层修复双主线 ③ 心跳触及既有回合流回归面）。**备砍序（容量紧张时）**：① REQ-047 research.phase 增强项（不提案即零成本）② T3 范围收窄至开关 + 载荷 + time_limit 标注（进度呈现纯复用，Σ−1）③ 心跳作用域收窄仅 research 回合（Σ−0.5，不推荐——普通回合静默风险同在）。排期由 PM 走 `/mm-iteration-plan`（iter-18）；design-iter-18 基线为全部开发任务前置（v1.4.15）；T0 取证项为 T2 实施输入前置。
     - **测试基线**：pytest 312 / vitest 364（iter-17 终态）；沿全局回归基线口径——存量全绿、改写用例登记映射（REQ-030 验收 1 事件序断言排除注释帧等）、功能性删除为零；度量数据全部机器采集（铁律 5）。
     - **发布影响**：v0.5.0 仍独立卡服务器，不受本变更影响。
  6. **暂缓池联动（批准后随 spec §4 同步的拟文）**：
     - D1 条目：划线移出 + 注记「CHG-012 移出，2026-08-21：落地为 REQ-045~047（批准结论随定夺回填；基线 req-baseline-v9）」。
     - 新增条目：「deep-research 独立 admin 开关与用量可见性：可用性现由 search 三与门承载、遥测 endpoint='research' 已区分、admin 聚合天然涵盖；独立开关/专属面板纳入时走 CHG（CHG-012 定夺⑧/3.7）」。
     - 新增条目（若定夺④=心跳采纳）：「异步研究任务（断连续跑/后台执行/完成通知）：轮询方案连同 research_jobs 任务表拟稿存档 changes.md CHG-012 内容 3.3，需求浮现时走 CHG」。
     - split-pane 多 agent 并行 UI 条目补注记：「D1 交付后可评估（审核稿 §五.4『等 D1 验证价值后再议』触发条件就绪）」——条目本身留池。
     - 其余条目（D2/移动端/天气/供应商对比/体验深化主题包①②③/同步精细合并/用量面板/RAG/裁决口径观察项/记忆抽取度量可见性）零变化。
- 落地核对清单（v1.4.10 制度 A；CEO 批准后逐项落地勾验，首个任务提交内落盘）：
  | # | 承诺项 | 状态 | 落地证据 |
  |---|--------|------|---------|
  | 1 | spec §2 新增 REQ-045~047 全文（四要素齐备，按内容 1 拟稿；编号按定夺②定案） | ✅ 已落地（2026-08-21） | spec.md §2 REQ-045/046/047 三节（REQ-043 之后），原样落自本条内容 1 |
  | 2 | REQ-030/036 正式改写（内容 2 拟文）+ 波及登记 9 项 + 零波及明示 8 项 | ✅ 已落地（2026-08-21） | spec.md REQ-030 三护栏句与 CHG-012 注记 + 验收 1 补注；REQ-036 注入序句与验收注记；波及 9 项 = REQ-001 主流程 4 / REQ-014 开关句 / REQ-025 开关句 / REQ-031 描述末 / REQ-032 描述末 / REQ-033 描述末 / REQ-034 波及段 / REQ-035 描述末 / REQ-037 描述末 |
  | 3 | 非功能两行同步（架构/可观测；数据行零变化明示随定夺④结论处理） | ✅ 已落地（2026-08-21） | spec.md §3 架构行〔CHG-012〕+ 可观测行〔CHG-012〕；数据行未动（定夺④=心跳定案，零新表零迁移，无需 v11） |
  | 4 | spec §4 暂缓池联动（D1 条目移出 + 两条新增 + split-pane 注记，内容 6 拟文） | ✅ 已落地（2026-08-21） | spec.md §4：D1 条目划线移出 + 「deep-research 独立 admin 开关与用量可见性」+「异步研究任务」两条新增；split-pane 注记无载体——spec 暂缓池无该条目（审核稿 §五.4 留档在案，触发条件「D1 交付后」就绪时再议即可），不凭空造条目 |
  | 5 | RTM 新增 REQ-045~047 行 + 变更备注行 + 改写行 CHG-012 注记 + 全局回归基线 D1 面说明（v1.4.11 C 行级收口 + v1.4.16 独立行同批收口） | ✅ 已落地（2026-08-21） | rtm.md：三新行 + REQ-030/036 改写注记 + 波及 9 项行级注记 + 变更备注表 CHG-012 行 + 全局回归基线行 D1 面口径与 C 面措辞卫生修正（NCR-iter17-002 同型防复发，随附卫生项登记） |
  | 6 | 定夺项①~⑩结论回填本条（含⑥参数随 D1 T0 校准值回填） | ✅ 已回填（2026-08-21，含 T0 校准值） | 本条内容 4 标题行 + 「需要 CEO 定夺的事项清单」标题行 + CEO 批准标记行；⑥ T0 回填 = 16 步 + 900s 维持（授权内零调整，verify §3）、④ T0 回填 = 20s 定档定案 + 部署配置口径修正（verify §2）——2026-08-21 随 iter-18 T0 交付回填 |
  | 7 | registry.md 同步（主会话执行） | ✅ 同批执行（2026-08-21，主会话） | company-os registry.md ai-chat 行登记 CHG-012 批准与基线 v9（company-os 仓单独提交，跨仓勾验沿 v1.4.15 B） |
  | 8 | design-iter-18 基线为 REQ-047 开发前置（v1.4.15 串行；spec「涉及页面」字段随基线零滞后回填） | ✅ 已落地（2026-08-21 随 iter-18 T1 基线） | design/iter-18/（设计稿 + 可交互原型，六定夺全按推荐定案 + 走查 31 条 + 样件 M38~M43）；spec REQ-047「涉及页面」已回填（拟文随稿 §12 执行）；tag design-iter-18 随统一提交 |
- 需要 CEO 定夺的事项清单（2026-08-21 呈报；**CEO「批准」——①~⑩ 全部按推荐定案**，基线 req-baseline-v9）：
  1. **CHG-012 整体批准**（REQ-045~047 三条新增与优先级建议 P0/P0/P1、正式改写 2 条 + 非功能 2 行、波及 9 项 + 零波及明示 8 项）→ 批准后打基线 req-baseline-v9
  2. REQ 编号起点（推荐不复用 REQ-044、自 REQ-045 起——044 永久留予 CHG-011 记忆度量拟稿）
  3. 编排形态（推荐受控 ReAct 变体，不建结构化三段 coordinator）
  4. **长回合连接保持——审核稿点名 T0 必须定夺**（推荐心跳 SSE 注释帧 20s 全回合生效；轮询方案含任务表拟稿已存档内容 3.3）
  5. 计费口径（推荐 1 次发起 = 1 回合、tokens 如实累计、步数/时长护栏兜底）
  6. 护栏参数（推荐 max_research_steps=16 + research_total_timeout=900s + 单步 120s 沿用，T0 校准 ±4 步/±300s 登记不走变更）
  7. 模式入口形态与承载（推荐输入框开关 + turn 端点 mode 字段、同会话混用、发送后复位）
  8. 可用性门控与 admin 开关（推荐三与门承载、不新增独立开关，独立开关入暂缓池）
  9. 报告形态与 prompt 约束（推荐 ≤3000 字 prompt 约束、引用复用 REQ-035 引用卡、research.phase 首版不加、reason 加法 'time_limit'）
  10. 断连口径与心跳作用域（推荐断连沿现行取消口径不做后台续跑、心跳全回合生效）
- CEO 批准：**批准（2026-08-21，CEO「批准」= 整体批准 + 十定夺①~⑩全部按推荐定案；出基线 req-baseline-v9，spec/RTM 同日同批落盘，tag req-baseline-v9 由主会话执行）**。

## CHG-011 架构升级第五期 C：五层记忆体系

- 日期：2026-08-20
- 类型：修改 + 新增
- 状态：**已批准（2026-08-20，CEO 原话「全部按推荐批准」；基线 req-baseline-v8）**
- 原因/依据：CEO 2026-08-20 指示「开启下一个任务」——iter-16（B2）已于 2026-08-20 关闭 G4（retros/iter-16.md：4/4 任务完成、Σ8 零偏差、pytest 239→282 + vitest 324→345、走查 70 PASS），七期路线 A1→A2→B1→B2→**C**→D1→D2 下一候选 = C；spec §4 暂缓池「C：五层记忆体系（记忆表迁移 + 会话后异步抽取 + 动态注入 + 会话摘要层 + 记忆管理 UI）——agent 路线第 5 期」条目拉项（审核稿 §六.2「每期排期时走一条 CHG」模式，沿 CHG-007/009/010 先例）。上游依据：已批准审核稿 `docs/architecture-upgrade-plan-2026-08-17.md`——§三要素 8「适配为五层：会话内全文→会话摘要→用户长期记忆（会话后异步抽取）→用户 systemPrompt→产品人设；配记忆管理 UI（查看/编辑/删除/停用，注入可见）」；§四 C 行「Σ10：记忆表（迁移 v7）+ 会话后异步抽取（落库+重启恢复口径）+ 动态注入 + 会话摘要层（复用 B2）+ 记忆管理 UI；验收口径示例：注入可见、可整体停用；抽取的后台调用计费口径 CHG 定夺」（**迁移编号更正注记：该稿写于迁移 v6 时代，「迁移 v7」已过期——v7=app_settings（iter-14）/v8=telemetry（iter-15）/v9=context_summary+加法列（iter-16）均已占用，本 CHG 更正为迁移 v10**）；§九效果叙事 C 行「新会话说『按我平时的偏好来』，AI 记得用户是谁、喜欢什么（跨会话长期记忆）；设置多一页『AI 的记忆』可查看/编辑/删除/一键停用——**与套壳拉开差距最大的产品特性**」。前置依赖已就绪（审核稿 §四：C 依赖 B2 摘要基建）：A1/A2（iter-13/14）、B1（iter-15）、B2（iter-16）均已交付关闭，基线现为 req-baseline-v7（REQ-001~041 全部达成）；B2 已提供 C 的复用面：**compress.py 摘要调用基建**（非流式调用器 + 独立超时护栏 + 失败降级哲学 + 对话转写渲染 + telemetry 落行模式——复用面边界见内容 3.3）、**context_summary 表与水位语义为会话级口径、记忆层不直接复用**（记忆是用户级实体，另立表）。五层中「会话内全文」（REQ-002 20 轮窗口）/「会话摘要」（REQ-039 compact）/「用户 systemPrompt」（REQ-008）/「产品人设」（.env 注入 `AI_CHAT_PRODUCT_PERSONA` → settings.product_persona，config.py L39，B1 交付 system[0] 静态前缀）四层为现状或已交付——C 的工作 = 新建第三层「用户长期记忆」+ 把五层纳入统一注入序与可见性口径。**现状代码取证（2026-08-20 逐项核实，非推测）**：
  - **组装与注入挂载点现状**：`backend/app/agent.py` `assemble_context()`（L139-168）——system[0]=产品人设静态前缀（L165-167，跨请求字节恒定）+ system[1]=动态尾区（L164：用户 systemPrompt 首位 + `_now_line()` 当前时间行，**动态尾区当前装的就是这两样，无其他内容**）+ 最近 20 轮（`MAX_CONTEXT_TURNS=20`，L29）user 锚定截断。压缩生效时走 `compress.assemble_compact()`（compress.py L343-368）：system[0]+system[1]+摘要 system 消息+最近 R 轮——**记忆注入挂载点 = 该组装链动态尾区之后、摘要/历史之前（定夺④）**；组装编排单点在 `proxy.py _assemble_pipeline()`（L75-148：snip→阈值判定→compact 注入，回合受理时执行，run_turn 收到的 messages 为管道产物）。
  - **B2 摘要调用基建全貌（C 复用对象与边界）**：`backend/app/compress.py`——`call_summary()`（L283-334：非流式 chat completion、stream=false 响应体直接含 usage 机器读数、独立超时护栏不占回合单步 120s、跟随回合当前模式的 base_url/api_key/model 入参、失败形态归 SummaryOutcome ok/error/timeout 三终态）；`SUMMARY_PROMPT` 文案后端拥有逐字断言面（L31-40，T0 R2 定稿先例）；`render_transcript()`（L220-245：会话档中段→转写文本，工具结果按字符上限截断）；`wrap_summary()` 注入前字面包裹防指令注入（L248-250，与 toolsgw.wrap_for_context 同哲学）；产物读写与水位 `load_summary/save_summary/watermark_valid`（L174-217）。**复用面 = 调用器形态/超时护栏/三终态降级/转写渲染/包裹哲学/telemetry 落行模式；不复用 = context_summary 表与水位语义（会话级，记忆为用户级另立表，无水位概念）**。
  - **迁移体系现状**：`backend/app/db.py` `SCHEMA_VERSION = 9`（L15），迁移 v1~v9 已占用（v2=chat_sessions 整档 JSON L39-46 / v3=profiles / v4=usage_daily / v5=users 加 quota_override——**users 表加法列先例 L91** / v7=app_settings KV / v8=telemetry / v9=context_summary + telemetry 加法列 L151-165）——**C 的记忆表 = 迁移 v10**（审核稿「迁移 v7」更正，见上注记）。
  - **配额与计量现状（抽取计费定夺的事实基础）**：`quota.py` `check_and_consume()`（L89-116）回合受理先查后计、requests/turns 同步 +1（L109-114）；`record_tokens()`（L124-144）独立短连接流后补记 tokens。配额判定只数回合数不数 tokens——**抽取为回合外后台调用，计不计回合/tokens 落哪由定夺③定死（推荐沿 B2 定夺⑧双轨哲学：配额轨零写入、遥测轨如实记）**。
  - **telemetry 行形状（抽取计量的落点）**：`telemetry.py` kind 枚举 llm/tool/compress（_COLUMNS 白名单 L31-38；加法扩展先例 = compress）；`record_compress()`（L166-214：step 恒 NULL、endpoint 区分触发面、usage 分项同列映射、tokens_before/after 专用列）；独立短连接 + 写失败吞异常不阻塞主路径（`_write` L55-79）；90 天惰性清理（L41-52）。**抽取行按 record_compress 同模式加 kind='memory_extract'（加法扩展，行形状见内容 3.3）**。
  - **settings 现状**：`config.py` Settings（L8-51，pydantic env_prefix `AI_CHAT_`）——统一 key 三变量/价格三变量/product_persona（L39）/压缩四参数（L45-51：阈值 7000/K=2/R=5/摘要超时 30s，均 T0 取证定死值）——**C 抽取微参数（轮数下限/静默窗/条目上限/扫描间隔）按同形态新增，T0 取证定死、实施期保守占位（沿 B2 定夺③先例）**。
  - **用户 systemPrompt 现状（五层第 4 层——取证与预期不符项①）**：`routers/profiles.py` 全文件（188 行）与 profiles 表 schema **无任何 system_prompt 字段**（表字段 = name/base_url/model/api_key/is_active/tools_enabled，ProfileOut L27-34）——systemPrompt 实际存**前端 localStorage**（`src/stores/settings.ts` L26-55：`ai-chat:settings` 键只持久化 systemPrompt）+ **随回合上传**（TurnRequest.system_prompt，proxy.py L43；`src/api/client.ts` runChatTurn 请求体 L135-139；sessions.ts generate L278 传 `settings.systemPrompt`），注入点 = 动态尾区段首位（agent.py L164）。**即五层第 4 层现状 = 前端本地存储、服务端零持久化、多设备不一致是现行行为；C 期机制零改动，仅口径上纳入五层叙事（REQ-008 改写）**。
  - **记忆管理 UI 挂载点现状**：`src/components/SettingsForm.vue`——设置弹窗 = 720px 左右分栏模态（REQ-028/design-iter-11），左导航 `TABS` 五分区：appearance/mode/adv/chat/account（L30-36），`showPane()` 切换机制 + role=tablist 方向键导航（L51-68）——**「AI 的记忆」分区 = TABS 加法第六项（定夺⑦推荐）**；前端回合数据面 `client.ts runChatTurn()` 请求体仅 session_id/message/可选 system_prompt（L135-139）、`sessions.ts`「先 PUT 整档再发回合」——**记忆注入为服务端行为，前端回合数据面零改动（同 B2 先例）**。
  - **后台任务与重启恢复事实基础**：`main.py` lifespan（L28-48）现仅初始化 db/http/search，`app.state.generating_sessions` 内存集合（L54，重启即清）——**现无任何常驻后台任务，C 的静默扫描为首次引入**；「落库 + 重启恢复」口径的唯一权威载体 = 任务表持久化（内容 3.4）。
  - **记忆机制零存在**：backend/app 全目录检索 `memory|记忆` 零匹配（非推测，grep 实测）。
  - **测试基线**：pytest 282 + vitest 345（iter-16 终态，retros/iter-16.md）。
- 内容（对 spec 的拟改，spec 级详细度——沿 CHG-007/009/010 呈批详度口径（CEO 2026-08-17 定），批准后按拟文落 spec/RTM。除内容 4 汇总的定夺项外，其余口径本 CHG 定死）：
  1. **新增 REQ 三条（编号自 REQ-042 顺延，spec 级拟稿全文，结构与 spec §2 既有 REQ 一致，批准后原样落 spec §2；拆分理由：五层中四层为现状/B2 已交付、不新立 REQ——C 的新增实体只有第三层「用户长期记忆」与其管理面/度量面，故拆为管道层 REQ-042（P0）+ UI 层 REQ-043（P1）+ 度量层 REQ-044（P1 可选，定夺⑩定是否立项），与 B2「管道/入口/度量」三分同构）**：
     **REQ-042 用户长期记忆（记忆表 + 会话后异步抽取 + 五层注入组装）**〔批次 C（iter-17 候选）｜优先级：P0（建议，CEO 批准时确认）｜不涉及设计稿（纯后端数据层，用户界面零变化——管理面归 REQ-043）〕

     - **用户故事**：作为用户，我要 AI 在日常对话中自动沉淀关于我的长期记忆（我是谁、喜欢什么、有哪些约定），并在新会话中自然记得，以便不必每次重复背景与偏好，AI「知道我是谁」（审核稿 §九 C 行效果叙事）。
     - **描述**：在 REQ-033 服务端组装器、REQ-036 分区与 B2 摘要调用基建（CHG-010 复用面：非流式调用器形态/独立超时护栏/三终态降级/转写渲染/包裹哲学/遥测落行模式；水位与 context_summary 表为会话级口径、不在复用面）基础上，新建五层记忆体系**第三层「用户长期记忆」**：**存储** = 迁移 v10 新建 `user_memories` 表（user_id FK 级联、自由文本条目、一条一个独立记忆点）+ users 加法列 `memory_enabled`（整体停用开关，定夺⑥定案）；**抽取** = 会话后异步后台抽取——服务端常驻后台任务（lifespan 挂载，首次引入）静默窗口扫描（会话轮数 ≥ N 且最近 X 分钟无新回合且存在未覆盖增量，**T0 取证回填：N=4 / X=10 分钟 / 扫描间隔 60s 定死，2026-08-20，留档 plans/iter-17-verify.md §4**）→ `memory_jobs` 任务行落库（pending，**持久化即唯一权威 = 重启恢复口径：进程重启不丢 pending 行、启动后继续执行**）→ 一次非流式抽取调用（沿 B2 call_summary 基建、独立超时护栏、跟随该用户当前模式，定夺⑧）→ 模型基于「现有记忆 + 增量转写」输出合并后的新记忆列表，后端**整体替换**落库（去重/冲突覆盖交模型、后端限条数上限，定夺⑤定案；**T0 收紧回填：30 条 × 单条 ≤150 字**），抽取执行落 telemetry `kind='memory_extract'` 行（机器采集，铁律 5，行口径见内容 3.3；admin 聚合可见性归 REQ-044/定夺⑩）；**注入** = 回合组装时若用户有记忆条目且 memory_enabled=1，记忆以 `<user_memory>` 字面包裹（防注入，同摘要包裹哲学）作为**独立 system 消息**注入，挂载点 = system[1] 动态尾区之后、摘要 system 消息之前（定夺④定案，内容 3.1）。**记忆只影响「发给上游的内容」**：记忆数据服务端独立表存储，与会话档/LWW/409 守卫/整档透传零交互；任何抽取失败降级为「无新记忆、存量记忆照常注入」，回合主路径零阻塞、用户无感。**抽取调用不计回合、usage_daily 零写入、tokens 仅落 telemetry（定夺③定案，同 B2 定夺⑧双轨哲学）**。五层第一/二/四/五层（会话内全文 REQ-002 / 会话摘要 REQ-039 / 用户 systemPrompt REQ-008 / 产品人设 system[0]）为现状或 B2 已交付，本条与之共同构成统一注入序（存量口径同步见内容 2）。
     - **主流程**：
       1. 回合组装：读 user_memories（启用且非空）→ `<user_memory>` 包裹注入——五层注入序 = system[0] 人设 → system[1] 动态尾区（用户提示词 + 时间行）→ 记忆消息（如有）→ 摘要消息（如压缩生效）→ 历史（20 轮或 R 轮）
       2. 静默窗口扫描（后台常驻）：会话满足触发条件（轮数 ≥ N + 静默 ≥ X 分钟 + 有未覆盖增量 + memory_enabled=1 + 上游可解析）→ memory_jobs pending 行落库 → 执行抽取调用（非流式、独立护栏）
       3. 抽取成功 → user_memories 整体替换 + job done + memory_extract 行（status=ok，tokens 机器读数）
       4. 记忆页（REQ-043）编辑/删除/停用 → 下一回合组装即生效（注入读库时点天然涵盖）
     - **异常分支**：
       - 抽取调用失败/超时/空输出/上游 4xx/5xx：job attempts+1（上限 3，超限留 error 行待观察、不无限重试），记忆表不变，memory_extract 行 status=error/timeout 如实记（铁律 5），回合主路径不受影响
       - 进程重启：memory_jobs 持久化为唯一权威，pending 行启动后继续执行（重启恢复口径）；在途抽取调用随进程丢失，下一轮扫描重新考虑（attempts 只计已完成的失败）
       - 统一 key 未配置且无生效档案：扫描跳过该会话、不落 job 行（上游不可解析，避免无效任务堆积）
       - 自填档案端点拒绝/不支持抽取调用：同失败分支降级（不区分错误形态，降级方向恒为现状）
       - 用户整体停用（memory_enabled=0）：注入跳过且扫描跳过（不新抽取；存量记忆保留，重新启用即恢复注入）
       - 记忆条数达上限（30 条，定夺⑤；T0 收紧回填）：整体替换按上限截断（模型输出顺序），抽取 prompt 约束口径 T0 定稿
       - 抽取与回合并发：抽取读会话档快照、回合主路径不读 memory_jobs，零交互；抽取在回合进行中完成 → 新记忆自下一回合生效
     - **验收标准（可判定）**：
       1. 注入正确性：预置用户 2 条记忆 + 启用 → 新会话首回合请求体含记忆 system 消息，位置 = system[1] 之后（有摘要时记忆在前摘要在后），内容 = `<user_memory>` 包裹的条目逐字（pytest，MockTransport 捕获）
       2. 停用零回退：memory_enabled=0 → 组装与基线 v7 口径逐字段等价（REQ-033/036/039 既有验收复跑，含压缩生效会话）
       3. 抽取闭环：满足触发条件的会话（轮数 ≥ N + 静默窗口到）→ 假上游返回记忆列表 → user_memories = 返回列表整体替换、job done、telemetry 恰 1 条 memory_extract 行（status=ok，tokens = 假 usage 帧机器读数）
       4. 失败降级：假上游 500 / 超时 → job error + attempts+1、记忆表不变、回合主路径正常完成（pytest）
       5. 重启恢复：预写 pending 行 → 新建 app 实例（模拟重启）→ pending 行被拾起执行（pytest）
       6. 存储隔离：记忆不写回会话档（会话 PUT 载荷形状零变化，vitest）；注销用户 → user_memories/memory_jobs 级联清零（pytest）
       7. 卫生断言：memory_extract 行与相关日志检索不到记忆内容全文与 key（pytest）
     **REQ-043 记忆管理 UI（「AI 的记忆」分区）**〔批次 C（iter-17 候选）｜优先级：P1（建议——可视化管理层，功能口径依 REQ-042）｜涉及设计稿：design-iter-17（待基线，「原型即需求」；v1.4.15 串行纪律：设计基线为全部开发任务前置）〕

     - **用户故事**：作为用户，我要在设置里看到 AI 记住了关于我的什么，并可编辑/删除/一键停用，以便记忆可检视可治理，且清楚知道哪些内容被注入了对话（审核稿 §四 C 行「注入可见、可整体停用」验收口径）。
     - **描述**：设置弹窗（REQ-028）左导航新增第六分区「AI 的记忆」（TABS 加法项，分区导航/焦点/Esc/遮罩机制零变化，定夺⑦定案）：分区页 = 记忆条目列表（条目文本 + 来源/时间元信息，形态随 design-iter-17 定稿）+ 条目编辑/删除 + 整体停用开关 + **注入文案预览**（逐字 = 实际组装注入内容含包裹标签，定夺⑨定案）。数据面 = 新增记忆 API（GET 列表含停用状态与注入预览 / PUT 条目 / DELETE 条目 / PUT 停用开关，用户 token scope 天然归属隔离）；前端记忆 store 与 api 客户端加法扩展（实现面随 T3 定稿）。编辑/删除/停用自下一回合生效（REQ-042 注入读库时点天然涵盖）。既有交互零回退：分区为弹窗加法项，REQ-028 既有五分区与 REQ-007「前往高级设置」直达验收口径全部保留。
     - **主流程**：
       1. 用户打开设置 → 「AI 的记忆」分区 → 加载记忆列表 + 注入预览 + 停用状态
       2. 条目编辑 → 保存（PUT）→ toast；条目删除 → 确认 → DELETE
       3. 整体停用开关 → PUT → toast（停用后页面明示「AI 将不再参考任何记忆」语义，文案随 design-iter-17）
     - **异常分支**：
       - 列表加载失败（后端不可达）：分区页降级提示 + 重试（沿 settings.boot bootFailed/retryBoot 先例）
       - 无记忆条目：空态文案（形态随 design-iter-17；含「记忆在对话中自动沉淀」说明）
       - 编辑/删除失败：toast 错误提示，列表不变
       - 回合进行中编辑：允许且自下一回合生效（记忆非会话组装实体的组成部分，无 409 竞态面——注入在组装时点读库）
     - **验收标准（可判定）**：
       1. 分区可达：设置弹窗左导航第六项「AI 的记忆」，点击切换正常；REQ-028 既有断言（五分区/Esc/遮罩/未保存拦截/直达定位）复跑零回退（vitest）
       2. 查看/编辑/删除闭环：GET 假列表 → 渲染；编辑保存 → 下一回合请求体注入 = 新文本；删除 → 下一回合注入不含该条（pytest + vitest 联动口径）
       3. 整体停用：开关置停用 → 下一回合请求体无记忆消息（pytest），页面呈停用态
       4. 注入可见：预览文案与组装注入内容逐字一致（含 `<user_memory>` 包裹，pytest/vitest 取值比对）
       5. 归属隔离：API 仅返回与可操作本人记忆（pytest：跨用户标识操作 404，沿复合主键归属隔离哲学）
       6. design-iter-17 走查清单留档（亮/暗双主题 + 空态 + 停用态 + 加载失败态 + 编辑/删除交互）
     **REQ-044 记忆度量与可观测**〔批次 C（iter-17 候选）｜优先级：P1｜涉及设计稿：design-iter-17（admin 面形态）｜**定夺⑩定案（2026-08-20）：不立项——遥测落行并入 REQ-042 为必含项，admin/用户侧聚合可见性入暂缓池；本段为拟稿留档**〕

     - **用户故事**：作为服务部署者，我要记忆抽取的执行次数、token 消耗与成功率被机器度量并在 admin 可见，以便抽取成本如实入账、C 期效果可验证（铁律 5：度量只允许机器采集）。
     - **描述**：telemetry kind 枚举加法扩展 `memory_extract`（行口径 = REQ-042 遥测条款，内容 3.3——该行落库为 REQ-042 必含项，与本条立项与否无关）；本条立项时在此基础上新增：admin 遥测聚合（REQ-038 端点）加法扩展**记忆抽取卡**（抽取次数/成功率/token 消耗，成本聚合计入 unified memory_extract 行 tokens_prompt×input 单价，口径同 REQ-041 compress 行成本入账先例）。REQ-037/038 既有行形状与口径零回退。
     - **主流程**：抽取执行 → memory_extract 行（REQ-042 已落）→ admin 遥测视图按日聚合展示抽取卡。
     - **异常分支**：缺失时段显示缺失标注（铁律 5，不估算）；普通用户访问聚合端点 403（沿 get_admin_user 门禁，REQ-038 口径零变化）。
     - **验收标准（可判定）**：
       1. 聚合一致性：造数已知 memory_extract 行集 → 聚合端点次数/成功率/token 精确值断言；缺失 → 缺失标注（pytest）
       2. 成本聚合计入 unified memory_extract 行 tokens（数值断言，同 REQ-041 验收 3 口径）
       3. 零回退：REQ-038 既有聚合用例零改动复跑全绿；普通用户 403 不泄露数据（pytest）
       4. design-iter-17 走查清单 admin 面留档（抽取卡 + 缺失态，亮/暗双主题）
  2. **存量需求改写（对照式：改写前 spec 原文 → 改写后拟文，批准后直接落 spec；正式改写 4 条 + 非功能 3 行 + 波及登记 5 项 + 零波及明示 5 项）**：
     - **REQ-002 多轮上下文记忆（正式改写——五层注入序与记忆层关系）**：
       - 改写前（描述末句）：「……未超阈值或压缩降级时，20 轮窗口现行口径零回退。」
       - 改写后（拟文）：句末补：「**C 起组装新增用户长期记忆层（CHG-011/REQ-042）**：用户有记忆条目且未整体停用时，记忆作为独立 system 消息注入动态尾区之后、摘要/历史之前；记忆只影响发给上游的内容——记忆数据服务端独立存储，库内会话全文与界面展示/导出/搜索口径零交互；无记忆或停用时组装口径与基线 v7 等价。五层记忆体系（会话内全文→会话摘要→用户长期记忆→用户 systemPrompt→产品人设）的注入序由本条与 REQ-033/036/039/REQ-042 共同固化（CHG-011）。」
       - 验收增补：「新会话首回合请求体含该用户记忆注入消息（位置 = system[1] 之后、逐字 = 记忆页预览，= REQ-042 验收 1，双向引用）」；既有四条验收零回退。
     - **REQ-008 系统提示词设置（正式改写——五层第 4 层定位与现状口径注记）**：
       - 改写前（描述句中段）：「……参与 REQ-002 的上下文组装，不受 20 轮截断影响；CHG-007 起由服务端组装器执行）。**优先级 CEO 已拍板为 P1，不进 MVP。**」
       - 改写后（拟文）：「……参与 REQ-002 的上下文组装，不受 20 轮截断影响；CHG-007 起由服务端组装器执行；**本条 = C 五层记忆体系第 4 层「用户 systemPrompt」（CHG-011 口径注记：注入位置 = 动态尾区段首位，机制零变化；本条现状 = 前端 localStorage 存储 + 随回合上传、服务端零持久化，多设备不一致为现行行为与已知边界——C 期记忆层（第 3 层）为服务端存储、跨设备一致，二者并存不互相替代）**。**优先级 CEO 已拍板为 P1，不进 MVP。**」
       - 验收零变化（本条仅口径注记，不改动行为口径）。
     - **REQ-028 设置弹窗化（正式改写——分区加法）**：
       - 改写前（描述句）：「……外观 / 密钥模式 / 高级设置（自填供应商）/ 对话设置 / 账号（改密+注销，REQ-021）五个区块全部保留，功能口径零变化；……」
       - 改写后（拟文）：「……外观 / 密钥模式 / 高级设置（自填供应商）/ 对话设置 / **AI 的记忆（CHG-011/REQ-043：长期记忆查看/编辑/删除/整体停用/注入预览）** / 账号（改密+注销，REQ-021）**六个区块**全部保留，功能口径零变化（AI 的记忆区块为 CHG-011 加法，形态随 design-iter-17 定稿）；……」
       - 主流程 1 改写：「五个区块可滚动访问」→「六个区块可滚动访问」。
       - 验收增补：「AI 的记忆分区走查留档（= REQ-043 验收 6，双向引用）」；既有三条验收零回退。
     - **REQ-036 prompt 静态/动态分割组装（正式改写——「C 记忆注入继续预留」落地）**：
       - 改写前（描述末句）：「……（CHG-010/REQ-039，挂载点落地；摘要内容在两次压缩之间跨回合恒定）；C 记忆注入继续预留。」
       - 改写后（拟文）：「……（CHG-010/REQ-039，挂载点落地；摘要内容在两次压缩之间跨回合恒定）；**C 起用户长期记忆作为独立 system 消息注入动态尾区之后、摘要之前（CHG-011/REQ-042，预留全部落地；记忆内容在两次抽取完成/用户编辑之间跨回合恒定）；五层注入序 = system[0] 人设 → system[1] 动态尾区 → 记忆消息（如有）→ 摘要消息（如有）→ 历史**。」
       - 验收补指针注：「验收 1/2 断言面（system[0]/system[1] 内容与位置）不受记忆注入影响——记忆消息在 system[1] 之后（CHG-011 注记，同 CHG-010 摘要注记体例）」。
     - **非功能条款 3 行（正式改写）**：
       - 数据行补：「〔CHG-011〕迁移 v10：新建 user_memories 用户长期记忆表 + memory_jobs 抽取任务表（均独立于会话档，ON DELETE CASCADE 注销级联）+ users 加法列 memory_enabled（整体停用开关）；老数据不动、不回填。」
       - 可观测行补：「〔CHG-011〕记忆抽取执行行（kind='memory_extract'：状态/耗时/抽取调用 token 消耗/触发会话），机器采集（铁律 5）；行不含记忆内容全文与 key；失败如实记、不补造。」
       - 架构行补：「〔CHG-011〕agent 运行时增用户长期记忆子系统（记忆表 + 会话后异步抽取后台任务〔常驻扫描 + 重启恢复〕+ 五层注入序组装；摘要调用基建复用 B2，技术口径见 changes.md CHG-011）。」
     - **波及登记 5 项（简版对照，口径不变、spec 描述随改写同步）**：
       - REQ-039：描述补「本条产出的会话摘要 = C 五层记忆体系第 2 层『会话摘要』（CHG-011 注记：管道/阈值/水位口径零变化，仅纳入五层叙事；注入位置维持动态尾区之后，记忆消息挂载于其前）」。
       - REQ-021：注销账号描述补「注销级联清理含 user_memories / memory_jobs（FK ON DELETE CASCADE，CHG-011）」。
       - REQ-034：描述补「记忆抽取后台调用（CHG-011/REQ-042）为非回合上游调用：回合计数口径不变（不计回合）、usage_daily 零写入，tokens 仅落 telemetry（CHG-011 定夺③定案）」——与手动压缩口径同哲学，quota.py 零改动。
       - REQ-037：kind 枚举加法扩展 'memory_extract'（REQ-042 遥测条款承载）；llm/tool/compress 行形状与采集口径零变化，spec 描述补一句指针。
       - REQ-038：定夺⑩定案 = 不立项 → 本条零变化（记忆抽取聚合可见性入暂缓池，纳入时走 CHG——2026-08-20 批准定案回填）。
     - **零波及明示 5 项（判断结论如实登记，不凑数）**：
       - REQ-006/REQ-022：记忆存独立表、不写回会话档 → LWW/409 跨格式守卫/整档透传/schema: 2 标记**零交互**；会话档结构零变化（同 CHG-010 零波及体例）。
       - REQ-013：导出 = 会话消息全文，记忆为用户级组装层实体不是消息 → 导出口径零变化（记忆不进导出，属有意边界，同摘要先例）。
       - REQ-016：搜索索引 = 消息文本段，记忆不在消息中 → 搜索口径零变化（跨会话记忆检索为暂缓池候选，本期不做）。
       - REQ-019：版本分支为会话级实体，记忆为用户级 → 分支切换/激活不影响记忆注入，零交互。
       - REQ-015：编辑重建不回滚已生成记忆（记忆为增量结论，独立于消息实体存续）；重建后的消息天然成为未覆盖增量的抽取素材（抽取执行时读库内当前内容）→ 编辑语义零回退、无新增分支。
  3. **关键技术机制写实（本 CHG 定死的技术口径；属定夺的参数汇总于内容 4）**：
     - **3.1 五层注入序（组装路径，定死——定夺④处理方式）**：
       ```
       回合受理（chat_turn，proxy.py）
        └─ 读会话档 → wire_messages_from_doc（零变化）→ 一级 snip（零变化，REQ-039）
            └─ _assemble_pipeline 扩展：
                ├─ 记忆读取：memory_enabled=1 且 user_memories 非空 → <user_memory> 包裹
                ├─ 阈值判定 / compact 管道（零变化，REQ-039）
                └─ 五层组装 = system[0] 人设 → system[1] 动态尾区（用户提示词+时间行）
                     → 记忆 system 消息（如有）→ 摘要 system 消息（如压缩生效）
                     → 历史（20 轮基线 / R 轮压缩生效）
       ```
       序位理由：记忆 = 用户级长期（近人设），摘要 = 会话级中期（近历史），语义上由远及近；记忆变化频率（抽取完成/用户编辑时点）远低于摘要（阈值触发重压缩），更稳定内容置前利于字节前缀稳定。**缓存影响写实分析（B1 收益面零劣化）**：DeepSeek 前缀缓存按请求体字节前缀匹配，B1 收益面 = system[0] 跨全部用户全部请求字节恒定（config.py product_persona）；system[1] 含时间行（agent.py `_now_line()` 逐分钟变化）与用户提示词（逐用户变化），跨请求共享前缀本就只有 system[0]——记忆消息位于 system[1] 之后，其内容变化（抽取/编辑）只改变已非共享区间之后的位置，**对 B1 前缀缓存收益零劣化**；记忆体量上限对请求体总量影响有限，不冲击 B2 阈值口径（**T0 复核回填（2026-08-20）：实测异常已行使收紧授权——50×200 字满载 = 6079 tokens 占阈值 7000 的 86.8%，上限定死收紧为 30 条 × 单条 ≤150 字，收紧后真满载实测 2909 tokens（41.6%），留档 plans/iter-17-verify.md §3**）。
     - **3.2 存储语义（定死）**：
       ```sql
       -- 迁移 v10（审核稿 §四 C 行「迁移 v7」为迁移 v6 时代写法，v7/v8/v9 已被
       -- app_settings/telemetry/context_summary 占用，更正为 v10 并注记登记）
       CREATE TABLE user_memories (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           content TEXT NOT NULL,              -- 记忆条目文本（一条一个独立记忆点，≤150 字；T0 收紧回填）
           source_session_id TEXT,             -- 抽取来源会话（机器记录；用户手工编辑/新增为 NULL）
           model TEXT,                         -- 抽取模型（机器记录；用户手工为 NULL）
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now'))
       );
       CREATE INDEX idx_user_memories_user ON user_memories(user_id);
       CREATE TABLE memory_jobs (
           user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           session_id TEXT NOT NULL,
           status TEXT NOT NULL DEFAULT 'pending',   -- pending | done | error
           watermark_msg_id TEXT NOT NULL,           -- 本次抽取覆盖至的消息 id（增量判定依据）
           attempts INTEGER NOT NULL DEFAULT 0,      -- 失败计数（上限 3，超限留 error 行待观察）
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now')),
           PRIMARY KEY (user_id, session_id)         -- 每会话至多一份在案任务（覆盖更新）
       );
       ALTER TABLE users ADD COLUMN memory_enabled INTEGER NOT NULL DEFAULT 1;  -- 整体一键停用（审核稿验收口径；users 加法列沿 v5 quota_override 先例）
       ```
       不写回会话档的理由（备选方案否决存档，沿 CHG-010 3.2 体例）：记忆是**用户级跨会话实体**，会话档为会话级 LWW 整档透传实体，二者维度不匹配；会话档顶字段方案除 CHG-010 已否决的前端陈旧副本抹除竞态外，还引入跨会话写同档的语义混乱。独立表方案：与 LWW/409 守卫/整档透传零交互、注销清理由外键级联承载、跨设备天然一致（服务端组装读服务端库）。代价 = 导出不含记忆（记忆非会话内容，可接受）。
     - **3.3 抽取调用与遥测口径（定死）**：
       - 调用形态：非流式 chat completion（stream=false，响应体直接含 usage），复用共享 httpx 池与 B2 call_summary 基建（compress.py：SummaryOutcome 三终态/独立超时护栏——抽取超时参数随 T0 定案（**T0 回填：冒烟三轮真实调用均秒级返回，30s 护栏保守可用，实施沿用 summary_timeout 同值定案**）；注入/抽取文案后端拥有、T0 定稿后逐字断言面登记 verify 文档（沿 SUMMARY_PROMPT R2 定稿先例）。抽取 prompt 要求：① 输入 = 现有记忆列表 + 本会话增量转写（render_transcript 同模式渲染）② 输出 = 合并后的**完整新记忆列表**（一条一个独立记忆点，去重、冲突以最新信息为准）③ 单条 ≤150 字、总数 ≤30 条（T0 体量复核收紧回填，2026-08-20，原拟稿 ≤200 字 × 50 条，留档 plans/iter-17-verify.md §3）。
       - 落库语义：后端收到新列表 → 同事务**先删后插整体替换**该用户 user_memories（定夺⑤定案：去重/冲突交模型、后端只限条数——整体替换是唯一无歧义、可断言的落库语义）。
       - 遥测行（铁律 5 机器采集）：kind='memory_extract'、endpoint='memory'、turn_id=NULL（非回合）、session_id=触发来源会话、step=NULL（同 compress 行不占回合 step 序列）、model/latency_ms/status/tokens 分项同列口径（usage 字段映射与 record_compress 一致）；**行不含记忆内容全文**（卫生口径同 REQ-037）。
       - 计费口径（定死，随定夺③推荐）：抽取调用**不计回合、usage_daily 零写入（quota.py 零改动），tokens 仅落 telemetry memory_extract 行**——沿 B2 定夺⑧双轨哲学：配额轨「1 回合 = 一次用户发送触发」语义不因后台行为扭曲，遥测轨保证成本不漏记（铁律 5）；成本聚合若立项（REQ-044）按 unified 口径计入（REQ-038 定夺⑥同源）。
     - **3.4 触发时机与重启恢复（框架定死，微参数 T0——定夺②处理方式，沿 B2 定夺③「T0 取证后定死」先例）**：
       - 触发 = 服务端常驻后台任务（main.py lifespan 挂载——现状零常驻后台任务，首次引入）：周期扫描（**T0 取证回填：扫描间隔定死 60s**），会话满足 **轮数 ≥ N（**T0 回填：N=4**）且距最近回合 ≥ X 分钟（**T0 回填：X=10**）且存在未覆盖增量（上次抽取 watermark 之后的消息）且 memory_enabled=1 且上游可解析** → memory_jobs pending 行落库（同主键覆盖更新）→ 异步执行抽取。（微参数论证依据留档 plans/iter-17-verify.md §4。）
       - 「会话后」语义说明：web 端无可靠「会话结束」信号（用户可直接关闭页面），**服务端静默窗口是唯一权威判定**——这是对审核稿「会话后异步抽取」的可实现化口径。
       - 重启恢复口径：memory_jobs 持久化 = 唯一权威——进程重启 pending 行不丢，后台任务启动后继续执行；在途调用随进程丢失、下一轮扫描重新考虑（attempts 只计已完成的失败，上限 3 后留 error 行待观察，不无限重试、如实可观测）。generating_sessions 内存重置（main.py L54）为现状口径，与记忆任务持久化口径零交互（回合状态与记忆任务状态独立）。
     - **3.5 与 schema:2/blocks 的关系（定死）**：blocks 模型零变化、**不新增 block 类型**——记忆是「用户级组装层实体」（独立表 + wire system 消息），不是消息；wire_messages_from_doc 归一化口径零变化；存量会话零迁移。
     - **3.6 与 LWW 云同步的关系（定死）**：记忆**不随会话 PUT 回写**——服务端独立表，前端对记忆数据写路径经独立记忆 API（REQ-043），不参与会话整档透传；LWW/409 守卫/整档透传/schema 标记全部零交互（内容 2 零波及明示）。
     - **3.7 记忆管理 API 口径（框架定死，形态随 design-iter-17 定稿）**：GET /api/memory（条目列表 + memory_enabled 状态 + 注入预览文案）/ PUT /api/memory/{id}（条目编辑）/ DELETE /api/memory/{id}（条目删除）/ PUT /api/memory/settings（memory_enabled 开关）——用户 token scope，user_id = token 身份，他人数据天然不可见不可操作（归属隔离沿复合主键哲学）；错误形态沿 sessions.py 404/409 detail 形状先例。注入预览 = 组装时点逐字同源取值（「看到的就是注入的」，定夺⑨定案）。
  4. **定夺项清单（2026-08-20 全部定夺，CEO 原话「全部按推荐批准」；推荐即定案，理由摘要留档）**：
     | # | 定夺项 | 定夺结论（2026-08-20） | 理由摘要 |
     |---|---|---|---|
     | ① | CHG-011 整体批准 | **批准**（含 REQ-042~044 新增与优先级 P0/P1/P1[⑩定]、正式改写 4 条 + 非功能 3 行、波及 5 项 + 零波及明示 5 项；基线 req-baseline-v8） | 审核稿 C 期既定路线，B2 复用面已就绪 |
     | ② | 抽取触发时机 | **服务端常驻后台静默窗口扫描**：轮数 ≥ N + 静默 ≥ X 分钟 + 有未覆盖增量；**T0 取证回填（2026-08-20）：N=4 / X=10 分钟 / 扫描间隔 60s 定死（论证定死留档 plans/iter-17-verify.md §4）** | web 端无可靠「会话结束」信号（用户可直接关页面），服务端静默窗口是唯一权威判定；扫描式触发天然含重启恢复（pending 行不丢）；回合结束即抽方案被否——频次高成本大且不符合「会话后」语义 |
     | ③ | 抽取调用计费/配额口径（审核稿点名 CHG 定夺） | **不计回合、usage_daily 零写入、tokens 仅落 telemetry memory_extract 行** | 抽取非用户发送触发，计入回合扭曲「1 回合 = 一次用户发送」语义；遥测轨保证成本不漏（铁律 5）；完全沿 B2 定夺⑧双轨哲学（手动压缩先例），quota.py 零改动 |
     | ④ | 记忆注入位置与序 | **独立 system 消息，system[1] 动态尾区之后、摘要消息之前**：人设→动态尾区→记忆→摘要→历史 | 记忆 = 用户级长期近人设、摘要 = 会话级中期近历史，由远及近；记忆变化频率更低置前利于字节前缀稳定；**缓存写实分析：B1 前缀缓存收益面 = system[0] 字节恒定，system[1] 时间行本已逐分钟变化，记忆置于其后零劣化缓存收益**（内容 3.1） |
     | ⑤ | 记忆条目结构与更新策略 | **自由文本条目列表**（一条一个独立记忆点；**T0 体量复核收紧回填（2026-08-20）：上限 30 条 × 单条 ≤150 字**，实测依据 plans/iter-17-verify.md §3——50×200 字满载 6079 tokens 占阈值 86.8%，按内容 3.1 授权收紧）；**更新 = 模型输出合并后完整新列表、后端整体替换（先删后插同事务）**，去重/冲突交模型 | 整体替换是唯一无歧义可断言的落库语义；去重/冲突交模型避免文本相似度计算，与 B2「语义工作交模型」哲学一致；结构化 fact（键值对）方案被否——抽取稳定性依赖模型格式纪律、MVP 成本不匹配 |
     | ⑥ | 停用粒度 | **整体一键停用必做**（审核稿验收口径，users.memory_enabled 加法列）；**单条停用本期不做**（不要的条目直接删除/编辑） | 整体停用满足审核稿「可整体停用」验收；单条停用 UI 面翻倍而价值有限（删除已覆盖该诉求），远期如需「停用不删除」语义再扩展 |
     | ⑦ | 记忆管理 UI 形态 | **设置弹窗第六分区「AI 的记忆」**（TABS 加法项，复用 REQ-028 容器与分区导航机制），design-iter-17 定稿 | 弹窗左右分栏已有承载面、零新增交互模式；独立页面需新增路由与维护面，成本不匹配；审核稿「设置多一页」叙事与弹窗分区语义兼容 |
     | ⑧ | 自填模式降级 | **抽取调用跟随该用户当前模式**（统一 key → .env 三变量；自填 → 生效档案三要素，同 B2 摘要定夺②）；自填端点失败/拒绝 → **同失败分支降级**（job error 计数、下次扫描重试，降级方向恒为「无新记忆、存量照常注入」）；统一 key 未配置且无生效档案 → 扫描跳过不落 job 行 | 与 B2 失败降级哲学逐字同构；不引入独立抽取模型配置面（零新增配置面，最小 MVP） |
     | ⑨ | 注入可见的产品形态 | **记忆页展示实际注入文案预览**（逐字含 `<user_memory>` 包裹，「看到的就是注入的」）；**回合内不做提示**（SSE 事件流零变化） | 审核稿「注入可见」验收由页内预览即满足；回合内提示需 SSE 新事件类型 + 前端适配且扰对话，B2 先例为用户无感，成本收益不匹配 |
     | ⑩ | REQ-044 是否立项 | **不立项**：memory_extract 遥测落行并入 REQ-042（铁律 5 必含项），admin/用户侧聚合可见性入暂缓池 | Σ10 顶格压力下的备砍序首位；行已在、成本可查（B1 遥测基建），可见性属锦上添花；CEO 如坚持可观测随交付可见，REQ-044 按拟稿立项（工作量含于备砍序①） |
  5. **影响评估**：
     - **存量需求逐条**：见内容 2——正式改写 4 条（REQ-002/008/028/036，对照式拟文可直接落 spec）+ 非功能 3 行；波及登记 5 项（REQ-039/021/034/037/038[定夺依赖]）；零波及明示 5 项（REQ-006/022/013/016/019/015——REQ-006 与 022 同条）。其余需求（REQ-001/003~007/009~012/014/017/018/020/023~027/029~032/035/040）不受影响。
     - **设计资产承载（v1.4.1 逐项核对，「原型即需求」）**：`design/iter-17` 新增——承载 REQ-043 记忆页（列表/编辑/删除/停用/注入预览/空态），及 REQ-044 admin 抽取卡（若定夺⑩=立项）；C 期 T0/T1 产出并基线（**v1.4.15 串行纪律：设计基线为全部开发任务（含非 UI）前置**）。`design/proto` 不同步（记忆对 iter-1 核心闭环原型不可见）；其余 design/iter-* 不同步（无对应 REQ 界面口径变化）。
     - **架构变更说明**：后端新增 `memory.py` 模块（记忆读写/抽取执行[job 调度 + 复用 B2 调用基建]/注入组装辅助，预估 200~250 行新模块）+ 新增 memory 路由（管理 API，REQ-043 数据面）+ db.py 迁移 v10 + telemetry.py memory_extract 落行 + proxy.py `_assemble_pipeline` 注入扩展 + main.py lifespan 常驻扫描任务（**首次引入**）+ config.py 抽取微参数字段；前端 SettingsForm.vue TABS 加法项 + 记忆分区面板 + 记忆 store + api 客户端加法扩展——**client.ts/sessions.ts 回合数据面零改动**（记忆注入为服务端行为，同 B2 先例）。quota.py 与 usage_daily 数据面**零改动**。
     - **工作量与排期**：审核稿 C 定级 **Σ10**；拆解预估 = T0 取证 S（1：抽取 prompt 真实 DeepSeek 冒烟 + 注入文案定稿 + 微参数 N/X/上限/扫描间隔取证定死）+ T1 design-iter-17 基线 S~M（2）+ T2 后端核心 L（4：迁移 v10 + 记忆模块 + 常驻扫描/重启恢复 + 注入组装 + 遥测行）+ T3 管理 API + 前端分区 M（2~3）——**Σ9~10**。**顶格 Σ10 理由**（近期「不顶格留余量」惯例的例外说明）：① 审核稿原将 C 定级 Σ10（七期路线仅 A1/D1 同级）② C 含七期路线首个「常驻后台任务 + 重启恢复」基建（无先例可复用，不确定性高于 B2 管道）③ UI 面为首个「页级设置分区」（B2 REQ-040 仅菜单一项）。**备砍序（容量紧张时）**：① REQ-044 立项项（定夺⑩已定案不立项，本项失效）② 记忆页编辑功能降级为「查看 + 删除 + 停用」（编辑后移，Σ−1）③ 微参数 T0 取证范围收窄为保守占位（不建议砍——取证驱动为 iter-16 已验证实践）。排期由 PM 走 `/mm-iteration-plan`（iter-17）；design-iter-17 基线为全部开发任务前置（v1.4.15）；T0 取证项为 T2 实施输入前置。
     - **测试基线**：pytest 282 / vitest 345（iter-16 终态）；沿全局回归基线口径——存量全绿、改写用例登记映射（REQ-033/036 组装等价类用例遇记忆在位会话按 REQ-042 验收 1/2 口径）、功能性删除为零；度量数据全部机器采集（铁律 5）。
     - **发布影响**：v0.5.0 仍独立卡服务器，不受本变更影响。
  6. **暂缓池联动（批准后随 spec §4 同步的拟文）**：
     - C 条目：划线移出 + 注记「CHG-011 移出，2026-08-20：落地为 REQ-042~043（REQ-044 按定夺⑩处理；基线 req-baseline-v8，批准结论随定夺回填）」。
     - 定夺⑩定案不立项，新增条目：「记忆抽取度量可见性（admin/用户侧）：memory_extract 遥测行已随 REQ-042 落库、成本可查；聚合可见性纳入时走 CHG（B1 遥测基建已承载）」。
     - 其余条目（D1/D2/移动端/天气/供应商对比/体验深化主题包/同步精细合并/用量面板/RAG/裁决口径观察项）零变化（D1 依赖 A 工具网关、与 C 无依赖关系）。
- 落地核对清单（v1.4.10 制度 A；CEO 批准后逐项落地勾验，首个任务提交内落盘）：
  | # | 承诺项 | 状态 | 落地证据 |
  |---|--------|------|---------|
  | 1 | spec §2 新增 REQ-042/043 全文（REQ-044 按定夺⑩定案处理，四要素齐备，按内容 1 拟稿） | ✅ 已落地（2026-08-20） | spec §2 REQ-042~043 全文（定夺结论随文标注；REQ-044 按定夺⑩「不立项」定案不落入 spec，遥测落行并入 REQ-042，拟稿留档本条内容 1） |
  | 2 | REQ-002/008/028/036 正式改写（内容 2 拟文）+ 波及登记 5 项（REQ-039/021/034/037/038）+ 零波及明示 5 项 | ✅ 已落地（2026-08-20） | spec REQ-002 描述/验收、REQ-008 描述（标题补注记）、REQ-028 描述/主流程/验收、REQ-036 描述/验收指针注；REQ-039/021/034/037 指针句（REQ-038 按定夺⑩零变化）；零波及明示（REQ-006/022/013/016/019/015）登记于本条内容 2 |
  | 3 | 非功能三行同步（数据/可观测/架构，内容 2 拟文） | ✅ 已落地（2026-08-20） | spec §3 数据/可观测/架构三行〔CHG-011〕段 |
  | 4 | spec §4 暂缓池联动（C 条目移出注记 + 抽取度量可见性新增条目，内容 6 拟文） | ✅ 已落地（2026-08-20） | spec §4：C 条目划线移出注记；记忆抽取度量可见性新增条目（定夺⑩定案） |
  | 5 | RTM 新增 REQ-042~043 行 + 变更备注行 + 改写行 CHG-011 注记 + 全局回归基线 C 面说明（v1.4.11 C 行级收口） | ✅ 已落地（2026-08-20） | rtm.md 头段 + REQ-042~043 两行 + 全局回归基线行 C 面 + REQ-002/008/028/036 行改写注记与 REQ-039/021/034/037/038 行波及简注 + 变更备注行 + 随附卫生项（B2 面滞后措辞收口） |
  | 6 | 定夺项①~⑩结论回填本条（含②⑤微参数随 C T0 取证定死值回填） | ✅ 已落地（2026-08-20 批准回填 + 2026-08-20 T0 定死值随 ca949e9 回填完毕：②N=4/X=10 分钟/扫描 60s，⑤上限收紧 30 条×≤150 字） | 状态行 / 内容 4 定夺表（定案列）/ CEO 批准字段 |
  | 7 | registry.md 同步（主会话执行） | ✅ 已落地（2026-08-20 同步，company-os 仓库 a23294c） | registry.md ai-chat 行含 CHG-011 批准与基线 v8 记录（含制度版本列 v1.4.14→v1.4.15 滞后收口） |
- 需要 CEO 定夺的事项清单（2026-08-20 全部定夺，CEO 原话「全部按推荐批准」；结论见内容 4 定夺表）：
  1. **CHG-011 整体批准**（REQ-042~044 三条新增与优先级建议 P0/P1/P1[⑩定]、正式改写 4 条 + 非功能 3 行、波及 5 项 + 零波及明示 5 项）→ 批准后打基线 req-baseline-v8
  2. 抽取触发时机（推荐服务端常驻后台静默窗口扫描：轮数 ≥ N + 静默 ≥ X 分钟 + 有未覆盖增量，微参数 T0 取证定死）
  3. 抽取调用计费/配额口径——审核稿点名 CHG 定夺（推荐不计回合、usage_daily 零写入、tokens 仅落 telemetry）
  4. 记忆注入位置与序（推荐独立 system 消息 = 动态尾区之后、摘要之前；B1 前缀缓存零劣化已写实分析）
  5. 记忆条目结构与更新策略（推荐自由文本条目列表 ≤200 字 × 上限 50，模型合并输出 + 后端整体替换）
  6. 停用粒度（推荐整体一键停用必做、单条停用本期不做）
  7. 记忆管理 UI 形态（推荐设置弹窗第六分区「AI 的记忆」，design-iter-17 定稿）
  8. 自填模式降级（推荐抽取跟随当前模式、失败同分支降级、无上游不落 job 行）
  9. 注入可见的产品形态（推荐记忆页注入文案预览、回合内不提示）
  10. REQ-044 是否立项（推荐不立项——遥测落行并入 REQ-042，admin 可见性入暂缓池）
- CEO 批准：**批准（2026-08-20，CEO 原话「全部按推荐批准」）**——10 项定夺全部按推荐定案：① CHG-011 整体批准（含 REQ-042~043 新增与优先级 P0/P1、正式改写 4 条 + 非功能 3 行、波及 5 项 + 零波及明示 5 项）；② 抽取触发 = 服务端常驻后台静默窗口扫描（轮数 ≥ N + 静默 ≥ X 分钟 + 有未覆盖增量，N/X/扫描间隔 T0 取证定死、实施期占位 4/10 分钟/60s）；③ 抽取不计回合、usage_daily 零写入、tokens 仅落 telemetry memory_extract 行；④ 记忆独立 system 消息注入动态尾区之后、摘要之前（五层注入序定案，B1 前缀缓存零劣化）；⑤ 自由文本条目 ≤200 字 × 上限 50、模型合并输出 + 后端整体替换（**⑤上限随 T0 体量复核收紧为 30 条 × ≤150 字，2026-08-20 回填，授权口径见内容 3.1，留档 plans/iter-17-verify.md §3**）；⑥ 整体一键停用必做（users.memory_enabled）、单条停用本期不做；⑦ 设置弹窗第六分区「AI 的记忆」（design-iter-17 定稿）；⑧ 抽取跟随当前模式、失败同分支降级、无上游不落 job 行；⑨ 记忆页注入文案逐字预览、回合内不提示；⑩ REQ-044 不立项——遥测落行并入 REQ-042、admin 可见性入暂缓池。基线 req-baseline-v8；spec/RTM 同日落盘（落地核对清单第 1~6 项勾验），tag 与提交推送由主会话执行。

## CHG-010 架构升级第四期 B2：三级上下文压缩

- 日期：2026-08-19
- 类型：修改 + 新增
- 状态：**已批准（2026-08-19，CEO 原话「全部按推荐批准」；基线 req-baseline-v7）**
- 原因/依据：CEO 2026-08-19 拍板启动七期路线第四期 **B2**（spec §4 暂缓池「B2：三级上下文压缩（旧工具结果裁剪 → 中段历史摘要 → token 阈值自动 + 手动压缩；REQ-002 终态演进）——agent 路线第 4 期」条目拉项；审核稿 §六.2「每期排期时走一条 CHG」模式，沿 CHG-007/009 先例）。上游依据：已批准审核稿 `docs/architecture-upgrade-plan-2026-08-17.md`——§三要素 6「适配为三级：旧工具结果裁剪（snip）→ 中段历史摘要（compact）→ token 阈值自动压缩 + 用户手动压缩；摘要基建为 C 复用」；§四 B2 行「Σ8：三级压缩管道 + 摘要调用基建（C 复用）；验收口径示例：T0 定死：30 轮会话第 31 次请求体 ≤ X token 且第 1 轮关键信息仍答对（X 与测量法随稿定死）」；§九效果叙事 B1+B2 行「三十轮长对话不失忆（中段自动摘要、开头关键信息保留）；admin 多一排卡」（admin 卡的面 B1 已随 REQ-038 承载遥测视图，B2 的效果度量复用 REQ-037/038 遥测基建）。前置依赖已就绪（审核稿 §四：B 依赖 A1 服务端组装与回合计费）：A1/A2（iter-13/14）、B1（iter-15）均已交付关闭，基线现为 req-baseline-v6（REQ-001~038 全部达成）；B1 已提供三项 B2 前置：**REQ-036** system 两段式分区（动态尾区为 B2/C 预留注入区，「本条只固化边界不实现注入」——本 CHG 落地挂载点）、**REQ-037** telemetry 明细表（请求级 token/延迟/缓存命中机器采集，压缩阈值判定与效果度量的数据底座）、**REQ-038** admin 遥测视图（压缩效果卡的承载面）。**现状代码取证（2026-08-19 逐项核实，非推测）**：
  - **组装现状**：`backend/app/agent.py` `assemble_context()`（L139-168）——system[0] 静态前缀 + system[1] 动态尾区两段式分区（CHG-009 落地）+ 最近 20 轮窗口（`MAX_CONTEXT_TURNS = 20`，L29）+ user 锚定截断；**无任何压缩分支**——无 token 阈值判定、无摘要注入、无工具结果裁剪。
  - **请求体增长现状（B2 要解决的问题）**：`agent.wire_messages_from_doc()`（L64-126）把 tool_result 段**全文**展开为 role=tool 消息进组装（经 `wrap_for_context` 注入包裹）；网关截断上限 32 KiB（`config.tool_result_limit = 32 * 1024`，config.py L31）——**单个搜索工具回合最多可为请求体附加约 32 KiB 结果文本**；20 轮窗口内请求体随轮数线性增长，超 20 轮的轮次**整段丢弃**（REQ-002 异常分支「自动截断」现状口径）——长会话中段失忆是现行设计行为，B2 改为「摘要替代丢弃」。
  - **压缩机制零存在**：backend/app 全目录检索 `compress|compact|snip|summar` 无任何压缩相关实现（唯一「摘要」字样为 `search.py` 搜索结果组装文案，与压缩无关）。
  - **阈值判定与效果度量的机器数据源已在**：telemetry 表（迁移 v8，db.py L118-141）每次上游调用落一行，`tokens_prompt` 由上游 usage 帧 `prompt_tokens` 机器映射落库（`telemetry.record_llm()`，telemetry.py L77-124，字段映射为 iter-15 T0 §2.4 取证结论）——**无需引入 tokenizer**，「上一回合请求体多大」有机器实测值（铁律 5 友好）。
  - **前端零组装现状**：`src/api/client.ts` `runChatTurn()`（L123-211）请求体仅 session_id / message / system_prompt；`src/stores/sessions.ts` send() 为「先 PUT 整档再发回合」（L273-275）——压缩对前端数据面零改动；界面可见历史 = chat_sessions.data 内 messages 全文档，与「发给上游的内容」天然解耦。
  - **配额与落账现状**：`quota.record_tokens()`（quota.py L124-139）独立短连接按 (day,user_id,mode) 追加 tokens；回合内上游调用 tokens 经 `run_turn.on_finish` 累计落账——摘要调用的计账口径需本 CHG 定死（定夺⑧）。
  - **测试基线**：pytest 239 + vitest 324（iter-15 终态，plans/iter-15-verify.md 收口记录在案）。
- 内容（对 spec 的拟改，spec 级详细度——沿 CHG-007/009 呈批详度口径（CEO 2026-08-17 定），批准后按拟文落 spec/RTM。除内容 4 汇总的定夺项外，其余口径本 CHG 定死）：
  1. **新增 REQ 三条（编号自 REQ-039 顺延，spec 级拟稿全文，结构与 spec §2 既有 REQ 一致，批准后原样落 spec §2）**：
     **REQ-039 三级上下文压缩管道（snip + compact + token 阈值自动压缩）**〔批次 B2（iter-16 候选）｜优先级：P0（建议，CEO 批准时确认）｜不涉及设计稿（纯后端数据层，用户界面零变化）〕

     - **用户故事**：作为用户，我要长对话不再「超过 20 轮就失忆」——中段历史被自动压缩成摘要继续参与组装、开头关键信息保留，以便三十轮会话仍连贯，且请求体不随轮数无限膨胀。
     - **描述**：在 REQ-033 服务端组装器与 REQ-036 分区基础上，上下文组装升级为**三级压缩管道**（审核稿 §三要素 6 三级口径）：**一级 snip（旧工具结果裁剪）**——组装时确定性地把早于最近 K 条工具消息（K=2，定夺⑨）的 tool 结果替换为裁剪占位（文案 `[旧工具结果已裁剪：{工具名} · {状态}]`，后端拥有、逐字断言面登记 verify 文档）；**二级 compact（中段历史摘要）**——以一次上游摘要调用把水位之前的中段历史压缩为摘要文本，作为**独立 system 消息**注入组装，挂载点 = system[1] 动态尾区之后、历史之前（REQ-036 预留注入区落地，内容 3.1）；**三级 token 阈值自动触发**——以该会话上一回合 step=1 上游调用的 telemetry `tokens_prompt` **机器实测值**（REQ-037 数据底座，不引入 tokenizer、不估算）判定，超阈值（定夺③：T0 取证后定死，实施期暂以 32768 占位）即在下一回合组装前执行 compact。**压缩只影响「发给上游的内容」**：库内会话消息全文零删除，界面全量展示/导出/搜索/版本分支口径全部不变（定夺⑥推荐口径）。摘要产物存服务端独立表 `context_summary`（迁移 v9，定夺⑤推荐，内容 3.2），不写回会话档，与 LWW/409 守卫/整档透传零交互。摘要调用跟随回合当前模式（统一 key → .env 统一三变量；自填 → 生效档案三要素），模型名随模式默认、不引入独立配置面（定夺②推荐）。摘要调用为非流式调用、独立超时护栏 30s（定夺⑨）；任何失败降级为不压缩组装（20 轮窗口 + snip），回合不阻塞、用户无感。摘要调用 tokens 如实计入回合 token 累计（REQ-034 既有口径自然覆盖，定夺⑧）；压缩执行落 telemetry `kind='compress'` 行（机器采集，铁律 5，行口径见 REQ-041）。摘要基建（调用器 + 产物存储 + 水位语义）为 C 期记忆体系复用面（审核稿 §三要素 6 末句）。
     - **主流程**：
       1. 回合受理 → 自库读会话档 → `wire_messages_from_doc` 归一化（零变化）→ 一级 snip：早于最近 2 条工具消息的 tool 结果替换为裁剪占位
       2. 阈值判定：读该会话上一回合 step=1 的 telemetry `tokens_prompt` 机器实测值 → 未超阈值 / 无记录（新会话/遥测缺失）→ 按基线 v6 口径组装（20 轮窗口，零回退）
       3. 超阈值且有有效摘要（水位消息仍在当前 messages 中）→ 摘要注入组装：system[0]（如有）+ system[1] + 摘要 system 消息 + 最近 R 轮（R=5，定夺⑨；snip 已执行）
       4. 超阈值且无有效摘要 → 执行摘要调用（非流式、30s 护栏）→ 产物与水位落 `context_summary` 表、落 compress 行 → 按 3 组装
       5. 无可压缩中段（总轮数 ≤ R）→ 跳过 compact（提示面见 REQ-040「无需压缩」口径）
     - **异常分支**：
       - 摘要调用失败/超时/空摘要/上游 4xx/5xx：本回合回退不压缩组装（20 轮窗口 + snip），回合正常完成；warning 日志 + compress 行 status=error/timeout（铁律 5 如实记，不阻塞、不扰用户）
       - 无上一回合遥测记录（新会话/遥测写失败/90 天清理边界）：按未超阈值处理（保守方向 = 不差于现状，不造数）
       - 编辑重建（REQ-015）删除了水位消息（编辑点在水位处或之前）：摘要行删除失效，下次超阈值重新生成（内容 3.2）
       - 版本切换（REQ-019）分支激活：水位消息 id 在当前 messages 中不存在 → 视同失效，回退不压缩组装（branches 本不参与组装，零新增口径）
       - 自填档案上游不支持/拒绝摘要调用：同失败分支降级（不区分错误形态，降级方向恒为现状）
       - 阈值超限但请求体仍超上游硬上限（极端大会话）：上游报错沿 REQ-007/030 既有错误映射（本条不另设分支；R 轮与摘要长度参数以 T0 取证校准避免该形态成为常态）
     - **验收标准（可判定）**：
       1. snip 确定性：构造含 5 个工具回合的会话 → 组装请求体中仅最近 2 条 tool 消息保留结果全文，更早 tool 结果为裁剪占位文案（逐字断言，pytest + MockTransport 捕获）
       2. 自动触发：置上一回合 step=1 telemetry tokens_prompt = 阈值+1 → 本回合请求体含摘要 system 消息（挂载位置 = system[1] 之后、历史之前）且历史仅最近 R=5 轮（pytest，摘要调用以假上游编排）
       3. 阈值下零回退：纯文本会话 + tokens_prompt = 阈值-1 → 组装与基线 v6 口径逐字段等价（REQ-033/036 既有验收复跑；含旧工具回合的会话按验收 1 口径断言，改写映射登记）
       4. 失败降级：假摘要调用 500 / 超时 → 请求体回退不压缩形态、回合正常完成、turn.end 帧正常、compress 行 status=error/timeout（pytest）
       5. 30 轮验收（审核稿 B2 口径）：30 轮会话（第 1 轮预置关键事实，如「我叫小明」+ 一项需求）→ 第 31 次请求体 ≤ X token（X 与测量法随 T0 取证定死，定夺⑦：测量 = 假上游 usage 帧 prompt_tokens 机器读数，铁律 5，不手数 token）且第 31 轮回答断言包含关键事实（pytest 脚本化假上游；真实 DeepSeek 30 轮冒烟走查留档 T0 取证段）
       6. 存储语义：压缩执行前后 chat_sessions 会话档 messages 数量与全文逐字不变、GET 读路径输出不变（pytest 前后比对）
       7. 产物独立：压缩产物仅存 context_summary 表；会话 PUT 载荷形状零变化、不含摘要字段（vitest 断言 PUT 载荷 + pytest 断言产物表）
     **REQ-040 用户手动压缩入口与可见性**〔批次 B2（iter-16 候选）｜优先级：P1（建议——可视化层，功能口径依 REQ-039 管道；**本条是否立项由定夺④定夺**）｜涉及设计稿：design-iter-16（待基线，「原型即需求」）〕

     - **用户故事**：作为用户，我要能主动压缩某个长会话的上下文并看到执行结果，以便在感觉 AI「变啰嗦/忘事」或切换话题时立即整理上下文，不必等阈值自动触发。
     - **描述**：会话操作面新增「压缩上下文」入口（形态随 design-iter-16 基线，候选：侧栏列表项「···」菜单项——复用 REQ-026 通用下拉菜单组件，零新增交互模式）。点击 → `POST /api/chat/compact`（session_id）→ 服务端同步执行完整管道（一级 snip + 全量 compact，**不受阈值判定约束**）→ 返回执行结果（成功/无需压缩/失败）→ 前端 toast 反馈（文案随 design-iter-16）。手动压缩**不计回合**（定夺⑧推荐：usage_daily turns 零变化，tokens 仅落 telemetry compress 行）。既有交互零回退：入口为菜单加法项，REQ-003/004/005/012/016/026 验收口径全部保留。
     - **主流程**：
       1. 用户在会话列表项「···」菜单（或 design-iter-16 定稿形态）触发「压缩上下文」
       2. 前端 POST /api/chat/compact → 服务端鉴权与会话归属校验（沿复合主键隔离）→ 执行管道（摘要调用同 REQ-039 口径）
       3. 返回结果 → 前端 toast；下一次回合组装即用新摘要
     - **异常分支**：
       - 会话无可压缩中段（总轮数 ≤ R）：返回「无需压缩」语义（零上游调用、零计费），toast 明示
       - 摘要调用失败/超时：按 REQ-007 错误体系提示，会话数据与摘要存量不变（原摘要仍有效则保留）
       - 该会话正在生成回合：拒绝并提示稍后（409 语义，防并发组装竞态，形态随设计）
       - 会话不存在或属他人：404/403（沿复合主键归属隔离）
     - **验收标准（可判定）**：
       1. 手动压缩执行一次 → compact 端点落 compress 行（endpoint='compact'，turn_id=NULL）、context_summary 更新、usage_daily turns 零变化（pytest + test_quota 零改动复跑）
       2. 手动压缩后下一回合请求体含摘要（= REQ-039 验收 2 口径，pytest）
       3. 「无需压缩」分支：轮数 ≤ R 的会话调用 → 零上游调用（假传输层零调用断言）+ 前端提示（vitest）
       4. 归属隔离：他人 session_id → 404；普通用户操作正常、无 admin 门槛（pytest）
       5. design-iter-16 走查清单留档（亮/暗双主题 + 执行中态 + 失败态 + 无需压缩态，v1.4.10 B/v1.4.11 B 断言面）
     **REQ-041 压缩效果度量与可观测**〔批次 B2（iter-16 候选）｜优先级：P1（建议——度量与可视化层，数据面依 REQ-039）｜涉及设计稿：design-iter-16（admin 遥测视图扩展形态，与 REQ-040 同稿承载）〕

     - **用户故事**：作为服务部署者，我要压缩执行次数、压缩前后 token 规模与降幅被机器度量并在 admin 可见，以便 B2 的效果可验证、摘要调用成本如实入账（审核稿 §九「运营者算得清每块钱花在哪」的 B2 面；铁律 5：度量只允许机器采集）。
     - **描述**：迁移 **v9** 两项加法：① telemetry 表增列 `tokens_before` / `tokens_after`（仅 kind='compress' 行取值，存量行 NULL、不回填）；② 新建 `context_summary` 产物表（REQ-039 载体，schema 见内容 3.2，与 v9 同批落库）。每次压缩执行（回合内自动 / 手动）落一条 compress 行（kind='compress'：turn_id 自动回合关联 / 手动 NULL，endpoint='turn'/'compact'，model=摘要模型，latency_ms=摘要调用耗时，status，摘要调用自身 token 消耗记 tokens_prompt 同列口径，tokens_before=触发依据的机器实测值，tokens_after=压缩后首次 step=1 上游调用 usage 机器实测值**懒回填**——未测得记 NULL、聚合显示缺失，不估算）。compress 行不占回合 step 序列（llm 行 step 连续性口径零变化，REQ-037 验收 1 不回退）。admin 遥测聚合（REQ-038 `GET /api/admin/telemetry` 端点）加法扩展：**压缩次数**与**平均降幅**（1 − Σtokens_after/Σtokens_before，任一侧缺失该时段显示缺失标注）；**成本聚合计入 compress 行 tokens**（摘要调用如实入账，统一 key 模式口径同 REQ-038 定夺⑥）。REQ-037/038 既有行形状与口径零回退。
     - **主流程**：压缩执行 → compress 行创建（tokens_after=NULL）→ 该会话下一次 step=1 上游调用返回 usage → 独立短连接懒回填 tokens_after（失败不阻塞、不补造）→ admin 遥测视图按日聚合展示压缩次数/降幅。
     - **异常分支**：tokens_after 始终未测得（会话再无回合）→ 维持 NULL，聚合显示缺失；压缩失败行（status=error/timeout）照常落、不计入降幅聚合（只计次数）；普通用户访问聚合端点 → 403（沿 get_admin_user 门禁，REQ-038 口径零变化）。
     - **验收标准（可判定）**：
       1. compress 行完整性：一次自动压缩回合结束 → telemetry 恰 1 条 compress 行，tokens_before 等于触发依据值、tokens_after 与该会话下一回合 step=1 llm 行 tokens_prompt 一致（pytest）
       2. 配额数据面零回退：test_quota 全套零改动复跑全绿（usage_daily 落账不变）；REQ-037 既有 test_telemetry 全绿（行形状仅加法列）
       3. 聚合一致性：造数已知 compress 行集 → 聚合端点次数/降幅精确值断言；缺失 → 缺失标注（pytest）；成本聚合含 compress 行 tokens（数值断言）
       4. 普通用户访问扩展后的聚合端点 403 且不泄露数据（pytest）
       5. design-iter-16 走查清单 admin 面留档（压缩卡 + 缺失态，亮/暗双主题）
  2. **存量需求改写（对照式：改写前 spec 原文 → 改写后拟文，批准后直接落 spec；正式改写 3 条 + 非功能 3 行 + 波及登记 5 项 + 零波及明示 4 项）**：
     - **REQ-002 多轮上下文记忆（正式改写——「终态演进为多级压缩（B2）」落地）**：
       - 改写前（描述末句）：「回合内工具结果注入当轮上下文、不占 20 轮窗口。20 轮窗口为现状规则照搬，终态演进为多级压缩（B2，见暂缓池）。」
       - 改写后（拟文）：「回合内工具结果注入当轮上下文、不占 20 轮窗口。**B2 起窗口规则演进为「20 轮窗口 + 三级压缩」（CHG-010/REQ-039）**：上一回合机器实测 prompt token 超阈值时，中段历史以摘要替代参与组装（旧工具结果先行裁剪）、最近 R 轮全文保留；**压缩只影响发给上游的内容——库内消息全文零删除，界面展示/导出/搜索口径全部不变**；未超阈值或压缩降级时，20 轮窗口现行口径零回退。」
       - 异常分支改写：「会话消息超出 20 轮：自动截断……被截断轮次仍完整保留在本地与界面中」句末补：「（超阈值且压缩生效的会话，中段不再被丢弃而是以摘要参与组装，REQ-039；未超阈值或压缩降级仍按本条现行口径截断）」。
       - 验收增补：「第 31 轮请求体 ≤ X token 且第 1 轮关键事实仍可答对（= REQ-039 验收 5，双向引用；X 与测量法随 B2 T0 取证定死）」；既有三条验收零回退。
     - **REQ-033 上下文组装迁服务端（正式改写——组装器与压缩管道的关系）**：
       - 改写前（描述末句）：「……回合内的工具调用/结果注入当轮上下文，**不占用** 20 轮窗口。组装器输入输出单点收敛。」
       - 改写后（拟文）：「……回合内的工具调用/结果注入当轮上下文，**不占用** 20 轮窗口。组装器输入输出单点收敛。**B2 起组装输出经三级压缩管道（CHG-010/REQ-039）**：snip（旧工具结果裁剪，确定性）→ 阈值判定（上一回合 telemetry 机器实测值）→ compact 注入（摘要 system 消息，挂载点 = 动态尾区之后、历史之前）；管道降级方向恒为基线 v6 组装形态（20 轮窗口），阈值下口径零回退。」
       - 验收改写：验收 1「组装等价」口径补注：「纯文本会话等价口径不变；含旧工具回合的会话按 REQ-039 验收 1 裁剪占位口径断言（改写映射逐条登记，全局回归基线口径）」；验收 2 补「压缩生效会话的窗口语义按 REQ-039 验收 2/5 口径（双向引用）」。
     - **REQ-036 prompt 静态/动态分割组装（正式改写——预留注入区落地为摘要挂载点）**：
       - 改写前（描述末句）：「动态尾区为 B2 压缩 / C 记忆的预留注入区，本条只固化边界不实现注入。」
       - 改写后（拟文）：「动态尾区为 B2 压缩 / C 记忆的预留注入区；**B2 起压缩摘要作为独立 system 消息注入动态尾区之后、历史之前（CHG-010/REQ-039，挂载点落地；摘要内容在两次压缩之间跨回合恒定）；C 记忆注入继续预留**。」
       - 验收零变化（验收 1/2 静态前缀字节稳定与动态尾区隔离口径不因挂载点落地回退——摘要消息在 system[1] 之后，system[0]/system[1] 内容与位置断言不受影响，补一句指针说明）。
     - **非功能条款 3 行（正式改写）**：
       - 数据行补：「〔CHG-010〕迁移 v9：telemetry 加法增列（tokens_before/tokens_after，compress 行专用）+ 新建 context_summary 压缩产物表（独立于会话档，不写回会话 JSON）；老数据不动、不回填。」
       - 可观测行补：「〔CHG-010〕压缩执行行（kind='compress'：状态/耗时/摘要调用 token 消耗/压缩前后 token 实测值），机器采集（铁律 5）；未测得分项记 NULL、聚合显示缺失不造数；不含 key 与消息内容全文。」
       - 架构行补：「〔CHG-010〕agent 运行时增三级上下文压缩管道（旧工具结果裁剪 → 中段历史摘要 → token 阈值自动 + 手动；摘要调用基建为 C 期记忆体系复用，技术口径见 changes.md CHG-010）。」
     - **波及登记 5 项（简版对照，口径不变、spec 描述随改写同步）**：
       - REQ-015：描述/主流程 4 补「编辑点位于压缩摘要水位处或之前（水位消息被删除）→ 摘要失效重算（CHG-010/REQ-039），自编辑点重建上下文的语义不变」。
       - REQ-030：描述补「回合受理时的组装已经三级压缩管道（CHG-010/REQ-039）；SSE v2 事件流对用户零变化（不新增事件类型）；摘要调用不占回合 step 序列」——run_turn 主循环结构零改动（管道位于组装阶段，run_turn 收到的 messages 为管道产物）。
       - REQ-034：描述补「回合内摘要调用（CHG-010/REQ-039）为内部上游调用：回合计数口径不变（计 1 回合），tokens 如实计入该回合累计；手动压缩调用（REQ-040）不计回合、tokens 仅落 telemetry（定夺⑧定案）」——usage_daily 落账机制零改动。
       - REQ-037：kind 枚举加法扩展 'compress'（REQ-041 承载）；llm/tool 行形状与采集口径零变化，spec 描述补一句指针。
       - REQ-038：遥测视图加法扩展压缩次数/降幅（REQ-041 承载，形态随 design-iter-16）；成本聚合计入 compress 行 tokens；既有卡片/端点口径零回退，spec 描述补一句指针。
     - **零波及明示 4 项（判断结论如实登记，不凑数）**：
       - REQ-006/REQ-022：压缩产物存独立表、不写回会话档 → LWW/409 跨格式守卫/整档透传/schema: 2 标记**零交互**；会话档结构零变化。
       - REQ-013：导出 = 会话消息全文，摘要为组装层实体不是消息 → 导出口径零变化（摘要不进导出，属有意边界）。
       - REQ-016：搜索索引 = 消息文本段，摘要不在消息中 → 搜索口径零变化。
  3. **关键技术机制写实（本 CHG 定死的技术口径；属定夺的参数汇总于内容 4）**：
     - **3.1 三级管道数据流（组装路径，定死）**：
       ```
       回合受理（chat_turn，proxy.py）
        └─ 读会话档 → wire_messages_from_doc（零变化）
            ├─ 一级 snip：早于最近 K=2 条 tool 消息的 tool 结果 → 替换为裁剪占位（wire 层操作，不触库）
            ├─ 阈值判定：读上一回合 step=1 telemetry tokens_prompt（机器实测）
            │    ├─ 未超阈值 / 无记录 → 基线 v6 口径组装（20 轮窗口，零回退）
            │    └─ 超阈值 →
            │         ├─ context_summary 有有效摘要（水位消息仍在当前 messages）→ 摘要注入组装
            │         ├─ 无有效摘要 → 摘要调用（非流式，30s 护栏）→ 产物落表 → 摘要注入组装
            │         └─ 摘要调用任何失败 → 回退基线 v6 组装 + compress 行 status≠ok
            └─ 摘要注入组装 = system[0] 人设（如有）+ system[1] 动态尾区 + 摘要 system 消息 + 最近 R=5 轮（snip 已执行）
       ```
       挂载点说明：摘要置于 system[1] **之后**（遵循 REQ-036「动态尾区为预留注入区」的边界语义）；B2 的缓存收益主面 = 请求体总量变小（token 成本直降），前缀缓存命中收益仍归 B1 分区（摘要在两次压缩间跨回合恒定，不劣化既有前缀）。
     - **3.2 存储语义（定死）**：
       - **被压缩的原文永久保留**于 chat_sessions.data（messages 全文档零删除）——压缩只影响「发给上游的内容」；界面展示/导出/搜索/版本分支全部不受影响（定夺⑥推荐口径定案）。snip 同理：裁剪只发生在 wire 层（组装产物），库内 tool_result 段全文不动。
       - **摘要产物独立表**（定夺⑤推荐口径定案；迁移 v9，与 REQ-041 度量列同批）：
         ```sql
         CREATE TABLE context_summary (
             user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
             session_id TEXT NOT NULL,
             summary TEXT NOT NULL,               -- 摘要文本（注入组装前的原料）
             watermark_msg_id TEXT NOT NULL,      -- 摘要覆盖至的消息 id（失效判定依据）
             model TEXT NOT NULL,                 -- 生成摘要的模型（机器记录）
             created_at TEXT NOT NULL DEFAULT (datetime('now')),
             updated_at TEXT NOT NULL DEFAULT (datetime('now')),
             PRIMARY KEY (user_id, session_id)    -- 每会话至多一份当前摘要（重压缩 = 覆盖更新）
         );
         ALTER TABLE telemetry ADD COLUMN tokens_before INTEGER;  -- compress 行：触发依据实测值
         ALTER TABLE telemetry ADD COLUMN tokens_after INTEGER;   -- compress 行：压缩后首测值懒回填
         ```
         不写回会话档的理由（备选方案否决存档）：会话档顶字段方案依赖前端整档透传保真（虽已取证 persistence init/persist 透传未知字段），但存在**前端陈旧副本 PUT 抹掉摘要**的 LWW 竞态（摘要生成于两次 PUT 之间时），且 409 守卫逻辑需扩展、老客户端行为需回归验证；独立表方案零交互、零抹除风险、注销清理由外键级联承载。代价 = 导出不含摘要（摘要非用户内容，可接受）、跨设备摘要不经会话同步（服务端组装天然全设备一致，无需同步）。
       - **水位与失效**：watermark_msg_id = 摘要覆盖到的最后一条消息 id；编辑重建删除水位消息 → 行删除失效（REQ-015 波及）；版本切换分支中水位 id 不存在 → 视同失效回退不压缩；重压缩 = 同主键覆盖更新。
     - **3.3 摘要调用口径（定死）**：
       - 调用形态：非流式 chat completion（stream=false，响应体直接含 usage，机器读数无歧义），复用共享 httpx 池；独立超时护栏 30s（不占 REQ-030 单步 120s 口径）；注入前对摘要文本做字面分界包裹（`<conversation_summary>…</conversation_summary>`，与 toolsgw.wrap_for_context 同哲学——摘要输入含用户消息与工具结果文本，防指令注入进 system 级消息）。
       - 模型来源：跟随回合当前模式（统一 key → settings.unified_*；自填 → 生效档案三要素），模型名随模式默认（定夺②推荐口径定案：不引入独立摘要模型配置面；摘要 prompt 消耗以 input 计价，DeepSeek chat 单价下成本可控）。
       - 摘要 prompt（文案后端拥有，T0 定稿后逐字断言面登记 verify 文档）：指令要求 ① 保留用户陈述的事实/要求/偏好（尤其会话开头信息）② 保留工具调用结论与来源要点 ③ 压缩至 ≤ 800 字（定夺⑨）。
       - 降级：error / timeout / 空摘要 / 上游 4xx/5xx → 回退不压缩组装，回合正常；warning 日志 + compress 行如实记 status（铁律 5）。
       - 计账：摘要调用 tokens 计入回合 token 累计（on_finish 既有路径，quota.record_tokens 零改动）；compress 行另记该调用自身消耗（度量轨与配额轨分离，同 REQ-037/034 双轨哲学）。
     - **3.4 阈值与参数定案口径（定夺③处理方式定死）**：阈值**沿 B1 T0 取证先例**——B2 T0 以真实 DeepSeek 取证 30 轮混合会话（含搜索工具回合）的 step=1 prompt_tokens 基线 Y，阈值定死为 0.75Y（取整到千位）写入 config（新 settings 字段，.env 可覆盖）；T0 未完成前实施输入用保守占位值 32768。30 轮验收的 X 值同源定死（定夺⑦）。
     - **3.5 与 schema:2/blocks 的关系（定死）**：blocks 模型零变化、**不新增 block 类型**——压缩产物是「组装层实体」（wire 消息与独立表），不是消息；wire_messages_from_doc 归一化口径零变化；存量会话零迁移。
     - **3.6 与 LWW 云同步的关系（定死，随定夺⑤推荐）**：压缩产物**不随会话 PUT 回写**——独立表由服务端在回合路径内写入，前端对压缩零感知零参与；LWW/409 守卫/整档透传/schema 标记全部零交互（内容 2 零波及明示）。
     - **3.7 压缩是否计入配额回合（定死，随定夺⑧推荐）**：回合内摘要调用 = 回合的内部上游调用——回合计数不变（计 1 回合，先查后计点位沿用），tokens 如实计入该回合（REQ-034「回合内 tokens 如实累计」既有口径自然覆盖，quota.py 零改动）；手动压缩 = 非回合调用——不计回合、usage_daily 零写入，tokens 仅落 telemetry compress 行（成本可观测由 REQ-038/041 承载，铁律 5 不漏记）。
  4. **定夺项清单（2026-08-19 全部定夺，CEO 原话「全部按推荐批准」；推荐即定案，理由摘要留档）**：
     | # | 定夺项 | 定夺结论（2026-08-19） |
     |---|---|---|
     | ① | CHG-010 整体批准 | **批准**（含 REQ-039~041 新增与优先级 P0/P1/P1、正式改写 3 条 + 非功能 3 行、波及 5 项 + 零波及明示 4 项；基线 req-baseline-v7） |
     | ② | 摘要模型来源与成本口径 | **跟随回合当前模式、模型名随模式默认，不引入独立配置**（零新增配置面，最小 MVP；DeepSeek chat 单价低、摘要 prompt 消耗可控；自填模式成本归用户自有 key，与 REQ-038 成本口径一致；远期如需统一低成本摘要模型再增 .env 变量入池） |
     | ③ | 自动压缩 token 阈值 | **「T0 取证后定死」处理方式**（沿 B1 缓存字段冒烟取证先例）：T0 实测 30 轮会话 prompt_tokens 基线 Y → 阈值定死 0.75Y；**实施期暂以 32768 占位**（现状无 tokenizer，拍脑袋阈值会失真且违铁律 5 度量精神）。**T0 取证回填（2026-08-19）：Y = 9909/9943（两次独立运行一致），阈值定死 = 7000（0.75Y 取整千位），留档 plans/iter-16-verify.md §2** |
     | ④ | 手动压缩是否做 / 入口形态 | **做；入口 = 侧栏列表项「···」菜单「压缩上下文」项**（design-iter-16 基线定稿形态；审核稿 B2 三级定义原话含「用户手动压缩」；入口复用 REQ-026 通用下拉菜单组件，零新增交互模式） |
     | ⑤ | 压缩产物存储位置 | **服务端独立表 context_summary（迁移 v9，PK (user_id, session_id)，带水位，ON DELETE CASCADE），不写回会话档**（与 LWW/409 守卫/整档透传零交互、无前端陈旧副本抹除风险、老客户端零变化；备选「会话档内顶字段」否决理由见内容 3.2） |
     | ⑥ | 被摘要原文的可恢复性 | **原文永久在库（压缩只影响上游请求体），不另做「恢复原文」UI**（界面恒全量展示原文，「可恢复」天然成立；零数据风险、零 UI 负担） |
     | ⑦ | 30 轮验收的 X 值与测量法 | **X 随 T0 取证定死（与③同源：X = 0.75Y 口径下的请求体上限，**T0 回填：X = 7000**，留档 plans/iter-16-verify.md §3）；测量法 = pytest MockTransport 捕获第 31 次请求体 + 假上游 usage 帧 prompt_tokens 机器读数（不手数 token，铁律 5）+ 关键信息问答断言；另真实 DeepSeek 30 轮冒烟走查留档 T0**（审核稿 B2 验收口径原话「X 与测量法随稿定死」的落实） |
     | ⑧ | 压缩的配额回合口径 | **回合内摘要调用 tokens 计入回合累计（回合计数不变）；手动压缩不计回合、usage_daily 零写入、tokens 仅落 telemetry**（REQ-034「回合内 tokens 如实累计」自然覆盖内部调用、quota.py 零改动；手动压缩非回合行为，计入回合会扭曲「1 回合 = 一次用户发送触发」语义；遥测记录保证成本不漏，铁律 5） |
     | ⑨ | 管道微参数 | **snip 保留最近 K=2 条工具消息结果全文（每次组装无条件执行）；压缩后保留最近 R=5 轮；摘要调用超时 30s；摘要目标长度 ≤ 800 字**（K=2：最近工具结论可直接引用、更早结论已被后续 assistant 文本消化；R=5：近期连贯性与压缩收益平衡点，T0 可 ±2 微调并登记不走变更；30s/800 为保守起点；备选「仅超阈值时 snip」不推荐——确定性规则更易断言且 snip 零成本风险） |
  5. **影响评估**：
     - **存量需求逐条**：见内容 2——正式改写 3 条（REQ-002/033/036，对照式拟文可直接落 spec）+ 非功能 3 行；波及登记 5 项（REQ-015/030/034/037/038）；零波及明示 4 项（REQ-006/022/013/016）。其余需求（REQ-001/003~005/007~012/014/017~029/031/032/035）不受影响。
     - **设计资产承载（v1.4.1 逐项核对，「原型即需求」）**：`design/iter-16` 新增——承载 REQ-040 手动压缩入口（主界面）与 REQ-041 admin 遥测视图压缩卡，B2 T0 产出并基线（含 UI 任务先基线后开发）；若定夺④=不做，design-iter-16 范围收窄为仅 admin 面。`design/proto` 不同步（压缩对 iter-1 核心闭环原型不可见）；其余 design/iter-* 不同步（无对应 REQ 界面口径变化）。
     - **架构变更说明**：后端 agent.py（组装路径内嵌管道）+ 新增压缩模块（摘要调用器/产物读写/水位失效判定，预估 150~200 行新模块）+ db.py 迁移 v9 + telemetry.py compress 行与懒回填 + proxy.py compact 端点（REQ-040）+ admin.py 聚合扩展（REQ-041）+ config.py（阈值/微参数 settings 字段）；前端仅定夺④=做时增菜单项与 toast（client.ts / sessions.ts **数据面零改动**）。quota.py 与 usage_daily 数据面**零改动**。
     - **工作量与排期**：审核稿 B2 定级 **Σ8**；拆解预估 = 管道核心（snip + 摘要调用基建 + 阈值判定 + 降级 + 产物表）L~XL（3~4）+ 手动压缩端点与前端入口 M（2，若定夺④=做）+ telemetry v9 与 admin 聚合扩展 S~M（1~2）+ design-iter-16 基线 S（1）——Σ7~9，容量 Σ≤10 硬约束内、不顶格留余量（近期连续迭代不顶格惯例与 iter-13 顶格代价在案）。排期由 PM 走 `/mm-iteration-plan`（iter-16）；design-iter-16 基线为 REQ-040/041 UI 开发前置；T0 取证项（③阈值 Y 值与⑦ X 值实测、摘要 prompt 真实冒烟、30 轮会话走查）为 T1 实施输入前置。
     - **测试基线**：pytest 239 / vitest 324（iter-15 终态）；沿全局回归基线口径——存量全绿、改写用例登记映射（REQ-033 验收 1「组装等价」含旧工具回合的用例改裁剪口径）、功能性删除为零；度量数据全部机器采集（铁律 5）。
     - **发布影响**：v0.5.0 仍独立卡服务器，不受本变更影响。
  6. **暂缓池联动（批准后随 spec §4 同步的拟文）**：
     - B2 条目：划线移出 + 注记「CHG-010 移出，2026-08-19：落地为 REQ-039~041（批准结论随定夺回填）」。
     - C 条目：补现状注记「**摘要调用基建（摘要调用器 + context_summary 产物存储 + 水位语义）已随 B2 交付（CHG-010/REQ-039），C 期会话摘要层直接复用**」。
     - 其余条目（D1/D2/移动端/天气/供应商对比/体验深化主题包/同步精细合并/用量面板/RAG）零变化。
- 落地核对清单（v1.4.10 制度 A；CEO 批准后逐项落地勾验，首个任务提交内落盘）：
  | # | 承诺项 | 状态 | 落地证据 |
  |---|--------|------|---------|
  | 1 | spec §2 新增 REQ-039/040/041 全文（四要素齐备，按内容 1 拟稿；REQ-040 按定夺④定案处理） | ✅ 已落地（2026-08-19） | spec §2 REQ-039~041 全文（定夺结论随文标注；REQ-040 按定夺④「做，侧栏菜单项」定案文本落） |
  | 2 | REQ-002/033/036 正式改写（内容 2 拟文）+ 波及登记 5 项（REQ-015/030/034/037/038）+ 零波及明示 4 项 | ✅ 已落地（2026-08-19） | spec REQ-002 描述/异常分支/验收、REQ-033 描述/验收 1-2、REQ-036 描述句；REQ-015/030/034/037/038 指针句；零波及明示（REQ-006/022/013/016）登记于本条内容 2 |
  | 3 | 非功能三行同步（数据/可观测/架构，内容 2 拟文） | ✅ 已落地（2026-08-19） | spec §3 数据/可观测/架构三行〔CHG-010〕段 |
  | 4 | spec §4 暂缓池联动（B2 条目移出注记 + C 条目摘要基建复用注记，内容 6 拟文） | ✅ 已落地（2026-08-19） | spec §4：B2 条目划线移出注记；C 条目摘要调用基建复用注记 |
  | 5 | RTM 新增 REQ-039~041 行 + 变更备注行 + 改写行 CHG-010 注记 + 全局回归基线 B2 面说明（v1.4.11 C 行级收口） | ✅ 已落地（2026-08-19） | rtm.md 头段 + REQ-039~041 三行 + 全局回归基线行 B2 面 + REQ-002/033/036 行改写注记与 REQ-015/030/034/037/038 行波及简注 + 变更备注行 |
  | 6 | 定夺项①~⑨结论回填本条（含③⑦的 T0 取证定死值随 B2 T0 报告回填） | ✅ 已落地（2026-08-19；③⑦精确值已随 T0 取证回填：阈值 = X = 7000，verify §2/§3） | 状态行 / 内容 4 定夺表 / CEO 批准字段 |
  | 7 | registry.md 同步（主会话执行） | ✅ 已落地（2026-08-19 同步 2aad00a；2026-08-20 追加 22f2e9f）——NCR-iter16-001 整改回填（2026-08-20） | registry.md ai-chat 行含 CHG-010 批准与基线 v7、iter-16 计划与 T0~T3 交付记录 |
- 需要 CEO 定夺的事项清单（2026-08-19 全部定夺，CEO 原话「全部按推荐批准」；结论见内容 4 定夺表）：
  1. **CHG-010 整体批准**（REQ-039~041 三条新增与优先级建议 P0/P1/P1、正式改写 3 条 + 非功能 3 行、波及 5 项 + 零波及明示 4 项）→ 批准后打基线 req-baseline-v7
  2. 摘要模型来源与成本口径（推荐跟随回合当前模式、不引入独立配置）
  3. 自动压缩 token 阈值（推荐「T0 取证后定死」，实施期 32768 占位）
  4. 手动压缩是否做 / 入口形态（推荐做，侧栏「···」菜单项，随 design-iter-16 基线定稿）
  5. 压缩产物存储位置（推荐服务端独立表 context_summary，不写回会话档）
  6. 被摘要原文的可恢复性（推荐原文永久在库，不另做恢复 UI）
  7. 30 轮验收的 X 值与测量法（推荐随 T0 取证定死 + 假上游 usage 机器读数 + 关键信息问答断言）
  8. 压缩的配额回合口径（推荐回合内摘要调用计回合 token、手动压缩不计回合仅落遥测）
  9. 管道微参数（推荐 K=2 / R=5 / 摘要超时 30s / 摘要 ≤ 800 字）
- CEO 批准：**批准（2026-08-19，CEO 原话「全部按推荐批准」）**——9 项定夺全部按推荐定案：① CHG-010 整体批准（含 REQ-039~041 新增与优先级 P0/P1/P1、正式改写 3 条 + 非功能 3 行、波及 5 项 + 零波及明示 4 项）；② 摘要模型跟随回合当前模式、模型名随模式默认、不引入独立配置；③ 自动压缩阈值「T0 取证后定死」（0.75Y），实施期 32768 占位；④ 手动压缩做、入口 = 侧栏列表项「···」菜单项（design-iter-16 定稿）；⑤ 压缩产物存服务端独立表 context_summary、不写回会话档；⑥ 被摘要原文永久在库、不做恢复 UI；⑦ 30 轮验收 X 值随 T0 定死 + 假上游 usage 机器读数测量法 + 关键信息问答断言；⑧ 回合内摘要调用 tokens 计入回合累计、手动压缩不计回合仅落遥测；⑨ 微参数 K=2 / R=5 / 摘要超时 30s / 摘要 ≤ 800 字。基线 req-baseline-v7；spec/RTM 同日落盘（落地核对清单第 1~6 项勾验），tag 与提交推送由主会话执行。

## CHG-009 架构升级第三期 B1：prompt 静态/动态分割 + 请求级遥测 + admin 遥测面板（含旧透传端点下线评估）

- 日期：2026-08-18
- 类型：修改 + 新增
- 状态：**已批准（2026-08-18，CEO 原话「全部按推荐批准」；基线 req-baseline-v6）**
- 原因/依据：CEO 2026-08-18 口述启动七期路线第三期 **B1**（requirements/changes.md CHG-007 暂缓池「B1：prompt 静态/动态分割 + 请求级遥测与 admin 面板扩展（含旧透传端点下线评估）」条目拉项；审核稿 §六.2「每期排期时走一条 CHG」模式，沿 CHG-007/008 先例）。上游依据：已批准审核稿 `docs/architecture-upgrade-plan-2026-08-17.md`——§三 要素 5「prompt 编排 + 缓存分割：静态前缀（产品人设+工具说明）在前、动态尾区（记忆/日期/用户 systemPrompt）在后，DeepSeek 自动前缀缓存直接受益」与要素 7「可观测体系：请求级结构化日志（延迟/token/缓存命中/工具调用/错误）+ admin 面板（成本估算、命中率、工具用量）；上游字段缺失按铁律 5 显示缺失不造数」；§四 B1 行「Σ7：静态/动态分割口径；请求级结构化日志（迁移新表）；缓存命中采集；admin 面板扩展（REQ-025 口径零回退）；验收口径示例：指标定义先核上游字段可得性、面板数据机器采集」。依赖关系（审核稿 §四）：B1 依赖 A1 服务端组装（REQ-033，iter-13 已交付）与回合计费（REQ-034），并为 B2 多级压缩（摘要效果度量）与暂缓池「A2 体验深化主题包」④⑤ 提供遥测基建。**现状代码取证（2026-08-18 逐项核实，非推测）**：
  - **prompt 组装现状**：`backend/app/agent.py` `assemble_context()`——单条 system 消息 = 用户系统提示词（如有，前置）+ CHG-008 当前时间行；无静态前缀、无产品人设、无分区边界；20 轮窗口 user 锚定截断；工具定义经 OpenAI `tools` 字段下发（不进 system 文本）。现状前缀稳定性：system 内容随时间行每分钟变化、用户提示词随用户而变，**跨请求无保证稳定的共享前缀**——前缀缓存无法受益。
  - **计量粒度现状**：`usage_daily (day,user_id,mode)` 日聚合（requests/turns/tokens 三列，迁移 v4/v6）；token 经 `stream_options.include_usage` 旁路采集、流结束补记；**无请求级明细、无延迟、无缓存命中、无成本、无工具调用维度**；回合内多次上游调用只留累计值。
  - **admin 面板现状**：REQ-025/029 口径——概览四卡（总用户/今日请求/今日 token/统一 key 用量进度）+ 用户与用量双分页列表 + 搜索开关行；REQ-025 描述句「完整结构化遥测与成本观测留 B1」即本 CHG 承接点。
  - **旧透传端点现状**：`POST /api/chat/completions`（`proxy.py`）——iter-7 T1 建、iter-13 定夺⑨零改动保留；逐字节透传、无工具、无服务端组装、无遥测、1 请求 = 1 回合计（配额同源）。
- 内容（对 spec 的拟改，spec 级详细度——沿 CHG-007 呈批详度口径（CEO 2026-08-17 定），批准后按拟文落 spec/RTM。除内容 5 汇总的定夺项外，其余口径本 CHG 定死）：
  1. **新增 REQ 三条（编号自 REQ-036 顺延，spec 级拟稿全文，结构与 spec §2 既有 REQ 一致，批准后原样落 spec §2）**：
     **REQ-036 prompt 静态/动态分割组装**〔批次 B1（iter-15 候选）｜优先级：P0（建议，CEO 批准时确认）｜不涉及设计稿（数据层，用户无感知）〕

     - **用户故事**：作为服务部署者，我要上下文组装把「跨请求恒定的内容」与「每次请求变化的内容」分区并固化边界，以便上游前缀缓存命中降低成本，且 B2 压缩与 C 期记忆注入有明确挂载点。
     - **描述**：在 REQ-033 服务端组装器基础上，system 段由单条消息升级为**两段式分区**（策略一，定夺②推荐、待 CEO 定夺；备选策略对比见内容 4.1）：`system[0]` = **静态前缀**——产品人设（部署配置，跨全部用户全部请求字节恒定）；`system[1]` = **动态尾区**——用户系统提示词（如有，REQ-008）+ 当前时间行（CHG-008 口径不变）。静态前缀配置为空 → 不发空段，请求体回退基线 v5 单 system 形态（回归锚点）。20 轮窗口规则与 user 锚定截断**零变化**（REQ-002/033）；工具定义仍经 OpenAI `tools` 字段下发、不文本化进 system（定夺③推荐）。动态尾区为 B2 压缩 / C 记忆的预留注入区，本条只固化边界不实现注入。
     - **主流程**：
       1. 回合受理 → 组装器读静态前缀配置（推荐 `backend/.env` 变量注入，与统一 key 三变量同法，定夺②附属项）
       2. 静态前缀非空 → 输出 `system[0]`（恒等内容）；动态尾区 = 用户提示词（如有）+ 时间行 → 输出 `system[1]`；静态前缀为空 → 输出单条 system（基线 v5 形态）
       3. 追加最近 20 轮（归一化与截断规则照搬）→ 上游请求体
     - **异常分支**：
       - 静态前缀配置为空/缺失：回退单 system 形态，行为与基线 v5 逐字段一致（验收 5）
       - 自填端点对「多条 system 消息」兼容性：多数 OpenAI 兼容端点支持，T0 以自填档案真实冒烟取证（沿 iter-14 T0 取证模式）；若实测某端点明确拒绝 → 档案级「合并 system 单段」回退开关按 REQ-014「支持工具」开关同哲学另登记（本 CHG 不预设，冒烟未见问题则不做）
       - 用户系统提示词留空：动态尾区仅含时间行（现状口径不变）
     - **验收标准（可判定）**：
       1. 静态前缀字节稳定：不同用户、不同会话、不同时刻的任意两回合，上游请求体 `system[0]` content 逐字节相同（pytest，MockTransport 捕获比对）
       2. 动态尾区完整性与隔离：用户系统提示词与时间行仅出现在 `system[1]`；`system[0]` 检索不到时间字符串与用户提示词（pytest）
       3. 窗口规则零变化：第 30 轮请求体仍仅含最近 20 轮（REQ-002/033 既有验收复跑，服务端 pytest）
       4. 既有「组装等价」类用例按新 system 形态改写并逐条登记映射（旧断言 → 新断言，全局回归基线口径，功能性删除为零）
       5. 空配置回归：静态前缀配置为空 → 请求体 system 部分与基线 v5 形态逐字段等价（pytest）
     **REQ-037 请求级遥测采集**〔批次 B1（iter-15 候选）｜优先级：P0（建议）｜不涉及设计稿（纯后端）〕

     - **用户故事**：作为服务部署者，我要遥测粒度从「按日聚合」细化到「每次上游 LLM 调用一行」（延迟/token 分项/缓存命中/工具调用/错误），以便成本观测、前缀分割与 B2 压缩的效果度量有机器采集的数据底座。
     - **描述**：迁移 **v8** 建 `telemetry` 明细表（schema 拟稿见内容 4.2；审核稿原写「迁移 v6 新表」，v6/v7 已随 iter-13/14 占用，按迁移体系顺延取 v8——版本号出入登记于此）。每次上游 LLM 调用落一行（kind=llm：turn_id/step/model/endpoint/延迟/状态/token 三项分项/缓存命中与未命中），每次工具执行落一行（kind=tool：工具名/状态/耗时，与 REQ-031 网关日志四字段同源并存）。**机器采集，铁律 5**：缓存字段上游不返回记 NULL（聚合展示「缺失」不估算不造数）；token 上游不返回记现状口径（0）；遥测写失败不阻塞回合主路径。表与日志不含 key、消息内容、工具结果全文（沿 REQ-031 卫生口径）。**既有 usage_daily 回合/token 落账零变化**——遥测是并行新轨，不替代配额数据面（REQ-024/025/034 口径零回退）。明细保留策略定夺⑤（推荐 90 天、按自然日惰性清理，清理失败不影响主路径）。旧透传端点若保留期间（定夺④）同样每请求落一行（endpoint=legacy），为下线决策提供流量证据。
     - **主流程**：
       1. 回合内每次上游调用结束（含错误/超时/取消终态）→ 采集延迟/usage 分项/缓存字段 → telemetry 落一行
       2. 工具网关每次执行终态 → 落一行（kind=tool）
       3. 旧透传端点（若保留）流结束 → 落一行（turn_id=NULL，endpoint=legacy）
     - **异常分支**：
       - 上游 usage 缺分项字段（prompt/completion 不返回，仅 total）：分项记 NULL、total 如实记（现状 include_usage 行为沿用）
       - 自填端点不返回缓存字段 / GLM 类端点无缓存概念：缓存列 NULL，admin 聚合显示缺失（铁律 5，验收 2）
       - 断连取消：已发生的调用照常落行（status=cancelled，tokens 计已发生部分——与 REQ-034 定夺⑧同口径）
       - 遥测写入异常（锁/磁盘）：回合正常完成，warning 日志，不补造（铁律 5）
     - **验收标准（可判定）**：
       1. 3 次上游调用的回合 → telemetry 恰 3 条 llm 行，tokens_total 逐行与 usage 帧一致、latency_ms>0、turn_id/step 连续（pytest）
       2. 缓存字段如实性：假上游 usage 含缓存字段 → 逐值落库；不含 → NULL 且后续聚合取数显示缺失（pytest）；**指标定义先核上游字段可得性（审核稿 B1 验收口径）**：真实 DeepSeek 冒烟取证 usage 缓存字段形状（字段名/数值语义）留档 T0 取证段，自填端点字段矩阵同取——冒烟结论为字段映射的实现输入，不得凭文档臆断
       3. 配额数据面零回退：test_quota 全套零改动复跑全绿（usage_daily 落账不变）
       4. 主路径隔离：遥测写入故障注入 → 回合正常完成、turn.end 帧正常（pytest）
       5. 卫生断言：telemetry 表行与相关日志检索不到 key、消息内容、工具结果全文（pytest）
       6. 工具遥测：search / echo 各执行一次 → tool 行含工具名/状态/耗时，与网关日志四字段一致（pytest）
     **REQ-038 admin 遥测面板扩展**〔批次 B1（iter-15 候选）｜优先级：P1（建议——可视化层，功能口径依 REQ-037 数据面）｜涉及设计稿：design-iter-15（待基线，「原型即需求」）〕

     - **用户故事**：作为管理员，我要在管理后台看到每日真实成本估算、缓存命中率、工具调用用量，以便算清每块钱花在哪、并量化 B1 分割与 B2 压缩的效果（审核稿 §九 B1+B2 效果叙事「admin 多一排卡」的 B1 面）。
     - **描述**：基于 REQ-037 telemetry 表新增 admin 遥测聚合端点与 AdminView 遥测视图（形态随 design-iter-15 基线）：**每日成本估算**（tokens × 部署配置单价；单价经 `backend/.env` 注入、admin 只读——口径定夺⑥推荐仅覆盖统一 key 模式（部署者真实支出），自填模式列 token 不计成本并明示「用户自带密钥」）；**缓存命中率**（hit/(hit+miss)，字段缺失时段显示缺失标注不估算）；**工具调用用量**（按工具名/状态聚合——暂缓池主题包⑤「管理员搜索用量面板」由本视图天然承载，search 为当前唯一生产工具）。**REQ-025/029 既有口径零回退**：四卡/双列表/搜索开关/403 门禁全部保留，遥测为加法扩展（沿 iter-12/14 overview 加法扩展先例）。缺失时段显示沿用 REQ-025 既有「不估算补齐」口径。
     - **主流程**：管理员进入后台 → 遥测视图（卡片/列表形态随 design-iter-15）→ 按日查看成本估算/命中率/工具用量 → 缺失时段见缺失标注。
     - **异常分支**：缓存字段全缺失 → 命中率显示缺失标注；单价未配置 → 成本卡不估算并提示未配置（不造数）；普通用户访问遥测端点 → 403（沿 get_admin_user 门禁）。
     - **验收标准（可判定）**：
       1. REQ-025/029 口径零回退：既有六端点形状零变化或仅加法字段、既有 admin pytest 用例零改动复跑全绿（含 403/封禁/调配额/用量抽样比对）
       2. 聚合一致性：造数已知 telemetry 行集 → 聚合端点数值断言（成本 = tokens×单价 精确值；命中率数值；缺失 → 缺失标注，pytest）
       3. 普通用户访问遥测端点 403 且不泄露任何数据（pytest）
       4. design-iter-15 走查清单留档（亮/暗双主题 + 缺失态 + 单价未配置态，v1.4.10 B/v1.4.11 B 断言面）
  2. **存量需求改写（对照式：改写前 spec 原文 → 改写后拟文，批准后直接落 spec；正式改写 3 条 + 非功能 3 行 + 波及 4 项）**：
     - **REQ-033 上下文组装迁服务端（正式改写——组装策略升级）**：
       - 改写前（描述首段要点）：「上下文组装规则**照搬现状**：系统提示词（如有，REQ-008）+ 最近 20 轮（最多 40 条消息）；……CHG-008 增补：系统段恒存在 = 用户系统提示词（如有，前置）+ 当前时间行。」
       - 改写后（拟文）：「上下文组装由服务端 agent 运行时执行（A1 口径沿用），**B1 起 system 段为静态/动态两段式分区**（CHG-009/REQ-036）：静态前缀（产品人设，部署配置，跨请求字节恒定）+ 动态尾区（用户系统提示词如有 + 当前时间行）；静态前缀配置为空时回退单 system 形态（基线 v5 等价）。最近 20 轮窗口与归一化规则不变。分区边界为 B2 压缩 / C 记忆注入预留点。」
       - 验收改写：既有「组装等价」用例改静态前缀空配置的回归等价口径 + 分区断言（REQ-036 验收 1/2/5 双向引用），改写映射逐条登记。
     - **REQ-008 系统提示词设置（正式改写——位置语义随分区调整）**：
       - 改写前（描述句要点）：「系统提示词作为上下文第一条随每次请求发送（……CHG-007 起由服务端组装器置于上下文首位，规则不变）」；验收 3：「会话超过 20 轮时，请求体中系统提示词仍在首位（不被截断）」。
       - 改写后（拟文）：「系统提示词随每次请求发送，置于**动态尾区段首位**（CHG-009 分区后：静态前缀段在其前；用户提示词在动态段内的首位语义不变），参与上下文组装、不受 20 轮截断影响。」验收 3 改：「会话超过 20 轮时，系统提示词仍在动态尾区段首位、不被截断（服务端 pytest 断言）」。
     - **REQ-025 管理员 Web 后台（正式改写——B1 指针句落地）**：
       - 改写前（用量统计句末）：「……支持过滤与排序即可，图表不做；完整结构化遥测与成本观测留 B1」。
       - 改写后（拟文）：「……支持过滤与排序即可，图表不做；**结构化遥测与成本观测由 B1 承载（CHG-009/REQ-038）**：admin 增遥测视图（每日成本估算/缓存命中率/工具用量），既有三类能力口径零回退。」
     - **非功能条款 3 行（正式改写）**：
       - 可观测行补：「〔CHG-009〕请求级结构化遥测——每次上游 LLM 调用与工具执行落明细行（延迟/token 分项/缓存命中/状态/错误码），机器采集；缓存字段上游不返回记 NULL、聚合显示缺失不造数（铁律 5）；不含 key 与内容全文。」
       - 数据行补：「〔CHG-009〕迁移 v8 新增 telemetry 明细表：老数据不动、遥测不回填历史；明细保留策略随定夺⑤（推荐 90 天）。」
       - 架构行：「旧 /api/chat 透传端点零改动保留（design-iter-13 定夺；下线时点 B1 排期评估）」→ **定夺④定案方案 A 下线（2026-08-18），spec 架构行改写为「随 B1 下线、回合端点为唯一对话入口；下线执行随 B1 任务」**（已随基线 v6 落地；评估全文见内容 5）。
     - **波及登记 4 项（简版对照，口径不变、spec 描述随改写同步）**：
       - REQ-002：描述末句「终态演进为多级压缩（B2）」前补「B1 起 system 段静态/动态分区（CHG-009/REQ-036，窗口规则不变）」——规则本体零变化。
       - REQ-030：run_turn 内增遥测采集点，SSE v2 事件流对用户**零变化**（usage 帧口径不变），spec 描述补一句指针。
       - REQ-031：网关日志四字段口径不变；工具执行遥测为并行新轨（REQ-037），spec 描述补一句指针。
       - REQ-034：异常分支「旧透传端点（窗口期老客户端）：1 次请求 = 1 次上游调用，按 1 回合计」——**随定夺④定案（2026-08-18，方案 A 下线）**：spec 分支改「下线执行完成前保留、完成后废止」登记口径，已随基线 v6 落地（见 spec REQ-034）。
  3. **关键技术机制写实（本 CHG 定死的技术口径；属定夺的参数汇总于内容 5）**：
     - **4.1 prompt 分割策略对比（定夺②，推荐策略一；批准后按定案改写 REQ-036 拟稿）**：
       - 现状形态（agent.assemble_context 输出）：
         ```jsonc
         [ {"role":"system","content":"<用户系统提示词>\n\n当前时间：2026-08-18（周二）14:30（北京时间）"},
           ...最近 20 轮（user 锚定） ]
         ```
       - **策略一（推荐）两段式分区**：`system[0]` 静态前缀（产品人设，全用户全请求字节恒定）+ `system[1]` 动态尾区（用户提示词 + 时间行）+ 20 轮不变。收益：共享前缀最大化 → DeepSeek 自动前缀缓存受益；B2/C 注入边界清晰；实现 = assemble_context 单点改造（S~M 级，组装器已单点收敛）。
       - **策略二（不推荐）单段重排**：仅维持单条 system、内部「静态在前动态在后」，不引入产品人设。现状时间行已在尾、前缀 = 用户提示词（随用户而变），收益有限且无 B2/C 挂载边界——不解决审核稿要素 5 的目标。
       - **策略三（不推荐）prompt 模板引擎**：分区注册/版本管理/模板组合（Claude Code 式全量编排）。单人公司容量下过度设计，与「最小 MVP」定调冲突，远期确有需要再立专项。
     - **4.2 telemetry 表 schema 拟稿（迁移 v8）**：
       ```sql
       CREATE TABLE telemetry (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           day TEXT NOT NULL,                 -- 自然日（服务器本地时区，同 usage_daily 口径）
           ts TEXT NOT NULL DEFAULT (datetime('now')),
           user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           mode TEXT NOT NULL,                -- 'unified' | 'self'
           turn_id TEXT,                      -- 回合关联；旧透传端点（若保留期）为 NULL
           endpoint TEXT NOT NULL,            -- 'turn' | 'legacy'
           kind TEXT NOT NULL,                -- 'llm'（上游调用行）| 'tool'（工具执行行）
           step INTEGER,                      -- llm 行：回合内步序
           model TEXT,                        -- llm 行：上游模型名
           latency_ms INTEGER NOT NULL,
           status TEXT NOT NULL,              -- ok | error | timeout | cancelled
           tokens_prompt INTEGER,             -- 上游不返回 → NULL（不造数）
           tokens_completion INTEGER,
           tokens_total INTEGER,
           cache_hit_tokens INTEGER,          -- 上游不返回 → NULL（铁律 5：显示缺失）
           cache_miss_tokens INTEGER,
           tool_name TEXT,                    -- tool 行：工具名
           error_code TEXT                    -- status != ok 时机器可读码（沿 §3.1 映射码体系）
       );
       CREATE INDEX idx_telemetry_day ON telemetry(day, user_id);
       ```
     - **4.3 聚合口径定义（REQ-038 实现输入）**：成本估算 = Σtokens × 单价（单价分 input/output/cache-hit 三项，.env 注入；仅统一 key 模式计成本——定夺⑥推荐口径）；缓存命中率 = Σhit / (Σhit + Σmiss)，任一侧缺失则该时段显示缺失标注；工具用量 = 按 tool_name × status 聚合行数与耗时均值。全部机器聚合，无手工修正入口（铁律 5）。
     - **4.4 迁移编号说明**：审核稿写「迁移 v6 新表」为 2026-08-17 预判，v6（usage_daily.turns + profiles.tools_enabled）与 v7（app_settings）已随 iter-13/14 落地占用；B1 按迁移体系顺延取 **v8**，出入登记于此，无需另走变更。
     - **4.5 定夺参数汇总（2026-08-18 全部定夺，CEO「全部按推荐批准」）**：
       | # | 参数 | 定夺结论（2026-08-18） |
       |---|------|------|
       | ① | CHG-009 整体批准（含 REQ-036~038 与优先级 P0/P0/P1） | **批准** |
       | ② | prompt 分割策略 | **策略一两段式分区**（4.1） |
       | ③ | 工具说明是否文本化进静态前缀 | **不进**——tools 字段现状即结构化工具说明，文本化重复计费 |
       | ④ | 旧透传端点处置 | **方案 A 随 B1 直接下线**（评估见内容 5；执行登记见落地核对清单第 9 项） |
       | ⑤ | 遥测明细保留期 | **90 天**（按自然日惰性清理） |
       | ⑥ | 成本口径与单价配置 | **仅统一 key 模式计成本 + .env 单价三变量**（admin 只读） |
       | ⑦ | 搭班建议（A2 体验深化主题包，见内容 6） | **方案 A：不整包搭班**——④⑤ 由 REQ-037/038 收编，①②③ 留池 |
       | ⑧ | 产品人设文案内容 | **授权 T0 采中性默认稿**，CEO 保留否决权 |
       | — | T0 取证项（非定夺，随 B1 T0 执行） | 真实 DeepSeek usage 缓存字段形状冒烟 + 自填端点多 system 消息兼容性冒烟（沿 iter-14 T0 取证模式），结论留档 verify |
  4. **波及影响分析**：
     - **后端**：agent.py（分区组装 + llm 行采集点）/ tools 执行点（tool 行）/ proxy.py（legacy 行——若保留期）/ db.py 迁移 v8 / admin.py（遥测聚合端点，加法扩展）/ config.py（人设/单价变量）；quota.py 与 usage_daily 数据面**零改动**。
     - **前端**：主对话面零改动（分割与遥测对用户不可见，REQ-001~019 触点零触达）；AdminView 增遥测视图（design-iter-15 承载，含 UI 任务先基线后开发）。
     - **迁移**：v8 新增表、老数据不动、不回填（沿 turns 列口径）；保留期清理为惰性删除，清理失败不阻断。
     - **既有测试**：pytest 224 / vitest 305 基线；「组装等价」类用例改写登记映射（功能性删除为零）；若定夺④=A，test_proxy.py 16 例旧端点用例随端点退役——**属决策驱动的功能性移除例外登记**（非口径迁移删除），退役映射 + 冒烟脚本迁 turn 端点一并记入全局回归基线 B1 面。
     - **设计资产同步逐项核对（v1.4.1）**：`design/proto` 不同步（iter-1 核心闭环原型定位不变，分割/遥测不可见）；`design/iter-15` 新增（REQ-038 遥测视图，T0 产出并基线）；其余 design/iter-* 不同步（本次无对应 REQ 界面口径变化）。
     - **工作量与排期**：审核稿 B1 定级 Σ7；拆解预估 = 分割 M + 遥测 L（取 3~4：新表 + 双端采集 + 故障隔离 + 保留期清理）+ admin 扩展 M + 下线执行 S（若定夺④=A）——Σ7~9，容量 Σ≤10 内、不顶格留余量（iter-13 顶格代价在案）；排期由 PM 走 `/mm-iteration-plan`（iter-15），design-iter-15 基线为 REQ-038 开发前置。
     - **发布影响**：v0.5.0 仍独立卡服务器，不受本变更影响。
  5. **旧透传端点下线评估（定夺④呈报件——本 CHG 只出评估，不执行下线）**：
     - **现状**：`POST /api/chat/completions`（iter-7 T1 建；iter-13 定夺⑨「零改动保留」）：逐字节透传、对对话内容零感知、无工具/无服务端组装/无遥测；配额与回合端点同源同语义（1 请求 = 1 回合计）。
     - **调用方核实（2026-08-18 代码取证）**：① 现前端零调用——`src/api/client.ts` iter-13 起统一走 `/api/chat/turn`，全 src 检索 `completions` 零引用；② 工程侧仅 `backend/tests/test_proxy.py` 16 例 + `scripts/proxy_smoke.py`；③ **公开发布面零负担**——v0.4.0 及以前为纯前端直连上游的静态站点（从未接入本后端），v0.5.0（首个含后端发布）卡服务器未发布，故「窗口期老客户端」实际仅指预览环境历史构建的浏览器缓存，刷新即灭。
     - **下线影响**：用户可见影响为零（无公开调用方）；工程动作 = 端点删除 + 16 例退役登记（全局回归基线例外口径，见内容 4）+ 冒烟脚本迁 turn + REQ-034 异常分支与非功能架构句改写；收益 = 遥测与配额回归单轨、维护面收窄、旧组装路径（前端上传历史）彻底终结。
     - **建议时机与方式**：**方案 A（推荐）随 B1 迭代直接下线**——公开负担为零、B1 遥测本需覆盖双端点，下线后单轨实现更省；**方案 B** 改为返回 410 Gone + 命中日志观察一个迭代再删（若 CEO 对预览环境旧缓存求稳）；**方案 C** 保留至 v0.5.0 公开发布后再评估（双轨遥测成本持续，不推荐）。
  6. **搭班建议（A2 体验深化主题包，定夺⑦呈报件）**：
     - **主题包内容（iter-14 入池，CEO「最小 MVP」定调）**：①引用上标/角标联动 ②搜索质量与时效调优（查询改写/多轮检索/重排，与「搜索供应商对比评估」池项同源）③搜索过程可视化增强 ④搜索成本可观测（Tavily 调用计费遥测）⑤管理员搜索用量面板。依赖结构：④⑤ 以 B1 遥测基建为前置；①②③ 为纯体验层、与 B1 无依赖。
     - **容量核算**：B1 核心 Σ7~9（内容 4），容量上限 Σ≤10 且连续九轮零偏差纪律在案；整包搭班预估另 +Σ5~8（①M②L③M），必然触顶砍范围（planning.md §3），不如不入。
     - **方案 A（推荐）不整包搭班，④⑤ 收编、①②③ 留池**：④ 即 REQ-037 遥测覆盖 search 调用维度 + REQ-038 成本口径含搜索成本（按次×单价，Tavily API 响应不返回计费字段，估算口径与缓存缺失同法明示）；⑤ 即 REQ-038 工具用量视图（search 为当前唯一生产工具，该视图即搜索用量面板）。两项不另立 REQ、不推高 Σ，主题包池条目相应注记收口④⑤；①②③ 留暂缓池，②建议与「搜索供应商对比评估」迭代合并评估。
     - **方案 B** 完全不搭（④⑤ 亦留池 B1 后另评）——遥测数据模型本就含工具维度，不顺手做反而二次开工。
     - **方案 C** 搭 ①（引用上标）小步——不推荐：B1 为后端主线的迭代引入前端体验层 + design-iter-14 修订 + 模型输出格式配合，上下文切换成本与 M2 增量不值。
  7. **暂缓池联动（批准后随 spec §4 同步）**：B1 条目注记「CHG-009 已登记呈批/已批准（随定夺结论）」；主题包条目按定夺⑦注记④⑤收口状态；其余条目（B2/C/D1/D2/移动端/天气/供应商对比）零变化。
- 落地核对清单（v1.4.10 制度 A；CEO 批准后逐项落地勾验，首个任务提交内落盘）：
  | # | 承诺项 | 状态 | 落地证据 |
  |---|--------|------|---------|
  | 1 | spec §2 新增 REQ-036/037/038 全文（四要素齐备，按内容 1 拟稿；REQ-036 按定夺②策略一定案文本落） | ✅ 已落地（2026-08-18，基线 v6） | spec §2 REQ-036~038 全文（定夺结论随文标注） |
  | 2 | REQ-033/008/025 正式改写（内容 2 拟文）+ REQ-002/030/031 波及登记 | ✅ 已落地（2026-08-18） | spec REQ-033 描述/验收 1、REQ-008 描述/验收 3、REQ-025 ③ 句；REQ-002/030/031 指针句 |
  | 3 | 非功能三行同步（可观测/数据/架构；架构行旧端点句按定夺④改写） | ✅ 已落地（2026-08-18） | spec §3 可观测/数据/架构三行 |
  | 4 | REQ-034 异常分支随定夺④结论处理（定案 A 下线） | ✅ 已落地（2026-08-18） | spec REQ-034 分支改「下线执行完成前保留、完成后废止」登记口径 |
  | 5 | spec §4 暂缓池联动（B1 条目 + 主题包④⑤收口注记，随定夺⑦） | ✅ 已落地（2026-08-18） | spec §4：B1 条目划线移出注记；主题包条目④⑤收编注记 |
  | 6 | RTM 新增 REQ-036~038 行 + 变更备注行 + 全局回归基线 B1 面说明 + 改写行 CHG-009 注记（v1.4.11 C 行级收口） | ✅ 已落地（2026-08-18） | rtm.md 头段 + REQ-036~038 三行 + 全局回归基线行 B1 面 + REQ-002/008/025/030/031/033/034 行注记 + 变更备注行 |
  | 7 | 定夺项①~⑧结论回填本条 | ✅ 已落地（2026-08-18） | 状态行 / 4.5 定夺表 / CEO 批准字段 |
  | 8 | registry.md 同步（主会话执行） | ✅ 已落地（2026-08-19，随 NCR-iter15-002/OBS-3 整改勾销） | registry.md 已含 CHG-009 批准 + iter-15 T0~T3 全量交付记录（「5860b99 + tag 已推 GitHub」） |
  | 9 | 定夺④=A 的执行登记：端点删除 + test_proxy 16 例退役映射 + proxy_smoke 迁 turn（随 B1 任务提交勾验） | ✅ 已落地（2026-08-19，随 T2 提交 89fe642 勾验，OBS-3 整改回填） | plans/iter-15-verify.md T2 §5 下线序列取证逐项（legacy 采集上线 → 流量取证 → 端点删除 → 404 回归守卫 → 16 例退役映射 §3.2 逐条 → scripts/turn_smoke.py 迁代） |
- 需要 CEO 定夺的事项清单（2026-08-18 全部定夺，CEO 原话「全部按推荐批准」；结论见 4.5 表）：
  1. **CHG-009 整体批准**（REQ-036~038 三条新增与优先级建议 P0/P0/P1、存量改写 3 条 + 波及 4 项、非功能三行）→ 批准后打基线 req-baseline-v6
  2. prompt 分割策略（推荐策略一两段式分区）
  3. 工具说明是否文本化进静态前缀（推荐不进，tools 字段现状）
  4. 旧透传端点处置（推荐方案 A 随 B1 直接下线；求稳选 B）
  5. 遥测明细保留期（推荐 90 天）
  6. 成本口径（推荐仅统一 key 模式 + .env 单价三变量）
  7. A2 体验深化主题包搭班（推荐方案 A：④⑤收编、①②③留池）
  8. 产品人设文案（推荐授权 T0 采中性默认稿，CEO 保留否决；亦可本呈批直接给定）
- CEO 批准：**批准（2026-08-18，CEO 原话「全部按推荐批准」）**——8 项定夺全部按推荐定案：① CHG-009 整体批准（含 REQ-036~038 新增与优先级 P0/P0/P1、存量改写 3 条 + 波及 4 项、非功能三行）；② prompt 分割采策略一两段式分区；③ 工具说明不文本化进静态前缀（tools 字段现状）；④ 旧透传端点方案 A 随 B1 直接下线；⑤ 遥测明细保留期 90 天；⑥ 成本口径仅统一 key 模式 + .env 单价三变量；⑦ 主题包不整包搭班（④⑤ 由 REQ-037/038 收编，①②③ 留池）；⑧ 产品人设授权 T0 采中性默认稿（CEO 保留否决权）。基线 req-baseline-v6；spec/RTM 同日落盘（落地核对清单第 1~7 项勾验），tag 与提交推送由主会话执行。

## CHG-008 A2 验收走查反馈：上下文时间注入 / 搜索时效参数 / 工具卡折叠规则修订

- 日期：2026-08-18
- 类型：修改（小型，CEO 真机验收走查反馈即时处理）
- **CEO 指示原文（2026-08-18 验收预览环境实测）**：①「查询到过程中，search 不需要展开」②「在渲染的过程中，我如果想要拉动页面进行滚动，目前是不行的，页面会因为滚动持续往下走」③「时间不对，查询出来的内容，貌似都有一周以上的延迟，而且直接问系统现在的时间，他也回答的不准确。这些细节问题都要处理啊，不止是时间问题」
- 内容（三项 + 一项缺陷随附）：
  1. **REQ-033 增补：上下文系统段恒含当前时间行**——组装器输出的 system 段 = 用户系统提示词（如有，前置）+ `当前时间：YYYY-MM-DD（周X）HH:MM（北京时间）`；无用户提示词时系统段仅含时间行。此前无任何时间来源，模型对「今天几号/现在几点」只能瞎猜。
  2. **REQ-035 增补：search 工具入参增可选 `days`（1~30）**——强时效查询由模型自行限定「最近 N 天」，透传 Tavily `topic=news + days`（新闻源 + 时间窗过滤，消除「搜索结果一周以上延迟」）；不传维持综合搜索不限时。网关参数校验同步支持数值边界（minimum/maximum）。工具 description 注明用法，配合时间注入模型可自主判定。
  3. **design-iter-13 §3 R1 / design-iter-14 折叠规则修订：工具步骤卡与引用卡创建即折叠（含运行中）**——头部行徽章已示进度（spinner/状态/耗时），展开看参数与结果由用户决定；R2 终态折叠、R3 历史折叠语义不变（创建即折叠后 R2 自然成立）。components.md v1.4 同步修订。
  4. （缺陷随附，登记 defects.md DEF-034）**流式渲染中无法上翻**：程序滚底的 scroll 回声重置跟随标记 + 距底 120px 阈值内用户抬升即被下一次增量拽回——修复为「程序滚动回声忽略 / 用户滚动距底 >120px 即脱离跟随 / 回底自动恢复 / 脱离时出『回到底部』浮钮」。
- 影响评估：后端 agent.py/search.py/tools.py（校验器数值边界加法）+ 前端 MessageList.vue/ToolStepCard.vue；测试 220→224（pytest：时间行 2 + days 3；既有「组装等价」用例按新系统段口径改写并登记映射）+ 301→305（vitest：R1' 适配 3 + 滚动跟随新增 4，含回声不重置根因用例）；走查脚本条 39① 断言随 R1' 更新；工作量 S×3（吃余量 2 后超出 1，属 CEO 验收反馈当轮修复，计划「实际结果」段回填）；基线 v5 需求集无新增/删除，REQ-033/035 条款增补经本 CHG 登记。
- CEO 批准：批准（2026-08-18 CEO 指示「这些细节问题都要处理啊」——指示即范围与批准；本条为该指示的变更记录落盘）

## CHG-007 agent 架构升级第一期（A1 Agent 地基 + A2 联网搜索）

- 日期：2026-08-17
- 类型：修改 + 新增
- 状态：**已批准（2026-08-17，CEO 口头批复「批准」；基线 req-baseline-v5）**
- 原因/依据：CEO 2026-08-17 方向决策——ai-chat 从「调 API 拿结果再打印」的纯聊天封装升级为 **agent 架构**；依据已批准审核稿《ai-chat 架构升级：Claude Code 借鉴清单与分批建议》（CEO 2026-08-17 批准：七期路线 A1→A2→B1→B2→C→D1→D2、4 条 CHG、移动端让位至 agent UI 稳定后），原文留档 `docs/architecture-upgrade-plan-2026-08-17.md`（含适合性矩阵、分批压测、验收口径、存量冲突清单与 CEO 已拍板的 7 个审核点）。本条为该路线**第一条 CHG，覆盖前两期 A1（Agent 地基）+ A2（联网搜索）**；后续 B/C/D 各期从暂缓池拉项、各走 CHG（审核稿 §六.2：基线是承诺不是路线图，不做一条 CHG 出全路线）。
- 编号说明：按审核稿 §六.2「CHG 编号按批准时间顺序分配，不为移动端锁号」，本条先呈批即取 **CHG-007**；registry.md 中「移动端主界面适配……纳入须走 CHG-007 变更基线」为旧预留措辞，由主会话在本 CHG 批准后修正（本条不改 registry）。
- 内容（对 spec 的拟改，**spec 级详细度**——CEO 2026-08-17 反馈「写得不够详细，像目录」后扩写，CHG 作为批准单元自足可批；批准后按下述拟文落 spec/RTM 正文。除内容 4.8 汇总的「T0 定夺」参数外，其余口径本 CHG 全部定死）：
  1. **§1 产品概述与架构决策改写（对照式拟文，批准后直接落 spec）**：
     - 改写前（§1 第一段末句）：「本产品不做 RAG/知识库与联网搜索（暂缓，见想法池）。」
     - 改写后（拟文）：「产品形态为**多用户自部署的 AI agent 对话服务**：除纯文本对话外，AI 可经服务端工具网关调用工具（首个生产工具为联网搜索，随 A2 交付），并将工具步骤与来源引用呈现给用户；上下文组装、回合编排与配额计量由服务端 agent 运行时承担（CHG-007，2026-08-17 方向升级）。RAG/知识库仍暂缓（见想法池）。」
     - 架构决策段追加（拟文，列于现有后端职责④「用户数据云端存储」之后）：「⑤ **agent 运行时**（CHG-007）：ReAct 循环（最大步数/单步超时/断连取消三护栏）、工具网关（注册/参数校验/出网固定域白名单/超时/结果大小限制/注入防护）、SSE 事件协议 v2（服务端解析重组、独立回合端点，事件表见 changes.md CHG-007 内容 4.1）、上下文组装迁服务端（规则照搬：系统提示词 + 最近 20 轮）、配额按回合计。技术口径全文见 changes.md CHG-007。」
     - 决策历史补记（拟文）：「2026-08-15 CHG-004 决策『联网搜索本轮不做』；2026-08-17 CEO 方向决策升级为 agent 架构，联网搜索作为第一个生产工具纳入（CHG-007），原文存变更历史与 docs/architecture-upgrade-plan-2026-08-17.md。」
  2. **新增第一期 REQ（编号从 REQ-030 顺延，共 6 条；以下为 spec 级拟稿全文，结构与 spec §2 既有 REQ 一致——用户故事/描述/主流程/异常分支/验收标准/优先级/批次/涉及设计稿，批准后原样落 spec §2。验收条款为可判定断言，原验收条款表 13 项全部归位于各 REQ 名下，映射见内容 5）**：
     **REQ-030 工具调用框架与 ReAct 循环（含内置演示工具）**〔批次 A1｜优先级：P0（建议，CEO 批准时确认）｜涉及设计稿：design-iter-13（待基线）〕

     - **用户故事**：作为用户，我要 AI 在需要时调用工具完成纯文本模型做不到的事（查实时信息、执行可验证操作），并让我看到它每一步在做什么，以便信任并核验回答的来源与过程。
     - **描述**：后端新增 agent 运行时，以「回合（turn）」为单位编排一次用户发送触发的完整过程：上下文准备（REQ-033）→ 流式调用上游（携工具定义）→ 解析工具调用意图 → 经工具网关执行（REQ-031）→ 工具结果回填 → 继续调用或终止。三护栏：**最大步数**（一回合内上游调用次数上限，候选 8~12、推荐 10，T0 定死——见 4.8-1）、**单步超时**（上游调用候选 120s、工具执行按各工具声明——见 4.8-2）、**断连取消**（客户端断开 → 取消进行中的上游调用与工具执行，无孤儿任务）。事件经 SSE 协议 v2 下发（事件表与帧格式见内容 4.1）。A1 交付 2 个内置演示工具（定义见内容 4.6）作为无出网的循环验证载体。上游错误映射完全复用 REQ-007/design-iter-7 §3.1 既有 10 场景体系，不新建映射。
     - **主流程**：
       1. 前端将**仅本条用户消息** + 会话 id POST 至回合端点（推荐 `/api/chat/turn`，承载方式 T0 定夺见 4.8-8；历史不上传，见 REQ-033）
       2. 后端校验会话 token → 按回合计检查配额（REQ-034；不足即 429，零上游调用）→ 创建回合（turn_id）并下发 `turn.start`
       3. 服务端自库取会话消息 → 归一化（v1/v2 统一展开）→ 组装上下文（系统提示词 + 最近 20 轮）+ 注册表工具定义 → 首次上游流式调用
       4. 上游文本 delta 逐块转发为 `text.delta`；上游发起工具调用 → 下发 `tool.call` → 工具网关执行（校验链见 REQ-031）→ 下发 `tool.result`（含 ok/error/timeout 状态与耗时）
       5. 工具结果以 tool role 消息回填本轮上下文 → 步数 +1（下发 `turn.step`）→ 未到步数上限且模型仍要求调用工具 → 回到 4；模型给出最终回答或到上限 → 定型
       6. 回合结束：下发 `usage`（回合内 tokens 累计）→ `turn.end`（reason=done/max_steps/aborted/error）；assistant 消息以 blocks 落库（REQ-032），usage 落 usage_daily（REQ-034）
     - **异常分支（逐项，含用户所见）**：
       - 入参异常（空文本/超长）：422 拒绝（沿既有校验风格）；前端本就禁发空输入（REQ-001），双保险
       - 上游报错（401/403/429/5xx/超时）：沿 REQ-007 既有映射——错误气泡（含类型与建议动作）+ 可重试错误提供重试；本回合已生成的文本与工具步骤保留
       - 上游连接中断：沿用既有 `upstream_interrupted` 自定义帧 → 已收内容保留、标注「生成中断」
       - 工具执行报错/超时：`tool.result` 带 error/timeout → 工具步骤卡标「失败/超时」；错误结果回填模型，模型可降级直答（回合继续，不崩）；连续工具失败无独立熔断（由步数上限兜底）
       - 步数到顶：回合终止（turn.end reason=max_steps）→ 回复末尾标注「已到单回合步数上限」（文案随 design-iter-13），已生成内容保留并落库
       - 断连取消：用户关闭页面/断网 → 服务端检测连接断开，取消进行中的上游调用与工具执行；已落库内容保留，未完成回复标注「生成中断」（与 REQ-006 刷新恢复口径衔接）；回合计费口径见 4.8-9
       - 配额拦截：回合开始即 429（REQ-034），不产生任何上游调用
       - 自填档案「支持工具」开关为关（定夺①）：本回合以无工具模式组装（tools 定义不下发），用户无感知差异
       - 演示工具未注册/被开关关闭：模型收到 error 结果，降级直答
     - **验收标准（可判定）**：
       1. 〔原表 1〕2 步工具回合事件序逐帧断言（pytest + MockTransport）：帧序 = turn.start → turn.step(1) → text.delta* → tool.call → tool.result(ok) → turn.step(2) → text.delta* → usage → turn.end(done)，逐帧比对无乱序、无缺帧
       2. 〔原表 2〕步数上限：max_steps=2 配置下发起需 3 步的回合 → 第 2 步后 turn.end(reason=max_steps)，回复含上限标注，进程不悬挂（用例等待有界）
       3. 〔原表 3〕单步超时：工具执行超过其声明超时（假工具 sleep 超限）→ tool.result(status=timeout)、无第二次执行，回合继续并降级直答
       4. 〔原表 4〕断连取消：客户端在工具执行中断开 → 用例断言取消后零新增上游调用、工具协程已终止（取消信号可观测），无孤儿任务
       5. 上游错误/中断映射复用：design-iter-7 §3.1 既有 10 场景映射用例在回合路径下复跑全绿（pytest）
       6. 演示工具端到端：echo 与 demo_weather 各 1 用例——tool.call 到 tool.result(ok) 且最终回答包含工具结果内容（pytest）
     **REQ-031 工具网关安全基线**〔批次 A1（框架）/ A2（出网治理随首个出网工具生效）｜优先级：P0（建议）｜不涉及设计稿（纯后端；admin 侧开关入口见 REQ-035/design-iter-14）〕

     - **用户故事**：作为服务部署者，我要所有工具调用经统一网关完成注册校验与出网管控，以便公开注册的服务不被工具层滥用（SSRF、超大结果、未审计调用）。
     - **描述**：工具以服务端代码**静态注册**（A1 无动态/插件注册机制），每个工具声明：名称、入参 JSON Schema、是否出网、出网固定域白名单、单工具超时、结果大小上限。六项校验的逐项判定口径见内容 4.5。不搬 BashTool 式 shell 检测（审核稿 §五.2：本产品不出 shell 工具；远期若加代码执行工具再立专项）。安全事件（拒绝/截断/超时）写服务端日志，机器采集，不含结果全文与密钥。
     - **主流程**：
       1. 运行时收到模型的 tool_call（name + arguments JSON 字符串）
       2. 网关依序执行：注册检查 → 参数校验（JSON Schema）→（出网工具）目标域名/IP 判定 → 执行（受单工具超时约束）→ 结果大小检查与截断 → 注入防护包裹
       3. 任一环节拒绝 → 直接产出 tool.result(status=error)（含机器可读原因），不执行后续环节；全部通过 → tool.result(status=ok)
     - **异常分支**：六项校验各自拒绝时，回合不崩——error 结果回填模型，模型可降级直答（用户所见同 REQ-030 工具失败分支）；网关自身未捕获异常 → error result + 服务端日志留痕（error 级）。
     - **验收标准（可判定）**：
       1. 〔原表 9-a〕未注册工具名 → error result 且工具体零执行（假传输层断言零调用）
       2. 〔原表 9-b〕出网仅白名单域：目标为内网/环回地址（127.0.0.1 / 10.x / 172.16~31.x / 192.168.x / 169.254.x / ::1）或非白名单域 → 连接不发起（假传输层零连接断言）；A1 演示工具无出网，A2 仅搜索域放行
       3. 〔原表 9-c〕超限截断：假工具返回 1 MiB → tool.result 结果长度 ≤ 上限且带截断标注
       4. 参数校验：入参缺字段/类型错 → error result 含校验原因，不执行
       5. 网关日志：每次调用记录工具名/状态/耗时/是否截断四字段，不含结果全文与密钥（pytest 断言日志结构）
     **REQ-032 消息 blocks 模型与工具步骤 UI**〔批次 A1/A2｜优先级：P0（建议）｜涉及设计稿：design-iter-13（A1：工具步骤 UI）、design-iter-14（A2：引用来源卡）——均待基线，「原型即需求」〕

     - **用户故事**：作为用户，我要在消息流里看到 AI 用了什么工具、正在执行还是已完成、结果是什么（联网搜索还附来源引用），以便理解并核验回答。
     - **描述**：ChatMessage 的 content 由纯 string 升级为分段 blocks（文本 / 工具调用 / 工具结果；类型定义与新旧对照示例见内容 4.2）；服务端与前端共享该模型语义，前端**读时归一化**（v1 string → 单文本段，渲染无差别）；新格式写档在会话 JSON 顶层带 `schema: 2` 标记（写侧守卫载体，见内容 4.3）；存量会话（含 branches）**不迁移**。工具步骤 UI：状态徽章（运行中/完成/失败/超时）、可折叠、结果卡，A2 增引用来源卡——具体形态随 design-iter-13/14 基线（本 CHG 不预定视觉参数，见 4.8-5/6）。
     - **主流程**：
       1. 回合事件流到达前端：text.delta 追加至当前文本段；tool.call 创建工具步骤卡（运行中徽章）；tool.result 更新为终态徽章并挂结果（默认折叠态随设计定夺）
       2. turn.end 后消息以 blocks 定型（status=done），随会话 PUT 落库（顶层带 schema: 2）
       3. 打开历史会话：服务端返回原样 JSON → 前端读时归一化（v1 → 单文本段）→ 渲染，v1/v2 消息同流无差别呈现
     - **异常分支**：
       - 老 string 会话（含 branches、编辑态、版本切换）：读时归一化渲染零回退（验收 1）
       - 工具步骤卡在暗色主题/编辑态/版本切换/导出/搜索下的呈现：暗色与交互态随设计基线走查；导出与搜索口径见 REQ-013/016 改写（内容 3）
       - 老客户端读新格式会话：降级显示（旧渲染器呈现 blocks 异常）——升级窗口期已知表现、非数据丢失（定夺项②附带说明）
     - **验收标准（可判定）**：
       1. 〔原表 7〕老 string 会话（含 branches / 编辑 / 版本切换用例数据）在新前端逐字一致渲染（vitest + 真实 Chrome 走查留档）
       2. 〔原表 1 前端侧〕2 步回合渲染状态机：运行中徽章 → 终态徽章 + 可折叠结果卡，暗色同步（走查留档）
       3. 〔原表 13 前半〕v2 客户端 PUT 的会话 JSON 顶层含 schema: 2（vitest 断言持久化载荷）
       4. 〔原表 11 关联〕A2：回答含引用来源卡（design-iter-14 走查留档）
       5. 既有 MessageBubble/会话相关用例零删除；blocks 适配逐用例登记映射（全局回归基线，内容 5）
     **REQ-033 上下文组装迁服务端**〔批次 A1｜优先级：P0（建议）｜不涉及设计稿（数据层）〕

     - **用户故事**：作为用户，我要多轮上下文规则在服务端统一执行，以便 agent 回合（含工具结果注入）组装正确，且后续演进（压缩、记忆）不依赖我浏览器里的前端版本。
     - **描述**：上下文组装规则**照搬现状**：系统提示词（如有，REQ-008）+ 最近 20 轮（最多 40 条消息）；组装主体由前端迁至服务端 agent 运行时，前端不再组装与上传历史（请求仅含本条消息 + 会话 id）。v1/v2 消息先归一化再计入窗口（一条消息 = 一轮的一半，不因 blocks 拆分改变「轮」的边界）。回合内的工具调用/结果注入当轮上下文，**不占用** 20 轮窗口。组装器输入输出单点收敛，为 B2 压缩预留演进接口。
     - **主流程**：
       1. 前端 POST 本条消息 + session_id（请求体无历史数组）
       2. 服务端取该会话全部消息 → 归一化（v1/v2 统一展开）→ 截取系统提示词 + 最近 20 轮 → 组装 messages
       3. 上游请求体由此产生（等价性验收锚点）；回合内每步在上轮基础上追加 tool 消息后重组
     - **异常分支**：会话消息不足 20 轮 → 全量携带；超 20 轮 → 截断（被截轮次完整保留在库与界面——现状口径不变）；会话不存在或属他人 → 404/403（沿复合主键归属隔离）；会话 corrupted（messages 缺失）→ 沿现有「无法读取」口径，不参与组装。
     - **验收标准（可判定）**：
       1. 〔原表 6〕组装等价：同一会话（同消息集）迁移前后产生的上游请求体逐字段等价（system 首位 + 最近 20 轮；pytest，MockTransport 捕获比对）
       2. 第 30 轮请求体仅含最近 20 轮（REQ-002 验收的服务端化口径，pytest）
       3. 前端不再上传历史：回合端点请求体不含历史消息数组（vitest 断言请求载荷形状）
       4. 工具回合后的窗口边界正确：含工具回合的会话，后续组装窗口与纯文本会话同构（pytest）
     **REQ-034 配额语义改「按回合」**〔批次 A1｜优先级：P0（建议）｜不涉及设计稿〕

     - **用户故事**：作为服务部署者，我要配额按回合计量而 token 成本如实累计，以便用户侧规则简单可解释、服务端成本口径真实、单回合滥用有步数护栏兜底。
     - **描述**：30/500/2000 的语义由「每自然日对话请求数」改为「**每自然日对话回合数**」（一回合 = 一次用户发送触发的完整 agent 过程，含其全部内部上游调用；数值 30/500/2000 与管理员按用户覆盖机制沿用）。回合内每次上游调用的 usage（stream_options.include_usage，现状已旁路采集）逐次累加、回合结束落 usage_daily；步数上限是回合内护栏、不占配额。计算规则全文与数值示例见内容 4.4。usage_daily 落库方式（改 requests 列语义 vs 新增 turns 列）T0 定夺（4.8-7，推荐新增 turns 列、历史数据不回填）。注册限频（每 IP 每日 3）不变。DEF-028 随本条销账（联动 REQ-024/025 改写）。
     - **主流程**：
       1. 回合受理：查当日该用户当前档位配额 → 不足即 429（零上游调用）→ 充足则回合计数 +1（先查后计点位沿用）
       2. 回合内逐次上游调用累计 tokens（usage 帧旁路，现状机制沿用）
       3. turn.end 时 usage_daily 落库：该日该用户该模式回合数 +1、tokens + 本回合累计值
     - **异常分支**：
       - 步数上限截停：已计 1 回合、tokens 计已发生调用的累计值（不因截停清零）
       - 断连取消：计费口径 T0 定夺（4.8-9，推荐「已抵上游则计」——与「配额不足不抵达上游」的公平性边界一致）
       - 回合中途服务重启/崩溃：回合计数已落（先查后计），tokens 计已落部分，缺失不补造（铁律 5，admin 面板缺失时段沿用「不估算」口径）
       - 旧透传端点（窗口期老客户端）：1 次请求 = 1 次上游调用，按 1 回合计（两入口配额同源同语义）
     - **验收标准（可判定）**：
       1. 〔原表 5〕配额设 5 的账号：第 6 回合收到配额提示（429 quota_exhausted 语义），服务端日志证明该回合零上游调用（seen 取证沿用）
       2. 〔原表 10〕一回合 3 次上游调用（MockTransport 编排）：usage_daily 该日该用户回合 +1、tokens = 三次调用 usage 之和（pytest 数值断言，如 1200+1500+900=3600）
       3. max_steps=2 截停的回合：计 1 回合、tokens 计前 2 步已发生值（pytest）
       4. 既有 test_quota 16 用例语义迁移后全绿（限频/边界/档位联动/熔断/次日重置/不抵达上游，数值断言同构改回合）
     **REQ-035 联网搜索工具**〔批次 A2｜优先级：P1（建议——依赖第三方选型与 key 归属，保留排期弹性）｜涉及设计稿：design-iter-14（待基线：引用来源卡、admin 开关入口）〕

     - **用户故事**：作为用户，我要问时效性问题时（今天的热点、最新版本号）AI 自动联网搜索并给出来源引用，以便答案不过时、可核验。
     - **描述**：联网搜索为第一个生产工具：后端接第三方搜索 API（**必须自建**——统一 key 为 DeepSeek 无自带联网；选型对比与推荐倾向见内容 4.7，A2 T0 定夺；推荐 SaaS（Tavily/博查）起步、SearXNG 不做）。搜索 key 服务端注入（推荐 backend/.env，admin 可见开关状态、不可见 key）。接入工具网关全套校验（固定域白名单/超时/结果截断/注入防护，REQ-031）。admin 整体开关：关闭后工具不注册、上游 tools 定义不含 search（模型不知其存在）。引用来源渲染随 design-iter-14。
     - **主流程**：
       1. 模型判定需要搜索 → tool.call(search, {query})
       2. 网关校验链（REQ-031）→ 白名单域调用搜索 API（超时内）
       3. 结果组装：截断至大小上限、整理为「结果摘要 + 来源列表（标题/URL/片段）」文本
       4. tool.result 回填 → 模型综合生成带引用标记的回答 → 前端渲染引用来源卡（design-iter-14）
     - **异常分支（含用户所见）**：
       - 搜索 API 失败/超时：tool.result(error/timeout) → 模型降级直答；回答不崩，用户可见「搜索未成功，以下为模型直接回答」类标注（文案随 design-iter-14）
       - admin 关闭搜索：工具不在注册表 → 模型直答（用户无错误提示，属正常降级）
       - 搜索结果为空：模型据空结果如实回答「未搜到相关内容」，不编造来源
       - 结果超限：网关截断（模型只见截断后内容）
       - 配额/步数护栏：沿 REQ-030/034 通用分支
     - **验收标准（可判定）**：
       1. 〔原表 11〕时效性问题（预置样例）回答含可见工具步骤与引用来源（真实 Chrome 走查留档）
       2. 〔原表 12-a〕搜索 API 失败/超时（假搜索端点）→ 回合降级直答不崩（pytest + 走查）
       3. 〔原表 12-b〕admin 关闭搜索 → 注册表无 search、上游请求 tools 定义不含 search（pytest 断言 payload）
       4. 〔原表 9 实例化〕出网仅搜索 API 域：目标改为内网/他域 → 零连接（pytest）
       5. 搜索结果超限截断实例化用例（假端点返回超大结果 → 截断标注）
  3. **存量冲突逐条改写（对照式：改写前 spec 原文 → 改写后拟文，批准后直接落 spec；6 条正式改写 + DEF-028 销账 + 波及 8 项简版同法）**：
     - **REQ-002 多轮上下文记忆（改写）**：
       - 改写前（描述句）：「每次请求将本会话的历史消息一并发给 API，使 AI 回复与上文连贯。上下文组装规则：**系统提示词（如有，见 REQ-008）+ 最近 20 轮（最多 40 条消息）**；更早轮次仅存本地，不参与请求。」
       - 改写后（拟文）：「上下文组装由**服务端 agent 运行时**执行（CHG-007/REQ-033，前端不再组装与上传历史）：服务端按会话存储的消息取**系统提示词（如有）+ 最近 20 轮（最多 40 条消息）**组装；回合内工具结果注入当轮上下文、不占 20 轮窗口。20 轮窗口为现状规则照搬，终态演进为多级压缩（B2，见暂缓池）。」
       - 验收改写：「第 10/30 轮请求体可观测」两条改服务端 pytest 断言（MockTransport 捕获上游请求体）；「连续对话指代连贯」端到端口径不变。
     - **REQ-001 发送消息并流式接收回复（改写）**：
       - 改写前（主流程 4）：「消息区出现该会话的 AI 回复气泡，内容随流式返回逐步渲染」
       - 改写后（拟文，主流程 4-5 扩写）：「AI 回复以**回合（turn）**为单位流式渲染：文本增量逐步显示（现状打字机效果不变）；模型调用工具时，消息流内出现工具步骤（运行中/完成/失败状态、可折叠、结果卡，REQ-032），工具结果返回后回答继续流式生成；回合结束时回复气泡标记为完成。」
       - 异常分支增补：「工具步骤失败 / 回合被步数上限截停 / 断连取消」三项的用户所见（口径引用 REQ-030 异常分支，不重复展开）；空输入/网络失败/流式中断既有分支零变化。
       - 验收增补：回合事件序断言引用 REQ-030 验收 1；其余既有验收零回退。
     - **REQ-006 会话持久化与恢复（改写）**：
       - 改写前（描述首句）：「会话（含消息、branches 分支）的**唯一持久层为服务端数据库**，读写经 REQ-022 的云存储与同步承载。」
       - 改写后（拟文）：「会话（含消息、branches 分支）的**唯一持久层为服务端数据库**；消息模型升级为 v2 blocks（CHG-007/REQ-032），**新格式写档带会话 JSON 顶层 `schema: 2` 标记，存量 string 会话不迁移、读时归一化**；读写经 REQ-022 的云存储与同步承载（含跨格式写侧守卫）。」
       - 验收增补：老 string 会话（含 branches）在新前端渲染逐字零回退（= REQ-032 验收 1，双向引用）；其余验收零回退。
     - **REQ-022 服务端会话云存储与多设备同步（改写）**：
       - 改写前（冲突策略句）：「多设备并发修改同一会话的冲突策略为**最后写入覆盖（LWW，CEO 已拍板）**：被覆盖端下次加载以后端数据为准，不弹冲突解决 UI。」
       - 改写后（拟文）：「多设备并发修改同一会话的冲突策略为**同代格式内最后写入覆盖（LWW，CEO 已拍板）**：被覆盖端下次加载以后端数据为准，不弹冲突解决 UI。**跨格式写侧守卫（CHG-007 定夺②）**：服务端 PUT 检测『存量已带 `schema: 2` 标记、来件为无标记旧格式（升级窗口期旧客户端陈旧副本）』→ 返回 409 `session_schema_conflict` 拒绝写入、存量逐字不动，防旧客户端覆盖抹掉新格式工具步骤。旧客户端遇 409 不重试（前端暂存队列 4xx 非临时性语义：首次保存静默上抛告警、队列重放按毒丸丢弃——代码取证存档 CHG-007）；新客户端恒带标记、理论不触发，防御性按 REQ-007 错误体系提示并引导刷新页面。」
       - 异常分支表增补一行：「多设备新旧客户端并存（升级窗口期）：旧格式载荷覆盖新格式存量 → 409 拒绝（见守卫）；新格式覆盖旧格式 → 正常保存（升级）；同格式并发 → LWW 照旧。」
       - 验收增补：〔原表 13 后半〕pytest——① v2 存量 + 无标记 v1 载荷 → 409 且 GET 复读存量逐字不变；② 带标记整档透传回写（模拟老客户端 GET v2 后改名回写）→ 200 保存、blocks 与标记保留。
     - **REQ-024 用量配额与滥用防护（改写）**：
       - 改写前（配额定义句）：「……初始默认值已于 iter-8 计划定案（2026-08-16 CEO 拍板：免费档 30 / 自填档 500 / 统一 key 总量 2000，每自然日**对话请求数**；注册限频每 IP 每日 3——CHG-004『后续待定』销账）」
       - 改写后（拟文）：「……初始默认值沿用（免费档 30 / 自填档 500 / 统一 key 总量 2000，注册限频每 IP 每日 3），计量语义改为**每自然日对话回合数**（CHG-007/REQ-034：一回合含其全部内部上游调用，计 1 次；回合内 tokens 如实累计；步数上限为回合内护栏不占配额）。」
       - 验收改写：「将测试账号配额设为 5 次：第 6 **回合**发送收到配额提示、该回合零上游调用」（原「第 6 次发送」改「第 6 回合」）；其余验收（限频/重置/熔断/管理员覆盖）数值同构、语义改回合。
       - **DEF-028 顺带销账**：admin 调配额模态副文案随回合计口径更新（「每日对话回合数」表述替换「高档」类措辞），原「30/500 为部署可配置项写死会失真」的已接受偏差由本改写消解；销账登记于 RTM 变更备注与 plans/defects.md。
     - **REQ-025 管理员 Web 后台（改写）**：
       - 改写前（用量统计句）：「③ 用量统计——最小可行口径：**按用户按日的请求数与 token 数列表**（支持过滤与排序即可，图表不做）。」
       - 改写后（拟文）：「③ 用量统计——**按用户按日的回合数与 token 数列表**（语义随 REQ-034 回合计化，token 为回合内累计如实值；支持过滤与排序即可，图表不做；完整结构化遥测与成本观测留 B1）。A2 增**联网搜索工具整体开关**（admin 可关闭；关闭后工具不注册、用户侧降级直答，见 REQ-035）。」
       - 验收改写：「按用户按日的请求数与 token 数列表」→「按用户按日的**回合数**与 token 数列表，与 usage_daily 抽样比对一致」；REQ-029 六端点与其验收零回退（CHG-006 承诺延续）。
     - **波及登记 8 项（简版对照，口径不变、spec 描述随改写同步）**：
       - REQ-008：「系统提示词作为上下文第一条随每次请求发送」→「……由服务端组装器置于上下文首位（CHG-007，规则不变、位置随服务端组装）」；验收「请求体中系统提示词仍在首位」改服务端 pytest 断言。
       - REQ-011：「AI 回复按 Markdown 渲染」→「AI 回复的**文本段**按 Markdown 渲染（blocks 之 text 段）；代码块复制口径不变；工具结果卡为新载体（其内容不进 Markdown 管线，形态随 design-iter-13）」。
       - REQ-013：「导出文件包含该会话全部消息（区分用户/AI）」→「导出涵盖 v2 blocks 消息：文本段照旧输出、工具调用/结果以简明标记行呈现（如 `> [工具 demo_weather · 完成]`，具体格式随 design-iter-13）；老 string 会话导出不变」。
       - REQ-014（定夺①追加）：「高级设置允许用户自填供应商三要素（base URL / 模型名 / API key）」→「……三要素 + **『支持工具』能力开关（默认开，CHG-007 定夺①）**：开关为关时该档案回合以无工具模式组装（tools 定义不下发）；上游明确报不支持 tools 的错误时经 REQ-007 映射提示并引导关闭该开关；统一 key 恒为开」。
       - REQ-015：「从该条起重新组装上下文（系统提示词 + 最近 20 轮）并流式生成新回复」→「删除该条及其后消息并**发起服务端回合**（上下文由服务端按 REQ-002 新口径组装），流式生成新回复」——编辑重建语义不变。
       - REQ-016：「过滤出『标题或消息正文含关键词』的会话」→「过滤出『标题或消息**文本段**含关键词』的会话（blocks 消息取文本段拼接；工具调用参数与结果不入索引——本 CHG 定案）」；500ms 口径不变。
       - REQ-019：「被替换的旧分支归档保留（Session.branches，按 forkId 索引）」→「……branches 可含 v1/v2 混合消息（读时归一化），切换交互与验收不变」。
       - 非功能条款（可观测 + 架构）：可观测——「后端记录每用户调用计数与上游转发结果日志」补「及回合事件日志（步数/工具名/状态/耗时/是否截断），机器采集、不含密钥与工具结果全文」；架构——非功能表「架构」行补 agent 运行时五要素与回合端点（指针 CHG-007）。
  4. **关键技术机制写实（本 CHG 定死的技术口径；真正属设计阶段的参数汇总于 4.8 标「T0 定夺」）**：
     - **4.1 SSE 事件协议 v2（回合端点）**：
       - 事件类型枚举：
         | 事件 | 负载字段 | 语义 |
         |---|---|---|
         | turn.start | session_id, turn_id | 回合受理成功（配额已过检并计 1 回合），前端建立回合态 |
         | text.delta | text | 文本增量（由上游 delta.content 归并转发） |
         | tool.call | tool_call_id, name, arguments（JSON 字符串原样） | 模型发起一次工具调用，前端开工具步骤卡（运行中） |
         | tool.result | tool_call_id, status（ok/error/timeout）, result（截断后文本）, duration_ms | 工具执行终态，前端更新徽章与结果 |
         | turn.step | step, max_steps | 第 step 次上游调用开始（步数计数） |
         | usage | requests（本回合上游调用次数）, tokens（本回合累计） | 回合用量（tokens 如实累计，REQ-034） |
         | turn.end | reason（done/max_steps/aborted/error） | 回合终止与原因，前端定型消息 |
         | error | code, message | 错误（code 沿用 design-iter-7 §3.1 映射码体系扩展） |
         | upstream_interrupted | （沿用现帧） | 上游连接中断（既有自定义帧先例延续） |
       - 示例帧（每事件一条，`data: ` 前缀 + JSON，SSE 标准）：
         ```
         data: {"type":"turn.start","session_id":"s_ab12","turn_id":"t_01HX"}
         data: {"type":"text.delta","text":"我先查一下"}
         data: {"type":"tool.call","tool_call_id":"c_1","name":"demo_weather","arguments":"{\"city\":\"北京\"}"}
         data: {"type":"tool.result","tool_call_id":"c_1","status":"ok","result":"北京：晴，最高 32°C","duration_ms":412}
         data: {"type":"turn.step","step":2,"max_steps":10}
         data: {"type":"usage","requests":2,"tokens":2100}
         data: {"type":"turn.end","reason":"done"}
         data: {"type":"error","code":"upstream_auth","message":"上游密钥无效"}
         ```
       - 前端处理规则：turn.start 建回合态；text.delta 追加当前文本段；tool.call / tool.result 维护工具步骤卡；turn.end 定型消息（status=done）并触发会话 PUT（带 schema: 2）；error 走 REQ-007 错误气泡体系；**未知 type 静默跳过**（沿用 parseSse 前向兼容原则，为 B/C/D 期新事件留扩展位）。
       - 后端处理规则：解析上游 SSE 逐块（解析重组模块约 100-150 行）→ 归并为 v2 事件下发；上游 usage 帧旁路累计（现旁路机制沿用）；连接断开检测 → 取消传播至上游调用与工具执行。
       - 与旧前端的兼容口径：**旧 /api/chat 透传端点保留**（升级窗口期老客户端零改动可用、无工具能力；1 请求 = 1 回合计，配额同源）；v2 走新回合端点（推荐 `/api/chat/turn`，承载方式 T0 定夺见 4.8-8）；旧端点下线时点 = B1 排期时评估（暂缓池注记）。
     - **4.2 blocks 消息模型**：
       - 类型定义（TypeScript 风格，前后端共享语义；落库为 JSON）：
         ```ts
         type Block =
           | { type: 'text'; text: string }                     // 文本段（Markdown）
           | { type: 'tool_call'; tool_call_id: string; name: string;
               arguments: string /* JSON 字符串，原样保存 */ }
           | { type: 'tool_result'; tool_call_id: string;
               status: 'ok' | 'error' | 'timeout';
               result: string /* 网关截断后的文本 */ }
         // v2 消息：content: Block[]（至少一段）；v1 消息：content: string
         // 读时归一化：v1 ⇒ [{ type: 'text', text: content }]
         ```
       - 新旧对照（同一条消息两种形态）：
         ```json
         // v1（现状）
         {"id":"m3","role":"assistant","content":"今天北京晴，最高 32°C。","status":"done"}
         // v2（CHG-007 起）
         {"id":"m3","role":"assistant","content":[
           {"type":"text","text":"我先查一下天气。"},
           {"type":"tool_call","tool_call_id":"c_1","name":"demo_weather","arguments":"{\"city\":\"北京\"}"},
           {"type":"tool_result","tool_call_id":"c_1","status":"ok","result":"北京：晴，最高 32°C"},
           {"type":"text","text":"今天北京晴，最高 32°C。"}
         ],"status":"done"}
         ```
       - 会话档顶层：新增 `"schema": 2` 标记字段（v1 无此字段视为 v1）；其余字段（id / title / messages / branches / updatedAt 等）结构不变。
     - **4.3 schema: 2 写侧守卫（定夺②定案，改造量 S、纳入 A1 T1、须与 blocks 同批上线）**：
       - 判定流程（PUT /api/sessions/{id}）：① 既有校验照旧（id 一致、messages 为 list）；② **新增**：SELECT 存量行（现 PUT 零读直接 upsert——`backend/app/routers/sessions.py` L45-55——守卫补一次主键读）；③ 判定：`存量.schema == 2 且 来件.schema != 2` → 409 拒绝、存量不动；其余（v2 覆 v2 / v2 覆 v1 / v1 覆 v1 / 新建）→ 照常 upsert（来件原样存储）。
       - 409 响应体示例：`{"detail":{"code":"session_schema_conflict","message":"该会话已升级为新格式，请刷新页面获取最新版本后再编辑"}}`
       - 老客户端行为链路（代码取证存档）：`src/db/persistence.ts` L34-37 仅 status 0 / ≥500 为临时性 → 409 非临时性：首次保存不入暂存队列、上抛后 `stores/sessions.ts` L88-90 仅 console.warn（用户无提示）；队列重放遇 409 按毒丸丢弃继续（L112-138）——**无无限重试**；陈旧写入被静默丢弃（已发布老客户端无法补提示，发布说明引导升级）。透传保真：init() / persist() 展开透传未知顶层字段（L76-90），老客户端 GET v2 后的正常回写带标记、守卫放行，blocks 不丢。
     - **4.4 配额回合计（计算规则与数值示例）**：
       - 规则：① 回合 = 一次用户发送（含编辑后重发、重新生成）触发的完整 agent 过程；② 回合计数在回合受理时 +1（先查后计点位沿用，回合中途不再逐调用计数）；③ tokens = 回合内每次上游调用 usage 逐次累加，turn.end 落 usage_daily（day, user_id, mode）；④ 步数上限为回合内护栏（截停不另计回合）；⑤ 全站 2000 = 统一 key 模式回合数合计熔断（语义同前）；⑥ 旧透传端点 1 请求 = 1 回合。
       - 数值示例：某回合内 3 次上游调用（初始 1 次 + 工具结果后继续 2 次），usage 分别 1200 / 1500 / 900 —— 该日该用户**回合数 +1**（不是 +3），**tokens +3600**；若该回合在第 max_steps 步被截停且仅完成 2 次调用 —— 回合数仍 +1，tokens +2700（已发生部分）；配额 5 的账号发起第 6 回合 —— 入口 429，零上游调用、零 tokens。
     - **4.5 工具网关校验清单（六项逐项判定口径）**：
       | # | 校验项 | 判定口径 |
       |---|---|---|
       | 1 | 注册检查 | name 必须在服务端静态注册表；未注册 → error result，不执行 |
       | 2 | 参数校验 | 按工具入参 JSON Schema 校验（缺字段 / 类型错 → error result 含原因，不执行） |
       | 3 | 出网白名单（SSRF 防护） | 出网工具仅可访问声明的固定域；目标 host 不在白名单，或 DNS 解析为内网/环回地址（10/8、172.16/12、192.168/16、127/8、169.254/16、::1）→ 拒绝且零连接 |
       | 4 | 单工具超时 | 执行超过工具声明超时 → 取消执行、status=timeout，回合继续 |
       | 5 | 结果大小限制 | 输出超上限（候选 32 KiB，4.8-3）→ 截断加标注，截断后恒 ≤ 上限 |
       | 6 | 注入防护 | 结果回填前：控制字符转义 + 字面分界（如 `<tool_result>…</tool_result>`）包裹，模型按数据处理；A2 随真实搜索结果复核 |
     - **4.6 内置演示工具定义（A1 循环验证载体，均无出网）**：
       - `echo`：入参 `{ "text": string（≤ 500 字） }`；出参 = 入参原文回显；用途 = 验证参数校验与调用往返。
       - `demo_weather`：入参 `{ "city": "北京" | "上海" | "广州" | "深圳" | "杭州" }`（枚举）；出参 = 固定假数据文本（如「北京：晴，最高 32°C」），带 200~500ms 模拟延迟；用途 = 验证非平凡结果渲染与工具步骤卡。
       - 两者单工具超时均 2s、结果上限同网关默认；**终端用户可见性 T0 定夺**（4.8-4：候选 仅 admin 可见 / 全员可见 / 仅测试环境注册，推荐仅 admin）。
     - **4.7 A2 搜索选型对比（T0 定夺，附推荐倾向）**：
       | 维度 | Tavily | 博查 Bocha | SearXNG 自建 |
       |---|---|---|---|
       | 能力 | 面向 LLM 的搜索 API，返回结构化摘要+引用，英文/通用质量高 | 国产搜索 API，中文源覆盖好，结构化结果 | 元搜索聚合（Google/Bing/DDG 等），返回链接摘要需自行组装 |
       | 价格模式 | 按量付费（免费额度后按 credit） | 按次付费（千次包） | 无 API 费；服务器与维护成本 |
       | 运维成本 | 零（SaaS） | 零（SaaS） | 高（自部署、上游引擎波动、质量不稳） |
       | 合规风险 | 域名出境调用 | 国产合规友好 | 聚合抓取合规灰区自担 |
       | 适用场景 | 海外/通用质量优先 | 中文用户为主、国内部署 | 完全自控、零边际成本诉求 |
       - 推荐倾向：**SaaS（Tavily 或博查）起步，SearXNG 不做**（运维与质量不稳，与单人公司容量冲突）；key 归属推荐 backend/.env 注入 + admin 开关（admin 不可见 key）。A2 T0 定夺，不阻塞本 CHG。
     - **4.8 T0 定夺参数汇总（本 CHG 不装作已定；「推荐」列仅供参考，定夺随各期 T0）**：
       | # | 参数 | 候选范围 | 推荐 | 定夺时点 |
       |---|---|---|---|---|
       | 1 | 最大步数 | 8 / 10 / 12 | 10 | A1 T0 |
       | 2 | 上游单步超时 | 60 / 120 / 180 s | 120s | A1 T0 |
       | 3 | 工具结果大小上限 | 16 / 32 / 64 KiB | 32 KiB | A1 T0 |
       | 4 | 演示工具终端可见性 | 仅 admin / 全员 / 仅测试环境 | 仅 admin | A1 T0 + design-iter-13 |
       | 5 | 工具步骤卡形态（徽章/折叠默认/结果卡） | 随原型 | — | design-iter-13 基线 |
       | 6 | 引用来源卡形态 | 随原型 | — | design-iter-14 基线 |
       | 7 | usage_daily 回合语义落库 | 改 requests 列语义 / 新增 turns 列 | 新增 turns 列（历史不回填） | A1 T0 |
       | 8 | v2 承载方式 | 独立端点 /api/chat/turn / 同端点头协商 | 独立端点 | A1 T0 |
       | 9 | 断连取消计费口径 | 已抵上游则计 / 零上游不计 | 已抵上游则计 | A1 T0 |
       | 10 | 搜索 API 选型与 key 归属 | Tavily / 博查 / SearXNG | SaaS + .env | A2 T0 |
       | 11 | 旧透传端点下线时点 | B1 后评估 | — | B1 排期时 |
  5. **验收条款归位映射（原验收条款表 13 项全部归位 REQ 名下，防两处维护；RTM 按此跟踪）**：
     | 原条款 | 归位 |
     |---|---|
     | 1 事件序逐帧断言 | REQ-030 验收 1（前端侧 = REQ-032 验收 2） |
     | 2 步数上限 | REQ-030 验收 2 |
     | 3 单步超时 | REQ-030 验收 3 |
     | 4 断连取消 | REQ-030 验收 4 |
     | 5 配额第 6 回合拦截 | REQ-034 验收 1 |
     | 6 组装等价 | REQ-033 验收 1 |
     | 7 老 string 零回退 | REQ-032 验收 1（双向引用 REQ-006） |
     | 8 既有回归 | 全局回归基线（见下） |
     | 9 网关安全 | REQ-031 验收 1-3（搜索实例化 = REQ-035 验收 4-5） |
     | 10 回合计与 token 口径 | REQ-034 验收 2 |
     | 11 搜索交付 | REQ-035 验收 1（渲染 = REQ-032 验收 4） |
     | 12 搜索降级 | REQ-035 验收 2-3 |
     | 13 LWW 守卫 | 标记写入 = REQ-032 验收 3；守卫 409 = REQ-022 验收增补 |
     - **全局回归基线（原条款 8，作为 iter-13/14 验收统一门槛、RTM 独立行跟踪）**：前端 254 用例 + 后端 139 用例全绿；因口径迁移（REQ-002 请求体观测服务端化、REQ-024 回合语义、blocks 适配等）而改写的用例逐条登记映射（旧断言 → 新断言），功能性删除为零；度量数据全部机器采集（铁律 5）。
  6. **暂缓池登记后续路线（候选非承诺，纳入各走 CHG）**：B1 prompt 静态/动态分割 + 请求级遥测与 admin 面板扩展（含旧透传端点下线评估）；B2 三级上下文压缩（REQ-002 终态）；C 五层记忆体系（记忆表迁移 + 会话后异步抽取 + 记忆管理 UI）；D1 deep-research 子代理（长回合连接保持「心跳 vs 轮询」T0 必须定夺）；D2 hooks（先进程内旁路回调，后 HTTP webhook）。**移动端主界面适配**：让位至 agent UI 形态稳定后（约 B1 后，可与 D2 搭班）。**A2 补充候选（CEO 2026-08-17 确认，补记于本段）**：真实天气工具（和风天气类专用 API，REQ-031 六项校验接入；demo_weather 保持仅 admin 自检用）——A2 通用搜索（REQ-035）为主路径、专用天气 API 为推荐补充，iter-14 计划评估时权衡取舍，候选非承诺（spec §4 暂缓池同日登记）。
  7. **两个定夺项（均 CEO 已定夺 2026-08-17：① 方案 A 档案级能力开关；② 方案一版本标记 + 写侧守卫——机制详文见内容 4.3，决策与三方案存档如下）**：
     - ① **自填端点 tools 降级策略**（任意 OpenAI 兼容端点 ≠ 必支持 tools）——**CEO 已定夺（2026-08-17）：方案 A 档案级能力开关**。定案口径：自填档案（REQ-014/018）增「支持工具」能力开关字段，默认开；上游明确报不支持 tools 时经 REQ-007 错误映射提示并引导用户在档案中关闭；统一 key（DeepSeek）由服务端配置，恒为开；**不做**自动去 tools 重发（错误形态判定不可靠、每次探测多耗一次计费调用、与回合计配额语义交叠——否决理由存档）。联动：波及登记（内容 3）追加 REQ-014 一项（档案能力开关字段 + REQ-007 映射扩展），落地核对清单第 9 项勾验范围相应 +1，均随批准后 spec 改写落地。
     - ② **多设备新旧客户端 LWW 覆盖边界**（升级窗口期旧客户端保存可能抹掉新格式工具步骤）——**CEO 已定夺（2026-08-17）：方案一「载荷版本标记 + 写侧守卫」**（此前分析师「接受为已知边界」建议经 CEO 驳回、要求补偿机制后重新提案）；三方案对比与代码取证存档如下：
       - **已核实链路（本 CHG 登记时代码取证，方案评估的事实基础）**：`src/db/persistence.ts` L34-37 `isTransient`——仅 status 0（网络层）或 ≥500 视为临时性，**4xx 一律非临时性**；L79-91 saveSession 非临时性失败**不入暂存队列、直接上抛**，`src/stores/sessions.ts` L88-90 persist() 兜底仅 `console.warn`（用户无提示）；L112-138 flushPending 重放遇非临时性失败按「毒丸」**丢弃该条继续**——即**服务端以 409 拒绝旧载荷不会导致老客户端无限重试**（首次保存静默告警、队列重放毒丸丢弃），代价是该次陈旧写入被静默丢弃（已发布老客户端无法补提示，只能靠发布说明引导升级）。另：init()/persist() 均展开透传未知顶层字段（sessions.ts L76-90），老客户端 GET 新格式会话后的正常回写，版本标记与 blocks 随整档保留。
       - **方案一（CEO 已定夺采纳）：载荷版本标记 + 写侧守卫（409 拒绝旧覆新）**。机制：新前端写档在会话 JSON 顶层加版本标记（如 `schema: 2`，无标记视为 v1）；服务端 PUT 增守卫（现 PUT 零读直接 upsert，`backend/app/routers/sessions.py` L45-55）——存量为 v2 且传入载荷为 v1 → 409 `session_schema_conflict` 拒绝、存量不动；其余（v2 覆 v2 / v2 覆 v1 / v1 覆 v1 / 新建）照常 LWW upsert。对 LWW/透传影响：最小——整档 JSON 透传与 upsert 结构不变，仅增一次主键 SELECT；LWW 收窄为「同代格式内最后写入覆盖」，仅阻断「旧格式覆盖新格式」；老客户端透传回写因标记随档保留正常放行，数据不丢。改造量：**S**（后端守卫分支 + pytest 若干；前端写标记属 REQ-032 既有工作）——**不推高 Σ10**：纳入 A1 T1 并置换一项备回退项，Σ 维持 10；守卫必须与 blocks 上线同批，滞后即裸奔。老客户端行为：见已核实链路，无无限重试风险；被拒的是陈旧副本写入，服务端新格式数据保全（严格优于现状「静默覆盖丢最新数据」）。附带说明：老客户端**读**新格式会话为降级显示（旧渲染器呈现 blocks 异常），属窗口期表现、非数据丢失；如需彻底，GET 兼容序列化（v2 → string 降级输出）可作 A2/B1 可选项另行登记，非本定夺必选。
       - **方案二（未采纳）：守卫改保守合并（消息级并集）**。机制：检测条件同方案一但不拒绝——服务端接受 PUT，消息数组按 id 并集（存量含 blocks 的消息逐条保留、传入独有的消息追加），标量字段（标题等）取传入值；老客户端改名与新增消息均生效、工具步骤不丢，用户完全无感。对 LWW 影响：实质把跨版本路径从会话级 LWW 改为**消息级合并**——REQ-022 LWW 定义需改写，动摇 CHG-004「LWW 不弹冲突 UI」定案，并与暂缓池「同步冲突精细合并（vector clock）」边界重叠。已知正确性缺陷：整档模型下「删除消息」与「未携带消息」不可区分（无墓碑机制），按 id 并集会**复活老客户端已删除的消息**；闭合需引入消息版本号/墓碑，成本进一步上探。改造量：M~L（合并逻辑 + 边界用例 + 墓碑设计）——**推高 A1 至 Σ11~13，违反 Σ≤10 硬约束**，须砍 A1 其他范围或另立一期。老客户端行为：无感（PUT 200），无重试问题。结论：**未采纳**（CEO 2026-08-17 定夺方案一）——无墓碑致「删除复活」正确性缺陷、动摇 LWW 定案、推高 A1 违反 Σ≤10 硬约束。
       - **方案三（未采纳）：服务端 schema 校验 + 结构化存储**。机制：消息出 JSON 列、入结构化表（消息/blocks 表），PUT 逐消息强类型校验、非法拒绝，存储层「懂内容」。对 LWW/透传影响：**推翻整档透传存储设计**——REQ-022 现实现（PUT 整档 upsert、GET 逐字恢复验收）全部重做，GET 还需为老客户端另拼整档 JSON 兼容层。改造量：L——**必然推高 A1（+3 以上）或独立成期**。结论：**未采纳**（CEO 2026-08-17 定夺方案一）——推翻整档透传存储设计且 L 级推高容量；其「存储懂内容」的收益属 B1+ 遥测/压缩演进方向，届时随该期 CHG 再议（可在暂缓池注记）。
       - **联动落点（已随本定夺写进 CHG 对应位置，批准后随 spec 改写生效）**：守卫验收归位 REQ-032 验收 3 与 REQ-022 验收增补（内容 5 映射表第 13 行）；内容 3 REQ-006/022 对照式改写（schema: 2 标记 + PUT 守卫 + 取证结论）；内容 2 REQ-032 与内容 4.3 机制详文；落地核对清单第 4/6 项同步。
- 影响评估：
  - **存量需求逐条**：见内容 3——正式改写 6 条（REQ-001/002/006/022/024/025，对照式拟文可直接落 spec）+ DEF-028 销账；波及登记 8 项（REQ-008/011/013/014/015/016/019 + 非功能可观测/架构条款；REQ-014 为定夺①追加）；其余需求（REQ-003/004/005/009/010/012/017/018/020/021/023/026~029）不受影响。
  - **设计资产承载（原型即需求）**：涉及 UI 部分由设计师随迭代 T0 产出可交互原型并基线，作为 spec 附件——design-iter-13（A1 T0：blocks 模型展示层、工具步骤 UI、SSE 协议 v2 前端契约、组装迁服务端边界）与 design-iter-14（A2：引用来源渲染、admin 搜索开关入口）；spec「涉及页面」字段随各自基线回填（吸取 NCR-iter12-001 指针滞后教训，列入落地核对清单第 4/8 项勾验范围）。
  - **架构变更说明**：后端从零建 agent 运行时（消息级模型+归一化、工具网关、ReAct 循环、SSE 解析重组约 100-150 行新模块、配额回合化）；前端为协议与渲染升级（client.ts / sessions.ts / MessageBubble.vue）；改造面集中、测试底子好（MockTransport 假上游夹具现成），无架构级阻断（审核稿 §二结论）。SQLite 经 `PRAGMA user_version` 新增迁移，老数据不动、读时归一化（方案 T0 定）。
  - **工作量与排期**：A1 Σ10 = M+L+L（顶格，备回退项）、A2 Σ6~8（审核稿 §四）；共两迭代（iter-13 = A1、iter-14 = A2 候选），排期由 PM 走 `/mm-iteration-plan`，容量 Σ≤10 硬约束。搜索选型与 key 归属为 A2 T0 定夺项，不阻塞本 CHG。
  - **registry 同步**：由主会话在本 CHG 批准后执行（新方向与七期路线进暂缓池登记 + 「CHG-007 预留=移动端」旧措辞修正），见落地核对清单第 12 项。
  - **发布影响**：v0.5.0 仍独立卡服务器，不受本变更影响（审核稿 §八.4）；升级窗口期补偿机制（写侧守卫 + 旧透传端点保留）见定夺项②与内容 4.1/4.3。
- 落地核对清单（v1.4.10 制度；2026-08-17 批准后逐项落地勾验）：
  | # | 承诺项 | 状态 | 落地证据 |
  |---|--------|------|---------|
  | 1 | 审核稿留档 `docs/architecture-upgrade-plan-2026-08-17.md` | ✅ 已留档（2026-08-17 随本 CHG 登记） | 文件在库，内容与批准稿一致（顶部留档注记标明出处与批准状态） |
  | 2 | spec §1「不做联网搜索/RAG（暂缓）」句推翻 + 决策历史保留 | ✅ 已落地（2026-08-17） | spec §1 末句改 agent 形态表述 + RAG 仍暂缓；决策历史补记 CHG-004→CHG-007 沿革与留档指针 |
  | 3 | spec §1 架构决策补 agent 运行时要素 + 审核稿指针 | ✅ 已落地（2026-08-17） | 架构决策段职责⑤ agent 运行时（五要素 + 指针 CHG-007）；非功能「架构」行同步 |
  | 4 | REQ-030~035 六条 spec 级拟稿落 spec §2（四要素齐备；原验收条款 13 项按内容 5 映射归位；全局回归基线入 RTM 独立行） | ✅ 已落地（2026-08-17） | spec §2 REQ-030~035 全文（〔原表 N〕归位标注）+ 全局回归基线小节；RTM 七个新行 |
  | 5 | REQ-002 改写（组装迁服务端，20 轮照搬，B2 终态注记） | ✅ 已落地（2026-08-17） | spec REQ-002 描述/主流程 2/验收 2-3 改服务端口径；B2 终态句；暂缓池 B2 条目 |
  | 6 | REQ-001/006/022 改写（blocks 模型 + 老会话兼容迁移验收 + schema: 2 标记与 PUT 守卫 409 条款，定夺项②定案） | ✅ 已落地（2026-08-17） | REQ-001 主流程 4-5/异常分支 +3/验收引用；REQ-006 描述句 + 验收增补；REQ-022 LWW 收窄句 + 异常分支行 + 守卫双验收 |
  | 7 | REQ-024 改写（回合计语义）+ DEF-028 销账登记 | ✅ 已落地（2026-08-17） | REQ-024 描述改回合计 + 验收第 6 回合；RTM 变更备注行登记销账；plans/defects.md 实物核销随 iter-13 计划任务携带（QA 复核点） |
  | 8 | REQ-025 改写（回合计统计口径联动 + 搜索 admin 开关） | ✅ 已落地（2026-08-17） | REQ-025 ③ 改回合数列表 + A2 搜索开关句；验收 4 改回合数口径 |
  | 9 | 波及 8 项登记（REQ-008/011/013/014/015/016/019 + 非功能可观测/架构条款；REQ-014 为定夺①追加） | ✅ 已落地（2026-08-17） | 逐条落 spec：REQ-008 描述+验收、REQ-011 描述、REQ-013 验收、REQ-014 描述+异常分支（能力开关）、REQ-015 描述+主流程 4、REQ-016 描述、REQ-019 描述、非功能架构/可观测两行 |
  | 10 | 暂缓池更新（移出「联网搜索/工具调用」；登记 B1/B2/C/D1/D2 + 移动端候选） | ✅ 已落地（2026-08-17） | spec §4：联网搜索划线移出注记；B1/B2/C/D1/D2 五条新增；移动端条目补让位定序；LWW 条目同步守卫注记 |
  | 11 | RTM 同步（REQ-030~035 新行 + 变更备注行 + 基线 v5 tag） | ✅ 已落地（2026-08-17；tag 由主会话统一处理） | RTM：头段 v5 登记 + REQ-030~035 与全局回归基线 7 新行 + 改写 6 行状态注记 + 变更备注 2 行（CHG-007 + REQ-021 卫生修正） |
  | 12 | registry.md 同步（主会话：新方向登记 + CHG-007 旧预留措辞修正） | 已落地（2026-08-18：registry ai-chat 行推进至 iter-14 T0~T3 全交付 + QA 审计有条件通过 3 NCR 已整改；七期路线 A1/A2 已登记） | registry.md |
  | 13 | 定夺项结论回填本条（① 方案 A 档案级能力开关；② 方案一版本标记 + 写侧守卫） | ✅ 已完成（2026-08-17，CEO 两项均已定夺回填） | 定夺项①②；三方案对比与代码取证存档在案，方案二/三未采纳理由留档 |
- CEO 批准：批准（2026-08-17，CEO 口头批复「批准」——含六条 REQ 与优先级 P0×5 / P1×1、§1 改写、存量改写 6 条、波及 8 项、暂缓池路线登记、验收归位与技术机制写实；两定夺项于批准前已定夺回填。同日先按「写得不够详细，感觉像是一个目录」反馈扩写至 spec 级详细度后重读批准。基线 req-baseline-v5，spec/RTM 已同步落盘）。

## CHG-006 上线前体验对齐——主界面与管理后台 UX 全面重构（参考 DeepSeek）

- 日期：2026-08-16
- 类型：新增
- 状态：**已批准（2026-08-16，基线 req-baseline-v4）**
- 内容：CEO 判断当前产品仅 demo 水准、未达上线要求，授权全面审计后新增四条需求（参考 DeepSeek 交互模式）：
  1. **REQ-026 主界面框架与侧栏重构（P0）**：会话列表项单行化（hover「···」下拉菜单承载重命名/删除）；列表按「今天/昨天/近 7 天/更早」分组、组内去掉逐条时间戳；底部账户区精简为用户名 +「···」菜单（设置/管理后台/登出），移除常驻设置按钮、密钥模式标签、盾牌、登出 icon；侧栏可收起为窄条且状态持久化；沉淀通用下拉菜单组件（外点关闭/Esc/键盘可达）。
  2. **REQ-027 消息流与顶栏视觉对齐（P0）**：去掉全部消息头像（AI logo +「我」）；用户消息气泡由主色实底改浅色轻量形态（具体随 design-iter-11 基线，暗色同步）；顶栏精简——「导出」收纳入菜单（REQ-013 口径不变）、「模型：xxx」副标题移除或改为不误导呈现（统一 key 模式下禁止显示「未设置」类文案）、主题切换按钮去留由设计师提案 CEO 基线时定夺。
  3. **REQ-028 设置弹窗化（P1）**：设置由整页视图改模态弹窗，五区块（外观/密钥模式/高级设置/对话设置/账号）功能口径零变化；错误气泡「前往高级设置」定位逻辑（locateAdvanced）随之适配。
  4. **REQ-029 管理后台体验重构（P1，排 iter-12）**：概览统计卡（总用户/今日请求/今日 token/统一 key 用量）+ 用户搜索 + 前后端分页 + 视觉重构；REQ-025 功能口径零回退。
- 原因：CEO 试用反馈点名 7 项不合理（列表 icon 竖排应改「···」菜单、逐条时间应改今天/昨天分组、footer 冗余应精简、无侧栏收起、消息头像应去掉、设置应弹窗化、管理后台堆砌无体验），并授权「找出来项目里面非常不合理的部分」。全面审计（代码取证）在 CEO 7 项之外补充确认 7 项：① 顶栏「模型：未设置」误导（统一 key 模式零配置可用但显示未设置）；② 顶栏常驻「导出」低频操作；③ 用户消息主色实底蓝气泡视觉过重（DeepSeek 为浅灰底）；④ 管理后台用户/用量列表全量拉取无分页（功能缺陷级）；⑤ 管理后台无用户搜索、无概览统计卡；⑥ 主界面无移动端适配（非功能需求现状仅登录页承诺 480px）；⑦ 缺通用下拉菜单组件（本次改造 ≥3 处需要）。
- 影响评估：
  - **存量需求逐条**：REQ-003/004/005/012/016（会话列表触点载体变化——单行化/菜单化/时间分组，验收口径不变，spec 触点描述随 design-iter-11 同步）；REQ-013（导出入口迁移，功能口径不变）；REQ-007（「前往设置页」措辞随弹窗化为「打开设置弹窗」，错误映射本身不变）；REQ-017（顶栏主题按钮若随 design-iter-11 定夺移除，验收条款改由「设置内外观选项」承载，随基线同步改写）；REQ-021（账号区块迁入弹窗，DeleteAccountModal 触达路径变化，口径不变）；REQ-025（由 REQ-029 增强体验，六端点功能与验收零回退）。
  - **设计资产需同步**：design-iter-11 承载 REQ-026~028（侧栏/消息流/设置弹窗/顶栏 + 通用下拉菜单交互规格），iter-11 T0 产出并基线；design-iter-12 承载 REQ-029，随 iter-12 启动。design/proto 维持历史资产不动（proto 定位 iter-1 核心闭环原型，避免 CHG-001 两处维护教训）。
  - **暂缓池更新**：新增「移动端主界面适配」（iter-12 候选，纳入须走变更；非功能需求现状仅登录/注册页承诺 480px 不变）。
  - **工作量**：REQ-026~028 排 iter-11（Σ10 = M+L+M+M，达容量上限）；REQ-029 排 iter-12（含后端分页 API，塞入 iter-11 将超容量 40%，按 planning.md 砍范围保节奏）。
  - **落地核对清单（v1.4.10 制度 A 条首次应用，2026-08-17 补建并全项复核）**：
    | # | 承诺项 | 状态 | 落地证据 |
    |---|--------|------|---------|
    | 1 | REQ-003/004/005/012/016 spec 触点描述随 design-iter-11 同步 | ✅ | iter-11 NCR-003 整改（dfa093c，10 处）；iter-12 QA 复核在案 |
    | 2 | REQ-013 导出入口迁移措辞 | ✅ | 同上 |
    | 3 | REQ-007「前往设置页」→「打开设置弹窗」 | ✅ | 同上 |
    | 4 | REQ-017 顶栏按钮条款随 design-iter-11 定夺①改写 | ✅ | 随基线同步（2026-08-16） |
    | 5 | REQ-021 账号区块迁弹窗触达路径 | ✅ | iter-11 T3（RTM 行） |
    | 6 | REQ-025 六端点功能与验收零回退 | ✅ | iter-12 §5 映射 + pytest 19 用例零改动 + 三端点逐字节 diff（qa-audit 补证 1/2） |
    | 7 | REQ-029 spec「涉及页面」随 design-iter-12 基线更新 | ✅ | **iter-12 NCR-001 整改补落（2026-08-17，a1e63f9）——滞后 4 天，同型第 3 次复发，根因与本清单机制来源** |
    | 8 | design-iter-11 基线承载 REQ-026~028 | ✅ | 2026-08-16 基线，tag 推远端 |
    | 9 | design-iter-12 基线承载 REQ-029 | ✅ | 2026-08-17 基线，tag→ae08fc7 推远端（补证 5） |
    | 10 | design/proto 维持不动 | ✅ | git log 区间无 proto 改动 |
- CEO 批准：批准（2026-08-16，CEO 原话「可以，全部批准」——CHG-006 四条需求与优先级 P0/P0/P1/P1、iter-11 方案 A 范围、主题按钮交设计师在 design-iter-11 提案均一并批准）。

## CHG-005 密码强度规则升级：8~128 位且含字母+数字（REQ-020/021）

- 日期：2026-08-16
- 类型：修改
- 状态：**已批准（2026-08-16，CEO 定夺「升级为含字母+数字」，随 iter-9 T1/T2 落地）**
- 内容：密码强度规则由「最短 8 位（CHG-004 定稿，仅长度校验）」升级为「**8~128 位且须同时包含字母（a-zA-Z）与数字**」。注册（REQ-020）与改密（REQ-021）统一此口径；登录（REQ-020）不做复杂度校验——格式不合法与密码错误统一 401「用户名或密码错误」，不泄露密码规则。
- 原因：design-iter-9 走查清单「新密码至少 8 位，需包含字母与数字」与后端既有「仅长度校验」不一致，QA 审计 NCR-iter9-001 暴露；CEO 定夺升级后端规则（而非修订设计稿文案）。
- 影响评估：
  - REQ-020 注册、REQ-021 改密：密码规则同步升级，前后端同口径（后端 `security.password_meets_complexity` + auth.py 注册/改密两处 validator；前端 SettingsForm 改密校验 + 注册校验）。
  - REQ-020 登录：分离 `LoginBody`（password 只做长度上限校验，不做最小长度/复杂度），保证登录统一错误语义。
  - 设计资产：design-iter-9 文案「含字母与数字」即定案口径，无需改设计稿；design-iter-6 注册原型「最短 8 位」为历史遗留（非本次范围，观察项另记）。
  - 测试：后端 +3 复杂度用例（纯字母/纯数字拒绝，pytest 117→118）、前端 +2（纯数字/纯字母拦截，206→201 后口径）。
- CEO 批准：批准（2026-08-16，CEO 定夺「升级为含字母+数字」；另一项定夺「侧栏宽保持 264px」见 design-iter-9 R2）

## CHG-004 产品定位升级：账号体系与多用户 + 自建 FastAPI 后端（公开注册、云端会话、密钥代管、用量防护、管理后台）

- 日期：2026-08-15
- 类型：修改 + 新增
- 状态：**已批准（2026-08-15，基线 req-baseline-v3）**
- 内容：
  1. **产品概述改写**：从「单人本地工具」变更为「多用户自部署 Web 服务」——任何人可注册使用，会话数据存服务端，多设备一致。
  2. **架构决策更新**：前端 Vue3+TS 不变，新增 **Python FastAPI 后端**。后端职责：① 用户账号体系（注册/登录/会话管理）；② API 密钥统一管理与服务端代管——**双模式**（默认服务端统一 key，高级设置可自填 key 存服务端解锁更高配额）；③ OpenAI 兼容流式请求代理转发；④ 用户数据（会话/档案）云端存储。替换原「纯前端直连、不自建后端」决策（决策历史在 spec §1 注明）。
  3. **新增需求 REQ-020~025**（优先级 CEO 已确认）：REQ-020 注册与登录（P0）、REQ-021 账号管理-改密/注销（P1）、REQ-022 服务端会话云存储与多设备同步（P0）、REQ-023 API 密钥服务端代管与流式代理——双模式（P0）、REQ-024 用量配额与滥用防护（P0）、REQ-025 管理员 Web 后台（P1）。
  4. **正式改写存量需求**：REQ-006（服务端为唯一持久层，IndexedDB 降级为一次性迁移源；不保留本地模式、必须登录）、REQ-014（密钥双模式，浏览器不再存 key）、REQ-018（档案迁服务端存储，一键切换交互保留）、REQ-007（错误映射扩展：登录 401 / 配额提示 / 上游错误透传）。
  5. **非功能需求更新**：架构/数据/安全条款改写（密码哈希加盐、密钥仅存服务端）；新增「部署」条款——Docker Compose 本地一键起全链路（前端+后端+SQLite DB），不锁死云环境、可迁移；SQLite 起步（CEO 认可）。
  6. **暂缓池更新**：移出「账号体系与多用户」「自建代理后端」两项；联网搜索留池待后端就绪后走下一次变更；新增「同步冲突精细合并（vector clock 等）」注记。
- 原因：CEO 2026-08-15 拍板——① 用户范围公开注册，因此必须含滥用防护与用量控制（P0）；② 登录用用户名+密码、自管账号，不依赖第三方；③ 后端技术栈 Python FastAPI；④ 数据云端同步随账号体系一并纳入；⑤ 联网搜索本轮不做；同日对 6 项澄清问题逐项定案（见下「澄清定案」）。
- 澄清定案（2026-08-15 CEO 拍板）：
  1. **API 密钥归属：兼容双模式**——默认服务端统一 key（配额内免费额度）；高级设置允许用户自填 key 存服务端、解锁更高配额（REQ-023/014/024 联动）。
  2. **本地模式：不保留，必须登录**——未登录只能看到登录页；IndexedDB 降级为一次性迁移数据源（REQ-006/022）。
  3. **管理员：要 Web 管理后台**（新增 REQ-025，P1）——首个注册用户为管理员；封禁/解封用户、按用户调整配额、查看用量统计（最小可行口径：按用户按日的请求数与 token 数列表，图表不做）。与暂缓池「用量与费用统计面板」（面向普通用户的个人面板）的边界已在暂缓池写明。
  4. **部署：先本地跑通，部署目标后议**——Docker Compose 本地一键起全链路（前端+后端+DB），不锁死云环境、可迁移；VPS/域名/HTTPS 选型列入本记录「后续待定」，不写入需求正文。
  5. **同步冲突：最后写入覆盖（LWW）**（写入 REQ-022）；vector clock 等精细合并留暂缓池。
  6. **存量数据迁移：一次性「导入本地会话到云端」入口**（写入 REQ-022）；导入后本地数据保留只读 30 天再清。
  7. **仓库布局：同仓库 monorepo**——后端代码放 ai-chat 现有仓库内新增 `backend/` 目录（Python/FastAPI，独立依赖文件与 lockfile，.gitignore 排除 `__pycache__`/`.venv`），前端代码保持根目录现状不动，`docker-compose.yml` 放仓库根目录统一编排；不另建独立后端仓库、不用 submodule。（实施层细化，无需单独批准，随 CHG-004 一并生效）
  8. **需求层口径补记（CEO 定 2026-08-15，随 design-iter-6 基线批准；CHG-004 澄清定案追加补记，无需新 CHG）**：① **用户名规则**写入 REQ-020——2~32 字符，允许中文/字母/数字/`_`/`-`，唯一性大小写不敏感，作为前后端共同校验口径；② **兼容性条款补充**——登录/注册页承诺 ≤480px 移动端可用（仅这两页，其余页面维持现状不承诺）；③ **登出入口最小扩展**——侧栏底栏显示用户名+登出 icon，为 iter-1~5 主界面基线的唯一增量（design-iter-6 待澄清 5 定案），随 design-iter-6 批准。
  9. **设计资产承载补记（NCR-iter6-006 整改，CEO 批准处置 2026-08-16）**：影响评估原写「design/proto 需新增登录/注册/账号管理原型与管理后台原型」——实际**登录/注册原型由 design-iter-6 承载**（已基线），REQ-021 账号管理/REQ-025 管理后台原型随 iter-8 设计产出，proto 不重复添加。理由：proto 定位是「iter-1 核心闭环的交互原型」，新页面有各自 design-iter-N 基线承载即可，避免同一内容两处维护（CHG-001 教训）。spec REQ-020「涉及页面」字段已同步为 design/iter-6。
  10. **design-iter-6 实现偏差处置（NCR-iter6-002 整改，CEO 批准「功能修复+视觉登记」2026-08-16）**：QA 审计列 8 处偏差——①401 到达登录页显示「登录已过期」、②空值/用户名已占用改字段行内、③确认密码显隐眼睛、④≤480px 输入 16px 触控口径、⑤加载态实底主色+spinner、⑧服务端密码上限 128，**已修复回基线**（前端 119/119、后端 37/37 全绿）；⑥规则 hint 以 placeholder 呈现（非常驻文字）、⑦视觉参数偏差（字段距 14px vs 设计 20px、卡片内距 32/28 vs 24、按钮 38px/14/500 vs 36px/13/600、无副标题、无 autofocus）**登记为已接受偏差**——理由：全部命中既有令牌、与主界面既有组件（SettingsForm 表单口径）一致性优先、不影响可用性与 ≤480px 承诺；CEO 批准接受（2026-08-16）。
  11. **design-iter-7 技术定夺补记（CEO 批准 2026-08-16，4 项按设计师建议定案，随 design-iter-7 基线；CHG-004 澄清定案追加补记，无需新 CHG）**：① **统一 key 注入方式**——`backend/.env` 三变量（`AI_CHAT_UNIFIED_KEY` / `AI_CHAT_UNIFIED_BASE_URL` / `AI_CHAT_UNIFIED_MODEL`），`.env` 不入 git，`.env.example` 占位；② **自填 key 存储**——明文存服务端 SQLite（不做应用层加密），「受保护存储」落实为可验收条款：不进 git/日志/任何 API 响应、编辑模态不回显（掩码或留空=沿用）、数据库文件 0600（写入 REQ-014）；③ **错误映射**——上游错误经代理透传的映射表随 design-iter-7 基线定稿（REQ-007 扩展映射以设计稿为准）；④ **存量本地档案上云形态**——登录后提示条 + 一键导入（非静默，key 未经确认不上传；导入=新增不覆盖 + 本地清除；「暂不导入」下次登录再提示），落地 iter-8（写入 REQ-018）。
- 影响评估：
  - **存量需求逐条**：
    - REQ-006（**重大，已定稿改写**）：会话唯一持久层改为服务端；IndexedDB 不再作运行时存储，仅作 v0.4.0 及以前本地数据的一次性迁移源（导入后只读 30 天再清）；未登录一律跳登录页，不保留本地模式。
    - REQ-014（**重大，已定稿改写**）：密钥双模式——默认服务端统一 key 零配置可用；自填 key（base URL/模型名/key）存服务端并解锁更高配额；原验收中「仅存浏览器本地」「清除密钥入口」条款作废，改为「浏览器与 git 仓库均检索不到 key」。
    - REQ-018（中，已定稿改写）：供应商档案从本地迁移至服务端存储，登录后多设备可见；一键切换交互与验收口径保留。
    - REQ-007（中）：错误来源新增服务端层——登录态失效 401、配额超限提示、上游错误经代理透传映射；提示映射表需扩展。
    - REQ-001/002/003/004/005/009/010/012/013/015/016/019（界面与交互逻辑不变）：数据读写层从 IndexedDB 切换为服务端 API（由 REQ-022 统一承载，前端交互与验收口径兼容）；流式请求端点从上游直连改为后端代理（REQ-023），REQ-001/002 的请求路径相关验收需在代理架构下复验。
  - **设计资产需同步（逐项核对）**：
    - `design/proto`：需**新增**登录/注册/账号管理原型（REQ-020/021）与**管理后台原型**（REQ-025），按「原型即需求」由设计师产出并作为 spec 附件；登录态下的应用框架需补充说明——未登录只有登录页，登录后进入主界面。
    - `design/iter-1`/`design/iter-5`（设置页）：密钥配置区按双模式**重设计**——默认统一 key 零配置，自填入口收进「高级设置」。
    - `design/iter-2`~`iter-5`（主界面/会话列表/消息流）：交互不变，**不同步**，理由：对应 REQ 的界面验收口径未变，仅数据层换源。
    - 后端与管理后台为新增面：纯 API 部分无设计稿，不涉及；管理后台 UI 依赖 REQ-025 原型。
  - **架构变更说明**：新增 FastAPI 服务（模块预估：auth / proxy / sessions / quota / admin）与 SQLite 数据库（起步选型，CEO 认可）；前端 `api/client.ts` 请求目标从上游切换为后端代理端点；`db/idb.ts` 降级为一次性迁移读取源。**工作量待 /mm-iteration-plan 估算**（预估 L~XL，将跨多个迭代，需重排迭代计划——iter-6 起规划）。
  - **后续待定（不阻塞本次变更批准）**：① 部署目标环境（VPS/域名/HTTPS 终结方式）——本地 Docker Compose 跑通后再议；② 统一 key 与自填 key 的具体配额数值——由管理员后台参数化（REQ-025），初始默认值随 iter 计划定。
  - 度量影响：metrics 脚本若采集前端构建/测试数据，架构调整后需适配（交 iter 计划评估）。
  - 里程碑影响：本轮不挤占已关闭迭代；v0.5.0 及以后的发布形态从静态站点变更为前后端服务，发布 checklist 需在 release 流程中补充部署验证项。
- CEO 批准：批准（2026-08-15，CEO 逐项确认 6 项澄清后批准；基线 tag：req-baseline-v3）。

## CHG-003 对话体验打磨——输入区按钮位置 / 消息操作栏（复制+编辑） / 版本切换（CEO 试用反馈，参考 DeepSeek）

- 日期：2026-08-15
- 类型：修改 + 新增
- 内容：
  1. **REQ-001 输入区**：发送/停止按钮由「底部操作栏」改回与 textarea 同排、顶部对齐首行文字（CEO 试用反馈「发送图标最好在上面，跟第一行输入框文字对齐」；覆盖 T1 两行结构的回基线决定）。hint 移到底部弱化。
  2. **REQ-015 消息操作栏**：编辑铅笔由「hover 左侧」改为「消息下方常显操作栏」，并新增「复制」按钮（复制整条消息原文，参考 DeepSeek），不再 hover 才出现。
  3. **新增 REQ-019 版本切换**：编辑/重新生成后保留旧分支，可在新旧分支间切换（参考 DeepSeek 版本导航）。
- 原因：CEO 试用 iter-4 交付后反馈——输入区按钮位置仍显歪扭；消息操作入口（铅笔）位置与显隐不符合 DeepSeek 习惯；编辑后缺少回到旧回复的切换能力。
- 影响评估：
  - REQ-001（输入区布局：两行 → 单排顶对齐）、REQ-015（编辑入口位置 + 复制 + 版本切换，牵动数据模型：Message 增 forkId、Session 增 branches 分支存档）、REQ-006（branches 随会话持久化）。
  - 设计资产需同步：design/iter-4（输入区 1.1 节、消息编辑 2.x、新增版本切换触点）、design/proto（输入区交互原型，已同步单排顶对齐；消息操作栏/版本切换属 iter-4 新增 REQ-015/019，不在 P0 原型范围，保留理由已写入 proto 头部注释）——避免重演 CHG-001 未同步被 QA 抓 NCR-002 的教训。（proto 评估为 NCR-iter4-005 整改补记，2026-08-15）
  - 工作量：输入区与操作栏为 S/M；版本切换为新数据模型 + UI，估 L，随本迭代收尾。
- CEO 批准：批准（2026-08-15，CEO 试用反馈提出）。

## CHG-002 新增 REQ-015~018（消息编辑/重新生成、会话搜索、暗色主题、多供应商档案）+ 关联输入框缺陷 DEF-011

- 日期：2026-08-15
- 类型：新增
- 内容：新增四条需求——REQ-015 消息编辑与重新生成（P1）、REQ-016 会话搜索（P2）、REQ-017 暗色主题（P2）、REQ-018 多供应商档案一键切换（P2，REQ-014 增强）。同时关联输入框缺陷 DEF-011（见 plans/defects.md）：ComposerBox 实现偏离已基线设计稿 iter-1，处置为「回基线设计稿」，本轮**不做**超越基线的视觉升级（留作后续单独评估）。
- 原因：CEO 试用反馈「对话框很粗糙，不仅样式细节（输入框歪扭），功能太基础」。需求分析逐条澄清后 CEO 拍板：输入框先按缺陷修复（回基线设计稿 iter-1：14px 字号、textarea 在上 + 底部操作栏两行结构、shadow-1 阴影、底部「Enter 发送 · Shift+Enter 换行」hint、textarea 内边距）；功能层引入上述 4 条新需求入基线，但本轮容量 Σ≤10、只排 1~2 条核心（建议 iter-4 以 REQ-015 为主线，其余 defer，具体排期交 /mm-iteration-plan）。产品定位仍为单人本地，账号/云端/多端/RAG/自建后端继续留暂缓池。
- 影响评估：
  - 牵动现有需求：REQ-001（输入框回基线设计稿，发送交互不变但布局结构变化）；REQ-010（停止按钮「红实底白字方块」已基线 design-iter-2 不变，但位置随两行结构重定）；REQ-002（REQ-015 编辑后需重建上下文组装，删除编辑点之后的旧消息）；REQ-006（REQ-015 要求持久化从「追加」扩展为「可更新历史消息」，存储结构需兼容迁移）；REQ-014（REQ-018 为 014 增强，从单套配置扩展为多档案切换）。
  - 设计资产需同步（制度 v1.3.1 检查项「原型与设计稿是否需同步」）：design/iter-1（4.6 节输入区状态回基线）、design/iter-2（停止按钮基线）、design/iter-3（顶栏/导出，若涉及）、design/proto（输入区交互原型）——DEF-011 修复与 REQ-015~018 新增均需同步对应设计稿/原型，避免重演 CHG-001 曾因未同步被 QA 审计抓出的 NCR-002。
  - design-system 影响：REQ-017 暗色主题需新增整套暗色令牌，tokens.md 当前 v1.2 仅浅色，为前置依赖；components.md 组件样式仍待沉淀（iter-3 复盘已标注），可借本轮视觉打磨时机沉淀。
  - 工作量：待 /mm-iteration-plan 估算；不涉及架构变更（仍纯前端直连 + 本地 IndexedDB）。
- CEO 批准：确认（2026-08-15，CEO 确认变更记录与缺陷登记无误，落基线；spec.md/rtm.md 已同步落盘）。
- 交互决策定案（2026-08-15 CEO 拍板，已写入 spec）：
  - REQ-015 生成中编辑历史消息 = **允许编辑，编辑确认时中断当前生成**（与 REQ-003「生成中新建=中断」语义一致）。
  - REQ-018 生成中切换供应商档案 = **当前这轮用旧档案跑完，切换自下一次请求生效**（与 CHG-001「切换不中断」语义一致）。

## CHG-001 生成中切换会话不再中断，改为后台继续生成

- 日期：2026-08-15
- 类型：修改
- 内容：REQ-004 原为"生成中切换会话 = 中断并标注'生成中断'"，改为"切换后原会话在后台继续流式生成，完成后切回可见完整回复"。REQ-003（生成中**新建**会话 = 中断并标注）维持不变。生成状态由全局单一改为按会话独立（每个会话有自己的 AbortController）
- 原因：CEO 实际使用反馈——切换查看其他会话时把正在生成的回复打断，不符合预期（基线时采纳的"MVP 简化"方案在体验上不成立）
- 影响评估：工作量 +0.5d（已完成）；进度 无影响；受影响需求：REQ-004（验收标准更新）、REQ-003（语义微调：中断仅由新建触发）。"生成中断"标注与恢复逻辑（REQ-006）保留，仍用于新建中断与刷新恢复场景
- CEO 批准：批准（2026-08-15，CEO 主动提出："切换对话会导致生成中断，不要这样"）

> 补记（2026-08-15，QA 审计 NCR-002 整改）：本变更当时未同步更新原型与设计稿（`design/proto/index.html`、`design/iter-1/index.html`），已于审计当日补齐——两份设计资产中 REQ-004 行为已改为"切换不中断"，并注明 CHG-001。制度层面已加防护：requirements.md §3 变更影响评估新增"原型与设计稿是否需同步"检查项（制度 v1.3.1）。
