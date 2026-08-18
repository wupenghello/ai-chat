# iter-15 验证留档（T0 段）

> T0 = 前置取证 + 产品人设中性默认稿（plans/iter-15.md T0 行）：① DeepSeek（统一 key）usage 缓存字段形状冒烟（REQ-037 验收 2 取证条款）② 自填端点多 system 消息兼容性冒烟 + usage 字段矩阵（REQ-036 异常分支）③ 产品人设中性默认稿（定夺⑧，2026-08-19 CEO「批准」按稿定稿）。后续任务（T1/T2/T3）留档将追加本文件。

## T0 前置取证 + 产品人设中性默认稿（2026-08-19 执行）

### 1. 环境与路径

| 项 | 值 |
|---|---|
| 冒烟方式 | 独立取证脚本直连上游（不经本后端，隔离产品路径；零产品代码改动） |
| 运行环境 | backend/.venv（Python + httpx 0.28.1），项目根目录执行 |
| key 注入 | `set -a; source backend/.env; source .env; set +a` 经进程环境注入；key 仅存在于上游请求头 Authorization |
| key 卫生 | 本文件与脚本输出全程零 key 明文，引用以变量名 + 掩码指代：AI_CHAT_UNIFIED_KEY（`sk-****2c36`）、VITE_GLM_API_KEY（`****iEF2`）——沿 iter-14 T0 口径 |
| 脚本登记 | `scripts/usage_cache_smoke.py`（冒烟①）、`scripts/multi_system_smoke.py`（冒烟②）——取证脚本非产品代码，不随日常测试运行 |
| 端点范围 | 只含 chat/completions 上游 LLM 端点；.env 中 Tavily（AI_CHAT_SEARCH_KEY）/博查（AI_CHAT_BOCHA_KEY）/和风天气（AI_CHAT_WEATHER_KEY/HOST）为工具 API，非对话上游，不在本冒烟范围 |

### 2. 冒烟① DeepSeek（统一 key）usage 缓存字段形状取证

请求形态：非流式 `POST https://api.deepseek.com/chat/completions`（stream=false，便于取完整 usage；另以流式探针 D 核对生产路径形态），model=deepseek-chat（AI_CHAT_UNIFIED_MODEL）。消息内容为测试占位句（「只回复两个字：甲子」等），无敏感内容。

#### 2.1 原始 usage 逐字留档（脱敏：零 key；两轮运行均为真实观测值）

**首轮（冷启动，miss→hit 全过程主证据）**：

```
A 基线（单条 user，最简请求）：
{"prompt_tokens": 9, "completion_tokens": 1, "total_tokens": 10, "prompt_tokens_details": {"cached_tokens": 0}, "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 9}

B1 短前缀·第一次（system[0]=人设稿 256 字符 + system[1]=时间行 + user 占位）：
{"prompt_tokens": 183, "completion_tokens": 2, "total_tokens": 185, "prompt_tokens_details": {"cached_tokens": 0}, "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 183}

B2 短前缀·第二次（system[0] 逐字节同 B1，system[1] 时间行与 user 变化）：
{"prompt_tokens": 183, "completion_tokens": 2, "total_tokens": 185, "prompt_tokens_details": {"cached_tokens": 128}, "prompt_cache_hit_tokens": 128, "prompt_cache_miss_tokens": 55}

C1 长前缀·第一次（system[0]=人设稿+填充段 3018 字符 ≈1664 tokens，尾部与 B 同构）：
{"prompt_tokens": 1743, "completion_tokens": 2, "total_tokens": 1745, "prompt_tokens_details": {"cached_tokens": 128}, "prompt_cache_hit_tokens": 128, "prompt_cache_miss_tokens": 1615}

C2 长前缀·第二次（system[0] 逐字节同 C1，尾部变化）：
{"prompt_tokens": 1743, "completion_tokens": 2, "total_tokens": 1745, "prompt_tokens_details": {"cached_tokens": 1664}, "prompt_cache_hit_tokens": 1664, "prompt_cache_miss_tokens": 79}
```

**复跑（热缓存稳态 + 流式探针）**：B1/B2 均 hit=128、miss=55；C1/C2 均 hit=1664、miss=79（首轮已缓存，符合缓存语义）。

```
D 流式探针（stream=true + stream_options.include_usage，与生产路径同形态）末帧 usage：
{"prompt_tokens": 1743, "completion_tokens": 2, "total_tokens": 1745, "prompt_tokens_details": {"cached_tokens": 1664}, "prompt_cache_hit_tokens": 1664, "prompt_cache_miss_tokens": 79}
流式末帧 usage 字段集与非流式完全一致（含缓存字段）✅
```

#### 2.2 字段形状逐字段表（T2 字段映射输入）

| 字段路径 | 类型 | 数值语义 | 备注 |
|---|---|---|---|
| `prompt_tokens` | int | 输入 token 总量 | 恒 = hit + miss（实测逐笔核对：0+9、0+183、128+55、128+1615、1664+79 均成立） |
| `completion_tokens` | int | 输出 token | |
| `total_tokens` | int | prompt + completion | 现状配额落账即取此字段（agent.UpstreamCall / quota.extract_total_tokens） |
| `prompt_cache_hit_tokens` | int | 命中前缀缓存的输入 token | **恒存在**（未命中时值为 0 而非字段缺失——A 基线实测） |
| `prompt_cache_miss_tokens` | int | 未命中的输入 token | 同上恒存在 |
| `prompt_tokens_details.cached_tokens` | int（嵌套对象） | OpenAI 兼容镜像字段 | 实测恒 = `prompt_cache_hit_tokens`，二者取一即可（建议取原生两字段） |

#### 2.3 缓存命中语义（「前缀缓存受益」断言的实现输入）

1. **首现 miss、同前缀再调 hit**：B1 hit=0/miss=183 → B2 hit=128/miss=55；C1 → C2 hit 128→1664。system[1] 时间行与 user 消息逐次变化不影响 system[0] 前缀命中——**B1 两段式分区（静态在前）的收益机制实测成立**。
2. **缓存按 128-token 块粒度**：hit 取值均为 128 的整数倍（128；1664=13×128）；人设稿前缀 ≈150 tokens 仅命中前 128 块。
3. **短前缀亦有缓存**：人设稿体量（256 字符/≈150 tokens）的 system[0] 已产生 128-token 块命中——未观测到「最小 1024 tokens 才缓存」的门槛行为（以实测为准，不凭文档臆断）；静态前缀越长受益越大。
4. **增量前缀复用**：C1 复用了 B 阶段已缓存的 PERSONA 头部（hit=128）——前缀按从头逐 token 精确匹配、可部分复用。
5. **流式与非流式 usage 字段集一致**（探针 D）：生产路径（stream=true + include_usage）末帧即含全部缓存字段，T2 流式采集面无形状差异。

#### 2.4 T2 字段映射口径（本结论为 REQ-037 字段映射唯一实现输入，同步 T2）

- `tokens_prompt ← prompt_tokens`；`tokens_completion ← completion_tokens`；`tokens_total ← total_tokens`
- `cache_hit_tokens ← prompt_cache_hit_tokens`；`cache_miss_tokens ← prompt_cache_miss_tokens`（DeepSeek 统一 key/自填均恒返回，无 NULL 场景；`prompt_tokens_details.cached_tokens` 为镜像字段不重复映射）
- 命中率聚合口径（REQ-038）：Σhit/(Σhit+Σmiss) 在 DeepSeek 侧恒可计算；自填端点字段缺失时按 NULL→缺失标注（铁律 5）

### 3. 冒烟② 自填端点多 system 消息兼容性 + usage 字段矩阵

载荷形态（模拟 B1 两段式分区）：`system[0]`=人设稿（§4 全文，与冒烟①逐字节同源）+ `system[1]`=「当前时间：2026-08-19（周三）09:00（北京时间）」+ `user`=冒烟占位提问；非流式。

#### 3.1 逐端点取证

**DeepSeek（api.deepseek.com / deepseek-chat，key 变量 AI_CHAT_UNIFIED_KEY，按自填档案同形态请求）——接受**：

```
HTTP 200
回复片段：收到
usage 原文：{"prompt_tokens": 189, "completion_tokens": 1, "total_tokens": 190, "prompt_tokens_details": {"cached_tokens": 128}, "prompt_cache_hit_tokens": 128, "prompt_cache_miss_tokens": 61}
```

两条 system 消息被正常接受，回复正常；usage 字段矩阵与冒烟①完全一致（6 顶层字段，hit=128 为冒烟①已缓存人设前缀的复用，语义自洽）。

**GLM（open.bigmodel.cn/api/paas/v4 / glm-5，key 变量 VITE_GLM_API_KEY）——无法判定（余额拒绝，先于消息校验）**：

```
HTTP 429
错误体原文：{"error":{"code":"1113","message":"余额不足或无可用资源包,请充值。"}}
```

- 错误为账户余额类（1113，与 DEF-002/DEF-005 在案口径一致），发生于消息内容校验之前，**GLM 对多 system 的接受/拒绝无法判定**——非「明确拒绝多 system」。
- usage 字段矩阵缺失（无成功响应可取）。
- 处置：延续 DEF-002 CEO 决策口径（2026-08-15/16「不充值 GLM、不补验」；本次冒烟为 T0 既定取证任务，取证结果即 429/1113 如实记录）；GLM key 充值恢复后随测补取多 system 兼容与 usage 矩阵，不阻塞 B1。

#### 3.2 usage 字段矩阵差异摘要

| 字段 | DeepSeek（统一 key 与自填同形） | GLM |
|---|---|---|
| prompt_tokens / completion_tokens / total_tokens | ✅ int 三分项 | 缺失（未取证；恢复后补验） |
| prompt_cache_hit_tokens / prompt_cache_miss_tokens | ✅ int 恒存在 | 缺失（未取证；GLM 类端点无缓存概念，预期 NULL——**实测确认前不作为实现依据**） |
| prompt_tokens_details.cached_tokens | ✅ 镜像字段 | 缺失（同上） |

**缺失即 NULL 口径依据**：自填模式各端点 usage 形状不可预设，T2 映射一律按「上游返回则如实记、不返回记 NULL」（铁律 5）；DeepSeek 自填与统一 key 同形状已实测，其余端点（GLM 类）缓存列按 NULL→聚合显缺失处理。

#### 3.3 结论（REQ-036 异常分支判定）

- **未见任何端点明确拒绝多 system 消息**（DeepSeek 接受；GLM 为余额拒绝非消息形态拒绝）→ 按 CHG-009/REQ-036「冒烟未见问题则不做」：**不实现、不登记「合并 system 单段」回退开关**（若后续 GLM 补验发现明确拒绝，届时按 REQ-014「支持工具」开关同哲学另登记报 CEO 批准）。
- B1 两段式分区可按计划直接实施，无端点级阻断。

### 4. 产品人设中性默认稿（**状态：已审签定稿——2026-08-19 CEO「批准」，按稿定稿，未加品牌名，维持中性原文**）

内容物定位：`system[0]` 静态前缀的源文本，跨全部用户全部请求字节恒定（不含时间行、不含用户提示词、无占位符）。体量 256 字符（冒烟①实测含该前缀的最简请求 prompt_tokens=183，前缀本体约 150 tokens）。全文如下：

```text
你是一个 AI 对话助手，在本服务中为用户提供对话与问答协助。

行为准则：
一、准确：基于上下文与工具返回的实际内容作答；引用联网搜索等工具结果时忠于原文并注明来源。
二、诚实：不确定时明确说明不确定；不知道时直接说不知道，不编造事实、数据、链接或来源。
三、如实转述工具结果：工具成功则按其结果作答；失败、超时或无结果时如实说明，不用虚构内容代替。
四、时效意识：涉及时效的问题优先使用可用工具查证；无法查证时提示信息可能过时。
五、表达克制：使用与用户一致的语言直接作答，不堆砌套话；结构与详略随问题调整。
```

起草依据与说明：
- 依产品定位（spec §1：多用户自部署 Web 服务的 AI agent 对话助手，账号体系 + 云端会话，支持工具调用与联网搜索）；中性、克制，不虚构身份背景（无品牌名、无人格设定——CEO 审签确认未加品牌名，维持中性原文定稿）。
- 五条行为基调覆盖任务要求：准确、诚实、不知道就说不知道、工具结果如实转述，另补时效意识（与 CHG-008 时间行/搜索 days 机制呼应）与表达克制。
- 定稿登记形态（2026-08-19 审签后已落地）：变量 `AI_CHAT_PRODUCT_PERSONA` 写入 `backend/.env`（多行值双引号包裹，pydantic-settings 解析实测与定稿逐字节一致，746 字节 / 8 行，既有行零改动）+ `backend/.env.example` 占位条目；定稿文案逐字登记本文件（T0 验收标准）。config.py 变量接线随 T2。

### 5. 验收对照（plans/iter-15.md T0 行）

| 验收标准 | 证据 | 判定 |
|---|---|---|
| 两项冒烟结论与人设稿（CEO 审签）留档 plans/iter-15-verify.md T0 段 | 本文件 §2/§3/§4（原始响应逐字留档，零 key）；人设稿 2026-08-19 CEO「批准」定稿 | ✅ |
| 字段形状结论同步 T2 字段映射口径 | §2.4 映射口径（REQ-037 验收 2「冒烟结论为字段映射的唯一实现输入」达成：全部字段名/类型/语义为真实调用实测，未凭文档臆断） | ✅ |
| 人设稿定稿文案逐字登记（静态前缀内容物，跨请求字节恒定的源） | §4 全文逐字（2026-08-19 CEO 审签定稿，未加品牌名维持中性原文；`backend/.env` 注入实测逐字节一致 + `.env.example` 占位） | ✅ |
| 零产品代码改动、无未登记变更 | backend/ 与 src/ 零改动；新增仅 scripts/ 两取证脚本（§1 登记）与本文件；GLM 缺失如实记录不造数（铁律 5） | ✅ |

### 6. 偏差与观察（如实登记）

- **零产品缺陷、零新增 DEF**。
- **观察①（GLM 取证缺失，非缺陷）**：GLM key 余额不足（429/1113），多 system 兼容与 usage 矩阵无法取证——延续 DEF-002 在案口径（CEO 决策不充值不补验），充值恢复后随测；B1 实现按 §3.2 NULL 口径防御，不受阻。
- **观察②（现状口径，T2 改造标的）**：现两条上游路径仅采集 total_tokens（agent.UpstreamCall 取 usage.total_tokens；legacy 路径 quota.extract_total_tokens 正则取末帧）——缓存字段当前被丢弃，即 REQ-037/T2 的改造对象，非缺陷。
- **观察③（脚本断言自纠一轮，诚实登记）**：`usage_cache_smoke.py` 首轮断言「长前缀第一次必 miss（hit=0）」未考虑探针间共享 PERSONA 前缀的跨阶段复用（C1 实测 hit=128，为 B 阶段已缓存前缀块的增量命中——本身即前缀缓存语义的正向证据）；已修正为「第二次命中量 ≥ 第一次」，复跑全绿。脚本问题，非上游异常。
- **观察④（B1 素材）**：DeepSeek 缓存为 128-token 块粒度且短前缀亦命中——人设稿（≈150 tokens）即有 128-token 块级受益；静态前缀体量与共享请求量越大降本越显著，效果量化留 REQ-038 遥测面板上线后以真实数据度量（审核稿 B1+B2 效果叙事口径）。

---

## T2 后端 B1 核心（2026-08-19 执行）

> T2 = plans/iter-15.md T2 行八子项：① 两段式分区组装 ② 迁移 v8 + 双端采集 ③ usage 分项与缓存字段映射 ④ 写失败不阻塞 ⑤ 90 天惰性清理 ⑥ 旧透传端点下线执行（定夺④）⑦ 人设/单价 config 接线 ⑧ 卫生。实现输入：T0 取证段 §2.4（字段映射唯一输入）+ design-iter-15 §5（API 口径，聚合端点归 T3，T2 交付数据层）。

### 1. 验收条款对照（逐条）

#### REQ-036（验收 1~5）

| 验收 | 断言 | 用例（pytest + MockTransport 捕获） | 判定 |
|---|---|---|---|
| 1 静态前缀字节稳定 | 不同用户（alice/bob）、不同会话（s1/s2）、不同时刻（_now_line 两值注入）任意两回合 system[0] content 逐字节相同 | test_turn::test_分区_静态前缀跨用户跨会话跨时刻字节恒定 | ✅ |
| 2 动态尾区完整性与隔离 | 用户提示词与时间行仅在 system[1]；system[0] 检索不到时间串与用户提示词；非 system 段不含时间行 | test_turn::test_分区_动态尾区完整性与隔离 + test_分区_用户提示词留空_动态尾区仅时间行 | ✅ |
| 3 窗口规则零变化 | 第 30 轮请求体仍仅最近 20 轮（第 12 轮 user 起 38 条 + 本条，分区在位复验） | test_turn::test_分区_第30轮窗口零变化_仍仅最近20轮 | ✅ |
| 4 「组装等价」类用例改写登记 | 旧断言 → 新断言逐条映射（本段 §3） | 改写 + 新增用例全绿 | ✅ |
| 5 空配置回归 | product_persona="" → system 部分与基线 v5 形态逐字段等价（单 system + 最近 20 轮，msgs == expected 逐字） | test_turn::test_组装等价_空配置回退与基线v5逐字段等价 | ✅ |

#### REQ-037（验收 1~6）

| 验收 | 断言 | 用例 | 判定 |
|---|---|---|---|
| 1 三调用恰三行 | 3 次上游调用 → telemetry 恰 3 条 llm 行；tokens_total 逐行与 usage 帧一致（1200/1500/900）；latency_ms>0（mock 流内 5ms 实延）；turn_id 同一、step 1/2/3 连续；usage 事件面零变化（requests=3 tokens=3600） | test_telemetry::test_三调用回合_恰3条llm行_逐值一致 | ✅ |
| 2 缓存字段如实性 | 含缓存字段 usage（T0 §2.1 形状样件 183/2/185/hit128/miss55）→ 逐值落库；仅 total 的 usage → prompt/completion/hit/miss 全 NULL、total 如实（77）；映射口径 = T0 §2.4 逐字实现（prompt_tokens_details.cached_tokens 镜像字段不重复映射） | test_telemetry::test_缓存字段_上游返回_逐值落库 + test_缓存字段_上游不返回_记NULL不造数 | ✅ |
| 3 配额数据面零回退 | test_quota.py **逐字节零改动**（git diff 为空取证）复跑全绿；quota.py 与 usage_daily 数据面零改动（git diff 为空） | 本段 §4 零改动取证 + 231 全绿内 test_quota 17 例 | ✅ |
| 4 主路径隔离 | telemetry.connect 故障注入（OperationalError）→ 回合正常完成、事件序 turn.start~turn.end 完整、零补造行 | test_telemetry::test_遥测写故障注入_回合正常完成 | ✅ |
| 5 卫生断言 | key/用户消息/用户提示词/工具结果全文四探针：telemetry 全表 dump 零命中 + 全日志（DEBUG 级 caplog）零命中 | test_telemetry::test_卫生_表与日志零key零内容零工具结果全文 | ✅ |
| 6 工具遥测同源 | search/echo 各一次 → tool 行（tool_name/status/latency_ms）与网关日志四字段逐值同源（caplog 解析 name=/status=/duration_ms= 对行断言；truncated 第四字段仅日志侧——schema 无该列，CHG-009 4.2 定稿） | test_telemetry::test_工具遥测_search与echo各一次_与网关日志同源 | ✅ |

#### 改写与波及条款

| 条款 | 断言 | 用例 | 判定 |
|---|---|---|---|
| REQ-033 验收 1（新口径） | 空配置回退等价（上表 REQ-036 验收 5 用例承载）+ 分区在位断言引用 REQ-036 验收 1/2/5 用例，改写映射 §3 登记 | 同上 | ✅ |
| REQ-008 验收 3（分区改口径） | 25 轮会话系统提示词仍在动态尾区段首位（system[1] 以提示词起首）、静态前缀段在其前、不被截断 | test_turn::test_分区_超20轮系统提示词仍在动态尾区段首位 | ✅ |
| REQ-030/031 波及复验 | SSE v2 事件流逐帧零变化（test_turn 既有事件序用例零改动复跑）；网关四字段口径不变（test_agent_tools 31 例零改动复跑） | 231 全绿内既有 191 例零改动 | ✅ |

### 2. 实现要点（对合同八子项）

| 子项 | 落地 |
|---|---|
| ① 两段式分区 | `agent.assemble_context` 单点改造：新增 `product_persona` 形参（缺省 ""）——非空 → system[0]=人设原文（不做任何拼接/插值，字节恒定）+ system[1]=用户提示词（如有）+ 时间行；空 → 基线 v5 单 system 逐字段等价。20 轮窗口与 user 锚定截断代码零变化；tools 字段下发路径未动（不文本化）。回合端点单点传参 `settings.product_persona` |
| ② 迁移 v8 + 双端采集 | db.py MIGRATIONS[8]（schema 与 CHG-009 4.2 逐字一致）+ SCHEMA_VERSION=8；存量库实测 v5→v8 升迁成功（列/索引核验）。llm/tool 行经 run_turn `telemetry_sink`（路由侧闭包补 day/user_id/mode/endpoint 后写库）；legacy 行按下线序列先行采集（本段 §5 取证） |
| ③ 字段映射 | `app/telemetry.py::record_llm`——T0 §2.4 口径：prompt/completion/total ← prompt_tokens/completion_tokens/total_tokens；hit/miss ← prompt_cache_hit_tokens/prompt_cache_miss_tokens；缺字段 → NULL（total 缺失记现状口径 0）；镜像字段 cached_tokens 不映射。agent.UpstreamCall 增 `usage_detail` 原文留存（quota 落账口径 `usage` 零变化） |
| ④ 写失败不阻塞 | 独立短连接 + 事务（沿 quota.record_tokens 先例）；sqlite3.Error → warning 不补造；run_turn 侧 `_emit` 再包一层 Exception 护栏（双保险）；故障注入用例全绿 |
| ⑤ 90 天惰性清理 | 每次写入机会式检查水位（app_settings `telemetry_purged_day`，跨自然日一次）；DELETE day < 今日-89 天 = 含今日 90 个自然日；清理与写入分事务——清理失败不丢当行；两用例（边界 89/91 天 + 清理失败注入）全绿 |
| ⑥ 下线执行 | 见 §5 序列取证（legacy 采集上线 → 流量取证 → 端点删除 → 404 取证 → 16 例退役映射 §3 → proxy_smoke 迁 `scripts/turn_smoke.py`） |
| ⑦ config 接线 | `product_persona`（AI_CHAT_PRODUCT_PERSONA，.env 值 T0 就位，Settings 解析实测通过）+ 单价三变量 `price_input/price_output/price_cache_hit`（float|None，元/百万 token；AI_CHAT_PRICE_INPUT/OUTPUT/CACHE_HIT，.env.example 占位已补，任一缺失 → None = 未配置，T3 聚合 `configured=false` 语义承接）。**注**：config 接线提交前曾发生一次外部回退，按 T2 合同 ⑦ 恢复并全绿，随本留档登记 |
| ⑧ 卫生 | 表：telemetry 仅存数值/枚举/model/tool_name/error_code，无内容列；日志：telemetry/agent/proxy 新增日志面仅 kind/endpoint/user_id/mode 等维度字段；断言用例（验收 5）+ 代码审查双取证 |

### 3. 测试改写与退役映射登记（全局回归基线口径）

#### 3.1 「组装等价」类用例改写映射（REQ-036 验收 4，功能性删除为零）

| 旧用例（基线 224 内） | 旧断言 | 新口径断言 | 承载用例 |
|---|---|---|---|
| test_turn::test_组装等价_系统提示词首位加最近20轮 | msgs[0] 单条 system = 用户提示词+时间行；30 轮取最近 20 轮逐字段等价 | 静态前缀**空配置**下与基线 v5 形态逐字段等价（回归锚点，断言本体逐字保留，增 `product_persona=""` 显式注入）；分区在位形态另立 REQ-036 验收 1/2/3/5 用例 | test_turn::test_组装等价_空配置回退与基线v5逐字段等价 |
| test_turn::test_组装_系统段恒含当前时间行（CHG-008 用例） | 纯函数 assemble_context：无提示词 → 系统段仅时间行；有 → 拼接 | **零改动**（纯函数缺省 persona="" = 基线行为；分区在位的时间行断言由 test_分区_动态尾区完整性与隔离 承载） | 原用例 + 分区新用例 |

#### 3.2 test_proxy 16 例退役映射（定夺④方案 A，决策驱动的功能性移除例外登记）

| # | 旧用例（含参数化） | 旧断言摘要 | 退役去向 |
|---|---|---|---|
| 1 | TestAuthGate::test_未登录_401 | 未登录 401、零上游 | 收编 → test_turn::test_turn_未登录_401 |
| 2 | TestUnifiedMode::test_转发_sse_逐字节透传 | 响应字节 == 上游 SSE 原文 | **无对等物**——逐字节透传为被下线功能本体；帧切分/事件面由 test_turn::test_两步工具回合_事件序逐帧 承载（SSE v2 重组语义） |
| 3 | TestUnifiedMode::test_转发请求_模型取服务端配置_body_model_被忽略 | model 取服务端配置、provider 不透传 | 收编 → test_turn::test_turn_载荷_model取服务端配置（turn 请求体本无 model 字段） |
| 4 | TestUnifiedMode::test_统一密钥未配置_503_引导文案 | 503 unified_key_missing + 文案 | 收编 → test_turn::test_turn_统一密钥未配置_503_引导文案 |
| 5 | TestProfileRouting::test_生效档案_路由到档案上游与密钥 | 档案 base_url/key/model 路由 | 收编 → test_turn::test_turn_自填档案_路由到档案上游与密钥_回退统一key（前半） |
| 6 | TestProfileRouting::test_无生效档案_回退统一_key_路由 | 删档案回退统一 key | 收编 → 同上前半用例（后半） |
| 7 | TestProfileRouting::test_档案_明文密钥不出现在任何响应 | key 不出响应 | 拆分：profiles CRUD 响应面由 test_profiles 既有用例承载（零改动）；对话链路 key 卫生收编 → test_telemetry::test_卫生_表与日志零key零内容零工具结果全文 |
| 8/9 | TestUpstreamErrors::test_上游_401_403_映射_502_密钥无效文案[401/403] | 401/403 → 502 upstream_auth 文案 | 收编 → test_turn::test_上游错误_映射为error事件_回合不崩[401/403]（SSE error 事件承载，code 同源 §3.1；回合端点 HTTP 层恒 200 流式） |
| 10 | TestUpstreamErrors::test_上游_429_透传_限流文案 | 429 upstream_rate_limited | 收编 → test_turn::test_上游错误_映射为error事件_回合不崩[429] |
| 11/12 | TestUpstreamErrors::test_上游_5xx_映射_502_不可用文案[500/503] | 5xx → 502 upstream_error | 收编 → test_turn::test_上游错误_映射为error事件_回合不崩[500]（≥400 同分支覆盖 503）+ test_telemetry::test_llm行_上游5xx_error终态带映射码 |
| 13 | TestUpstreamErrors::test_上游超时_504 | ConnectTimeout → 504 upstream_timeout | 收编 → test_turn::test_turn_上游连接异常_error事件[ConnectTimeout] |
| 14 | TestUpstreamErrors::test_上游连接失败_502_unreachable | ConnectError → 502 upstream_unreachable | 收编 → test_turn::test_turn_上游连接异常_error事件[ConnectError] |
| 15 | TestStreamInterrupt::test_上游流中断_补帧_已收内容保留 | 中断补 upstream_interrupted 帧 | 收编（语义迁移）→ test_turn::test_turn_上游流中断_error事件_回合不崩（SSE v2 无补帧机制，中断映射 upstream_unreachable error 事件） |
| 16 | TestKeyHygiene::test_全部响应体检索不到任何密钥 | 全响应零 key | 收编 → test_telemetry::test_卫生_表与日志零key零内容零工具结果全文（表+日志面扩展）+ test_profiles 既有用例 |

**共享夹具迁移**：test_proxy.py 保留为纯基座模块（upstream_app / _sse_response / SSE_FRAMES / ok_handler）；`chat` 驱动器随端点下线迁至回合端点（幂等会话 + POST /api/chat/turn，配额检查位与落账同源，断言语义不变）——test_quota/test_admin 文件零改动由此承接（**DEF-035**：该间接依赖为 CHG-009 影响分析未显式盘点项，当轮发现当轮处置并登记）。

#### 3.3 其他波及改动登记（非组装等价类，逐条如实）

| 文件 | 改动 | 性质 |
|---|---|---|
| tests/test_search.py | `db_version(conn) == 7 → 8`（1 处） | 迁移 v8 波及的 schema 版本锚点同步（非断言语义变化） |
| app/routers/proxy.py | 回合拦截日志 `turn blocked → chat blocked` | 配额拦截取证标记统一（REQ-024 iter-8 定稿标记的唯一断言面在 test_quota，零改动门槛要求；plans/requirements 无「turn blocked」文案锁定，grep 取证） |

### 4. 零改动取证（REQ-037 验收 3 + 计划「quota.py 与 usage_daily 数据面零改动验证」）

| 对象 | 取证方式 | 结果 |
|---|---|---|
| tests/test_quota.py | `git diff -- backend/tests/test_quota.py` 为空 | ✅ 逐字节零改动，17 例复跑全绿（含跨零点 token 归属、熔断、档位联动） |
| app/quota.py | `git diff -- backend/app/quota.py` 为空 | ✅ 数据面零改动（check_and_consume/record_tokens/extract_total_tokens 原样；extract_total_tokens 随 legacy 端点退役成死代码，按「quota.py 零改动」纪律保留不删） |
| usage_daily 表 | 迁移 v8 仅新增 telemetry 表；v4/v6 既有列与约束未触 | ✅ |

### 5. 下线序列取证（定夺④方案 A，硬约束：先采集上线，再删端点）

| 步骤 | 动作 | 取证 |
|---|---|---|
| 1 legacy 采集上线 | proxy.py 旧端点 relay 增 telemetry 行（endpoint='legacy'，turn_id=NULL，total 如实、分项/缓存 NULL——legacy 历史仅解析 total，不为将下线端点新增解析面） | 代码落地 + 步骤 2 用例 |
| 2 流量取证留档 | test_telemetry::test_legacy行_旧端点每请求一行_turn_id为NULL 实测全绿：endpoint=legacy / turn_id NULL / step NULL / status ok / tokens_total=8 如实 / 分项与缓存列 NULL | **Phase A 全量复跑 247 passed（2026-08-19）含本用例**——先于端点删除的采集上线证据 |
| 3 端点删除 | proxy.py 删 chat_completions + ChatCompletionRequest/ChatMessage + _INTERRUPTED_FRAME + relay（含 legacy 采集）；模块文档改写为「回合端点唯一对话入口」 | 代码 diff 留档（git，主会话提交） |
| 4 请求 404 取证 | test_turn::test_turn_旧透传端点已下线_404（回归守卫：防静默恢复）+ scripts/turn_smoke.py 条 6 真机取证位 | ✅ 231 全绿内含 |
| 5 16 例退役映射 | 本段 §3.2 逐条登记 | ✅ |
| 6 proxy_smoke 迁 turn | scripts/proxy_smoke.py 删除 → scripts/turn_smoke.py（回合端点端到端 + SSE v2 事件序 + 首块延迟对照 + key 卫生 + 401 门禁 + 旧端点 404 取证，六项承继） | ✅ 脚本落地（真机运行随预览环境，沿 proxy_smoke 惯例不入日常测试） |

落地核对清单第 9 项（CHG-009）勾验：端点删除 ✅ + test_proxy 16 例退役映射 ✅ + proxy_smoke 迁 turn ✅——随本 T2 提交勾验（QA 复核点）。

### 6. 卫生自查结论（子项 ⑧）

- **表**：telemetry 19 列全部为数值/枚举/标识字段（day/ts/user_id/mode/turn_id/endpoint/kind/step/model/latency_ms/status/tokens×3/cache×2/tool_name/error_code），无消息内容、无工具结果、无 key 承载列；写入面 `_COLUMNS` 白名单防越界列。
- **日志**：新增日志仅 `telemetry write failed kind=/endpoint=`、`telemetry purge failed`、`telemetry sink failed kind=`（exc_info 中 sqlite 异常仅含占位符 SQL 不含值）；回合/配额既有日志面零扩展。
- **断言**：四探针（key/用户消息/用户提示词/工具结果全文）× 两面（全表 dump + DEBUG 级全日志）用例全绿。
- **.env 卫生**：单价三变量仅 .env.example 占位；人设值在 .env（不入 git）；key 类变量接线纪律沿既有（不入日志/响应）。

### 7. 测试数字（机器采集）

| 项 | 数 |
|---|---|
| 存量基线（计划时点） | pytest 224 |
| 退役（test_proxy 16 例，决策驱动例外登记） | -16 |
| 新增 test_turn（分区 5 例含 REQ-008 分区改口径 1 例 + 退役收编 6 例/7 用例含参数化 + 404 取证 1） | +13 |
| 新增 test_telemetry（验收 1/2/4/5/6 共 6 例——验收 2 两用例 + 终态行 2 + 清理 2） | +10 |
| **收口实测** | **231 passed（全绿）+ ruff clean**；vitest 305 零触达（前端零改动，T3 收口） |

### 8. 缺陷与遗留

- **新登记**：DEF-035（test_quota/test_admin 经共享驱动器 chat 间接命中被下线端点——CHG-009 影响分析未显式盘点项；当轮处置：chat 迁 turn、两文件零改动复跑全绿）。
- **遗留（T3 接口面摘要）**：
  1. 聚合数据层 = telemetry 表（day 为聚合主维度，服务器本地时区同 quota.today）；T3 端点形状/聚合公式/缺失与未配置语义以 design-iter-15 §5 为准逐字实现（GET /api/admin/telemetry?days=1~90；成本仅 mode='unified' llm 行；cache_rate=Σhit/(Σhit+Σmiss) 日级仅计带字段行；工具 GROUP BY tool_name,status；price.configured = 三变量全非 None；retention_days=90 取 telemetry.RETENTION_DAYS）。
  2. NULL 语义：cache 列 NULL = 上游未返回（聚合显缺失，永不显 0）；0 = 机器采集真值（DeepSeek hit=0 未命中如实）——T0 §2.3/§3.2 口径。
  3. endpoint='legacy' 值随 schema 保留（历史/取证行），下线后不再新增。
  4. 单价单位元/百万 token，成本 = Σtokens × 单价 ÷ 1e6（后端 6 位小数随 T3）。
- **观察**：T1 留档未落 plans/iter-15-verify.md（设计基线产物在 design/iter-15/ + spec 指针回填，tag 由主会话打）——本 T2 段按合同以 design-iter-15 §5 为 API 口径核对输入，逐字一致性已核（端点归 T3 实现，T2 数据层形状与之无冲突）。
