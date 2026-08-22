# 周报 — ai-chat 第 34 周（2026-08-17 ~ 08-23）

> 数据来自 git log 与项目文档，无手编。

## 本周完成

### iter-12（08-16 计划批准，08-17 T0 完成；REQ-029 管理后台体验重构，Σ8 = M+M+L 进行中）

- **iter-12 计划已批准**（2026-08-16，提交 a60ec8a）：Σ8 = M+M+L——T0 design-iter-12 设计稿 + T1 后端分页/搜索/统计聚合 + T2 AdminView 前端重构；REQ-025 六端点零回退为硬验收；移动端主界面适配 CEO 定夺不纳入，留暂缓池作 iter-13 候选（届时走 CHG-007 变更基线）
- **T0 design-iter-12 已基线**（2026-08-17，CEO 批准「批准，全部按推荐定案」，tag design-iter-12）：
  - 8 项定夺全按推荐：①分页信封兼容（不传参=既有列表形状零变化，传参才返回 {items,total,...}——test_admin 19 用例零改动门槛）②越界服务端钳制到最后一页 + 参数非法 422 ③默认 20/页不做切换、单页控件隐藏 ④统计口径（今日=服务器本地自然日、全模式合计、统一 key 分母=配置值 2000、无记录 0 不估算补齐·铁律 5）⑤全站配额条三态并入统计卡 4 + near/burst 页面级警示条（文案逐字沿用 iter-8 口径）、常态条退役 ⑥用量排序迁后端（sort_key/sort_dir + tie-break username，分页后客户端排序跨页语义错误）⑦灰底白卡/内容列 1080px/表格入卡留白加深 ⑧零新令牌 + components.md v1.1 登记三形态（统计卡/分页控件/后台搜索框）
  - 设计稿：概览统计卡四卡常驻 tabs 上方 / 用户搜索（防抖 300ms·大小写不敏感·命中高亮·空态）/ 双列表分页控件（total≤20 不渲染）/ §4 分页与统计 API 口径定案（T1 直接对照）/ §5 零回退映射表 + 403/入口/被封禁横幅证据帧 / §7 走查清单 52 条（零回退组逐条映射 iter-8-verify 编号，T2 复验直接对照）
  - 实现影响登记：定夺⑤ AdminView.spec 全站条三态用例需适配为新载体断言（spec 适配≠口径回退，复验以 §7.2 条 7/8/9 为准）；定夺⑥ usage 前端排序用例迁后端
- **T1 后端分页/搜索/统计聚合已实现并验证**（2026-08-17，REQ-029）：
  - users 增 `search`（子串大小写不敏感、%/_ ESCAPE 转义字面量、trim 空串不筛选）+ `limit`/`offset`（1~100 / ≥0，非法 422）分页信封；定夺①落地：不传新参数 = 纯列表形状零变化（既有消费方零感知）
  - usage 增 `sort_key`/`sort_dir`（Literal 白名单，非法 422；tie-break username 升序保证翻页不重不漏）+ 分页信封含 `distinct_days`（缺失时段「不估算补齐」的全窗口判定，不受翻页影响）；越界钳制到最后一页 + 真实 total（定夺②）
  - overview 加法扩展 `total_users`/`today_requests`/`today_tokens`（定夺④：今日 = 服务器本地自然日、全模式合计、无记录 0 不估算补齐——铁律 5）；既有三字段零变化；ban/unban/quota 三端点零改动
  - 测试：test_admin 新增 **20 用例**（搜索 5 / 分页 6 / 排序分页 7 / 统计 2），pytest **139/139（119→139）** + ruff clean；**既有 19 用例零改动复跑通过**（design-iter-12 §4 兼容硬门槛）；批量造数走 `_insert_users`（bcrypt 占位直插，绕开 45 次哈希成本）与 `_seed_usage`（三日三用户含 tie-break 数据）
- **T2 AdminView 前端重构已实现并验证**（2026-08-17，REQ-029）：
  - 概览统计卡四卡（tabs 上方常驻，进度条常态 #3370FF / ≥80% #B45309 / 熔断 #D93025）+ near/burst 页面级警示条（文案逐字沿用 iter-8 口径，常态条退役——定夺⑤）
  - 用户搜索（260×32、防抖 300ms/Enter 立即/清除重置回第 1 页、大小写不敏感、mark.hl 命中高亮复用 REQ-016 highlightSegments、空态空盒+清除动作）+ 分页控件（20/页、单页隐藏、>7 页折叠「…」、边界禁用、翻页 scrollIntoView）
  - 用量排序迁后端（sort_key/sort_dir + tie-break username——定夺⑥）+ 分页同口径 + distinct_days 缺失行全窗口判定（不受翻页影响）；灰底白卡 1080px 视觉重构（定夺⑦，零新令牌，guard:style 过）
  - 治理操作/403/入口/封禁横幅零改动（REQ-025 零回退）
  - 测试：AdminView.spec 15→22 用例（三态用例按定夺⑤登记适配为新载体断言），前端 vitest **254/254（247→254）** + guard:style + 生产构建
  - 走查：**真实 Chrome 49/49 全过**（scripts/e2e-walkthrough-12.mjs 新沉淀；design-iter-12 §7.2 52 条逐条留档 plans/iter-12-verify.md，10 截图 /tmp/e2e12/shots/；46 用户+跨 7 天含缺失造数、亮暗双主题、网络面板参数取证、同源三口径比对）。首轮 40/48 的 8 项 FAIL 全为脚本断言问题（选择器作用域/箭头字符/前导空格），零产品缺陷，已登记
- 测试：前端 254/254 + guard + 构建；后端 139/139 + ruff clean
- **QA 审计（retros/qa-audit-iter-12.md）：有条件通过 2 NCR**，CEO 定夺处置：
  - NCR-001 spec REQ-029「涉及页面」指针未随基线同步（同型第 3 次复发，v1.4.9 新防线首战失守）→ **整改**：spec 已更新 + CHG-006 影响评估承诺清单 10 项全项落地复核留痕（verify 整改段）；根因（spec 指针列无核对触发点）入复盘
  - NCR-002 调配额模态副文案「高档」vs 基线样件「30/500」→ **DEF-028 登记已接受偏差**（理由：30/500 部署可配置写死失真，值无关措辞语义一致；补证 iter-8 T2 2f91e45 引入——iter-8 走查盲区一并留档；下轮走查脚本补选项文案断言面）
  - OBS-1/2/6 顺手修（design 稿正文徽标刷新 / components.md v1.1 两处登记值修正 6px+左信息 / verify 补断言数差额说明）；OBS-3（双主题承载方法）/OBS-4（脚本自迭代 FAIL 是否入 DEF）/OBS-5（加载态运行时取证）入复盘定口径
  - 审计员总评：工程交付与取证质量十二轮最高（计数三方一分不差、零回退锁死、走查失败诚实归因）；主会话补证 6 项全过（含三治理端点逐字节 diff、运行时复跑全绿）
  - 整改后复跑：前端 254/254 + guard + 构建 + 后端 139/139 + e2e 新库重建 49/49 全绿
- **复盘关闭（G4 过，2026-08-17）**：四问 CEO「四问全认可」；改进 A/B/C 全批落制度 **v1.4.10**（A CHG 承诺清单化 → requirements §3；B 走查断言面 → testing §5 第 6 条；C 走查脚本自迭代口径 → tailoring 补记）；CHG-006 落地核对清单补建为范本（10 项全 ✅）；容量维持 Σ≤10（连续七轮零偏差）；见 retros/iter-12.md


---

## iter-13（A1 Agent 地基，2026-08-17 计划批准并当日全交付；NCR-iter13-003 整改补录）

**变更与基线**：CHG-007 批准出基线 req-baseline-v5（dcc7dd6 + tag）——agent 架构升级第一期：REQ-030~035 新增、存量改写 6 条、两定夺项定案（①档案级工具开关 ②schema:2 写侧守卫 409）；架构升级方向审核稿留档（七期路线 A1→D2，docs/architecture-upgrade-plan-2026-08-17.md，愿景叙事 §九）。

**任务交付**（计划 5bf78ad；统一提交 5 笔 = NCR-iter13-001 整改）：
- T0 design-iter-13 基线（6c874e8 + tag）：九项定夺全按推荐（步数 10/超时 120s/32KiB/仅 admin/独立端点 /api/chat/turn/turns 列/断连已抵上游则计）；走查清单 51 条。
- T1 后端 agent 运行时（a5d10c3）：ReAct 循环三护栏 + 工具网关六项校验 + SSE 解析重组 + 回合端点 + 配额回合化（迁移 v6）+ schema:2 守卫 + echo/demo_weather；**pytest 139→182（+43）+ ruff，既有 139 零改动**。
- T2 前端协议与渲染（本笔）：blocks 模型 + ToolStepCard 四态徽章 + 回合端点接入 + export/search/markdown 适配 + DEF-028 核销；**vitest 254→273（存量逐用例迁移映射登记）+ vue-tsc + guard + 构建**。
- 走查：真实 Chrome 全链路（真 DeepSeek 统一 key，北极星链路：工具卡运行中→完成→综合回答）+ 51 条清单脚本化（scripts/e2e-walkthrough-13.mjs，38 断言 0 FAIL + 13 条自动化承载标注；截图 6 张）。
- 缺陷：DEF-028 销账；DEF-029（回合与会话 PUT 竞态 404）/030（markdown 块间空行，iter-1 存量）/031（用户气泡左缘，iter-11 存量基线偏离）/032（错误共存形态）——CEO 走查×2 + 脚本走查×2，全部当轮修复同提交登记。
- QA 审计：有条件通过 5 NCR（retros/qa-audit-iter-13.md）——002/004/005 当轮整改，001/003 经本统一提交闭环（tailoring 已补登偏离与防复发口径）。

**Code Review（G4 前置，2026-08-18 产出待 CEO 过目）**：iter-13 全量 review（3c7a834..2137a5a，7 笔 / 41 文件 / +3400−280 量级）。

**三问结论**：

1. **有无偷换需求范围**：无。REQ-030~034 全量交付且与 CHG-007 验收条款、design-iter-13 基线逐条对得上（QA 审计面 1/3/4 已独立核对）；REQ-035（联网搜索）按计划不做、留 iter-14；新增产物（走查脚本/审计存档/components v1.2/tailoring 补登）均为任务交付物或 QA NCR 整改项，来源可溯。
2. **有无明显隐患**：逐项复核——①回合端点安全面：会话归属校验（复合主键 404 不泄露）、消息 32K/system_prompt 8K 上限、工具 admin 过滤在服务端、密钥零日志；②守卫与配额原子性见下述已知取舍；③前端 `await persist` 后再起回合（DEF-029），断网路径错误语义正确；④`runChatTurn` 的 TurnEvent 含宽型未知成员，store 侧分支内显式断言（TS 收窄缺口已堵）。**三条非阻塞已知取舍留档**：a) schema:2 守卫 SELECT→UPSERT 非原子（并发窗口极窄，最坏退化为守卫前 LWW 行为，无害）；b) 流无 turn.end 即截断时客户端按 done 兜底（沿旧端点同型语义；实际中断场景由 error 事件/HTTP 状态码覆盖）；c) 上游连接期即失败的回合计 1 回合（与旧端点受理侧同口径，verify §5 已登记）。
3. **测试是否真实覆盖**：真实。后端 139→182（既有零改动经 git diff 取证）、前端 254→273（存量逐用例迁移映射登记于 spec 头注释，退役 4 例均有服务端承接）、走查 38 断言 0 FAIL 两轮复跑；数值断言全部机器采集（pytest/vitest/脚本断言），铁律 5 符合。

> CEO 过目结论：**认可**（2026-08-18 CEO「可以，下一步吧」——无异议；三条非阻塞已知取舍留档接受：守卫并发窗口 / 流截断兜底语义 / 连接期失败计费口径）


## iter-14（A2 联网搜索，2026-08-18 计划批准并 T0~T3 全交付；Σ8 = S+M+L+M）

- **计划**：Σ8（余量 2 不顶格）——T0 OBS-2 前置取证（S）+ T1 design-iter-14（M）+ T2 后端搜索（L）+ T3 前端引用卡与开关（M）。定夺：Tavily 起步（博查备选，SearXNG 不做）/ 搜索 key 入 backend/.env / 真实天气工具不纳入留 B1（和风凭据+专属 Host 已冒烟验证备存 .env）。
- **T0**：QA OBS-2 闭环——自填端点（mode=self）真实回合取证（demo_weather 真实执行 + 事件序全帧 + usage 回合口径），留档 verify §T0。
- **T1**：design-iter-14 基线（8 定夺全按推荐：引用卡/降级文案逐字/admin 开关 + API 口径/档案开关 UI/微参数 10s·5 条·默认折叠；走查清单 42 条；tag design-iter-14；spec 指针回填零滞后 + OBS-3 闭环 + components.md v1.3 toggle switch 登记）。
- **T2**：后端搜索工具——search 注册（Tavily 客户端/白名单 + DNS 双段校验/10s/32KiB 截断/归一化五字段 + sources）+ admin 开关（迁移 v7 + overview + PUT /api/admin/settings）+ profiles tools_enabled API；pytest 182→220（+38），既有 182 例零改动；真实 Tavily 冒烟 2 例。
- **T3**：前端——SourceCard 引用卡 + MessageBubble 接线 + ToggleSwitch + AdminView 搜索开关 + SettingsForm 档案开关第五字段；vitest 301/301 + build + guard；真实 Chrome 走查 56 PASS/0 FAIL（REQ-035 验收 1 达成）；当轮修复产品缺陷 1 项（段间 4px→8px）。
- **QA 审计**：有条件通过 3 NCR（001 周报空 / 002 DEF-033 补登 / 003 tailoring 版本滞后），已整改；6 OBS。
- **待办**：CEO 过目落痕 → G4 复盘 → 推送远端（本地提交待推）。

**Code Review（G4 前置，2026-08-18 产出待 CEO 过目）**：iter-14 全量 review（c2ac216..HEAD，12 笔 / 41 文件 / +4587−62）。

**三问结论**：

1. **有无偷换需求范围**：无。REQ-035 验收 1~5 逐条对应（降级/开关 payload/出网/截断/真实 Tavily 走查）、REQ-032 引用卡承载不新增 block 段类型、REQ-031 出网治理 A2 面收口（白名单 + DNS 解析双段）、REQ-025 admin 开关逐字（StrictBool 422/幂等/403）、REQ-014 档案开关兑现定夺①；真实天气工具零实现（全仓 grep 零命中，和风凭据仅存 .env 备用）；「上标联动」按定夺③定案纯来源列表卡、未越界。
2. **有无明显隐患**：无阻塞缺陷。search 安全面（白名单模块常量不可绕过 + 前缀伪装域测试、DNS 解析期核验真实、注入转义 + 字面分界、截断、key 全程零明文）、admin 开关三态门控（PUT 后下一回合运行时生效、统一 key 恒开、key 缺失可存不注册）、前端 XSS 面（SourceCard textContent 直排不入 Markdown 管线）均真实覆盖。**5 项非阻塞已知取舍留档**：①DNS 解析 TOCTOU（白名单固定域实际攻击面零，远期用户可控 URL 工具再上钉扎）②注入防护为 prompt 级软防护（CHG 4.5-⑥ 定义口径）③截断标注后略超 32KiB（约 +21 字节）④Tavily 成本不入 usage_daily（属 B1 遥测范围，LLM token 成本如实累计）⑤「不支持 tools」引导未单独建 pytest 用例（走查条 36 已验直达）。
3. **测试是否真实覆盖**：真实。pytest 220 本机复跑全绿（假端点全 mock 不依赖真实 key/额度）、vitest 301 全绿、走查 56 条逐字/几何/加载态/双主题 getComputedStyle 实测（条 40 几何断言当场捕获段间 4px 偏差 → DEF-033 当轮修复）。

**轻微硬化建议（非阻塞，可不动）**：SourceCard `:href` 未校验 URL scheme（Tavily 可信 API 仅返 http/https，风险极低）；verify §2 分组计数口径已留档说明。

> CEO 过目结论：**认可**（2026-08-18 CEO「我认可，回填落痕」——无异议；5 项非阻塞已知取舍留档接受：DNS TOCTOU / 注入软防护口径 / 截断标注 +21B / Tavily 成本遥测留 B1 / 引导路径走查承载；CHG-008 验收走查反馈三项 + DEF-034 已当轮处理并全量复验 56 PASS）

## iter-15（B1 prompt 分割+请求级遥测+admin 遥测面板，2026-08-19 计划批准并 T0~T3 全交付；Σ8 = S1+M2+L3+M2）

- **计划**：Σ8（余量 2 不顶格）——T0 取证+人设稿（S）+ T1 design-iter-15（M）+ T2 后端核心（L）+ T3 admin 遥测面板（M）。基线 req-baseline-v6（CHG-009，8 定夺全按推荐）。
- **T0**：真实冒烟两项——DeepSeek usage 缓存字段形状（prompt_cache_hit/miss 恒返回、128 块粒度、未观测 1024 门槛、分区收益实测）+ 自填端点多 system 无明确拒绝（GLM 429 余额不足延续 DEF-002）；人设稿 CEO 审签「批准」（AI_CHAT_PRODUCT_PERSONA）；零 DEF。
- **T1**：design-iter-15 基线（6 定夺全按推荐；遥测视图=AdminView 第三 tab 加法扩展 + GET /api/admin/telemetry 口径 + 缺失/单价未配置两异常形态；走查 44 条；零新增令牌；tag design-iter-15=a245085）。
- **T2**：后端核心 89fe642——prompt 两段式分区 + 迁移 v8 telemetry 双端采集（缺失记 NULL/90 天清理/写失败隔离）+ 旧透传端点下线（test_proxy 16 例退役映射+404 取证+turn_smoke 迁代）+ 人设/单价 config；pytest 224−16+23=231。
- **T3**：admin 遥测面板 2b4f915——聚合端点（成本三分项/命中率/工具用量，403 门禁，days 1~90，六端点零变化）+ AdminView 第三 tab 四卡七态；后端 239/前端 324 全绿 + guard + 构建；走查 e2e-walkthrough-15 58/58（8 帧截图）。
- **缺陷**：DEF-035（test_quota 耦合，当轮处置）、DEF-036（th.num 对齐，当轮修复）。
- **特殊事件**：双后端 agent 同工作区撞车 + 一条虚假「T2 已完成」回报——主会话核实为假未采信、收束重复 agent、亲跑 make check 为收口依据（registry 留痕；NCR-003/OBS-1 复盘议）。
- **QA 审计**：有条件通过 3 NCR（001 周报四件套台账失守 / 002 RTM 行级收口未做 / 003 两笔 feat 提交违反 v1.4.12）+ 4 OBS，CEO 批准按建议整改中。
- **待办**：NCR 整改提交 → Code Review 产出 → CEO 过目 → G4 复盘。

## 技术债

- 无新增

## Code Review

**iter-12 全量 review（a60ec8a..d42ba36，含 NCR 整改；2026-08-17 产出，待 CEO 过目落痕）**

范围：4 提交 / 12 文件 / +3363−274。核心改动：`backend/app/routers/admin.py`（+189 三端点扩展）、`src/views/AdminView.vue`（重写 724 行改动）、`backend/tests/test_admin.py`（+297）、`src/views/__tests__/AdminView.spec.ts`（15→22 用例）、`src/api/backend.ts`（信封类型与两端点）、设计稿 1380 行、走查脚本 490 行、计划/verify/RTM/周报。

**三问结论**：

1. **有无偷换需求范围**：无。REQ-029 四项范围全交付且与 design-iter-12 基线逐条对得上（QA 符合项 8 抽查）；REQ-025 零回退双重取证（三治理端点函数体逐字节 diff 为空 + test_admin 19 用例零删除零改动）；无未批准新增范围（走查脚本与 launch 配置为任务交付物/环境件，已随任务提交）。
2. **有无明显隐患**：逐项复核——①SQL 注入面：search 经 ESCAPE 转义参数绑定、sort_key/sort_dir 为 Literal 白名单（FastAPI 422 拦非法），无字符串拼接用户输入；②越界钳制与 offset 回写闭环（信封 offset 即生效值）；③防抖计时器 onBeforeUnmount 清理；④pageList 边界（current±1 越界值不进 Set）——均无问题。**两条非阻塞已知取舍留档**：a) usage 的 total 与 distinct_days 两次查询非同事务，极端并发下理论漂移（读侧快照语义，SQLite 单写者，量级无害）；b) loadMeta 静默 catch——概览接口失败时卡片区消失无错误提示（不阻塞列表主流程的取舍，QA 未列项）。
3. **测试是否真实覆盖**：真实。QA 审计独立静态计数与运行复跑双重核对（前端 254/26 文件、后端 127+12=139、e2e 49 断言，三方一分不差）；新库重建造数复跑全绿；同源断言（卡值=接口值=DB 真值）落实铁律 5。

**风险提示**：DEF-028（已接受偏差）与 OBS-4（脚本自迭代口径）已在 defects/复盘池登记；无遗留代码风险项。

> CEO 过目结论：**认可**（2026-08-17 CEO「继续」——无异议，闭环 G4；两条非阻塞已知取舍留档接受）

**iter-15 全量 review（1802f75..2b4f915 代码面；2026-08-19 产出，待 CEO 过目）**

范围：代码面 2 笔提交（89fe642 T2 + 2b4f915 T3）/ 17 文件 / +3018−458。pytest 239 + vitest 324 实测复跑全绿；quota/tools/search/main/test_quota/test_admin 逐字节零改动。

**三问结论**：
1. **有无偷换需求范围**：无。REQ-036 验收 1~5 / REQ-037 验收 1~6 / REQ-038 验收 1~4 逐条映射实现与用例；CHG-009 八定夺逐条核对执行（②③④⑤⑥⑧ 全落）；仅新增 1 只读聚合端点 + 第三 tab 加法，无未批准新增。
2. **有无明显隐患**：无 NCR 级。八项重点核过——SQL 全参数绑定（INSERT 列名编译期白名单）；403 体仅 {detail}；NULL/0 纪律双侧变异断言（永不显 0、合法 0 如实）；分区字节恒定（lru_cache 同源+真机命中取证）；故障隔离双保险+清理/写入分事务；90 天清理边界实测（91 清/89 留）；聚合 round6 精确值断言；前端零 v-html；六端点零变化。取消路径（先落终态行后 yield、同步补行不引 await）设计正确+真实 cancel 用例。
3. **测试是否真实覆盖**：真实。239=218 def+21 parametrize 逐处核算；324 逐 it 清点；走查 58=48 实跑+10 承载标注（自我声明）。断言抽查零空转（精确值/变异/卫生四探针/集合形状）。退役 16 例映射逐条（收编 14+无对等 1+语义迁移 1），间接依赖当轮登记 DEF-035。

**非阻塞已知取舍留档**（4 条，量级低/可忽略）：①工具执行遭断连取消不落 tool 行（成本口径零影响）②惰性清理仅写入触发（闲置超期行滞留，聚合永不展示）③聚合 fetchall 内存面（单公司流量无压力）④hit 有值 miss NULL 理论行计 0（DeepSeek 恒成对，实际不可达）。

**轻微硬化建议**（非阻塞）：①单价非数字→启动崩（fail-fast）与 design「configured=false」措辞出入，下轮改设计措辞或加校验 ②telemetry docstring legacy 双端表述标退役 ③聚合可下推 SQL GROUP BY ④ts 列 UTC 与 day 本地口径统一（行级时间线时再做）。

**总评**：代码面与批准口径逐字对齐，铁律 5 贯彻到变异断言层；范围零越界、测试零空转、退役零黑箱，具备进入发布流程的代码质量条件。NCR 级缺陷：无。

> CEO 过目结论：**认可**（2026-08-19 CEO「可以，下一步吧」——无异议；4 条非阻塞已知取舍留档接受：取消不落 tool 行 / 惰性清理闲置滞留 / fetchall 内存面 / hit-miss 理论计 0）


---

## iter-16（B2 三级上下文压缩，2026-08-19 计划批准并 T0 完成；Σ8 = S1+M2+L3+M2）

- **变更与基线**：CHG-010 批准出基线 req-baseline-v7（6b65515 + tag）——B2 三级上下文压缩：REQ-039 管道核心（P0）/ REQ-040 手动压缩入口（P1）/ REQ-041 效果度量（P1）；REQ-002/033/036 改写 + 波及 5 项 + 零波及明示 4 项；九定夺全按推荐定案（CEO「全部按推荐批准」）。
- **计划**：Σ8（余量 2 不顶格）——T0 取证（S）+ T1 design-iter-16（M）+ T2 后端管道核心 + 迁移 v9（L 下沿 3）+ T3 手动压缩与 admin 度量收口（M）。备砍序 a) admin 降幅卡与懒回填延后 b) 手动压缩顺延；REQ-039 管道核心为底线。无携带缺陷（DEF-001~036 全闭环核查）。
- **T0 前置取证完成**（2026-08-19，scripts/b2_t0_smoke.py 新增，两轮真实 DeepSeek 31 回合冒烟）：
  - 定夺③精确值回填：Y = 9909/9943（两轮一致）→ **阈值定死 7000**（0.75Y 取整千位）；增长曲线实证（单搜索回合 +3.7k tokens，20 轮窗口封顶 ~9.9k）
  - 定夺⑦精确值回填：**X = 7000**；测量法定稿 = 假上游 usage 机器读数 + 关键信息问答断言 + 真实冒烟留档
  - 窗口外失忆实证：Run 2 第 31 轮明确失忆（Run 1 答对系窗口内再提及污染，如实登记）——B2 要解决的问题实证成立
  - 摘要 prompt R2 定稿（R1 产物 1344 字超限 → 增「知识性问答只留主题清单」条）：R2 产物 313 字 ≤800、关键事实与三次搜索结论全保留；逐字登记 plans/iter-16-verify.md §5
  - 零产品代码改动、零 DEF；changes.md CHG-010 定夺③⑦与落地清单第 6 项回填
- **T1 design-iter-16 已基线**（2026-08-20，CEO 批准「批准，全部按推荐」）：7 项定夺定案——①菜单项位于导出后/danger 分隔前 ②执行中 pill + 禁用防重 ③成功 toast 不带数字（懒回填半截数字违铁律 5）④409 服务端唯一判定 ⑤卡 E 全宽（双卡区与卡 D 之间）⑥降幅仅计测得行零测得显缺失 ⑦成本注记落卡 E 不动卡 A；逐字文案 C1~C16 登记表；API 口径定案（compact 四语义 + telemetry compact 加法键）；走查清单 44 条（零回退组映射 iter-11/15）；零新增令牌；spec 涉及页面指针零滞后回填。
- **流程纪律（CEO 定夺 2026-08-20）**：T2 开发任务与设计并行偷跑两轮（iter-15/16）——偏离已登 tailoring；口径定为**严格串行**（开发任务一律在设计基线后启动），模板措辞澄清入本迭代复盘改进项；今日 T2 半成品阻塞门禁卡住 T1 基线提交为既显代价；当前在跑 T2 按 CEO 定夺跑完 + 主会话亲跑核验，不构成先例。
- **T2 后端三级压缩管道核心 + 迁移 v9 完成**（2026-08-20，提交 e055e03）：新增 app/compress.py 管道核心（一级 snip 逐字占位 / 二级 compact 非流式摘要调用 30s 护栏跟随回合模式 / 三级阈值判定读该会话上一回合 step=1 机器实测值 / 失败恒降级基线 v6 / 水位失效判定）+ 迁移 v9（context_summary 产物表 PK(user_id,session_id) 水位 CASCADE + telemetry tokens_before/tokens_after/session_id 加法列，存量不回填）+ compress 行数据面（turn 关联、tokens_after=NULL 待 T3 懒回填）+ 摘要 tokens 计回合累计（quota.py 零改动）；阈值 7000 与 K=2/R=5/30s 入 config（.env 可覆盖），摘要 prompt R2 定稿逐字常量；session_id 加法列为实现级偏离已登记 verify。测试：pytest 239→255（+16，test_compact 覆盖 REQ-039 验收 1~6 逐条 + 30 轮机器读数 ≤7000 + 关键事实问答），vitest 324→325（+1，PUT 载荷零摘要字段），既有用例仅 1 处迁移版本位断言 8→9（映射已登记），ruff clean。
- **T3 手动压缩 + admin 压缩卡与全局回归收口完成**（2026-08-20）：POST /api/chat/compact 端点（design §5.1 四语义逐字：200 compacted / 200 skipped too_short / 409 session_generating / 502·504 compact_failed + 404 归属隔离 + 422 corrupted 双保险；不计回合、usage_daily 零写入、tokens 仅落遥测）+ 侧栏「···」菜单加法项「压缩上下文」（导出后/danger 分隔前，DropdownMenu 零组件改动）+ 执行中 pill（primary 族 10px spinner）与四终态 toast 逐字（C5~C8；成功不带数字 / 409 服务端 message 直呈）+ tokens_after 懒回填（该会话下一次 step=1 usage 独立短连接回填，失败不阻塞不补造；REQ-041 验收 1 完整一致性断言补齐）+ GET /api/admin/telemetry 加法 compact 键（次数/降幅/measured/缺失 null；成本口径演进计入 unified compress 行 tokens_prompt×input 单价，既有形状零变化）+ AdminView 卡 E 上下文压缩（双卡区与卡 D 之间全宽，正常/缺失/空三态，C9~C16 逐字，零新增令牌）。数据面 client.ts/sessions.ts 零改动。测试：pytest 255→282（+27：test_compact_api 18 + test_admin_compact 9），vitest 325→345（+20：TheSidebarCompact 6 + AdminCompactCard 9 + SessionListItem 加法 5），既有 3 处改写映射登记（30 轮 tokens_after 断言演进 / telemetry 顶层形状加法 / 菜单项索引平移），ruff clean + guard:style + 生产构建。走查：scripts/e2e-walkthrough-16.mjs 真实 Chrome + 真实后端（真实 DeepSeek 摘要调用，key 经进程环境注入）**70 PASS / 0 FAIL**（design §7.2 全 44 条逐条留档 plans/iter-16-verify.md T3 段：亮/暗双主题、执行中/失败/无需压缩/缺失四态全实测，10 帧截图 /tmp/e2e16/shots/；真实回合摘要注入关键事实可答 + 懒回填机器读数一致性实证）；三轮脚本自迭代 FAIL 全为脚本断言问题，零产品缺陷。


**iter-16 全量 review（459a065..7a15155 代码面；2026-08-20 产出，待 CEO 过目）**

范围：代码面 2 笔提交（e055e03 T2 + 7a15155 T3）/ 19+ 文件 / 约 +3100 行。pytest 282 + vitest 345 实测复跑全绿 + 走查 70 PASS/0 FAIL 复跑（均为 QA 阶段主会话亲跑，结论复用不重跑）。

**三问结论**：
1. **有无偷换需求范围**：无。REQ-039 验收 1~7 / REQ-040 1~5 / REQ-041 1~5 逐条映射实现与用例；CHG-010 九定夺逐条核对执行；实现级加法一处（telemetry session_id 列，OBS-3 登记在案）+ T3 七项最小改动决策点（verify §7 登记），无未批准新增。
2. **有无明显隐患**：无 NCR 级。八项重点核过——SQL 全参数绑定（压缩/遥测/回填三模块逐处）；404 不泄露归属；key 零日志零落库零响应；摘要注入字面包裹；409 进程内登记 finally 全路径清理（无泄漏死锁）；懒回填幂等单列 UPDATE（WAL 并发安全）；摘要 tokens 计入回合 usage（quota 路径零改动）；LWW/会话档零交互（产物独立表，前后比对测试背书）。
3. **测试是否真实覆盖**：真实。三套全绿均主会话复跑；断言抽查零空转（snip 占位逐字/挂载位置逐条/30 轮机器读数/懒回填真实采集 963==963/聚合 round6 精确值/缺失态变异断言）；改写映射 4 处登记，功能性删除为零。

**非阻塞已知取舍留档**（4 条，量级低）：①409 进程内状态重启即失（重启窗口判定失效，用户走失败 toast 路径可接受）②阈值交替形态（压缩回合回基线、下回合再触发——CHG-010 定死设计行为，走查已见节奏；如需「压缩粘性」另走 CHG）③摘要输入单工具结果 1000 字符截断（体量护栏，较 T0 冒烟更保守）④聚合 fetchall 内存面（单公司流量无压力，iter-15 同取舍延续）。

**总评**：代码面与批准口径逐字对齐，压缩管道降级方向恒为基线组装（每步回归锚点成立）；范围零越界、测试零空转、卫生面贯彻铁律 5。NCR 级缺陷：无。

> CEO 过目结论：**认可**（2026-08-20——无异议；4 条非阻塞已知取舍留档接受：409 重启即失 / 阈值交替形态 / 摘要输入截断护栏 / fetchall 内存面），进入 G4 复盘。

- **iter-16 关闭（G4 过，2026-08-20）**：QA 审计有条件通过 1 NCR（台账滞后）当轮整改 + 4 OBS 处置闭环（OBS-1 主会话代审计经 CEO 接受——qa 员工 API 配额 429 中断，重置 2026-08-26）；复盘四问认可，改进 A/B 落制度 v1.4.15（①设计基线为全部开发任务前置严格串行 ②跨仓动作后回源勾验承诺清单）、C 入池；容量 Σ8 vs Σ8 连续十一轮零偏差；基线 v7 全量达成（回归基线后端 282 + 前端 345 + 走查 70/0 均主会话亲跑复验）；见 retros/iter-16.md。

## iter-17（C 五层记忆体系，2026-08-20 CHG-011 批准 + 计划批准 + T0 交付；Σ10 = S1+M2+L4+M3 顶格）

- **变更与基线**：CHG-011 批准出基线 req-baseline-v8（71fef1a + tag，CEO「全部按推荐批准」）——C 五层记忆体系：REQ-042 用户长期记忆（P0：迁移 v10 user_memories/memory_jobs + users.memory_enabled；服务端常驻静默窗口异步抽取〔落库+重启恢复〕；五层注入序组装〔记忆注入动态尾区之后、摘要之前〕；抽取不计回合 tokens 仅落遥测）/ REQ-043 记忆管理 UI（P1：设置弹窗第六分区「AI 的记忆」，design-iter-17 待基线）；REQ-044 按定夺⑩不立项（遥测落行并入 REQ-042、admin 可见性入池）；REQ-002/008/028/036 改写 + 非功能三行 + 波及 5 项 + 零波及明示 5 项；十定夺全按推荐定案。取证特别事实：用户 systemPrompt（五层第 4 层）现状 = 前端 localStorage + 随回合上传、服务端零持久化（多设备不一致为已知边界，迁云端需另立 CHG，呈批时 CEO 已知悉）；审核稿「迁移 v7」更正为迁移 v10（v7~v9 已占用）。
- **计划**：Σ10 顶格（CEO 定夺）——T0 取证（S）+ T1 design-iter-17 基线（M，v1.4.15 串行前置）+ T2 后端核心（L4：迁移 v10 + memory.py + 常驻扫描/重启恢复 + 注入组装 + 遥测行 + 记忆 API）+ T3 前端分区 + 全局回归 C 面收口（M3）。顶格理由三条在案（审核稿原定级 / 七期首个常驻后台任务基建 / 首个页级设置分区）；备砍序 a) 记忆页编辑降级查看+删除+停用 b) T0 取证收窄；REQ-042 管道核心为底线。无携带缺陷（DEF-001~036 全闭环核查）。
- **T0 前置取证完成**（2026-08-20，scripts/c_t0_smoke.py 新增，真实 DeepSeek 六次调用冒烟，逐字留档 plans/iter-17-verify.md T0 段）：
  - 抽取 prompt R1 一次定稿（无 R2）：质量九项全过——记忆点准确（身份/偏好/约定/处境如实收录）、一条一记忆点、冲突最新优先（杭州→上海、三人→五人小组）、重复合并（「简洁」重复提及未产生重复条目）、新增独立条目（无表情符号）、知识问答与一次性任务零残留（GIL/翻译/FastAPI 版本）、格式纪律稳定（完整新列表/序号行/无前缀）
  - **上限收紧定案（行使 CHG-011 内容 3.1 授权）**：50×200 字满载实测 6079 tokens 占 B2 阈值 7000 的 86.8%（实测异常）→ 收紧为 **30 条 × ≤150 字**，收紧后真满载实测 2909 tokens 占 41.6%（四点机器读数全留档）；抽取 prompt 与 spec/CHG 定夺⑤同步回填
  - 微参数定死（论证留档）：N=4 轮 / X=10 分钟静默 / 扫描间隔 60s；抽取超时沿用 summary_timeout 30s（冒烟三轮秒级返回实证保守可用）
  - 注入文案定稿：`<user_memory>` 字面包裹 + 说明行 + 编号条目（逐字断言面在案，REQ-043 注入预览同源取值）
  - 零产品代码改动、零 DEF；changes.md CHG-011 定夺②⑤精确值与落地清单回填（ca949e9）；下一步 T1 design-iter-17 设计基线
- **T1 design-iter-17 已基线**（2026-08-20，CEO 批准「批准，全部按推荐」，e4006e2 + tag design-iter-17）：设置弹窗第六分区「AI 的记忆」七态全形 + 记忆 API 四端点口径定案（PUT 来源归零语义 / 注入预览服务端单一链路零本地拼装 / 无 POST 手动新增为有意边界）+ 走查清单 34 条（A 组弹窗容器零回退映射 iter-11#37~45 / B 组分区新增 22 / C 组全局 3）+ 样件文案逐字 M1~M37；八项定夺全按推荐定案（布局/行内编辑 150 字计数/ConfirmModal 删除确认/停用灰显 .45+操作冻结/折叠代码块预览/来源+日期元信息不显模型/toast「下一回合生效」三态/编辑态不纳入未保存拦截守零回退）；零新增令牌零自造色值零新增组件形态；spec REQ-043 与 RTM 指针零滞后回填。**v1.4.15 串行前置满足，T2/T3 开发解锁。**
- **T2 后端记忆子系统核心 + 迁移 v10 完成**（2026-08-20）：app/memory.py 新模块（~430 行：EXTRACT_PROMPT/注入文案 T0 定稿常量、parse_extract_output、user_memories 读写与先删后插整体替换、五层注入序挂载、memory_jobs 任务面 + execute_job 抽取执行器〔call_summary system_prompt 参数化复用、attempts≤3 失败降级〕、scan_once 静默窗口扫描 + pending 恢复面、scan_loop 常驻循环）+ 迁移 v10（user_memories/memory_jobs/users.memory_enabled，审核稿「迁移 v7」更正注记）+ config 六参数（T0 定死值）+ telemetry record_memory_extract（kind 加法、turn_id/step 恒 NULL、endpoint='memory'）+ routers/memory.py 四端点（归属隔离 404 / PUT 来源归零 / 注入预览单一链路 / settings 注册序在 /{id} 前）+ proxy chat_turn 组装后注入 + main lifespan 常驻任务挂载。测试：pytest 282→312（+30：test_memory 18 + test_memory_api 12，REQ-042 验收 1~7 + REQ-043 验收 5 逐条承载），既有仅 1 处演进（迁移版本位断言 9→10，映射登记）；vitest 345 零改动全绿；ruff clean；quota.py 与 usage_daily 零改动（定夺③双轨）。实现级决策点 5 项登记 verify T2 §3（含 watermark 两段语义与 lifespan 局部任务引用两处开发中实测修正）。
- **T3 前端记忆分区 + 全局回归 C 面收口完成**（2026-08-21）：MemoryPane.vue 七态自含组件（加载失败重试/列表元信息三分支/行内编辑 150 字/删除确认/停用灰显冻结/注入预览单一链路逐字/空态）+ SettingsForm TABS 第六分区加法（对话设置后账号前）+ Esc 链加法插入点 + backend.ts 四端点方法；回合数据面 client.ts/sessions.ts 零改动（REQ-042 验收 6 锚点）。测试：vitest 345→364（+19 MemoryPane.spec 纯新，七态 + toast M30~M36 逐字 + 预览同源 + 零乐观更新），改写映射 2 处登记（settings-form 六分区演进）；vue-tsc clean + guard:style + 生产构建。走查：scripts/e2e-walkthrough-17.mjs 真实 Chrome + 真实后端（/tmp 独立库，key 仅进程环境注入）**34 PASS / 0 FAIL**（design §7.2 全清单承载划分：浏览器 32 断言点 + pytest/vitest 交叉引用；8 帧截图 /tmp/e2e17/shots）。走查首轮发现 DEF-037（Esc 双重消费连带关弹窗）当轮修复登记（移除 textarea 本地监听，Esc 统一走遮罩层单一消费点）。全局回归 C 面收口：pytest 312 + vitest 364 + 走查 34/0 全绿、功能性删除为零。**iter-17 T0~T3 全交付，待 QA 审计 → Code Review → G4 复盘。**

**iter-17 全量 review（e4006e2..c10f8fb 代码面 = 40d0154 T2 + c10f8fb T3；2026-08-21 产出，待 CEO 过目）**

范围：代码面 2 笔提交 / 20+ 文件 / 约 +3150 行（backend/app/memory.py ~430 行新模块 + routers/memory.py + 迁移 v10 + telemetry 加法 + proxy/main 接线；前端 MemoryPane.vue ~450 行 + SettingsForm TABS/Esc 链 + backend.ts 加法）。pytest 312 + vitest 364 实测复跑全绿 + 走查 34 PASS/0 FAIL 复跑（QA 阶段主会话亲跑，结论复用不重跑）。

**三问结论**：
1. **有无偷换需求范围**：无。REQ-042 验收 1~7 / REQ-043 验收 1~5 逐条映射实现与用例（verify T2 §2/T3 §2）；CHG-011 十定夺逐条核对执行（③双轨：quota.py 与 usage_daily diff=0 实证；④注入序：挂载位 2/1 确定性断言；⑤收紧后上限 30×150 落 config/prompt/spec 三处一致；⑨预览单一链路：前端零拼装断言）；实现级加法 5 项全部登记在案（verify T2 §3：watermark 两段语义/lifespan 局部引用/settings 注入/注册序/done 增量判定），无未批准新增；REQ-044 按定夺⑩未实现（admin 抽取卡零代码，有意边界）。
2. **有无明显隐患**：无 NCR 级。八项重点核过——①SQL 全参数绑定（memory.py/routers/memory.py f-string 构造 SQL 扫描零命中）②记忆内容渲染无 v-html（Vue 插值自动转义，抽取产物含用户对话内容——注入防护由 `<user_memory>` 包裹 + system 级消息位承载，XSS 面由转义承载）③key 卫生：memory 模块 api_key 仅经 _resolve_upstream_for_user 传上游调用，日志面零 key（warning 仅 user_id/session_id/status）④并发：常驻扫描任务与回合主路径各自独立连接（WAL 串行安全），抽取读会话档快照、回合不读 memory_jobs（零交互语义有断言）⑤重启恢复：pending 持久化唯一权威 + 在途调用丢失 attempts 不计（口径与 spec 逐字一致）⑥Esc 链单一消费点（DEF-037 修复后 textarea 无本地监听，走查条 20 复验）⑦停用态双保险（按钮 disabled + startEdit 守卫）⑧路由注册序 /settings 先于 /{id}（形状冲突面消除）。
3. **测试是否真实覆盖**：真实。三套全绿均主会话复跑；断言抽查零空转（注入挂载位逐条/预览 = injection_preview 逐字同源/停用零回退逐字段/重启恢复 pending 拾起/归属隔离 404/元信息三分支正则全量/暗色 computed 令牌）；改写映射 3 处登记（settings-form 六分区 ×2 + test_search 版本位），功能性删除为零。

**非阻塞已知取舍留档**（5 条，量级低）：①scan_once 每轮全量扫描 chat_sessions（单部署流量规模下成本可忽略；规模化再议索引/增量面）②memory_jobs 每会话至多一份在案任务（PK 覆盖更新——重触发即重置 attempts，长会话高频触发下失败计数非严格累计，可接受：上限语义为「单轮连续失败」）③写操作后整分区重取 GET（零乐观更新的代价是一次额外往返；分区数据量小，可接受）④预览折叠态跨分区切换保持（previewOpen 不重置；无害且符合用户预期）⑤memory_extract 成本未入 admin 聚合（定夺⑩不立项，遥测行已在、可查，聚合可见性入暂缓池）。

**总评**：代码面与批准口径逐字对齐，降级方向恒为现状（抽取失败/停用/无记忆三态均回基线组装）；范围零越界、测试零空转、卫生面贯彻铁律 5。NCR 级缺陷：无。

## iter-18（D1 deep-research 子代理 + SSE 心跳，2026-08-21 CHG-012 批准 + 计划批准 + T0~T3 全交付；Σ9 = S1+M2+L4+M2 不顶格）

- **变更与基线**：CHG-012 批准出基线 req-baseline-v9（9aefb9f + tag，CEO「批准」= 整体批准 + 十定夺全按推荐）——D1：REQ-045 SSE 心跳与长回合连接保持（P0）/ REQ-046 deep-research 模式与 coordinator 编排（P0，受控 ReAct 变体 + 步数 16/时长 900s 双护栏 + 1 发起 = 1 回合 + endpoint='research' 遥测 + 报告 ≤3000 字）/ REQ-047 前端入口与进度报告呈现（P1，design-iter-18 待基线）；编号自 045 起不复用 044（永久留予 CHG-011 记忆度量拟稿）；REQ-030/036 正式改写 + 非功能两行 + 波及 9 项 + 零波及明示 8 项；十定夺全按推荐（④心跳 SSE 注释帧 20s 全回合生效〔审核稿点名必夺项关闭〕⑤1 发起 = 1 回合 ⑥16 步 + 900s T0 校准 ⑦输入框开关 + mode 字段 ⑧三与门承载 ⑨≤3000 字引用复用 ⑩断连沿现行取消）；推荐方案零新表零迁移。
- **计划**：Σ9 不顶格（CEO「全部批准」+ research.phase 维持不提案按推荐）——T0 取证（S）+ T1 design-iter-18 基线（M，v1.4.15 串行前置）+ T2 后端核心（L4：心跳 + mode 门控 + research.py + run_turn 参数化 + 六层注入 + 双护栏 + 遥测 + quota 端点）+ T3 前端（M2：开关三态 + 载荷 + time_limit 标注 + D1 面收口）。备砍序 a) T3 收窄 b) research.phase 不提案（默认）c) 心跳收窄（不推荐）；REQ-046 编排核心与 REQ-045 心跳为底线。
- **T0 前置取证完成**（2026-08-21，385aa3b）：research 指令 prompt R2 定稿（真实 DeepSeek + stub search 冒烟，方法论四项全过——计划分点/逐子问题检索/结论先行分点/字数纪律方向正确；模型识破 stub 占位数据并拒绝编造引用 = REQ-035 品格取证；真 Tavily 三项随测登记〔[n] 对应/字数精确/结果质量，key 就绪后〕）；nginx 反代三组实测（默认 60s 配置静默流 60.0s 断连坐实 / 20s 心跳 100s 完整存活坐实 / 部署现状 300s 配置 120s 静默安全——心跳 20s 定档定案；部署配置 300s 发现，心跳价值口径修正为「不依赖部署配置的鲁棒性」）；护栏初校（实测 3~5 步/22~27s/6.2k~14.6k tokens，16 步+900s 维持授权内零调整）。
- **T1 design-iter-18 已基线**（2026-08-21，CEO「批准，全部按推荐」，2a0c4c4 + tag design-iter-18）：composer 信息行左端 ToggleSwitch 复用（零新增形态第三处消费）+ 随态标签 + 发送即复位（含 HTTP 失败）+ 禁用不隐藏 + time_limit 文案 M43「已到研究时长上限」+ 进度/报告零新增渲染面（research.phase 不画不提）+ research_available = quota 端点加法 bool（前端保守禁用 + 后端 422 两级防线）；六定夺全按推荐；走查 31 条 + 样件 M38~M43 逐字；零新增令牌。
- **T2 后端核心完成**（2026-08-21，36255a1）：research.py 薄模块（R2 逐字常量 + ResearchProfile + inject_instruction 六层注入序）+ agent.py run_turn 参数化（单实现优先，未薄复制）+ proxy.py mode Literal 校验 + _tool_gates() 共享判定三与门 422 research_unavailable（先于计费）+ 双护栏（步数 max_steps / 时长 turn.end reason='time_limit' 加法）+ 心跳单生成器事件等待超时补帧（: ping 20s 兜底全回合生效）+ 遥测 endpoint='research' + GET /api/quota 加法 research_available。quota.py/db.py/tools.py/telemetry.py 零改动。测试 pytest 312→332（+20 test_research，REQ-045 验收 1~3 + REQ-046 验收 1~8 逐条承载），改写 1 处（test_quota 补字段）+ REQ-030 事件序断言零改写（注释帧天然排除）；主会话亲跑核验采信。
- **T3 前端 + 走查完成**（2026-08-21，da073de 代码 + d443eaa 走查脚本）：ComposerBox 开关三态（M38~M42 逐字 + 发送即复位 + 禁用不隐藏）+ client.ts mode 加法参数（缺省零变化）+ sessions timeLimit 定型 + MessageBubble M43 pill（沿 maxSteps 体例互斥）+ quota store research_available（=== true 保守禁用 + 422 主动 refresh）。测试 vitest 364→378（+14 纯新增，零既有改写）；vue-tsc 0 + guard:style + 构建；主会话亲跑四门槛核验采信（T3 agent 因 API 402 中断，代码实际完整核验后采信非口头）。走查 scripts/e2e-walkthrough-18.mjs 真实 Chrome + 真实后端 + 真 Tavily **41 PASS / 1 FAIL → DEF-038 改规格处置后 0 FAIL**（research 端到端 5 搜索/25 真实来源/报告 2705 字/[n] 引用 + time_limit M43 小值注入真实触发 + 禁用态真实空 key 后端；真 Tavily 随测三连 PASS）；9 帧截图 /tmp/e2e18/shots。DEF-038（条 11 Tab 序规格矛盾）CEO 定夺「改规格对齐 DOM」处置（21362fd，design R1 + index.html + 走查脚本断言同步，实现零改动）。**iter-18 T0~T3 全交付，待 QA 审计 → Code Review → G4 复盘。**

**iter-18 全量 review（36255a1..c6d473a 代码面 = T2 后端 + T3 前端 + 走查脚本；2026-08-21 产出，待 CEO 过目）**

范围：代码面 3 笔提交 / 10+ 文件 / 约 +1200 行（backend/app/research.py 新模块 + agent.py run_turn 参数化 + proxy.py mode 门控/心跳/quota 端点 + config 3 参数 + test_research 20 例；前端 ComposerBox 开关 + quota store 新增 + client/sessions/MessageBubble 加法 + 4 spec +14 例；走查脚本三后端两前端）。Sanity check：pytest 332 + vitest 378 亲跑全绿，与 verify/QA 登记一致；R2 逐字性三方一致（源码常量/verify 定稿/测试独立转录，含长度锚点）。

**三问结论**：
1. **有无偷换需求范围**：无。REQ-045 验收 1~4 / REQ-046 验收 1~8 / REQ-047 验收 1~6 逐条映射实现与用例；CHG-012 十定夺逐条核对（④心跳全回合生效——stream() 连接层 mode 无关；⑤1 发起 = 1 回合、quota.py 零改动、usage_daily 精确 tuple (1,1,1500) 实证；⑥config 默认值即 T0 定死值；⑧三与门真同源——_tool_gates() 单函数三处消费（research 门控/search 下发/quota 端点），无第二判定路径；⑨research.phase 未加、TurnEndReason 仅加 time_limit；⑩断连沿现行取消无后台续跑）。零新表零迁移零新端点零新事件类型零新组件形态，无未批准新增。
2. **有无明显隐患**：无 NCR 级。八面核过——①心跳单生成器「事件等待超时补帧」实现正确（超时补帧后 next_ev 保留复用无事件丢失；断连清理链完整 CancelledError→next_ev.cancel→agen.aclose→run_turn 既有 finally，无孤儿任务；「watchdog 异常不杀流」由构造消除——无独立协程，与改造前 async for 语义一致非回归）②run_turn research=None 逐字节等价（三处时限检查 total_deadline is None 短路、capped_by_total 恒 False，312 存量例全绿佐证）；判因三处边界正确（到顶已产出保留、未完成调用不计 calls/tokens，流中到顶断言 requests=0/tokens=0、llm 行 error_code='time_limit' 如实编码）③mode 门控 422 位于配额计费**之前**（proxy.py L209 先于 L215）——拒绝零上游零计费，无滥用绕过面④research 指令跨请求字节恒定不含用户输入、用户内容恒 user role、六层注入序逐分支推演（含无人设/有摘要分支）+ 记忆预置用例实测锚定；搜索结果回填沿既有 wrap_for_context 包裹，零新增注入面⑤key 卫生三面真检索（原始字节流/telemetry JSON/指令常量）零命中⑥前端零新增 v-html、M38~M43 本地常量、research_available 双处严格判定（=== true / !== true，catch 降级 false）⑦research.py 零 DB 访问、_tool_gates 复用既有 SELECT/KV 读、零新查询面⑧time_limit 三路径均收敛 turn.end('time_limit') + finally 清理，走查条 22 真后端网络级验证。
3. **测试是否真实覆盖**：真实。三层断言抽查零空转——test_research 帧级逐帧（13 事件 type 序 + 精确 dict + sources len==5）、计费真数值、门控三分支真 422 零上游（handler AssertionError 双保险 + content-type 非 SSE）、卫生真检索；前端 +14 例载荷形状 toEqual/复位/翻转/互斥；走查 41 断言抽查 4 条全实质（几何 rgb 实值/boundingClientRect/真 6s 注入 time_limit 网络级/报告字数真计算）。断连取消 TestClient 限制的适配已登记 verify 决策 5（同一 CancelledError 传播路径等价面）。

**非阻塞已知取舍留档**（5 条，量级低）：①REQ-045 验收 4「走查脚本一条」未以 nginx 形态复测——T0 §2 实证（默认 60s + 心跳 100s 存活）证据力更强，verify 已登记不重复，部署形态变更时可补②总时长护栏不抢占在途工具（检查在工具前）——回合总时长 soft 上界 ≈ 900s + 单工具超时，有界且与「无孤儿不强杀」哲学自洽③time_limit pill 无独立 vitest——数据源标志（sessions.spec）+ 走查条 22 双断言，沿 maxSteps pill 同体例④流中 time_limit 遥测编码 status='timeout' + error_code='time_limit'——admin 聚合计入 timeout 类目而非独立类目，error_code 可查⑤research_available 不含「上游可解析」项——与 CHG-012 三与门定义逐字一致，503 既有分支兜底。

**总评**：实现与 CHG-012/REQ-045~047/design-iter-18 逐条对得上，无范围偷换；心跳与双护栏的实现级决策与 verify 登记一致且推演成立；测试三层断言真实、亲跑全绿。NCR 级缺陷：无。

## iter-19（D2 生命周期事件 hooks 收官，2026-08-22 CHG-013 批准 + 计划批准 + T0~T2 全交付；Σ4 = S1+M2+余量 1 不顶格）

- **变更与基线**：CHG-013 批准出基线 req-baseline-v10（7efb04f + tag，CEO「全部按推荐」= 整体批准 + 八定夺全按推荐）——D2 收官期：REQ-048 生命周期事件 hooks（P0，单条承载：闭合 5 事件 turn.accepted/tool.before/tool.after/turn.end/turn.cancelled；fire-and-forget 旁路 + hook_timeout 5s + 只观察不决策 + 元数据-only 载荷；部署者级代码静态注册 + .env 两参数，admin 运行时零新增；零新表零迁移零 UI）；存量正式改写 0 条（明示）+ REQ-030 波及注记 + 非功能两行 + 零波及明示 8 项；关键定夺⑦**移动端不搭班**（独立 CHG-014 + iter-20）/ ⑧Σ4~5 推荐 Σ4 + T0 技术基线承担串行「基线先行」职能；暂缓池 D2 移出 + 三条新增（webhook / 拦截改写与载荷扩展 / 子系统事件）；期间清理 iter-18 周报门禁 dry-run 探针残留三文件。
- **计划**：Σ4 不顶格（CEO「批准」）——T0 前置取证与技术基线（S1）+ T1 无（零 UI 无设计任务）+ T2 后端实现 + D2 面收口（M 下沿 2）；T0→T2 严格串行；备砍序三项（底线 = tool 前后 + turn.end + 旁路分发 + 故障隔离）；无携带缺陷（DEF-001~038 全闭环）。
- **T0 技术基线完成**（2026-08-22，0444fbb）：asyncio 分发语义五组实测定案（Python 3.12.14——强引用集合必设〔官方口径，实测挂起 future 链存活但不可依赖〕/ wait_for 超时护栏对吞取消坏公民 hook 亦有界 / fire-and-forget 异常 unretrieved 告警实测复现 → done_callback 消费必设 / 引用集合零累积）+ 五事件点位亲读核对与 CHG-013 3.1 全一致（agent L458/466/493/494-503 + proxy L232；turn.cancelled 同步 create_task 不引入新 await 点）+ hook_timeout 定档 5.0s（授权内维持）+ dispatcher 定案模块级单例直接调用；留档 plans/iter-19-verify.md T0 段；零产品代码改动。
- **T2 后端实现 + D2 面收口完成**（2026-08-22，本批提交）：app/hooks.py 薄模块（5 事件枚举 + HookEvent 元数据-only 载荷 + register_hook 静态注册 + dispatch fire-and-forget〔强引用集合 + wait_for 护栏 + 异常吞 warning + done_callback 消费〕）+ agent.py run_turn 埋点 4 处 + proxy.py chat_turn 埋点 1 处（turn.accepted 受理成立点，被拒回合零事件）+ config +2 参数（hooks_enabled 默认开 / hook_timeout 5.0s）+ main.py 注册示例注释；实现级决策 5 项登记 verify T2-2（run_turn user_id 加法形参 / mode = chat|research / UTC ISO8601 毫秒 / 全局 get_settings / warning 文案）。db.py/telemetry.py/quota.py/前端零改动，零新表零迁移零新 SSE 帧类型。REQ-048 验收 1~8 逐条 ✅（tests/test_hooks.py 15 用例）；pytest 332→347 全绿（+15 纯新增，**改写映射为零**——既有测试文件零改动；开发中插曲：首轮 6 例失败系 test_hooks 临时工具注册表污染〔测试卫生〕，finally 清理后全绿，非产品缺陷）+ ruff clean + 前端 vitest 378/378 复跑背书（零触达）；周报节落 W34（PM 计划 W35 为周次偏差，verify T2-4 登记修正）。**iter-19 T0~T2 全交付，待 QA 审计 → Code Review → G4 复盘；七期路线 A1~D2 全部落地。**

**iter-19 全量 review（0444fbb..c98aa6b 代码面 = hooks.py + 埋点 + config + test_hooks；2026-08-22 产出，CEO 过目认可）**

范围：代码面 1 笔提交 / 6 代码文件 / 约 +570 行（hooks.py 新模块 127 行 + agent.py 埋点 4 处与 user_id 形参 + proxy.py 埋点 1 处 + config 2 参数 + main.py 注册示例 + test_hooks 15 用例）。Sanity check：复跑 15/15 + 全量 347/347 + ruff clean，与 verify/QA 登记逐字一致；改写映射为零属实（diff 触及测试文件仅纯新增 test_hooks.py）。

**三问结论**：
1. **有无偷换需求范围**：无。全代码 grep 实证恰好 5 发射点 5 事件常量（无私自增删）；fire-and-forget 四不逐条核清；只观察不决策（hook 返回值全代码无消费路径）；载荷元数据-only 为**结构性强制**（HookEvent 13 字段与 CHG-013 3.2 字段表逐字段对齐，消息正文/工具结果/key 无容身位，未知字段 TypeError）；被拒回合 4 拒绝分支全在埋点之前；research 唯一分支 = mode 字符串零行为分叉；零新表零迁移零前端零新 SSE 帧四零改动面 diff 实证。
2. **有无明显隐患**：无阻塞级。共享态（frozen dataclass + 注册表 import 期写运行期只读 + 单 loop 任务集合）无并发可变面；跨 loop 残留无泄漏路径（存量 332 用例注册表恒空短路）；**两处 asyncio 语义疑点以本机探针独立实证**——① 生成器悬停 yield 点被 aclose（代理层真实路径）时 yield 后埋点不执行直入取消处理器（工具未执行则 tool.before 合理缺席、turn.cancelled 照常触发，与设计预期自洽）；② 断连两注入路径（CancelledError await 点 / GeneratorExit aclose）收敛于同一 except handler 等价成立。进程关停截断在途任务属 spec 已登记尽力而为边界；_drain 已防 cancelled 任务 exception()；hook_timeout 读 lru_cache 与全部既有 Settings 参数同语义（部署级重启生效）。
3. **测试是否真实覆盖**：真实。无弱断言（精确序列 == / 数值断言 / strip turn_id 后逐帧 dict 相等）；卫生探针三标记串真实进入请求后全量检索（载荷 dump + caplog 双面）；超时护栏断言 10 倍余量（CI 慢机风险低）；QA OBS-1 research 带工具缺位的承接链评估成立（mode 由 _hook_mode 闭包单点定值，工具与终态事件共用同一闭包，research 携带 mode='research' 由结构保证）。

**非阻塞已知取舍留档**（5 条，量级低/极低）：①emit 载荷组装 TypeError 不吞（hooks.py 无 try 包裹）——对 spec「载荷组装异常等同分发失败」为字面偏离，设计意图 = 开发期暴露埋点笔误（verify T2-1 已登记；五埋点全被用例覆盖首跑即炸 CI）；若收口 dispatch 外包 except→warning 三行闭合②无 running loop 终局 create_task RuntimeError 不吞（与 _emit 全吞不对称）——生产拓扑不可达（生成器终局恒经活 loop 内 aclose）③终帧竞态：断连落在「turn.end 已送达 → anext 重挂」亚毫秒窗 → hook 侧得 turn.cancelled 而非 turn.end——observe-only 无行为危害，埋点定点选择的固有边界④user_id 类型注解不一致（emit 形参 str|None / HookEvent int|str|None / 实传 int）——注解 looseness 化妆品级⑤QA OBS-1 research 带工具用例缺位（同项，结构保证 + 后续顺手补）。

**总评**：无 NCR 级缺陷。三问全过（范围逐条对得上、asyncio 两疑点探针实证、测试断言实质）；实现忠实于 T0 技术基线（强引用集合、done_callback 消费、坏公民护栏有界三设计决策在代码与测试均可指认）。放行。

**iter-19 G4 关闭（2026-08-22）**：QA 审计有条件通过（1 NCR = CHG-013 落地核对清单第 7 项漏勾，CEO 定夺当轮整改 39eea7f；3 OBS 按建议处置）+ 主会话补证 7 项全过 + Code Review 无 NCR 级缺陷 CEO 认可落痕（51a6245）+ 复盘四问认可（改进 A/B 落制度 **v1.4.18**：A 提交防漏核对扩「CHG 落地核对清单回填」——治 NCR-iter19-001 台账滞后第 6 代、CHG 清单本体为最后盲区收口；B planning 计划头部自检「当周 ISO 周核实」——治 OBS-3 周次错，iter-19.md 周次行同批更正）；容量 Σ4 vs Σ4 连续十四轮零偏差（不顶格第三例正面证据）；基线 v10 全量达成（REQ-048）；**七期路线 A1→A2→B1→B2→C→D1→D2 全部收官**；下一候选移动端主界面适配（独立 CHG-014 + iter-20，设计基线前置）；见 retros/iter-19.md。（本段为 iter-19 节末「待 QA 审计 → Code Review → G4 复盘」的收口更新，NCR-iter17-002 同型防复发口径）

## iter-20（移动端主界面适配，2026-08-22 CHG-014 批准 + T1~T3 全交付；Σ6 = M×3 不顶格）

- **变更与基线**：CHG-014 批准出基线 req-baseline-v11（CEO「全部按照推荐」= 整体批准 + 八定夺全按推荐）——REQ-049 主对话面适配 / REQ-050 设置弹窗全屏化 / REQ-051 触摸交互；纯前端迭代（后端零改动零迁移零新 API）；管理后台不纳入（定夺⑤桌面优先）。
- **T1 design-iter-20 已基线**（2026-08-22，CEO「批准，全部按推荐」六定夺：①≤768px 移动顶条 48px + 44×44 汉堡钮 M44 ②抽屉 264px 原样平移（<330px min(80vw,264px)）③动画 .15s ease ④触屏闲置 Enter hint 不渲染 ⑤弹窗导航横向滚动条 ⑥发送钮 ≤480px 视觉 44、icon 钮热区扩 44 视觉不变）；走查清单 31 条 + 样件 M44~M45 逐字；零新增令牌；spec REQ-049/050/051「涉及页面」指针随基线回填。
- **T2 主对话面 + 触摸交互完成**（2026-08-22，34636f0 已推送）：首步 spike 定案（useMediaQuery composable——CSS 同源带界判定 + jsdom 兜底桌面口径；焦点细则留走查定夺）+ App.vue 抽屉/遮罩/移动顶条（M44）+ TheSidebar fixed overlay 平移与 rail 抑制 + MessageBubble/SessionListItem hover:none 常显与热区 + ComposerBox 44px 发送钮与 hint/placeholder 触控口径（M45）；vitest 378→399（+21，既有零改动）；verify T2 段登记五项 spike 决策。
- **T3 设置弹窗全屏化 + 断点走查 + 全局回归收口完成**（2026-08-22，本批提交）：首步冒烟既有 settings 43 用例全绿零改写（容器耦合风险证伪）；SettingsForm ≤480px 全屏态（inset 0 = 100vw×100vh + 导航横向滚动条〔定夺⑤〕+ 单滚动 + 二级弹窗〔档案编辑/ConfirmModal/DeleteAccountModal〕同口径全屏；弹窗逻辑零改动、桌面 720px 分栏零触碰）+ locateAdv 挂载路径 flash 丢失顺带修正（watch 注册序）+ showPane scrollIntoView（验收 6）；vitest 399→411（+12 SettingsMobileCssContract）；走查 scripts/e2e-walkthrough-20.mjs 真实 Chrome + 真实后端 **38 PASS / 0 FAIL**（design §7.2 全 31 条：768/480 双断点 × 亮暗四象限 + 桌面零回退 E 组 + 像素级几何〔抽屉 264/256、inset 0、热区 hit-test〕+ M44/M45 逐字；触屏态 = isMobile+hasTouch 设备仿真——CDP hover 特性本机 Chrome 已不生效，登记 verify）；截图 10 帧 /tmp/e2e20/shots。
- **DEF-039 当轮发现当轮修复**：T2 触屏热区 `::after` inset 方向写反（calc((44px-100%)/2) 向内收缩为 12×12 而非扩 44）——真实 Chrome hit-test 捕获，三处改 calc((100%-44px)/2) + 契约 spec 同步 + 走查条 25 复验 PASS（桌面零影响）。
- **全局回归收口**：后端 pytest 347/347 复跑背书（零后端改动）+ 前端 vitest 411/411 + guard:style + 生产构建全绿；既有用例改写映射为零；RTM REQ-049/050/051 三行 + 全局回归基线移动端面行同批收口。**iter-20 T1~T3 全交付，待 QA 审计 → Code Review → G4 复盘。**
