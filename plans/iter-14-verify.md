# iter-14 验证留档（T0 段 + T2 段 + T3 段）

> T0 = QA OBS-2 前置取证（plans/iter-14.md T0 行）：自填端点真实回合联调补账。T1（design-iter-14 基线）交付物在 design/iter-14/（基线声明见其 §11）。T2 = 后端搜索工具接入（2026-08-18，本文件 §T2）。T3 = 前端引用卡与开关 UI（2026-08-18，本文件 §T3）。

## T0 自填端点真实回合联调取证（2026-08-18 执行并验证）

### 1. 环境与路径

| 项 | 值 |
|---|---|
| 后端 | 本地 uvicorn（app.main:app，127.0.0.1:8765），独立临时库（AI_CHAT_DB_PATH 指向 /tmp，不触开发库） |
| 用户 | 临时库首注册用户（id=1，is_admin=true——演示工具可见前提，design-iter-13 定夺④） |
| 上游 | **自填模式（mode=self）**：DeepSeek 三要素档案（base_url=api.deepseek.com / deepseek-chat / CEO 自有 key），创建响应仅掩码 `sk-****2c36` |
| 会话 | PUT /api/sessions/t0-session-01 预置空会话后发起回合 |
| key 卫生 | key 经服务端存储下发上游；本取证全程响应/日志/本文档零明文（铁律与 REQ-014 受保护条款口径） |

### 2. 取证结果（POST /api/chat/turn → 200，2.80s，事件序完整逐帧）

原始帧节选（text.delta 共 14 帧，示前 3 帧；其余全帧如下）：

```
data: {"type": "turn.start", "session_id": "t0-session-01", "turn_id": "e94685eb1378"}
data: {"type": "turn.step", "step": 1, "max_steps": 10}
data: {"type": "tool.call", "tool_call_id": "call_00_qNaTeyeIbqLsJ1nGk4Ps1785", "name": "demo_weather", "arguments": "{\"city\": \"北京\"}"}
data: {"type": "tool.result", "tool_call_id": "call_00_qNaTeyeIbqLsJ1nGk4Ps1785", "status": "ok", "result": "北京：晴，最高 32°C", "duration_ms": 200}
data: {"type": "turn.step", "step": 2, "max_steps": 10}
data: {"type": "text.delta", "text": "北京"}（…共 14 帧：模型一句话复述工具结果）
data: {"type": "usage", "requests": 2, "tokens": 897}
data: {"type": "turn.end", "reason": "done"}
```

服务端日志（ai-chat.quota / ai-chat.tools）：

```
turn accepted user_id=1 mode=self session_id=t0-session-01 tools=2
tool executed name=demo_weather status=ok duration_ms=200 truncated=False
```

### 3. 验收对照（plans/iter-14.md T0 行）

| 验收标准 | 证据 | 判定 |
|---|---|---|
| 真实自填档案经回合端点完成 ≥1 次完整回合（含 ≥1 次工具调用） | `mode=self` 日志实锤自填路径；真实上游 tool_call_id（call_00_qNaTeyeIbqLsJ1nGk4Ps1785）+ demo_weather 真实执行（200ms ok）+ 终帧 turn.end(reason=done) | ✅ |
| 事件流与终态取证留档 | 本节全帧 + 日志两行 | ✅ |
| iter-13 风险①「双端点取证」补齐 | 统一 key DeepSeek（iter-13 在案）+ 自填端点（本节） | ✅ |
| OBS-2 闭环登记（RTM 备注 + 审计观察项处置留痕） | rtm.md 头注 T0 备注 + retros/qa-audit-iter-13.md OBS-2 行处置留痕（随本提交） | ✅ |
| 上游分片行为差异（若有）登记 verify 并同步 T2 | 见下「差异结论」 | ✅ |

### 4. 差异结论（同步 T2 实现口径）

- **text 分片**：DeepSeek 流式 text.delta 以 1~3 字/帧小分片到达，运行时透传不聚合——前端按 delta 追加渲染即可（A1 既有消费路径已覆盖）。
- **tool_calls 分片**：上游 tool_calls 增量分片由运行时按 index 重组（design-iter-13 §4.2 既定口径）后以**单帧 tool.call** 下发，客户端不感知上游分片差异——T2 search 工具沿用同口径，无需新增处理。
- **usage 帧验证 REQ-034 口径**：`{"requests": 2, "tokens": 897}` = 一回合计（2 次上游调用如实累计 tokens、回合计 1）——与 iter-13 T1 pytest 口径在真实上游上一致。
- **GLM 异构上游分片差异面未取证**：GLM key 余额不足（.env 备注 429/1113），延续 DEF-002 CEO 决策（2026-08-16 不补验）；T2 兼容面由假端点 pytest 承载，真实 GLM 待 key 恢复后随测（不阻塞）。
- **会话回写口径复核**：回合端点不回写消息（GET /api/sessions 复核 messages=0），落库由前端 PUT 承载——与 DEF-029 修复后「回合先于首次 PUT 到达不 404」的竞态口径一致（本回合即在预置会话上执行）。

### 5. 结论

T0 交付：OBS-2 补账闭环（取补做路径、不裁剪），iter-13 QA 审计观察项「自填端点真实联调取证无记录」消除；**零产品代码改动、无新增 DEF**；差异结论已同步 T2（plans/iter-14.md T2 行实现口径）。

---

## T2 后端搜索工具接入（2026-08-18 实现并验证）

### 1. 交付范围（对照 plans/iter-14.md T2 行 ①~⑥ + design-iter-14 §6 API 口径逐条）

| 项 | 落点 |
|---|---|
| ① search 工具静态注册 | `backend/app/tools.py`（ToolDef 增 `gate` 运行时能力门字段 + `tools_for_user` 增 gates 参数，缺省全关 = A1 行为不变）+ `backend/app/search.py`（name=search，入参 `{query: string}`，egress 白名单固定 = api.tavily.com，超时 10s（design §7）、结果上限沿网关默认 32 KiB；非 admin_only 全员可见，受 admin 开关 ∧ key 配置门控） |
| ② Tavily 客户端 | `backend/app/search.py`（POST https://api.tavily.com/search，Bearer key，max_results=5；key 经 `config.py` Settings 新字段 `search_key` 读 `AI_CHAT_SEARCH_KEY`；`.env.example` 补占位行；运行时 bind/unbind 由 `main.py` lifespan 承载——key 配置才绑定）；出网治理 A2 面实例化：请求前白名单判定（零连接拒绝）+ **DNS 解析期地址核验**（CHG-007 4.5-③ 后半「解析为内网/环回 → 拒绝」随本任务落地，`tools.is_disallowed_ip` 谓词统一两处判定） |
| ③ 结果组装 | `backend/app/search.py`（normalize_results：Tavily title/url/content(/published_date) → design §2.1 五字段形态，条数防御恒 ≤5、无 URL 丢弃、title 缺 hostname 兜底；assemble_text：「搜索「q」共 N 条结果：+ 标题/URL/片段」文本给模型）+ `tools.py`（ToolOutput 结构化输出——text 走截断/注入链、sources 随行）+ `agent.py`（tool.result 事件可选 `sources` 数组，§6.4 载荷逐字对照：仅 ok 且非空携带） |
| ④ admin 整体开关 | `backend/app/db.py`（迁移 v7：app_settings KV 表 + kv_get/kv_set + is_search_enabled/set_search_enabled，行缺失 = 默认开）+ `routers/admin.py`（overview 加 `search_enabled`/`search_key_configured` 两加法字段 + `PUT /api/admin/settings`，§6.1 形状逐字对照：StrictBool 缺字段/非布尔 422、幂等、非 admin 403）+ `routers/proxy.py`（回合受理时实时读：gates = {search: 开关 ∧ key 配置}；关闭或 key 缺失 → 上游 tools 定义不含 search） |
| §6.3 profiles 扩展（design §6 逐条对照） | `routers/profiles.py`（ProfileOut 加 `tools_enabled` 加法字段；POST/PUT 可选布尔：新建缺省 true / 编辑未传沿用原值，与 api_key「留空 = 沿用」同精神——T3 前端消费） |
| ⑤ pytest | `backend/tests/test_search.py` 新文件 38 用例（下 §2 分组；假端点全 mock，不依赖真实 key/额度） |
| ⑥ 质量门槛 | 既有 182 例零改动全绿（加法扩展硬门槛）；ruff clean；真实冒烟 1 例（§4） |

### 2. 测试证据

- **后端 pytest：182 → 220 全绿**（新增 38：`tests/test_search.py`），ruff clean；既有 test_admin/test_profiles/test_turn/test_agent_tools 等 182 例**零改动**复跑通过（admin/profiles 加法字段零形状回退 = design §6 硬门槛达成）。
- 新增 38 例（下述分组标签为「断言条目」计数口径、存在跨组重复——如 key 卫生组「整条 SSE 流零明文」断言并入回合成功用例——故分组求和 42 ≠ 用例数 38；以 pytest 实跑 38 例为准）：
  - 归一化与组装 4（五字段形态/缺字段不塌/条数防御/文本组装；空结果 D2 逐字）
  - 工具执行与异常 6（ok 双视角 + 安全日志四字段；429 限流；不可达；超时护栏（注入小值 0.2s，定案 10s 不进测试节奏——沿 max_steps 先例）；参数校验 3 断言合 1 例）
  - 出网治理 8（环回/10.x/192.168/169.254 云元数据/他域/白名单前缀伪装域 6 目标参数化零连接 + DNS 解析混入内网拒绝零连接 + 地址判定集 7+1）
  - 截断 1（512 KiB 单条 → 截断标注、≤32 KiB+标注、sources 不受文本截断影响）
  - key 卫生 2（结果/来源/日志零明文 + 请求头唯一承载；回合级整条 SSE 流零明文并入回合成功用例）
  - 回合级 4（成功事件序 + sources 载荷 + 注入包裹；失败降级直答帧级；超时降级直答帧级；注入防护转义路径——控制字符转义 + 伪造分界包裹最外层恒真实）
  - 开关断言矩阵 5（admin 关·档案开 → 无 search 且 PUT 后下一回合生效（运行时语义锚）；admin 开·档案关 → 无 tools；admin 开·档案开·自填普通用户 → [search]；admin 开·统一 key 恒开 → [search]；key 缺失·开关开 → 不注册 + overview 只报有无）
  - admin 开关 API 8（overview 加法字段集精确断言/key 已配置只报有无/PUT 切换幂等落库 db_version=7/非 admin 403/缺字段与非布尔 422×3/默认开未落行即读）
  - profiles §6.3 4（创建缺省 true/显式关/编辑显式覆盖与缺省沿用）

### 3. 验收条款对照（plans iter-14 T2 行 / REQ-035 / REQ-031 / REQ-025）

| 验收条款 | 用例/证据 |
|---|---|
| REQ-035 验收 2（失败/超时 → 降级直答不崩，帧级） | test_回合_搜索失败_降级直答不崩（tool.result error「搜索服务返回 500」→ 无 sources → 第 2 步直答 → turn.end done）+ test_回合_搜索超时_降级直答不崩（timeout「工具执行超时」同链）+ 单元级 429/不可达 |
| REQ-035 验收 3（admin 关闭 → 注册表无 search、上游 tools 不含 search，payload 断言） | test_开关矩阵_admin关_档案开_无search_运行时生效（MockTransport 捕获上游请求，PUT 前后同会话两回合对比：[echo,demo_weather,search] → [echo,demo_weather]） |
| REQ-035 验收 4 / REQ-031 验收 2 A2 面（出网仅搜索域，内网/环回/他域零连接） | test_出网_内网环回他域目标_零连接（6 目标参数化，seen == []）+ test_出网_DNS解析为内网_连接前拒绝_零连接（4.5-③ 后半实例化） |
| REQ-035 验收 5（超大结果 → 截断标注且 ≤32 KiB） | test_超大结果_截断标注_限内_条数不超（TRUNCATION_NOTE 逐字 + 字节数断言） |
| 开关断言矩阵（admin × 档案 tools_enabled × key 三态） | test_开关矩阵_* 5 例（含「统一 key 恒开不参与变化」「key 缺失时开关状态可存但工具不注册」） |
| key 卫生（响应体/日志零明文） | test_key卫生_* + 回合级 SSE 全帧断言 + overview 只报有无断言 + caplog 断言；`.env` 不入 git（.gitignore 既有）；真实 key 全程未写入任何代码/测试/文档（冒烟经环境变量注入，§4） |
| 注入防护复核（CHG-007 4.5-⑥ A2 动作） | test_回合_注入防护_真实搜索结果转义路径（真实搜索结果形状载荷含控制字符/伪造 `</tool_result>` 分界/指令注入文本 → 回填上下文 = 控制字符转义 + 字面包裹最外层恒真实分界） |
| 网关安全日志四字段沿用（REQ-035 ⑥） | search 经 execute_tool 统一 _log（caplog 断言 name/status/duration_ms/truncated，不含 key 与全文）；真实服务端日志取证见 §4 |
| REQ-025 A2 句（admin 开关后端） | TestSearchSwitchAPI 8 例（§6.1 形状逐字：加法读字段 + PUT 端点 + 403/422/幂等/默认开） |
| REQ-031 出网治理 A2 面收口 | 白名单 + DNS 解析双段校验落地（tools.is_disallowed_ip 统一谓词），先于任何连接（零连接断言 ×7） |

**留 T3 的验收面**：REQ-035 验收 1（时效性问题真实 Chrome 走查：工具步骤卡 + 引用来源卡）；REQ-032 验收 4（引用卡 design-iter-14 走查清单）；REQ-025/014 开关 UI 复验。

### 4. 真实 Tavily 冒烟取证（2 例，脱敏——key 经根 `.env` 环境变量注入，全程未输出/未落盘）

**例 1 客户端直调（网关全链）**：query「Vue 3.5 正式版 发布 新特性」→ status=ok，duration_ms=3470，truncated=False，result 9763 字节（< 32 KiB）；5 条结果归一化为 {title,url,snippet}（本次响应无 published_date——§2.3 可选字段缺失降级在位，前端元信息行该段省略）；key 卫生断言：result/sources 零 key 明文。

**例 2 端到端真实回合（临时 uvicorn 127.0.0.1:8799，独立库 /tmp（已清理），AI_CHAT_SEARCH_KEY 环境注入 + 统一 key DeepSeek）**：
- `GET /api/health` → `{"status":"ok","db_version":7}`（迁移 v7 生效）
- `GET /api/admin/overview` → `search_enabled=True, search_key_configured=True`
- POST /api/chat/turn「Vue 3 目前最新的正式版本号是多少？请用 search 工具联网查证后回答」→ 事件序 `turn.start → turn.step ×4 → tool.call(search) ×3（各配 tool.result status=ok）→ text.delta ×N → usage → turn.end(done)`；tool.result 首例：duration_ms=3251、sources 5 条（字段集 {title,url,snippet}）、result 文本头部「搜索「Vue 3 最新正式版本号 2025」共 5 条结果：」；usage `{requests: 4, tokens: 16087}`（回合计 1）；整条 SSE 流零 key 明文断言通过
- 服务端日志（四字段，无 key）：
  ```
  turn accepted user_id=1 mode=unified session_id=t2-smoke-s1 tools=3
  tool executed name=search status=ok duration_ms=3251 truncated=False
  tool executed name=search status=ok duration_ms=2183 truncated=False
  tool executed name=search status=ok duration_ms=1511 truncated=False
  ```

### 5. 口径登记（后端拥有文案与实现微参数，随本文件登记）

1. **D2 空结果文案（逐字）**：`未搜到相关内容`（`search.EMPTY_RESULT_TEXT`；后端拥有、前端零处理——与截断标注同口径）。
2. **搜索错误原因串（后端拥有）**：`搜索服务返回 {status}`（429/额度尽等计费类一律走此路径）/ `搜索服务不可达` / `搜索服务响应异常` / `搜索未配置（AI_CHAT_SEARCH_KEY 缺失）`（防御性兜底，正常路径 proxy 已按 key 门控不会触达）/ `出网目标解析为内网/保留地址，已拒绝`（4.5-③ 后半新增串）。
3. **微参数定案值（design §7）**：单工具超时 10s / max_results=5 / 引用卡默认折叠（前端）；**实现微参数（本任务工程值）**：query maxLength=400（网关 ② 参数校验承载，远超自然语言查询长度）。
4. **tools 定义描述文案（模型可见）**：search description =「联网搜索最新信息（时效性问题、最新动态、版本号、今日热点等）」。
5. **部署提示（非本任务动作）**：生产部署需将 `AI_CHAT_SEARCH_KEY` 配入 backend/.env（与统一 key 三变量同法）；真实 key 现由 CEO 保管于项目根 .env，本任务未搬动（「真实 key 不进任何文件」边界）。

### 6. 偏差与观察（如实登记）

- **零产品缺陷、零设计偏差**；既有 182 例零改动全绿。
- **观察①（非缺陷，B1 素材）**：真实回合中模型自主连续发起 3 次 search（逐步收窄查询），单回合 4 次上游调用 tokens 16087——步数护栏（10）内合法，token 成本随搜索次数线性增长；结果摘要文本体量（5 条 × ~1.4k 字符）为 design §7「1~2k token」预估的偏上沿。B1 prompt 分割+遥测时再评估是否约束「单回合搜索次数」。
- **观察②**：冒烟例 1 脚本尾部 `RuntimeError: Event loop is closed` 为取证脚本自身清理顺序（第二次 asyncio.run 关闭客户端）问题，非产品路径缺陷，产品代码无此路径（应用内 client 随 lifespan 单循环关闭）。
- **已知边界**：出网校验为「请求前独立 DNS 解析 + 白名单判定」，httpx 连接期自解析存在理论 TOCTOU 窗口（固定白名单域 api.tavily.com 下攻击面实际为零——攻击者无法控制 Tavily 域解析）；登记不隐瞒，远期接入用户可控 URL 工具时再上解析钉扎。

---

## T3 前端引用卡与开关 UI（2026-08-18 实现并验证）

### 1. 交付范围（对照 plans/iter-14.md T3 行 ①~⑤ + design-iter-14 §2/§4/§5 逐条）

| 项 | 落点 |
|---|---|
| ① 引用来源卡渲染 | `src/components/SourceCard.vue`（次级面板家族新成员：subtle-bg + 1px border + 10px 圆角；头部行「引用来源 · N 条」+ chevron 折叠；展开区条目五字段 title/url/site_name/date_published/snippet，缺字段不塌——title 缺 hostname 兜底、都缺连分隔点省略、无 snippet 紧凑形态；textContent 直排不进 Markdown 管线防注入；条数 slice(0,5) 兜底）+ `src/api/client.ts` SourceItem 类型 |
| ② 消费接线 | `src/components/MessageBubble.vue`（`sourcesOf`：配对 tool_result 含非空 sources 且 status=ok → 紧随工具卡渲染 SourceCard，blocks 顺序自然结果、渲染层派生不落库；`showDegrade`：search error/timeout 且有后续文本段 → 降级引导条「搜索未成功，以下为模型直接回答」） |
| ③ ToggleSwitch 通用开关 | `src/components/ToggleSwitch.vue`（36×20 轨道 + 16px 白滑块 + 1px 描边，开态 translateX 16px；button + role=switch + aria-checked；Enter/Space 原生；零新令牌——design §4.2 登记新形态） |
| ④ admin 搜索开关 | `src/views/AdminView.vue`（sw-row 统计卡区后、tabs 前：globe icon + 「联网搜索」+ 说明 12px text-3；D6 key 缺失附注 warning 色替换常显说明；点击 PUT /api/admin/settings → 态翻转 + D5 toast 逐字；失败 toast 错误 + 开关回弹）+ `src/api/backend.ts` adminUpdateSearchEnabled |
| ⑤ 档案「支持工具」第五字段 | `src/components/SettingsForm.vue`（档案添加/编辑模态 API Key 后：field-label「支持工具」+ D7 hint + ToggleSwitch；新建默认开、编辑回显 tools_enabled 实值；随「保存档案」一并提交无独立保存钮）+ 列表行 p-sub 尾「 · 工具已关」（开态不显示）+ `src/stores/settings.ts` toolsEnabled 映射（旧后端窗口期缺省按开） |
| 质量门槛 | vitest 301/301 + guard:style + 生产构建（三关）；后端 pytest 220/220 零改动复跑；真实 Chrome 走查 56/56 |

### 2. 测试证据

- **前端 vitest：301/301 全绿**（components 新增 SourceCard.spec / ToggleSwitch.spec 等；`npm test`）、`npm run guard:style` 通过（无令牌自引用、无未豁免裸色值）、`npm run build` 通过（vue-tsc + vite，128 模块）。
- **后端 pytest：220/220 全绿**（`cd backend && .venv/bin/python -m pytest -q`；既有 220 例零改动复跑——T2 新增的 test_search.py 38 例未受前端改动影响）。
- **真实 Chrome 走查：56 PASS / 0 FAIL**（`node scripts/e2e-walkthrough-14.mjs`，design-iter-14 §8.2 42 条清单浏览器适用条目全覆盖 + 逐字/几何/加载态/双主题断言面；10 截图 `/tmp/e2e14/shots/`）。

### 3. 验收条款对照（plans/iter-14.md T3 行 / REQ-035 验收 1 / REQ-032 验收 4 / REQ-025 / REQ-014）

| 验收条款 | 证据 |
|---|---|
| REQ-035 验收 1（时效性真实问题 → 真实 search → 工具步骤卡 + 引用来源卡 + 回答核验） | 走查阶段 B：真实 Tavily 回合——运行中帧（spinner +「运行中」+「（等待结果…）」）→ 流式中帧（引用卡前置可见 +「正在生成…」+ 光标）→ 终态（search 卡「完成」+ 引用卡默认折叠 + 回答非空）→ 条目核验（真实 Tavily 5 条、真实域链接、hostname/site 降级呈现，零 example.com）。§4 走查留档 |
| REQ-032 验收 4（引用卡 design-iter-14 走查留档） | §4 走查清单 1~14（引用卡形态）+ 15~17（双来源承载）逐条 PASS；亮/暗双主题、几何 computed 断言、样件文案逐字、加载态一帧均留档 |
| REQ-025 A2 开关 UI 复验（admin 开关操作生效；关闭后普通用户直答降级无错误提示） | 走查条 25/26/28/29/30/31（开关行形态/switch 几何/D5 toast/D6 附注/overview 加法字段/PUT 幂等）+ 条 24/D4（admin 关闭 → 无 search 卡无引用卡无引导条）；「模型不知其存在」口径走查通过 |
| REQ-014 开关 UI 走查（默认开/关闭态/引导路径） | 走查条 32/33/34/34b（第五字段位置与回显/D7 hint 逐字/列表行「工具已关」/新建默认开）+ 条 36（上游报不支持 tools → REQ-007 既有映射气泡 +「前往高级设置」直达，不新建映射） |
| 存量零回退复验 | 走查条 1/1b（消息流框架/用户气泡右对齐/v1 存量逐字 Markdown 管线）+ 条 13/20/41/41b（blocks 顺序/复制派生不落库/导出与侧栏索引零适配） |

### 4. 走查留档（scripts/e2e-walkthrough-14.mjs，56 条，2026-08-18 实跑）

- **服务**：自起后端 uvicorn（`AI_CHAT_DB_PATH=/tmp/ai-chat-walkthrough-14.db` 独立库，key 经环境变量注入——统一 key = 根 `.env` VITE_API_KEY → `AI_CHAT_UNIFIED_KEY`，搜索 key = 根 `.env` AI_CHAT_SEARCH_KEY；真实 key 仅进程环境/内存传递，不入日志/留档/提交）+ 前端 Vite dev（5179 → proxy 8802）。两阶段：A 不带搜索 key（D6 key 缺失态）+ B 带搜索 key（真实 Tavily 回合）。
- **覆盖**：design-iter-14 §8.2 42 条清单浏览器适用条目全部；逐字断言面（条 4/18/22/28/29/33）、几何断言面（条 2/3/7/9/10/19/26/40）、加载态一帧（条 39）、双主题承载（条 37/38）。
- **首轮 FAIL 处置（诚实登记，沿 iter-12 先例）**：脚本为前序实现代理所写但从未运行，首次实跑暴露 16 项 FAIL——**15 项为脚本断言/选择器问题，非产品缺陷**（注册 201 vs 200、条 6 键盘折叠后条 7~11 未复展开、条 11 点击后未等 Vue 重渲染、条 22 空结果卡按 textContent 定位而历史卡折叠、档案区 `.acct` 应点 `.dd-trigger`、暗色引用卡误在无引用卡的降级会话取证、暗色 switch 在 page.goto 重载后主题被复位、条 36 造数后未重载侧栏 + `TEXT` 辅助函数误入 page.evaluate 上下文）；已逐条修正脚本。
- **产品缺陷 1 项（当轮修复 + 单独提交 + 如实登记）**：条 40「工具卡与引用卡段间 8px」实测 4px——`.tool-card`/`.source-card` 均 `margin: 4px 0` 而 `.bubble.assistant` 为 block 流，相邻外边距塌陷为 max(4,4)=4px，与 design-iter-14 §2「段间距…与配对工具卡之间 8px」及 design-iter-13 §3「段间 8px」均不符（iter-13 走查 51 条仅以 `<22px` 宽松断言未捕获）。修复：两组件 `margin: 4px 0` → `8px 0`（相邻卡片塌陷后即 8px，文本↔卡片亦 8px，对齐两稿设计），vitest/guard/build/pytest 全绿复跑，走查条 40 复验 8px 通过。
- **真实搜索取证**：REQ-035 验收 1 阶段 B 真实 Tavily 回合——真实来源链接（fishersama.com / api-docs.deepseek.com / www.bentoml.com 等真实域，零 example.com）、元信息 hostname/site 降级呈现；模型回答可核验。全程 key 零明文。

### 5. 偏差与观察（如实登记）

- **零产品代码缺陷（修复后）**；走查首轮发现并当轮修复的 1 项产品缺陷见 §4（段间 4px→8px 对齐设计，非设计翻案）。
- **观察①（沿用 T2 观察①，B1 素材）**：真实回合模型自主发起 search 并以「search{query}…ms 完成」文本复述工具调用——工具卡文本并入气泡 textContent，正文核验需剔除工具卡文本（脚本已按此处理）。
- **已知边界（沿 iter-13 走查口径）**：真实回合用 admin 账号（walkthrough-admin），admin 关闭搜索后模型仍持有 echo/demo_weather 演示工具，故「无感降级」断言锚定为「无 search 卡/无引用卡/无引导条」（条 24/D4 实测 searchCards=["echo"] 但无 search），非「零工具卡」——演示工具为 A1 遗留在位、非本迭代产物。

