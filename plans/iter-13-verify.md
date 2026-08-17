# iter-13 验证留档（T1 段）

> T0（design-iter-13 基线）见 design/iter-13/；本文件登记 T1 后端交付的验证证据与口径登记。T2 前端交付后补 T2 段与全链路走查。

## T1 后端 agent 运行时（2026-08-17 实现并验证）

### 1. 交付范围（对照 plans/iter-13.md T1 行）

| 项 | 落点 |
|---|---|
| ① 消息级模型 + v1/v2 归一化 + 服务端组装器 | `backend/app/agent.py`（wire_messages_from_doc / assemble_context；B2 预留：组装器单点收敛） |
| ② 工具网关六项校验 + 安全日志四字段 | `backend/app/tools.py`（execute_tool 校验链；_log：name/status/duration_ms/truncated） |
| ③ ReAct 循环三护栏 | `backend/app/agent.py` run_turn（步数/单步超时/断连取消） |
| ④ SSE 解析重组模块 | `backend/app/agent.py` UpstreamCall.stream（帧切分 + tool_calls 分片按 index 重组 + usage 旁路） |
| ⑤ 回合端点 | `backend/app/routers/proxy.py` POST /api/chat/turn（定夺⑦独立端点） |
| ⑥ 配额回合化（迁移 v6） | `backend/app/db.py`（usage_daily.turns + profiles.tools_enabled）；`app/quota.py`（turns 随 requests 同步递增，SUM(requests) 口径对新旧数据恒等） |
| ⑦ schema:2 写侧守卫 409 | `backend/app/routers/sessions.py`（存量 v2 + 来件 v1 → 409 session_schema_conflict，存量逐字不动） |
| ⑧ 演示工具 | `backend/app/tools.py`（echo / demo_weather，无出网、仅 admin、单工具超时 2s） |
| ⑨ 自填档案「支持工具」开关 + 无工具模式组装 | profiles.tools_enabled（默认 1，定夺①；UI 随 A2） |
| ⑩ 旧 /api/chat 透传端点零改动保留 | proxy.py chat_completions 未动（既有 139 用例零回退复跑为证；1 请求 = 1 回合计同源） |
| 卫生项 DEF-028 核销 | `src/views/AdminView.vue` 调配额模态副文案 →「（每日对话回合数，部署配置默认值）」；plans/defects.md 状态 → 已销账（前端 254 复跑无回归） |

### 2. 测试证据

- **后端 pytest：139 → 182 全绿**（新增 43：`tests/test_agent_tools.py` 20 + `tests/test_turn.py` 23），ruff clean。
- **前端 vitest：254/254 全绿**（DEF-028 一行改动无回归）。
- **既有用例零改动**：test_quota/test_proxy/test_sessions 等 139 例原样通过（turns 列随 requests 同步递增保口径恒等；守卫为新增分支不改既有路径）。

### 3. CHG-007 验收条款对照（T1 覆盖面；全链路走查项留 T2）

| 验收条款 | 用例 |
|---|---|
| REQ-030-1 事件序逐帧断言 | test_两步工具回合_事件序逐帧（九事件序 + 单行 JSON 帧格式断言） |
| REQ-030-2 步数上限 | test_步数上限_第2步后截停_不悬挂（max_steps=2 注入；第 3 次上游调用不发起） |
| REQ-030-3 单步/单工具超时 | test_工具超时_该步取消_回合降级直答（timeout 结果回填、回合继续） |
| REQ-030-4 断连取消 | test_断连取消_上游连接关闭_无第二次调用（断开后 seen==1；回合计 1——定夺⑧） |
| REQ-030-5 错误映射复用 | test_上游错误_映射为error事件（401/403/429/5xx 参数化；十场景体系同文案） |
| REQ-030-6 演示工具端到端 | test_echo_演示工具_端到端 + 两步回合用例（demo_weather） |
| REQ-031-1 未注册工具 | run_turn 注册表查无 → error result（事件序用例覆盖路径；网关单测另有未注册串） |
| REQ-031-2 出网白名单/SSRF | test_出网白名单_*（非白名单/内网环回/缺主机名/零连接先后断言） |
| REQ-031-3 超限截断 | test_截断_超限追加标注（32 KiB 上限 + 标注 + 限内不标注） |
| REQ-031-4 参数校验 | test_参数校验_缺必填/类型/枚举/超长/未知参数/非合法_json |
| REQ-031-5 网关日志四字段 | tools._log 结构（name/status/duration_ms/truncated；不含结果全文与密钥） |
| REQ-033-1 组装等价 | test_组装等价_系统提示词首位加最近20轮（逐字段 == 期望；30 轮存量取最近 20 轮含本条——与旧 buildContext「最近 40 条+丢悬空 assistant」同结果） |
| REQ-033-2 30 轮窗口 | 同上（窗口边界断言）+ test_组装_库内已含本条消息_不重复追加（去重护栏） |
| REQ-033-4 工具回合窗口同构 | test_组装_工具回合窗口同构（v2 blocks 展开 + tool 消息注入包裹 + 不占轮） |
| REQ-034-1 第 6 回合拦截零上游 | test_配额_第6回合拦截_零上游调用（429 + seen 不增） |
| REQ-034-2 回合计与 tokens | test_回合计_tokens如实累计（3 调用 = 1 回合、tokens 3600 = 1200+1500+900、usage_daily (1,1,3600)） |
| REQ-034-3 截停计已发生值 | test_步数上限（usage requests=2 如实累计） |
| REQ-034-4 既有配额用例迁移 | 既有 test_quota 全绿（语义同构，零改动） |
| REQ-022 守卫双验收 | test_守卫_旧格式覆盖新格式_409且存量逐字不动 / test_守卫_带标记整档透传回写_200且保留 / test_守卫_v2覆v1与v1覆v1_照常保存 |
| 全局回归基线 | 182+254 全绿；功能性删除为零（既有用例零改动）；度量机器采集（pytest 断言/seen 取证） |

**留 T2/QA 的验收面**：REQ-032 前端侧（老会话零回退走查、schema:2 落档 vitest、工具步骤卡状态机走查、暗色双主题）；REQ-033-3 载荷形状 vitest；全链路真实 Chrome 走查 + design-iter-13 §7.2 清单。

### 4. 口径登记（T0 契约补注与后端拥有文案）

1. **请求体第三字段 `system_prompt`（可选）**：design-iter-13 §4.2 基线后补注——REQ-008 系统提示词存前端 localStorage，服务端组装需随回合上传；「无历史数组」口径不变（两必填字段 session_id/message + 一可选字段）。登记于本文件与 design 文档 §4.2 补注行。
2. **截断标注文案（后端拥有，前端原样渲染）**：`"\n[结果超长，已截断]"`（`app/tools.py` TRUNCATION_NOTE）——逐字断言面来源之一。
3. **工具错误原因串（后端拥有）**：缺少必填参数：{key} / 参数 {key} 类型应为 {type} / 参数 {key} 取值不在允许范围 / 参数 {key} 超过最大长度 N / 未知参数：{key} / arguments 非合法 JSON / 工具执行超时 / 工具执行异常：{类型名} / 未注册工具：{name} / 出网目标不在白名单 / 出网目标为内网/保留地址。
4. **409 detail.message（逐字）**：「该会话已升级为新格式，请刷新页面获取最新版本后再编辑」（CHG-007 4.3 同文）。
5. **组装去重护栏**：前端「先 PUT 再发回合」流向下，库内已含本条用户消息则不重复追加（test_组装_库内已含本条消息 为证）。
6. **存量 tool_result 回填上下文同样注入包裹**（与回合内实时回填同口径，test_组装_工具回合窗口同构 断言 `<tool_result>` 包裹形态）。

### 5. 已知边界（登记不隐瞒）

- 上游连接期即失败（unreachable）的回合：回合已在受理时计数（与旧端点行为一致，「已抵上游则计」的受理侧解释——连接未成的极端场景与现状同口径，QA 如认为需收窄留 A2/B1 再议）。
- max_steps=10 生产值不进验收（用例以小值注入压测）；演示工具延迟取 200ms 稳态（CHG 4.6 的 200~500ms 下限，避免用例抖动）。

---

## T2 前端协议与渲染升级（2026-08-17 实现并验证）

### 1. 交付范围（对照 plans/iter-13.md T2 行）

| 项 | 落点 |
|---|---|
| ① blocks 模型 + 读时归一化 | `src/api/client.ts`（Block 类型 / contentBlocks / contentText 适配层）+ `src/db/idb.ts`（content 联合类型 + schema 字段）；渲染层归一化（v1 ⇒ 单文本段），存量消息 string 原样不迁移 |
| ② StreamHandlers → TurnHandlers + v2 事件消费 | `src/api/client.ts` runChatTurn（SSE v2 九事件、未知 type 静默跳过、error 事件 → REQ-007 体系）；`src/stores/sessions.ts` generate 重写（blocks 顺序组装、工具事件后首帧开新文本段、max_steps 定型标注） |
| ③ 工具步骤 UI | `src/components/ToolStepCard.vue`（四态徽章 + 派生已中断态 / R1~R3 折叠 / 参数原样 + 结果卡左缘语义色条 + 占位三串，全令牌零新增）+ `MessageBubble.vue` blocks 顺序渲染 + 步数上限 pill |
| ④ 回合端点接入 | send/retry/editAndRegenerate 统一走 `/api/chat/turn`（请求体无历史数组；system_prompt 可选上传）；persist 恒带 `schema: 2` |
| ⑤ export/search/markdown 适配 | 导出文本段 + `> [工具 name · 状态]` 标记行（状态词四态）；搜索仅文本段；仅 text 段进 Markdown 管线 |
| ⑥ 存量交互零回退 | v1 会话/编辑态/版本分支/中断标注原口径（走查取证见 §3） |

### 2. 测试证据

- **vitest：254 → 270 全绿**（27 文件）：存量 254 逐用例迁移映射（mock 面由 streamChatViaProxy → runChatTurn；上下文组装类断言退役映射至服务端 pytest——见各 spec 头部「口径迁移登记」注释）；新增 ToolStepCard.spec 8（四态/R1~R3/占位/可达性）+ client.spec 事件流组 + sessions.spec blocks/schema:2 组 + export/search blocks 组。
- **vue-tsc 类型检查 + guard:style + 生产构建全过**；**后端 pytest 182 复跑全绿**（全链路无回退）。
- **功能性删除为零**（全局回归基线）：退役的 buildContext 组（3 例）与 upstream_interrupted 帧例（1 例）均有服务端对应用例承接（test_组装等价_* / 错误映射组），映射已登记。

### 3. 真实 Chrome 全链路走查（Vite dev + FastAPI + 真实 DeepSeek 统一 key，2026-08-17）

环境：`/tmp/ai-chat-walkthrough.db` 独立库（首个注册用户 = admin，演示工具可见）；证据 = 走查截图 3 张 + 后端日志链。

| 断言（REQ-032 前端侧验收 / design-iter-13 §7.2 核心面） | 结果 |
|---|---|
| 北极星链路：发「查北京天气」→ 工具卡（demo_weather）→「完成」徽章 + 耗时 201ms → R2 自动折叠 → AI 综合回答「北京天气晴，最高气温 32°C」 | ✅（真 DeepSeek 驱动，单回合 2 次工具调用 + 3 次上游调用，回合计 1——后端日志链取证） |
| echo 端到端（回显往返） | ✅（tool executed name=echo status=ok） |
| 加载态一帧（v1.4.10 B）：「运行中」徽章 + spinner + R1 展开态 + 「（等待结果…）」占位逐字 | ✅（748ms 帧捕获；「正在生成…」hint + 光标 301ms 帧捕获） |
| 暗色双主题：卡底 #24272E、完成徽章 #4CC38A（design §5 计算值逐值核对） | ✅（computed style 取证 + 暗色截图） |
| v1 老会话零回退：逐字渲染 / Markdown 加粗与代码 / 「生成中断」pill / 版本分支 1/2 计数 | ✅（legacy-v1-session 注入复验） |
| 后端日志四字段安全日志（name/status/duration_ms/truncated） | ✅ |
| 完整 51 条清单脚本化留档 | **移交 QA 前补**（scripts/e2e-walkthrough-13.mjs，tailoring C 走查脚本自迭代口径） |

### 4. 走查发现并当轮修复：DEF-029（集成竞态）

首次 send 的 createSession/persist 为 fire-and-forget，回合请求竞态先于会话 PUT 到达 → 服务端 404。pytest 未暴露（用例 PUT 同步先行）。修复：generate() 起回合前 `await this.persist(session)`。登记 plans/defects.md DEF-029（已修复），vitest 270 复跑含该路径。

### 5. CEO 走查反馈处置（2026-08-17 第三轮）

| 反馈 | 定性 | 处置 |
|---|---|---|
| 「技能库里没有 demo_weather」 | 非缺陷——定夺④（演示工具仅 admin）对普通用户正确生效：上游 payload 无 tools，模型如实自述无工具。走查库唯一 admin = walkthrough-admin；CEO 自注册账号为普通用户 | 已向 CEO 说明 + 提供走查账号；**产品输入登记 A2**：真搜索上线时需定义普通用户的工具缺失降级口径（避免模型困惑式回答） |
| 「回答太多空行」 | 真缺陷 DEF-030（iter-1 起存量）：pre-wrap 继承把 markdown 块间 `
` 渲染成整行空行 | 当轮修复（`.md` normal + breaks:true 成对），同条消息段间距 34px→8px 实测，回归用例 2 条，vitest 272/272 |
| 控制台历史 401×5 | 非缺陷——会话过期/登出后跳登录为既定行为（CEO 在面板探索期间产生） | 无需处置，记录在案 |
| 「用户对话挪到右边」 | 真缺陷 DEF-031（iter-11 存量基线偏离：`.row` 全宽架空外层右对齐，用户气泡停靠列左缘，历轮走查未覆盖水平位置断言） | 当轮修复 `.row.user { justify-content: flex-end }`（实测偏移 444px → 0px）；走查脚本纳入断言面（e2e-13 条 1+DEF-031）；vitest 272 复跑 |
| （后续）「回答空行乱」同轮 CEO 反馈链 | 见 DEF-030 行 | 同上 |

### 6. 51 条清单脚本化走查留档（2026-08-17，tailoring C 口径：脚本沉淀 scripts/e2e-walkthrough-13.mjs）

**结果：38 断言全 PASS / 0 FAIL**（对照 design-iter-13 §7.2 共 51 条：浏览器触点 38 条脚本断言；
行为类 13 条由 vitest/pytest 承载并在脚本输出逐条标注载体——19/20/31/33/36~46 部分/49/50）。

- 实跑环境：本机 Chrome（puppeteer-core headless）+ Vite 5174 + FastAPI 8000（walkthrough 库）；
  种子：v1 存量会话 + v2 全状态会话（五态徽章/占位三串/maxSteps/错误共存/branches 混流）经 API PUT；运行中帧组以一次真实 DeepSeek 回合取证（demo_weather 深圳 202ms 完成 + R2 折叠 + 打字机）。
- 截图 6 张：/tmp/e2e13/shots/（亮色 v2 / 暗色 v2 / hint 帧 / 运行中帧 / 终态 / v1 存量）。
- 走查中修复 1 个产品缺口：**条 32 错误共存形态**（错误消息此前整条被 ErrorBubble 替换，已实现「已生成内容保留渲染 + 错误气泡随其后」；存量空内容错误消息仅错误气泡，REQ-007 零回退）——MessageList.vue；脚本 6 处时序/断言缺陷同步修复（登记于脚本注释）。
- 复验：vitest 272/272 + vue-tsc + guard:style + 生产构建全过。

### 7. OBS-6 对照说明：29 行 log ↔ 38 条断言

单行 log 合并多条款项的映射：条10/18/51 → 运行中帧一断言（同帧取证）；条11/19 → 终态徽章+折叠（同卡终态）；条6+DEF-030、条1+DEF-031 → 一断言双口径；条16/38、条36~41、条45/46、条40/42 等 13 条行为类由 vitest/pytest 承载（载体逐条标注于脚本输出与 §6）；条5 为背书断言（载体如实标注）。合计 38 条清单项全部有断言或载体，无漏项。

