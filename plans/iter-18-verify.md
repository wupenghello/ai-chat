# iter-18 验收留档 — D1 deep-research 子代理 + SSE 心跳（基线 req-baseline-v9 / CHG-012）

## T0 前置取证（2026-08-21，S=1，零产品代码改动）

### §1 research 指令 prompt 真实冒烟（DeepSeek 统一 key + stub search）

**环境与局限（先行声明）**：backend/.env 当前无 AI_CHAT_SEARCH_KEY（iter-14 备存 key 已不在 .env），search 以本地 stub 返回 Tavily 归一化形态样例（「结果摘要 + 来源列表」文本，与 app/search.py 结果组装同构）。方法论遵循度不受影响；**以下三项随真 Tavily key 就绪后随测**（沿 DEF-002 GLM 随测先例，非本迭代承诺项）：① [n] 引用标注与真实来源的对应关系 ② 报告字数精确达标（去 stub 元叙事后）③ 检索结果质量对报告事实质量的影响。

**冒烟设计**：非流式 chat/completions，messages = [system 人设（.env 实值）, system 时间行, system research 指令, user 开放问题]，tools = [search 定义（与 app/tools.py 注册形状一致，含 days 可选参数）]，16 步上限、单步 120s、max_tokens 8192。两问：Q1「目前主流的开源大模型推理框架有哪些？各自适合什么场景？」（枚举对比型）、Q2「一个人自部署 AI 对话服务，成本主要由哪些部分构成？如何压低？」（分析型）。脚本未沉淀（一次性取证，输入输出留档本节）。

**R1 轮（两问）结果**：

| 问题 | 步数 | 总耗时 | 总 tokens | search 次数 | 报告字数 | [n] 标注 |
|---|---|---|---|---|---|---|
| Q1 | 3 | 22.1s | 6239 | 4（2+2） | 3400 | 无（元叙事拒绝） |
| Q2 | 3 | 22.0s | 7575 | 7（3+4） | 2766 ✅ | 有 |

方法论四项结论：
1. **计划分点 ✅**：两问 step1 均先输出计划文本（182/238 字，子问题分点形态）并同时发起首批针对性 search——计划与首轮检索合并在 step1（ReAct 自然行为，计划可见性满足 REQ-046 主流程 3「子问题分点可见」）。
2. **逐子问题检索 ✅**：Q1 4 次 / Q2 7 次 search，query 与子问题一一对应（如 Q2 的「GPU 成本构成」「量化降显存」「电力运营」「租 vs 买」四子题各自成 query）；并行 tool_calls（单步 2~4 个）为自然形态。
3. **综合报告结构 ✅**：结论先行 + 分点论证两问均达成（样例留档 /tmp/research_smoke_results.json）。
4. **字数纪律**：Q2 2766 ✅、Q1 3400 超限 13%（含 ~250 字 stub 元叙事）——R1 第 3 条收紧为 R2。

**意外收获（模型品格取证）**：两问模型均主动识别 stub 数据为占位内容（example.com 通用摘要），Q1 明确声明「不能凭空捏造来源引用」后基于自身知识作答并如实说明局限——**拒绝编造引用正是 REQ-035「不编造来源」口径要的行为**，记录在案。

**R2 轮（Q1 复验，第 3 条收紧「正文」+「宁可精炼、不可超限」）结果**：5 步 / 26.5s / 14550 tokens / 9 次 search；报告 3235 字（元叙事 ~150 字，正文 ~3085，接近达标方向正确）；[n] 标注 0（模型彻底拒绝假引用——诚实但随测项①不可判）。**R2 定稿**（逐字断言面，T2 实现逐字落 research.py）：

```
你现在处于「深度研究」模式：对用户给出的开放问题完成一次完整的多轮检索研究，并交付带引用来源标注的综合报告。

工作方法：
1. 先输出研究计划：把问题拆解为 3~6 个具体、可检索验证的子问题，逐条列出；
2. 逐个子问题调用 search 工具收集证据：每个子问题至少检索一次；若某子问题你已确知无需检索即可回答，须明确说明理由；
3. 全部子问题覆盖后，输出综合报告：结论先行、分点论证；报告中的事实性内容须以 [n] 标注对应来源（n = 该次搜索结果来源列表中的序号，如 [1][3]）；报告正文不超过 3000 字，宁可精炼、不可超限；
4. 综合报告直接输出：不加「好的」「以下是报告」等前缀，不复述研究计划。

计划与检索过程中的中间文字会流式展示给用户：保持简洁，一句话说明正在查什么即可；完整论述只在最后的综合报告展开。
```

### §2 nginx 反代心跳实测（真实 Compose 部署形态）

环境：本机 colima + 既有 ai-chat-frontend 容器（iter-9 T3 全链路，nginx 托管 dist + 反代 /api），临时追加 /t60/（**无 proxy_read_timeout = nginx 默认 60s**）与 /t300/（复刻既有 /api/ 的 300s 配置）两个 location 反代 SSE stub 容器（静默流 / 周期注释帧流）；测毕已还原配置并移除 stub（/api/quota sanity 0.007s 正常）。

| # | 配置 | 流形态 | 结果 |
|---|---|---|---|
| T-A | 默认 60s | 静默 120s | **60.0s 整 nginx 主动断连**（curl exit 18 transfer closed） |
| T-B | 默认 60s | 每 20s `: ping\n\n` 注释帧，总 100s | **100.0s 完整存活**（5×ping + data: end，exit 0） |
| T-C | 300s（复刻部署现状） | 静默 120s | **120.0s 完整存活**（data: end，exit 0） |

**结论**：
1. CHG-012 取证推理坐实：默认反代配置下静默流 60s 被切（T-A）；**20s 心跳注释帧使其在同样配置下完整存活**（T-B）——REQ-045 心跳方案有效性实证，**间隔 20s 定档定案**（60s 超时下 3 倍余量）。
2. **部署配置发现（口径修正）**：本仓部署形态 /api/ 反代显式配置 `proxy_read_timeout 300s`（iter-9 T3 为 SSE 长流所设，注释「上游 read 最长 120s」在案）——单步 120s 上限内现状部署实际安全（T-C 坐实）。心跳的价值口径由「修复现状断连风险」修正为：**不依赖部署者记得配置超时的鲁棒性**（默认/其他反代层 [云 LB 常见 60s] 下仍有保护）+ 消除对单点配置的依赖。REQ-045 描述无需改动（「连接层修复不分模式」口径仍成立，本节为实证细化）。
3. REQ-045 验收 4（反代实测 90s 静默不断连）的走查脚本承载口径：T2 交付后在心跳在位的前端全链路下复测（走查一条）。

### §3 护栏参数初校（定夺⑥ ±4 步 / ±300s 授权）

真实研究回合两轮实测：3 步 / 22.1s / 6239 tokens 与 5 步 / 26.5s / 14550 tokens（R2 轮因模型对 stub 数据多检索两轮而偏高）。**16 步 + 900s 维持，授权内零调整**（护栏为兜底非常态路径：常态 3~5 步余量 3~5 倍；单回合 tokens 峰值 ~14.6k，统一 key 按回合计费口径不受影响）。900s 校准备注：单步实测 1.3~16.8s，16 步 × 均值上界 << 900s，900s 足以容纳极端检索轮次。

### §4 T0 汇总

- research 指令 prompt **R2 定稿**（§1 逐字，T2 逐字断言面）；方法论四项全过；随测三项登记（真 Tavily key 就绪后）。
- 心跳 **20s 定档**（§2 实证）；部署配置 300s 发现与价值口径修正在案。
- 护栏 **16 步 + 900s 维持**（§3，授权内零调整）。
- 零产品代码改动；零 DEF；实测脚本与结果未沉淀 git（一次性取证，关键数据本节留档）。

## T2 后端核心（2026-08-21，L=4，REQ-045 心跳 + REQ-046 编排）

### 亲跑核验结论（v1.4.14 B）

主会话亲跑 `uv run ruff check .`（All checks passed）+ `uv run pytest -q`（**332 passed**，机器采集 `--collect-only` 计数 332）——与开发 agent 回报一致，采信。基线 312 例全数保留、功能性删除为零，新增 20 例（test_research.py）+ 改写既有 1 处（test_quota.py）。R2 逐字性由 test_research 逐字断言锚定（332 全绿即证），抽查 research.py 常量与 §1 定稿逐字等价（源码物理行拼接、注释声明在案）。

### 改动文件

| 文件 | 要点 |
|---|---|
| config.py | +3 参数 max_research_steps=16 / research_total_timeout=900.0 / heartbeat_interval=20.0（T0 定死值注释在案） |
| research.py（新） | RESEARCH_PROMPT（R2 逐字）+ ResearchProfile dataclass + research_profile() + inject_instruction()（六层注入序） |
| agent.py | run_turn 增可选 research 参数（steps_limit/total_deadline）+ TurnTimeLimit 异常 + turn.end reason 加法 'time_limit'（步数到顶沿 max_steps）；流式等待取「步超时 vs 总时长余额」较小者、判因区分 |
| routers/proxy.py | TurnRequest.mode Literal 校验 + `_tool_gates()` 共享判定（三与门一处读两用）+ research_unavailable 422（先于计费）+ research 指令注入（记忆后同位）+ 遥测 endpoint='research' + stream() 心跳 watchdog + GET /api/quota 加法 research_available + 间隔兜底 |
| .env.example | +3 参数占位（标注 T0 定死值） |
| tests/test_research.py（新） | 20 例（REQ-045 1~3 + REQ-046 1~8 + mode 校验 + quota 端点 + 逐字锚点 + 间隔兜底） |
| tests/test_quota.py | 改写 1 处（精确 dict 断言补 research_available） |

quota.py / db.py / tools.py / telemetry.py **零改动**（endpoint 参数已存在，sink 传 'research'；计费沿既有点位——1 发起 = 1 回合）。

### 验收条款逐条对照（REQ-045 1~3 + REQ-046 1~8）

- **REQ-045 ①静默保活**：interval 0.2s 注入压测，≥2 注释帧 + 相邻间隔 ≤ interval+1.0s（缩小映射登记）✅；②前端零感知 pytest 面：data: 行序列 = 完整事件序无 ping 混入 ✅；③普通回合零回退：心跳共存 + 事件序逐帧 = REQ-030 验收 1 等价序，全量回归复跑全绿 ✅；④反代实测 T0 已留档（§2）不重复 ✅。
- **REQ-046 ①帧级+注入位**：13 事件逐帧 + 首步请求体 research 指令位置（system[1] 后记忆前）/R2 逐字 + system[0] 人设/时间行不回退（含记忆预置六层序）✅；②步数硬上限：max_research_steps=3 → turn.end(max_steps) 内容保留不悬挂 ✅；③时长护栏：工具拖超/上游流中到顶 → turn.end('time_limit') 无孤儿 ✅；④计费：5 次调用 → turns+1、tokens=1500 数值断言 ✅；⑤门控拒绝：三与门三分支各 422 零上游零事件流 + mode 缺省零影响 + 非法 mode 422 ✅；⑥网关复用：非法入参 error 回填回合继续 + tool 行 endpoint='research' 落库 ✅；⑦断连取消（口径见决策 5）✅；⑧卫生：指令/事件流/遥测零 key ✅。

### 实现级决策清单（登记留档）

1. **心跳形态**：单生成器「事件等待超时补帧」（asyncio.wait 竞速 anext 任务 vs 心跳间隔），非独立 watchdog 协程——不引入第二任务、断连取消经 anext 任务注入既有清理、补帧失败面由构造消除（退化为尽力而为 try）。
2. **参数化（单实现优先）**：采纳参数化而非薄复制——run_turn 仅 +1 可选参数 + 3 处时限检查 + 1 内部异常；research=None 时普通回合逐字节等价（312 例锚点），未走薄复制。
3. **门控函数**：`_tool_gates()` 提至 proxy.py 模块级，search 下发门与 research 可用性门（含 quota 端点）共用，零复制判定路径。
4. **时长护栏语义**：步间/工具段边界检查（到顶即终态）；流式段内压进 wait_for 剩余时间、超时按 capped_by_total 判因（time_limit 新 reason vs upstream_timeout 既有）；到顶已产出内容保留、未完成调用不计 calls/tokens。
5. **断连取消口径**：TestClient stream break 不触发服务端取消（实测回合跑满 16 步），端点层无法确定性断言——改用 asyncio.create_task + task.cancel() 直接驱动 run_turn 断言取消传播与无孤儿契约；真实断连 CancelledError 传播由 REQ-030 既有路径承载。另发现既有 REQ-030 断连用例（handler 单次调用 seen==1）无法区分「已取消」与「自然完成」——未改动（功能性删除为零），仅登记观察。

### 既有用例改写映射

- test_quota.py::test_统一模式_默认档口径：quota 端点加法字段 → 精确 dict 断言补 research_available: False（1 处）。
- **REQ-030 验收 1 事件序断言零改写**：该用例本以 `line.startswith("data: ")` 过滤，注释帧天然排除——原预计的「排除注释帧」改写实际为零改写（复跑全绿）。
