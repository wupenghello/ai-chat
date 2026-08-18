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
