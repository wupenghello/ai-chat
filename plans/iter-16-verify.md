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

---

## T3 手动压缩 + admin 压缩卡与全局回归收口（2026-08-20；REQ-040 全量 + REQ-041 剩余面）

### §1 实现结构（新增 / 改动行数）

| 文件 | 性质 | 行数变化 | 职责 |
|------|------|---------|------|
| `backend/app/routers/proxy.py` | 改动 | +130/−18 | `POST /api/chat/compact` 端点（design §5.1 四语义逐字：200 compacted / 200 skipped too_short / 409 session_generating / 502·504 compact_failed + 404 归属隔离 + 422 corrupted 双保险，detail 形状 {code,message} 沿 sessions.py 先例）；turn 受理进行中回合登记（置位）与流终态清除（finally，含断连）；telemetry_sink step=1 usage 到达懒回填接入 |
| `backend/app/compress.py` | 改动 | +10/−5 | `plan_compact` 增 `incoming` 参数：手动压缩规划（无本条消息——总轮数 = 档内 user 轮数、保留窗 = 档内最近 R−1 轮，第 R 轮位留给下一回合本条消息，与自动路径窗口口径衔接无轮间缝隙）；自动路径口径逐字节零变化 |
| `backend/app/telemetry.py` | 改动 | +25 | `backfill_tokens_after`：独立短连接懒回填该会话全部待测 ok 行（tokens_after IS NULL），失败不阻塞不补造（吞 sqlite 异常仅 warning，沿 _write 主路径隔离哲学） |
| `backend/app/routers/admin.py` | 改动 | +47/−6 | `GET /api/admin/telemetry` 加法 `compact` 键（count/count_ok/count_failed/measured/Σbefore/Σafter/reduction_rate，后端 6 位小数，measured=0 → null）；成本口径演进——today_cost 与 daily[].cost_total 计入 unified compress 行 tokens_prompt×input 单价（CHG-010 3.3 按输入计价；comp_prompt=0 时与既有公式逐字节等价） |
| `backend/app/main.py` | 改动 | +4 | `app.state.generating_sessions` 进行中回合登记集合（409 判定数据面；进程内内存态，重启清零 = 无进行中回合，语义自洽） |
| `backend/tests/test_compact_api.py` | **新增** | +496 | REQ-040 验收 1~4 逐条 + 四语义边界（corrupted 422 / 无密钥 502 / 请求体 422）+ 409 生命周期 + 懒回填一致性 4 例（18 用例） |
| `backend/tests/test_admin_compact.py` | **新增** | +188 | REQ-041 验收 3~4：造数聚合精确值 / 缺失态 / 空窗口 / 合法 0 变异 / 成本计入 3 例 / 403 零泄露 / 加法形状零变化（9 用例） |
| `backend/tests/test_compact.py` | 改动 | +5/−1 | 30 轮用例 tokens_after 断言随懒回填落地演进（改写映射见 §5-1） |
| `backend/tests/test_admin_telemetry.py` | 改动 | +4/−2 | 顶层形状 set 断言加法 compact 键（改写映射见 §5-2；数值断言零变化） |
| `src/api/backend.ts` | 改动 | +30/−1 | `compactSession` + `CompactResult`；`AdminTelemetry.compact` 可选加法键（旧后端窗口期按空态）；`extractMessage` 加法支持 object detail {message}（409 服务端 message 逐字呈现的数据通道；既有 string/array 形状零变化） |
| `src/components/SessionListItem.vue` | 改动 | +39/−3 | 菜单加法项「压缩上下文」（导出之后、danger 分隔线之前，既有字段零组件改动）+ compacting pill（primary-l/primary + 10px spinner currentColor，pill.cut 同规格参数）+ 禁用两态（corrupted C4 / 执行中 C3）+ emits compact |
| `src/components/TheSidebar.vue` | 改动 | +38 | `compactingIds` 会话级执行中态 + `compactSession` 四终态消费（design §5.1 消费规则逐字：C5 success 变体不带数字 / C6 / C7 兜底 / C8 = e.message 服务端 message 逐字）；切换会话不 abort；data 面 client.ts/sessions.ts 零触达 |
| `src/views/AdminView.vue` | 改动 | +76/−2 | 卡 E 上下文压缩（双卡并排区与卡 D 之间全宽；三态 正常/缺失/空；C9~C16 逐字；icon 14px text-3；双大数值栅格 gap 16 + 内面板 bd-item 同规格）；`telEmpty` 口径演进含 compress 行（仅压缩行的窗口不视空） |
| `src/components/__tests__/SessionListItem.spec.ts` | 改动 | +79/−5 | 新增 5 用例（加法项位置/点击 emit/corrupted 禁用 C4/执行中禁用 C3/pill 优先级）；既有 3 用例菜单项索引适配（改写映射见 §5-3） |
| `src/components/__tests__/TheSidebarCompact.spec.ts` | **新增** | +167 | TheSidebar 压缩流程 6 用例（成功/跳过/409/失败/本地生成中零预判/执行中切换会话）；独立 mock，既有 TheSidebar.spec.ts 零触达 |
| `src/views/__tests__/AdminCompactCard.spec.ts` | **新增** | +229 | 卡 E 9 用例（位置/标题区/次数列/降幅列/缺失态/空态/合法 0/注记 C16/仅压缩行不视空）；独立 mock，既有 AdminTelemetry.spec.ts 零触达 |
| `scripts/e2e-walkthrough-16.mjs` | **新增** | +1083 | 真实 Chrome 走查脚本（真实后端 + 真实 DeepSeek 摘要调用；key 经进程环境注入，沿 b2_t0_smoke.py 模式；44 条浏览器适用条目实测 + pytest/vitest 承载标注） |

### §2 REQ-040 验收 1~5 逐条对照

| # | 验收 | 实现与用例 | 结论 |
|---|------|-----------|------|
| 1 | 手动压缩执行一次 → compress 行 endpoint='compact' turn_id=NULL、context_summary 更新、usage_daily turns 零变化（pytest + test_quota 零改动复跑） | `test_手动压缩_compress行endpoint_compact_turn_id_NULL_usage_daily零变化`：200 {status:compacted, tokens_before:触发依据实测值}；compress 行 endpoint='compact'/turn_id=NULL/status=ok/tokens_prompt=摘要自身消耗/tokens_before=8000/tokens_after=NULL/step=NULL；context_summary（summary+watermark m15+model）；usage_daily 零行；上游恰 1 次摘要调用。test_quota 全套零改动随 282 全绿复跑；quota.py 零触达（端点无 quota 调用） | ✅ |
| 2 | 手动压缩后下一回合请求体含摘要（= REQ-039 验收 2 口径，pytest） | `test_手动压缩后_下一回合请求体含摘要_零重复摘要调用`：压缩后 seed 阈值+1 → 下一回合请求体含 wrap_summary system 消息（水位有效 → 复用手动产物，零新摘要调用）。行为面走查条 27补：真实回合关键事实（小明/喵喵）经摘要承载可答（基线 v6 下该事实在 20 轮窗口外） | ✅ |
| 3 | 「无需压缩」分支：轮数 ≤ R → 零上游调用（假传输层零调用断言）+ 前端提示（vitest） | pytest `test_无需压缩_轮数不超R_200_skipped_零上游调用`（seen==[] + 零 compress 行 + usage_daily 零行）+ `test_无需压缩_空会话`；vitest TheSidebarCompact「200 skipped → toast C6」；走查条 22 真实端点 skipped toast 逐字 | ✅ |
| 4 | 归属隔离：他人 session_id → 404；普通用户操作正常、无 admin 门槛（pytest） | `test_归属隔离_他人会话404_普通用户无admin门槛`：bob→alice 会话 404 detail {code:session_not_found,message:会话不存在} 逐字 + 不存在 404 + bob（非 admin）压缩自己会话 200；走查条 33补/验收 4 浏览器面复验 | ✅ |
| 5 | design-iter-16 走查清单留档（亮/暗双主题 + 执行中态 + 失败态 + 无需压缩态） | scripts/e2e-walkthrough-16.mjs：**70 PASS / 0 FAIL**（亮/暗双主题；执行中 pill 条 18/19/20、失败 toast 条 23、无需压缩 toast 条 22 全实测）；10 帧截图 /tmp/e2e16/shots/；详见 §6 | ✅ |

补充语义面（design §5.1 定案逐字）：409 `test_409_生成中拒绝_detail逐字_零副作用`（detail {code:session_generating,message=C8 逐字} + 零上游调用 + 零 compress 行 + 摘要零变化）+ `test_turn受理登记_流终态清除_生成中注册生命周期`（受理置位/上游调用时刻在途/流终态清除）；502 `test_摘要失败_502_原摘要保留_会话档零写入`（原摘要保留 + 会话档前后逐字一致）；504 `test_摘要超时_504_compress行timeout`；422 corrupted `test_corrupted会话_422双保险`（detail {code:session_uncompactable,message=C4 逐字}，前端菜单禁用之外的服务端双保险）；请求体校验 `test_请求体校验_缺字段与非字符串422`；无密钥 `test_上游密钥未配置_502_如实记行`（决策点见 §7-2）。

### §3 REQ-041 验收 1（完整面）/ 3~5 逐条对照

| # | 验收 | 实现与用例 | 结论 |
|---|------|-----------|------|
| 1 | compress 行完整性：一次自动压缩回合结束 → telemetry 恰 1 条 compress 行，tokens_before = 触发依据值、**tokens_after 与该会话下一回合 step=1 llm 行 tokens_prompt 一致**（pytest） | T2 已交付创建面（tokens_after=NULL）；T3 懒回填落地补齐一致性断言：自动路径 `test_懒回填_自动压缩回合内回填_与step1_llm行一致`（压缩行创建于组装阶段 → 本回合 step=1 usage 即压缩后首测值，回合内回填 == 同回合 step=1 llm 行 tokens_prompt）；手动路径 `test_懒回填_手动压缩后_下一回合step1_usage回填_与llm行一致`；不造数两面 `test_懒回填_usage无prompt_tokens_不回填不补造` / `test_懒回填_失败行不回填`；走查懒回填一致性真实机器采集（tokens_after=910 == step1_prompt=910） | ✅ |
| 2 | 配额数据面零回退（test_quota 全套零改动复跑全绿；test_telemetry 全绿） | 282 全绿含 test_quota/test_telemetry 逐字节零改动复跑；手动压缩 usage_daily 零写入（验收 1 用例 + 无需压缩用例双断言） | ✅ |
| 3 | 聚合一致性：造数已知 compress 行集 → 聚合端点次数/降幅精确值断言；缺失 → 缺失标注；成本聚合含 compress 行 tokens（数值断言） | `test_compact聚合_造数精确值_失败行只计次数`（count 5/ok 3/failed 2/measured 2/Σ 30000/11000/rate round6 精确）+ `缺失态 rate 为 null` + `空窗口全零` + `合法 0 降幅如实`（变异断言）+ 成本 3 例（unified prompt×input 计入今日与 daily / self 不计 / 单价未配置同显 null）+ `加法扩展_既有键形状零变化`（llm 显示列零污染）；走查条 38 API 面精确值（count 12/measured 8/Σ 384000/122880/rate 0.68）+ 条 31补 成本演进（cost_input 0.396） | ✅ |
| 4 | 普通用户访问扩展后的聚合端点 403 且不泄露数据（pytest） | `test_扩展聚合端点_普通用户403_零compact泄露`：403 且 set(body)=={"detail"}（零遥测字段含 compact 键）；走查条 33补 浏览器面复验（403 卡 + DOM 无遥测节点） | ✅ |
| 5 | design-iter-16 走查清单 admin 面留档（压缩卡 + 缺失态，亮/暗双主题） | 走查条 34~41 全实测（位置/容器几何/C9~C16 逐字/68.0% 精确/缺失徽标/空态/合法 0）+ 条 42 暗色遥测面板与卡 E 零亮色残留 + 令牌断言；截图 01/02/03/10 | ✅ |

### §4 懒回填一致性断言结论（REQ-041 验收 1 完整面收口）

- **机制**：turn 端点 telemetry_sink 记录 step=1 llm 行后，usage 含 prompt_tokens → `backfill_tokens_after` 独立短连接回填该会话全部待测 ok 行（`kind='compress' AND status='ok' AND tokens_after IS NULL`）；失败不阻塞、不补造（sqlite 异常仅 warning；usage 无 prompt_tokens 记分行不回填）。
- **自动路径**：compress 行创建于组装阶段（step=1 调用前）→ 本回合 step=1 usage 即「压缩后首次 step=1 实测值」→ 回合内回填，与该回合 step=1 llm 行 tokens_prompt 恒等（pytest 断言 + 30 轮用例全量 compress 行逐行一致）。
- **手动路径**：压缩执行时刻 tokens_after=NULL（同步响应未测得，design 定夺③成功 toast 不带数字的同源口径）→ 该会话下一次 step=1 usage 到达回填，与下一回合 step=1 llm 行 tokens_prompt 恒等。
- **真实机器采集实证**（走查）：s_long 手动压缩后真实回合 → tokens_after=910 == step1_prompt=910；水位复用零新摘要调用（恰 1 条 endpoint='compact'）。
- **缺失语义**：会话再无回合 / usage 无 prompt_tokens / 压缩失败行 → 恒 NULL，聚合显「缺失」（铁律 5，永不显 0/NaN）。

### §5 测试计数、既有用例零改动证明与改写映射登记

- **后端 pytest：255 → 282（+27 新增，全绿）**。新增 27 = test_compact_api.py 18（REQ-040 验收 1~4 + 四语义边界 + 懒回填一致性）+ test_admin_compact.py 9（REQ-041 验收 3~4）。ruff clean。
- **前端 vitest：325 → 345（+20 新增，全绿）**。新增 20 = TheSidebarCompact.spec.ts 6 + AdminCompactCard.spec.ts 9 + SessionListItem.spec.ts 加法 5。guard:style 通过 + 生产构建通过。
- **既有用例零改动证明**：除下列 3 处登记映射外，test_quota/test_telemetry/test_turn/test_admin/test_admin_telemetry/test_sessions/既有全部前端 spec 逐字节零改动（client.ts/sessions.ts 数据面零触达，git diff 可证）。

改写映射登记（功能性删除为零）：

| # | 旧断言 | 新断言 | 说明 |
|---|--------|--------|------|
| 1 | `test_compact.py` 30 轮用例 `assert all(r["tokens_after"] is None for r in compress_rows)  # 懒回填归 T3` | 每条 compress 行 `tokens_after == 同回合 step=1 llm 行 tokens_prompt` | 断言职责随任务交接演进：T2 创建面「待回填 NULL」→ T3 完整面「回填且一致」。非口径回退——正是 REQ-041 验收 1 的完整断言落地 |
| 2 | `test_admin_telemetry.py` 顶层形状 `set(body) == {"window","price","today_cost","daily","tools","retention_days"}` | set 加法 `"compact"` | 响应加法键（design §5.2）；既有六键逐字节零变化，造数不含 compress 行故全部数值断言零变化 |
| 3 | `SessionListItem.spec.ts` 既有一/二/四位菜单项断言 `['重命名','导出会话','删除']`、删除项索引 2（2 处） | `['重命名','导出会话','压缩上下文','删除']`、删除项索引 3 | 菜单加法项（design §6 零回退映射 iter-11#6）：既有一/二/四位文案与配色逐字零变化，仅列表长度 3→4 与删除位索引平移 |

### §6 走查留档（design-iter-16 §7.2 全 44 条；scripts/e2e-walkthrough-16.mjs；70 PASS / 0 FAIL）

环境：真实 uvicorn（127.0.0.1:8817，/tmp 独立库）+ 真实 DeepSeek 统一 key（经进程环境注入，沿 b2_t0_smoke.py 模式，key 不入文件/日志/留档）+ vite 5181；单价三变量显式注入 2/8/0.5（与 iter-15 样件同）。造数纪律（铁律 5）：会话档与 admin 遥测样件全虚构（脚本内声明）；手动压缩产生的 compress 行/context_summary/懒回填值为真实后端机器采集，断言其与 llm 行一致性。截图 10 帧：/tmp/e2e16/shots/（01 卡 E 空态 / 02 缺失态 / 03 正常态 / 04 菜单开态 / 05 执行中 pill / 06 成功 toast / 07 压缩后侧栏 / 08 普通用户 403 / 09 暗色执行中 pill / 10 暗色卡 E）。

| 分组 | 条目 | 结果 | 承载方式 |
|------|------|------|---------|
| A 侧栏面零回退 | 1~14 | 14/14 PASS | 浏览器实测（条 1/2/3/4/5/6/7/8/9/10/11/12/13 几何与逐字 + 条 14 Esc/↓循环含压缩项/外点吞击三项交互实测） |
| B 触点①新增 | 15~29 | 15/15 PASS | 浏览器实测（15 C1 逐字+corrupted C4 / 16 位置与几何 computed / 17 行为链路 POST body 仅 session_id+不触发切换 / 18 pill 几何含 10px spinner / 19 pill 优先级+恢复 / 20 防重复禁用 C3+无第二次 POST / 21 C5 success 绿字不带数字+DB 面 / 22 C6 真实 skipped / 23 C7 / 24 C8 / 25 零预判照发+409 清态 / 26 失败路径摘要零变化 / 28 消息区 DOM 零变化 / 29 切换不 abort）；条 27 = 浏览器 toast C6 + pytest 零上游调用断言双面，条 27补 真实回合摘要注入关键事实可答（REQ-040 验收 2 行为面） |
| C admin 零回退 | 30~33 | 4/4 PASS | 浏览器实测（iter-15#1~41 关键面复跑：框架/顶栏/四卡/tabs/卡 A 副题逐字/卡 B/C/D 表头/403）+ 条 31补 成本口径演进精确值 |
| D 触点②新增 | 34~41 | 8/8 PASS | 浏览器实测（34 位置与容器 computed / 35 C9/C10 / 36 C11+sub+title / 37 C12+68.0%+C13+公式 title+栅格 gap / 38 API 面精确值 / 39 C15 空态+kv 保留 / 40 缺失徽标+永不显 0/NaN+已测得 0/成功 2 自释 / 41 C16） |
| E 全局 | 42~44 | 3/3 PASS | 浏览器实测（42 亮暗双主题：暗色侧栏+遥测面板零亮色残留扫描 + 关键令牌断言 + 对比度计算值；43 样件全虚构声明+机器采集实证；44 无图表/零轮询/无「已压缩」常驻标记） |
| 自动化承载标注 | — | 10 条 | pytest/vitest 双面断言的条目逐一标注载体（条 15 点击面 / 22·27 零调用 / 25 vitest 零预判 / 26 会话档比对 / 27 quota 复跑 / 38·31·33·40 聚合面 / 懒回填不造数两面） |
| 前置 | — | 8 条 | 服务/账号/造数/侧栏四会话全量加载（含 corrupted）/admin 三阶段样件 |

FAIL 归因：无（0 FAIL）。脚本迭代过程三轮自修复均为脚本断言问题（toast 堆叠读最新一条 / SVG spinner 旋转 boundingRect 膨胀改读 width 属性 / 搜索清除钮被菜单外点吞击导致搜索态残留 / 跨进程 WAL 写入 checkpoint 收敛），零产品缺陷。

### §7 偏离与决策点清单（含合同外最小决策）

| # | 事项 | 处置 |
|---|------|------|
| 1 | 409 判定数据面 = 进程内内存登记（app.state.generating_sessions） | 合同外最小决策：design §2.3 定夺④定「服务端回合登记是唯一权威」未定登记载体；内存登记零 DB 写（回合主路径零新增 IO）、turn 受理置位/流终态 finally 清除（含断连）、重启清零 = 无进行中回合语义自洽；turn 端点自身不加门禁（零回退），仅 compact 端点读取判定 |
| 2 | 统一 key 未配置且无生效档案 → 502 compact_failed + compress 行 status=error 如实记 | 合同外最小决策：design §5.1 四语义未列本分支（部署 misconfiguration 态）；归失败分支（用户侧共用 C7 toast），摘要调用不可执行 = 压缩失败如实记行（铁律 5），pytest 覆盖（零上游调用断言） |
| 3 | 手动压缩保留窗 = 档内最近 R−1 轮 | 设计稿「全量 compact」口径的唯一正确落地：第 R 轮位留给下一回合本条消息，与自动路径窗口口径衔接无轮间缝隙（若保留 R 轮，下一回合组装将丢失第 R−1 轮——既不在摘要也不在最近窗）；「总轮数 ≤ R → 无需压缩」按档内 user 轮数判定（design §5.1 逐字） |
| 4 | 懒回填范围 = 该会话全部待测 ok 行 | 多次压缩之间无回合时，各行「压缩后首次 step=1 实测值」为同一次调用——全部回填语义正确（每行各自的 after 首测口径）；失败行不回填（未生效压缩无降幅语义，REQ-041 异常分支） |
| 5 | 成本归属：unified compress 行 tokens_prompt 并入输入分项 | design §5.2 逐字（tokens_prompt×input_per_mtok÷1e6）：不扩 tokens_prompt 显示列（卡 A 分项显示形状零变化），仅成本计算纳入；摘要 completion tokens 不计成本（按输入计价，CHG-010 3.3）；self 模式 compress 行不计成本（定夺⑥口径自然延伸） |
| 6 | extractMessage 加法支持 object detail {message} | 409 服务端 message 逐字呈现（design §5.1 前端消费规则「前端直接呈现，两路径同文」）的数据通道；backend.ts 加法改动，既有 string/array detail 形状零变化 |
| 7 | AdminTelemetry.compact 为可选键 | 旧后端窗口期兼容（沿 AdminOverview.search_enabled 先例）；缺失按空态渲染（C15），新后端恒携带 |
| 8 | 走查脚本跨进程直插后 WAL checkpoint(TRUNCATE) 收敛 | 脚本侧健壮性（造数写入对后端新连接立即可见），零产品代码影响；会话加载前置核对（s_bad 后端可见才继续） |
