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
