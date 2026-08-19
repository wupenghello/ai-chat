# iter-16 验证记录（B2 三级上下文压缩）

## T0 前置取证（2026-08-19；CHG-010 定夺③⑦精确值 + REQ-039 验收 5 的 T0 取证段 + 摘要 prompt 冒烟）

### §1 取证环境与方法

- 脚本：`scripts/b2_t0_smoke.py`——临时 uvicorn（127.0.0.1:8816）+ 独立库 `/tmp/ai-chat-b2-t0.db`（用后自删）；配额豁免 `AI_CHAT_QUOTA_FREE_DAILY=100` 经进程环境注入（.env 零改动）；搜索 key 注入同法
- 真实 key 边界（沿 iter-14 T2）：统一 key 三变量经 backend/.env；搜索 key 经项目根 .env 以进程环境注入——真实 key 仅进程环境传递，不入任何文件/日志/留档
- 会话脚本：31 回合——第 1 轮种关键事实（「我叫小明，正在开发叫『喵喵』的 AI 聊天产品」）；第 8/16/24 轮为时效性问题（预期触发 search 工具，实际 3 次搜索调用）；其余为短答知识问答；第 31 轮为关键事实回忆
- 机器读数（铁律 5）：telemetry 表（迁移 v8）step=1 llm 行 `tokens_prompt`（上游 usage `prompt_tokens` 机器映射），不手数 token、不估算
- 人设与单价：backend/.env 既有配置（AI_CHAT_PRODUCT_PERSONA 已配置），组装含 system[0] 静态前缀（与生产同形态）

### §2 Y 基线与增长曲线（定夺③精确值）

两次独立运行如实留档：

| 运行 | Y（第 31 回合 step=1 tokens_prompt） | 0.75Y | 阈值（取整千位） |
|------|--------------------------------------|-------|------------------|
| Run 1 | 9909 | 7431.75 | 7000 |
| Run 2 | 9943 | 7457.25 | 7000 |

**定死值：自动压缩阈值 = 7000**（两次运行一致）。T2 实现：config 新 settings 字段写入 7000，.env 可覆盖（口径定稿）。

增长曲线（Run 2，step=1 tokens_prompt，telemetry 机器读数）：

| 回合 | 1 | 5 | 8 | 10 | 16 | 20 | 24 | 28 | 30 | 31 |
|------|---|---|---|----|----|----|----|----|----|----|
| tokens | 689 | 838 | 1031 | 2413 | 2739 | 6872 | 6951 | 9965 | 9927 | 9943 |

观察：① 请求体随轮数增长，单个搜索回合可增约 3.7k tokens（回合 8→10：1031→2413，工具结果进窗）；② 20 轮窗口封顶后趋稳 ~9.9k——本会话工具结果为中等体量（Tavily 5 条结构化结果），极端形态单个工具结果 32 KiB 截断上限（config.tool_result_limit）可数倍于此，阈值 7000 在该类会话下更早触发属预期行为；③ Run 1/Run 2 曲线形态一致、终值相差 0.3%（回复长度非确定性所致），基线稳健。

### §3 30 轮验收 X 值与测量法（定夺⑦精确值）

**定死值：X = 7000**（与阈值同源定死：压缩生效后第 31 次请求体上限）。

测量法定稿（T2 验收 5 直接对照）：
1. pytest + MockTransport 捕获第 31 次请求体，假上游 usage 帧回 `prompt_tokens` 机器读数（不手数 token）→ 断言 ≤ 7000
2. 关键信息问答断言：第 1 轮关键事实（小明/喵喵）在第 31 轮回答中可答对（压缩摘要承载，见 §4 实证）
3. 真实 DeepSeek 30 轮冒烟走查 = 本节 §1~§4 留档（已完成）

### §4 窗口外失忆实证（B2 要解决的问题）

- **Run 1：第 31 轮答对**（「你叫小明，正在开发 AI 聊天产品『喵喵』」）——但本轮第 29/30 轮对话在窗口内重新提及产品名「喵喵」（祝词与主题回顾），属窗口内再提及污染，**不作为窗口外记忆的证明**，如实登记
- **Run 2：第 31 轮明确失忆**（「你在之前并没有告诉我自己的名字，也没有说明在开发什么具体产品」）——第 1 轮关键事实落在 20 轮窗口外（窗口 = 第 12~31 轮），**窗口外失忆实证成立**
- 结论：基线 v6 组装下窗口外内容整段丢弃、关键事实不可恢复是现行设计行为（REQ-002 异常分支「自动截断」）；B2 验收口径 = 压缩生效后第 31 轮经摘要承载可答对（§3 测量法 2）

### §5 摘要 prompt 冒烟（定稿文案逐字登记，逐字断言面）

**R1（初稿，四条要求）实测**：输入 10471 字符真实中段历史，产物 **1344 字 > 800 字上限**（定夺⑨未达）——根因：知识性问答被逐条展开为 19 条定义要点；关键事实（小明/喵喵）与工具结论保留良好。

**R2 定稿（六条要求，增「知识性问答只留主题清单」与「严格字数上限与裁剪优先级」）**，文案如下（后端拥有、T2 实现按此逐字、断言面以本节为准）：

```
请将以下对话历史压缩为一段摘要，供 AI 助手在后续对话中参考。要求：
一、保留用户陈述的事实、要求与偏好，尤其是会话开头的关键信息（如用户身份、目标、约定）。
二、保留工具调用的结论与来源要点（如搜索结果的关键事实），不保留调用过程细节。
三、省略寒暄、重复与已被后续对话取代的旧信息。
四、用陈述句客观转述，不加评论。
五、知识性问答只保留主题清单（一句话列举聊过哪些主题），不展开各主题的定义与细节。
六、总长度严格不超过 800 字；若内容过多，优先删减知识性主题与工具结果的次要细节。
直接输出摘要正文，不要任何前缀说明。
```

**R2 实测（Run 2 会话真实中段历史 9642 字符，非流式调用，耗时 1.9s）**：
- 产物 **313 字 ≤ 800** ✅；结构 = 用户身份与目标 + 主题清单 + 三次搜索结论与点评
- 关键事实保留：「小明」✅「喵喵」✅；工具结论保留（宇树科技上市/OpenAI 暂停训练/DeepSeek V4 Pro 与调价/客服协同国标等搜索要点）✅
- 摘要调用 usage（机器读数）：prompt 5474 + completion 168 = 5642 tokens（成本入账口径：计触发回合 token 累计 + compress 行自记，定夺⑧）
- T2 实现输入：R2 定稿即实现稿；注入前字面包裹 `<conversation_summary>…</conversation_summary>`（CHG-010 3.3）；字数余量充足（313/800），长会话场景有裕度

### §6 T0 结论与携带

1. 定夺③精确值：**阈值 7000**（0.75Y 取整千位，Y=9909/9943 两轮一致）→ 回填 changes.md CHG-010 定夺表
2. 定夺⑦精确值：**X = 7000**，测量法 = §3 三条（机器读数 + 关键信息问答 + 真实冒烟留档本节）
3. 摘要 prompt R2 定稿（§5 逐字），冒烟全断言通过
4. 零产品代码改动（取证脚本 scripts/b2_t0_smoke.py 新增）；无未登记变更；无新增 DEF

---

## T2 后端三级压缩管道核心 + 迁移 v9（2026-08-20；REQ-039 主体 + REQ-041 数据面）

### §1 实现结构（新增 / 改动行数）

| 文件 | 性质 | 行数变化 | 职责 |
|------|------|---------|------|
| `backend/app/compress.py` | **新增** | +363 | 三级管道核心：snip 裁剪 / 阈值判定读 / compact 规划与水位 / 摘要产物读写 / 摘要调用器（非流式+30s 护栏）/ 摘要注入组装 |
| `backend/tests/test_compact.py` | **新增** | +579 | REQ-039 验收 1~6 逐条 + REQ-041 数据面 + 水位语义（16 用例） |
| `backend/app/routers/proxy.py` | 改动 | +98/−9 | 回合受理内嵌管道编排 `_assemble_pipeline`；telemetry_sink 携 session_id；run_turn 传 summary_tokens/turn_id |
| `backend/app/telemetry.py` | 改动 | +60 | `record_compress`（kind='compress' 行）；`record_llm`/`record_tool` 增 session_id；列白名单加 v9 三列 |
| `backend/app/db.py` | 改动 | +25/−1 | 迁移 v9：context_summary 表 + telemetry tokens_before/tokens_after/session_id 加法列；SCHEMA_VERSION 8→9 |
| `backend/app/agent.py` | 改动 | +10/−2 | run_turn 增 summary_tokens（计账）与 turn_id（compress 行关联）参数 |
| `backend/app/config.py` | 改动 | +7 | 阈值 7000 + 微参数 K=2/R=5/摘要超时 30s（T0 定死值，.env 可覆盖） |
| `backend/.env.example` | 改动 | +7 | 四压缩参数占位行 |
| `backend/tests/test_search.py` | 改动 | +2/−1 | 既有 db_version 版本位断言随迁移推进 8→9（见 §5 改写映射） |
| `src/db/__tests__/persistence.spec.ts` | 改动 | +11 | REQ-039 验收 7 前端面：PUT 载荷形状零变化、不含摘要字段（1 用例，生产代码零改动） |

定死参数落地核对：阈值 `compact_threshold` 默认 **7000**（.env 可覆盖）；摘要 prompt = §5 R2 定稿**逐字**常量 `compress.SUMMARY_PROMPT`（pytest 逐字断言）；snip 占位文案 `[旧工具结果已裁剪：{工具名} · {状态}]`（逐字断言）；摘要注入包裹 `<conversation_summary>…</conversation_summary>`；K=2 / R=5 / 摘要超时 30s 均入 config（默认值即定死值）。

### §2 REQ-039 验收 1~7 逐条对照

| # | 验收 | 实现与用例 | 结论 |
|---|------|-----------|------|
| 1 | snip 确定性 | 一级 snip 在 wire 层对早于最近 K=2 条的 tool 结果替换占位文案（`compress.snip_tool_results`，每次组装无条件执行、不触库）；`test_snip_五工具回合_仅最近2条保留全文`（逐字断言 5 个工具回合仅最近 2 条全文、更早 3 条占位，含 error/timeout 状态位）+ `test_snip_每次组装无条件执行_阈值下同样生效` | ✅ |
| 2 | 自动触发 | 三级阈值判定读该会话上一回合 step=1 telemetry tokens_prompt 机器实测值（`compress.last_turn_prompt_tokens`，依赖 v9 session_id 列），超阈值执行 compact，摘要作为独立 system 消息挂载 system[1] 之后历史之前、历史仅最近 R=5 轮；`test_超阈值_摘要注入_挂载位置与R轮窗口`（置 tokens_prompt=阈值+1 → 断言挂载位置逐条 + 窗口 m16 起 + prompt R2 逐字 + 水位 m15 落库） | ✅ |
| 3 | 阈值下零回退 | 纯文本会话 + tokens_prompt=阈值−1 → 与基线 v6 逐字段等价；`test_阈值下_纯文本会话_基线v6逐字段等价` + `test_无遥测记录_按未超阈值处理`（无记录保守不造数）。含旧工具回合的会话按验收 1 口径断言（见 §5 改写映射：既有用例零受影响） | ✅ |
| 4 | 失败降级 | error/timeout/空摘要/4xx/5xx 恒回退基线 v6 组装（20 轮窗口 + snip），回合不阻塞、warning 日志、compress 行 status=error/timeout 如实记；`test_摘要500_回退不压缩_compress行error` / `test_摘要超时_回退_compress行timeout` / `test_空摘要_回退_compress行error` | ✅ |
| 5 | 30 轮验收 | pytest 脚本化假上游 30 轮（第 1 轮种关键事实、第 7/15/23 轮工具回合）→ 第 31 次请求体 prompt_tokens 机器读数 ≤ 7000 + 关键事实（小明/喵喵）经摘要承载可答对；`test_30轮验收_第31次请求体机器读数不超阈值_关键事实可答`。真实 DeepSeek 30 轮冒烟走查引用本节 T0 §1~§4 留档，不重跑 | ✅ |
| 6 | 存储语义 | 压缩只影响发给上游的内容，库内消息全文零删除；`test_压缩前后_会话档逐字不变_GET输出不变`（压缩执行前后 chat_sessions messages 数量与全文逐字不变、GET 输出不变） | ✅ |
| 7 | 产物独立 | 压缩产物仅存 context_summary 表，不写回会话档；`test_产物独立_仅存context_summary_会话档与遥测零摘要文本`（pytest：产物表 + 会话档零摘要 + telemetry 零摘要文本）+ vitest `persistence.spec.ts` 新增 1 例（PUT 载荷形状零变化、不含摘要字段，生产代码零改动） | ✅ |

### §3 REQ-041 数据面（本任务承载：迁移 v9 + compress 行创建落库）

| # | 验收（本任务面） | 实现与用例 | 结论 |
|---|------|-----------|------|
| 1 | compress 行完整性（本任务面） | 一次自动压缩回合结束 → telemetry 恰 1 条 compress 行：turn_id 关联、endpoint='turn'、model=摘要模型、latency_ms=摘要调用耗时、tokens_prompt=摘要调用自身消耗（同列口径）、tokens_before=触发依据实测值、status=ok、**tokens_after=NULL（懒回填归 T3）**、step=NULL 不占回合 step 序列；`test_compress行完整性_恰1条_触发依据值_tokens_after为NULL` + `test_摘要tokens计入回合累计_usage与usage_daily含摘要消耗`（turn.end usage 与 usage_daily 含摘要消耗、quota.py 零改动） | ✅ |
| 2 | 配额数据面零回退 | test_quota 全套零改动复跑全绿；test_telemetry 全绿（行形状仅加法列）——见 §4 计数 | ✅ |

> 验收 1 的「tokens_after 懒回填后与下一回合 step=1 llm 行 tokens_prompt 一致」一致性断言属 T3 范围，本任务仅落 tokens_after=NULL 的创建面（任务书明示）。

### §4 测试计数与既有用例零改动证明

- **后端 pytest：239 → 255（+16 新增，全绿）**。新增 16 例全部在 `tests/test_compact.py`（REQ-039 验收 1~6 逐条 + REQ-041 数据面 + 水位语义）。
- **前端 vitest：324 → 325（+1 新增，全绿）**。新增 1 例在 `persistence.spec.ts`（REQ-039 验收 7 前端面）。
- **既有用例零改动证明**：除 §5 登记的 1 例版本位断言外，`git diff` 对 test_quota / test_telemetry / test_turn / test_admin_telemetry 等全部既有测试文件零改动；行形状仅加法列（tokens_before/tokens_after/session_id），既有 `SELECT *`/列名断言不受影响。ruff clean。

### §5 改写映射登记（全局回归基线口径，功能性删除为零）

| # | 旧断言 | 新断言 | 说明 |
|---|--------|--------|------|
| 1 | `test_search.py` `assert db_version(conn) == 8`（迁移 v8 版本位守卫） | `assert db_version(conn) == 9` | 迁移版本位断言随 v9 推进。非口径迁移、非功能性删除——该断言职责是「最新迁移已应用」，随每次迁移自然 +1。REQ-033 验收 1「组装等价」含旧工具回合的**业务用例零受影响**：K=2 保留口径下，存量用例（test_turn 工具窗口同构、test_telemetry 卫生探针、test_search 注入防护等）的存量会话工具消息数均 ≤2，snip 不触发替换，断言口径不变 |

> 「纯文本会话等价口径不变」由 `test_阈值下_纯文本会话_基线v6逐字段等价` 正面承接；snip 对纯文本会话无 tool 消息可裁剪、零影响。

### §6 session_id 加法列偏离登记（实现级加法，已拍板）

telemetry v8 表无会话关联列，无法满足 REQ-039「**该会话**上一回合 step=1 tokens_prompt」的阈值判定语义。本任务在迁移 v9 给 telemetry 增加 `session_id TEXT` 加法列：存量 NULL 不回填、turn 端点 llm/tool/compress 行写入时携带、阈值判定查询按 (user_id, session_id) 过滤。此为 CHG-010 schema 拟稿之外的**实现级加法列**——REQ 验收语义优先于 schema 拟稿，属「定死口径的最小必要落地」，非范围扩张；quota.py 与 usage_daily 数据面零改动、REQ-037/038 既有行形状零回退（仅加法列）。登记于 §1 db.py 行与本节。

### §7 卫生自查（铁律 5 + 受保护存储口径）

- **库内消息全文零删除**：压缩与 snip 均为组装层/wire 层产物，chat_sessions.data 原文不动（验收 6 用例前后逐字比对为证）。
- **表零 key 零消息内容全文**：context_summary 表存摘要产物（产物语义，非「消息内容全文入日志」）；telemetry compress 行仅 status/耗时/token 分项/触发依据值，无 key、无消息内容、无工具结果全文（`test_产物独立…遥测零摘要文本` 探针为证）。
- **日志零泄露**：摘要调用失败仅 warning `status=%s session_id=%s`，不含 key/内容（沿 REQ-031 卫生口径）；摘要 prompt 与调用体不入日志。
- **与 LWW/409 守卫/整档透传零交互**：压缩产物存独立表、不随会话 PUT 回写，会话档结构零变化（REQ-006/022 零波及明示承接）；前端数据面 client.ts/sessions.ts 零改动。
- **密钥安全**：摘要调用 Authorization 头全新构造、不入日志/响应；统一 key 与自填 key 均不出现在任何新增表/日志。

### §8 偏离与决策点清单（含合同外最小决策）

| # | 事项 | 处置 |
|---|------|------|
| 1 | telemetry.session_id 加法列（CHG-010 schema 拟稿之外） | 已拍板的实现级加法列，落地情况：迁移 v9 建列、存量 NULL 不回填、turn 端点 llm/tool/compress 行写入均携带（tool/compress 行同列为零成本一致性携带，阈值判定仅用 llm 行）；登记见 §6 |
| 2 | test_search db_version 版本位断言 8→9 | 迁移版本位随 v9 推进，改写映射登记见 §5；业务用例零改动 |
| 3 | usage 帧 requests 不含摘要调用（tokens 含） | 合同外最小决策：任务书⑦定「turn.end usage 与 usage_daily 落账含摘要消耗」仅指 tokens；摘要调用不占回合 step 序列（REQ-030 波及口径），故 requests（回合内步数）不计摘要调用，tokens 如实计入（用例数值断言 600+900=1500、requests=1） |
| 4 | 摘要调用失败码体系 | compress 行 error_code 取 summary_timeout / summary_empty / summary_error 三值（status 列仍为 timeout/error 两态，与 llm 行 status 枚举对齐；错误码体系为 compress 行新增面，非 §3.1 映射码复用） |
| 5 | 摘要输入工具结果单条 1000 字符上限 | 合同外最小决策：摘要输入体量护栏（结论要点保留、超长截断），避免中段历史多工具结果叠加撑爆摘要调用自身；与 T0 冒烟 [:2000] 同为截断口径、取值更保守，不影响 R2 prompt 定稿逐字一致 |
| 6 | 有效摘要复用不写 compress 行 | 「compress 行 = 压缩执行」口径：复用非执行、零摘要调用、零新增行（用例断言零行 + 产物行不覆盖）；降级与生成两路径照常落行 |
