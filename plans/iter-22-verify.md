# iter-22 验证登记 — T0 前置取证与文案定稿 / T2 验收对照

> 任务对应 plans/iter-22.md（已批准 2026-08-22 CEO「批准」，caac620）。T0→T2 严格串行（v1.4.15 适配，定夺④）：本文件 T0 段留档为 T2 开发唯一实现输入。

## T0 段：前置取证与文案定稿（S1，2026-08-22）

### 1. GeoAPI 可用性定案（定夺⑥，T0 首步）

- 复验时点：2026-08-22（计划批准当日，凭据复验后第二次）。
- 结果：专属 Host `/v2/geo/city/lookup` 中文 / ASCII / `/v2/geo/city/top` 三变体**全部 404 空体**（与 2026-08-22 上午复验一致，见 changes.md CHG-016 现状取证第 3 条）——凭据仍未启用 GeoAPI 服务。
- **定案：回退路径径行**（定夺⑥预授权，无需新决定）——内置城市 LocationID 静态表 + 模型直传坐标兜底；两步链不实施。若后续 CEO 在控制台启用 GeoAPI 且需求浮现（表外小地名高频），切换两步链走变更流程（表 + 坐标兜底已覆盖 REQ-053 全部验收面，切换为优化非解锁）。

### 2. 回退路径验证（坐标兜底 + 表数据源）

**坐标直查样例（6 城，含小地名，全 200 真实数据）**：

| 城市 | 坐标 | code | fxLink 站点 | 实况 |
|------|------|------|------------|------|
| 北京 | 116.41,39.90 | 200 | dongcheng-101011600 | 多云 27°C |
| 上海 | 121.47,31.23 | 200 | huangpu-101020400 | 晴 28°C |
| 广州 | 113.26,23.13 | 200 | yuexiu-101280107 | 阴 28°C |
| 桂林 | 110.29,25.27 | 200 | xiangshan-101300516 | 阴 29°C |
| 丽江 | 100.23,26.86 | 200 | gucheng-101291405 | 阴 19°C |
| 三亚 | 109.51,18.25 | 200 | jiyang-101310218 | 阴 28°C |

**结论与边界**：

- 坐标路径任意地名可用（模型提供坐标）；坐标解析到**区县级站点**（北京坐标 → 东城站）为已知边界——天气数据城市内等效，城市名标注不受影响（表路径用表内标准名，坐标路径以坐标串为标签，模型可自行补充城市语境）。
- **表数据源定案**：城市级 LocationID 直查校验生成——对拟入表城市以 `location={LocationID}` 直查，`fxLink` slug 比对确认（如 101010100 → beijing-101010100）；T2 生成脚本逐条机器校验，不手抄不猜测（铁律 5）。
- **表覆盖口径**：直辖市 4 + 省会 27（含港澳台外大陆 31 省市区首府）+ 计划单列市 5 ≈ 36 核心 + GDP/人口主要城市补至约百城；表外城市走坐标兜底（工具描述明示引导，见 §3）。

### 3. 逐字文案定稿（后端拥有，T2 逐字实现）

- **工具描述（tools.py 注册，模型可见）**：
  > 查询中国城市实时天气与三日预报。location 填城市名（支持约百个常用城市：直辖市/省会/主要城市）或「经度,纬度」坐标（如 116.41,39.90；表外小城市/区县请用坐标）。
- **参数**：`location` string 必填 maxLength 50（网关 ② 校验承载）。
- **坐标格式判定**：`^-?\d{1,3}\.\d+,-?\d{1,3}\.\d+$` 命中 → 坐标直传；否则查表；表未命中且非坐标 → error。
- **结果组装模板（模型消费文本，逐字）**：
  ```
  {定位标签}实时天气（观测于 {obsTime}）：{text}，气温 {temp}°C（体感 {feelsLike}°C），{windDir} {windScale} 级，湿度 {humidity}%
  三日预报（今起）：
  {fxDate}：{textDay}转{textNight}，{tempMin}~{tempMax}°C
  （共 3 行，逐日一行）
  ```
  定位标签 = 表路径取表内标准城市名；坐标路径取 `{lon},{lat}` 原串。now 缺字段（如 vis/cloud 不在模板内）不拼装；3d 缺 textNight 时该日写 `{textDay}，{tempMin}~{tempMax}°C`。
- **error / 降级文案（机器可读，逐字，对齐 search.py 体例）**：
  - 表未命中且非坐标：`未找到该城市（不在内置城市表；可改传「经度,纬度」坐标重试）`
  - 网络不可达：`天气服务不可达`
  - HTTP ≥400：`天气服务返回 {status}`
  - 响应解析失败：`天气服务响应异常`
  - 未配置（理论不可达，防御性兜底）：`天气未配置（AI_CHAT_WEATHER_KEY/HOST 缺失）`
- **降级标注**：模型沿 REQ-035 / design-iter-14 体例自述（「天气服务未成功，以下为模型直接回答」类），后端零新文案。
- **空结果**：无对应形态（天气端点必有 now/daily 或报错；now/daily 缺失 → 「天气服务响应异常」）。

### 4. 免费额度口径

- 机器可证事实：响应**无 X-RateLimit 头**（两次复验一致），额度可见性仅和风控制台；凭据 CMGTQUUCJA 为免费订阅档（iter-14 凭据记录口径）。
- 控制台日限额具体读数为 **CEO 侧待补项**（不阻塞开发与验收）：额度尽自愈链路已内建（API 返错 → ToolError → 网关 error result → 模型降级直答/转 search，回合不崩）；admin 工具用量视图自动涵盖 weather 行可观测异常。
- 表生成脚本一次性约百次调用计入额度消耗（T2 执行，一次性成本）。

### 5. 机制写实汇总（T2 实现输入）

- 定位路径：表（约百城，机器校验生成）+ 坐标兜底（正则判定直传）；GeoAPI 两步链不实施（§1 定案）。
- 出网治理：白名单 = `(settings.weather_host,)` 单元组；`ensure_egress_allowed` 传参 + `_assert_public_resolution` DNS 核验（复用 search 体例零逻辑变化）；请求 URL 恒 `https://{settings.weather_host}/v7/...`，Host 与配置不一致 → 白名单拒绝（验收 5）。
- 绑定体例：`bind(client, key, host)` / `unbind()`，main.create_app lifespan 调用（沿 search.py）；pytest 以假传输层 bind 承载。
- config 字段先行、.env 实值后写（Settings extra_forbidden，同型第三次教训——本次基线提交已被门禁实证拦截）。
- 超时：`WEATHER_TIMEOUT = 10.0`（网关 wait_for 兜底，单次工具执行 = 1~2 个上游子调用）；截断沿网关 32 KiB；遥测 kind='tool' 行零改动自动涵盖。

**T0 验收对照（plans/iter-22.md T0 验收标准）**：

1. ✅ 定位路径定案结论 + 依据留档（§1/§2——回退径行 + 坐标样例 + 表数据源）
2. ✅ 逐字文案全量定稿登记（§3——工具描述/模板/四类 error/降级与空结果口径）；额度口径登记（§4）
3. ✅ 零产品代码改动（本段全部脚本/文档级取证）、无未登记变更

## T2 段：后端实现 + 天气面收口（M2，2026-08-22 交付）

### 1. 交付面

- backend/app/weather.py 新模块（沿 search.py 体例）：bind/unbind 运行时绑定 + `resolve_location`（坐标正则直传 / 148 城表 / 未命中 ToolError）+ `_get`（白名单 + DNS 核验 + 失败归一）+ `assemble_text`（T0 §3 模板逐字）+ weather 注册（gate="weather"、timeout 10s、全员可见）
- backend/app/tools.py：demo_weather 移除（假数据表/handler/注册三段删除；echo 保留；模块头注记）
- backend/app/config.py：+`weather_key` / `weather_host`（.env.example 同批占位）
- backend/app/routers/proxy.py：gates 字典加 "weather" 键（key∧Host 均配置，定夺②——纯 settings 判定不读 conn，不新增 admin 开关，settings 端点形状零改写）
- backend/app/main.py：import 即注册 + lifespan 条件 bind + 无条件 unbind（沿 search 体例）
- scripts/gen_weather_cities.py：城市表 provenance 脚本（148 候选逐城 now+3d 双端点真调用，**148/148 通过零失败**，2026-08-22 实跑；凭据进程环境注入）
- scripts/e2e-walkthrough-22.mjs：走查脚本（真 Chrome + 真 DeepSeek + 真和风）

### 2. 验收对照（REQ-053 验收 1~6）

| 验收 | 结果 | 证据 |
|------|------|------|
| 1 真凭据端到端 | ✅ | 走查条 1/2/3：北京北极星链路（weather 工具卡完成非 demo_weather + 真实数据 + 综合回答含实况要素）；丽江三日逐日结构；表外漠河链路 |
| 2 降级不崩 | ✅ | pytest test_weather 降级 6 例（HTTP 429/网络不可达/非 JSON/body code 402/3d 缺 daily/未配置）文案逐字 + 走查条 4（亚特兰蒂斯：回合完成、无错误气泡、模型如实说明不编造） |
| 3 门控 | ✅ | test_weather 门控 2 例（weather 键关 → 注册面不可见；开 → 全员可见）+ test_search 既有开关矩阵改写后复跑 |
| 4 出网白名单 | ✅ | test_weather 白名单/DNS 3 例（配置域放行；他域 + 内网字面 IP 拒绝；DNS 解析内网保留地址连接前拒绝——零连接） |
| 5 Host 不一致拒绝 | ✅ | `test_白名单_请求Host与配置Host不一致_拒绝`（evil.example.com 与三个内网 IP 对 (配置 Host,) 白名单 → 一律「不在白名单」） |
| 6 demo_weather 移除映射 | ✅ | 见 §3（3 个既有测试文件 × 8 处退役映射逐条登记——NCR-iter22-001/OBS-1 整改口径） |

### 3. test 改写映射（demo_weather 退役——决策驱动已批准变更，CHG-016 定夺①；沿 test_proxy 16 例退役映射先例）

| 文件:用例 | 旧断言 | 新断言/处置 |
|------|--------|------------|
| test_agent_tools `test_演示工具_demo_weather_枚举城市` | demo_weather 执行返回固定串 | 移除（执行链路由 weather 真实工具承载：test_weather 端到端例） |
| test_agent_tools `test_参数校验_枚举外取值` | demo_weather enum 参数拒绝 | 改内联合成工具 t_enum 承载（网关 ② 能力与具体工具无关） |
| test_agent_tools `test_可见性过滤_演示工具仅_admin` | `["echo","demo_weather"]` | `["echo"]`（weather/search 为 gate 工具，gates 缺省视图不含） |
| test_agent_tools `test_注册表转_openai_tools_payload` | `["echo","demo_weather"]` | `["echo"]` |
| test_turn `test_两步工具回合_事件序逐帧` | tool.call demo_weather + 固定结果串 | echo 承载（name/arguments/result 三处同步改写，事件序断言面零变化） |
| test_turn 回合 payload 断言（原 L495） | `["echo","demo_weather"]` | `["echo"]` |
| test_search 开关矩阵（原 L435） | `["echo","demo_weather","search"]` | `["echo","search"]` |
| test_search 开关矩阵（原 L439/497） | `["echo","demo_weather"]` | `["echo"]` |

功能性删除 = demo_weather 8 处断言面（已批准移除项）；除此外功能性删除为零（weather 纯加法）。

### 4. 实现级决策（登记不走变更，沿 telemetry session_id 加法列先例口径）

1. **表存坐标而非 LocationID**（T0 §2 方法实现时优化）：CITY_TABLE = 城市名 → 中心坐标——和风 location 参数对坐标与 LocationID 语义等效，免 ID 校验链；表数据仍逐城真调用校验（148/148）。
2. **body code ≠ "200" 处理**：HTTP 200 但 body code 非 200（如额度尽）→「天气服务返回 {code}」统一降级（与 HTTP 错误同型机器可读）。
3. **egress_domains 注册字段留空**：出网域为运行时配置（专属 Host）静态字段承载不了——实际执法在 `_get` 的 ensure_egress_allowed（配置 Host 单元组），验收 5 专项断言承载。
4. **本地 .env 不含凭据**：Settings extra_forbidden 且 conftest `Settings(db_path=...)` 读 .env 其余字段（iter-18 同型第三次实证——基线提交被 pre-commit 拦截）→ 凭据仅进程环境注入（走查），生产 .env 随部署动作写入（CEO 批准后）。
5. **表规模 148 > T0 预告约百**：候选全过零失败全量保留；工具描述随实数写「148 个常用城市」。

### 5. 走查结论（scripts/e2e-walkthrough-22.mjs，真 Chrome + 真 DeepSeek + 真和风）

**9 PASS / 0 FAIL**（2026-08-22 干净库最终取证；截图 5 帧留档 /tmp/e2e22/shots/）：

- 条1 北极星链路 ×3 断言：weather 工具卡完成（非 demo_weather——定夺①移除面佐证）+ 结果含「实时天气/三日预报/°C」真实结构（非演示固定串「最高 32°C」）+ 综合回答含北京实况（真实数据：多云 27°C 体感 30°C 东南风 2 级 湿度 86%，观测时间到分钟）
- 条2 表内丽江 ×2：weather 卡完成 + 真实数据（小雨 18°C 体感 15°C）+ 三日逐日 3 行日期结构
- 条3 表外漠河：表未命中 error「未找到该城市（…可改传坐标）」→ 模型如实直答不编造（本轮模型未改传坐标即直答，容错断言分支承载——降级体例本身即验收目标）
- 条4 查无亚特兰蒂斯：回合完成不崩、无错误气泡、模型如实说明
- 条5 降级后服务健康（/api/quota 200）

### 6. 度量（机器采集，铁律 5）

- pytest 363 → **382 全绿**（**20 test_weather 新增 − demo_weather 枚举 1 例退役 = 净 +19**〔363−1+20=382，`--collect-only` 机器计数——NCR-iter22-001 整改口径〕+ §3 既有改写映射；`make check` 亲跑 113s）+ ruff check 通过
- 走查 walkthrough-22：**9 PASS / 0 FAIL**
- vitest 423 复跑背书（零触达；随提交门禁 npm test 实测）
- 城市表校验 148/148（一次性约 296 次真调用）

### 7. 零改动面核对

db.py / telemetry.py / quota.py / admin.py / settings 端点形状 / 前端全部文件——零改动；SCHEMA_VERSION 维持；search 工具与 research 三与门零触碰。零新 DEF（开发中 test_weather 自身 3 处夹具 bug 当场修复——测试卫生非产品缺陷，不登记）。

### 8. 观察项（OBS，不入 DEF）

- **前端 flaky 一例（2026-08-23 提交门禁首跑）**：T2 批次首次提交时 hook 内 npm test 1 例失败（422/423，输出截断未定位用例名）；本批零前端文件改动，随后连续两次全量复跑 423/423 全过——判定为瞬时 flaky（候选：integration.spec 流式时序类），与本次改动无关联证据；留档待观察（复发再定位入复盘候选，不构成 DEF）。
- **后端日期跨点竞态一例（2026-08-23 00:00 前后）**：第二次提交尝试 make check 内 `test_usage_api::test_today快照与quota端点同源` 失败（`assert 0.0 == 2.0`）——根因 = test_usage_api.py L31 `_TODAY = _day(0)` 模块级常量在收集时求值（08-22），端点请求时「今天」已跨入 08-23，造数日与查询日错位；iter-21 交付物既有边界（非本批触达面），非产品缺陷。**复盘候选：_TODAY 改调用时求值加固**（沿「测试卫生顺手修」口径，不构成 DEF）；本批零改动 test_usage_api，重试提交以非跨点时窗通过为据。
