# iter-21 verify — T2 后端个人用量端点（REQ-052）

> 任务：plans/iter-21.md T2（GET /api/usage/summary + telemetry 聚合 + 成本同构 + pytest 新增）。
> 实现依据：design-iter-21 §5 API 形状定案（tag design-iter-21）+ CHG-015 定夺③④。

## T2-1 实现级决策登记

1. **端点落位 = proxy.py（/api/quota 之后）**——不新开 router：个人用量与配额快照同域同鉴权面（CurrentUser），mount 零改动（design-iter-21 §5「routers/proxy.py 或新 router」二选一取前者）。
2. **成本同构提取 = telemetry.unified_cost()，admin.py 零回写**——体例与 admin `_cost6` 逐字同源（(tokens×单价)÷1e6、compress 行 tokens_prompt 并入输入分项、round 6 位、未配置 → None）；admin 端点本体零改动（REQ-038「admin 行为零改动」注记兑现），行为等价由 `test_成本体例与admin端点同构_同单价同算法` 用例承载（个人面成本 = admin 全站成本，单用户同批行比对）。
3. **days 枚举校验（422）用显式 `if days not in (7, 30)`**——非 Query(ge/le) 区间：个人面档位固定（design-iter-21 §5 有意口径），越界 detail「days 仅支持 7 或 30」。
4. **今日零遥测行 cost_total = 0.0（非 null）**——无调用即无成本为真值非造数；单价未配置才 null（铁律 5 口径：缺失 ≠ 零）。
5. **turns 计数限定 kind='llm' 且 turn_id 非空**——手动压缩（turn_id=NULL）与记忆抽取行不计回合，与 REQ-024 回合计口径一致（design-iter-21 §5）。

## T2-2 验收对照（plans/iter-21.md T2 验收 6 条）

| # | 验收条款 | 证据 |
|---|---|---|
| 1 | 本人 7/30 天每日回合数与 token 数与 telemetry 抽样一致 | `test_聚合数值_回合与token与费用_精确断言` + `test_手动压缩行_不计回合_摘要tokens入列并入成本`（造数直插 vs 端点聚合精确比对）✅ |
| 2 | 费用仅 unified 计入、体例与 admin 同源同单价 | `test_聚合数值…`（self 行不计）+ `test_self压缩行…` + `test_成本体例与admin端点同构_同单价同算法` ✅ |
| 3 | 用户 A 取不到用户 B 用量 | `test_跨用户隔离_bob数据不出现在alice面板`（双向）+ 端点不接受 user_id 参数（结构性消除）✅ |
| 4 | 单价未配置 → 费用全 null 不估算 | `test_单价未配置_cost_null_tokens照常` ✅ |
| 5 | test_quota 17 例零改动复跑 + /api/quota 形状零回退 | tests/test_quota.py 逐字节零改动（git diff 空）；`test_today快照与quota端点同源` 证 today 三数字同源 ✅ |
| 6 | pytest 存量 347 零回退 + 新增全绿 | **360 passed**（347 存量 + 13 纯新增 test_usage_api；make check 全量实跑，机器采集）✅ |

## T2-3 零改动面核对（计划「零改动面」条款）

- telemetry.py 写入点：零改动（仅新增 `unified_cost` 纯函数）；db.py schema：零改动（SCHEMA_VERSION 维持 10）；quota.py：零改动；既有端点形状：零改动；admin.py：零改动。

## T2-4 卫生项

- 铁律 5：缺失/未配置全 null 不造数（用例覆盖 缓存缺失/未配置/空窗口三面）。
- 缺陷：T2 当轮零 DEF（defects.md 无新增）。

---

# iter-21 verify — T3 前端分区 + 走查 + 全局回归收口（REQ-052）

> 任务：plans/iter-21.md T3（SettingsForm 第七分区 + 双态适配 + 走查 walkthrough-21 + 全局回归收口）。
> 实现依据：design-iter-21 §2~§4/§6/§7（tag design-iter-21）+ CHG-015 定夺①②④。

## T3-1 实现级决策登记

1. **未配置单价/失败态走查 = 网络层响应拦截**（puppeteer request interception 改写/abort `/api/usage/summary` 响应）——后端不可达「未配置」态（backend/.env 已配单价且 pydantic-settings 文件面优先级不可压）；真实 Chrome 渲染路径 + 状态模拟，组件面与 API 面由 vitest（UsagePane.spec 未配置/失败态用例）+ pytest（test_usage_api 未配置 null 用例）各承载。走查条 14/15 采此口径。
2. **走查条 11（费用合计缺失 →「—」）/条 20（外观主题切换）= N/A 交叉引用**——条 11 属未配置派生面（vitest 合计缺失用例承载）；条 20 由 useTheme.spec 6 用例 + 条 16 双主题翻转实测承载。
3. **走查条 17 断言口径 = 容器 overflow-x:auto + 分区/文档不溢出**——表格容器 scrollWidth > clientWidth 为「容器内滚动」机制本身（六列内容宽于 375px 视口属预期，design §3.3），非缺陷；不溢出由 paneOk + 文档横向滚动为零承载。
4. **数据加载不做独立 usage store**——UsagePane 组件本地态（phase/data/win）自含（沿 MemoryPane 先例）；`backend.ts` 仅加 `getUsageSummary` 方法与类型，既有 getQuota 调用点零改动（定夺④）。

## T3-2 首步冒烟（计划风险③处置）

既有 settings 全量用例加分区后首跑暴露 3 处分区计数耦合断言（计划预告候选风险兑现——非 SettingsForm 容器选择器耦合而是计数断言耦合）：
- settings-form.spec「弹窗结构」（六分区列表断言 → 七分区）+「分区切换」（账号索引 5 → 6 平移）
- SettingsMobileCssContract.spec「全屏化零改容器结构」（tab/pane 计数 6 → 7）
**改写映射 3 处逐条登记（旧断言 → 新断言，功能性删除为零）；逻辑断言零改写。**

## T3-3 验收对照（plans/iter-21.md T3 验收 7 条）

| # | 验收条款 | 证据 |
|---|---|---|
| 1 | 分区可达、今日行与列表逐字段映射 | walkthrough-21 条 1/2/3/4 + UsagePane.spec 今日两态 ✅ |
| 2 | 时间窗切换生效 | 条 6/6b（切 30 → 第 8 日行入列）+ UsagePane.spec 请求断言 ✅ |
| 3 | 空/未配置/缺失文案逐字 | 条 13/14 + U7/U14/U15 逐字 + UsagePane.spec（U13/U16 亦覆盖）✅ |
| 4 | ≤480px 全屏态可用不溢出 | 条 17（overflow 容器 + 文档零横向滚动）+ 条 27 ✅ |
| 5 | 既有六分区零回退 | 条 18/19/21/24/25 + walkthrough-20 全量复跑 38/0（条 18 计数断言随基线改写映射）+ vitest 411 存量复跑 ✅ |
| 6 | 走查脚本全 PASS 留档 | **walkthrough-21：32 PASS / 0 FAIL / 2 N/A（交叉引用）**，截图 /tmp/e2e21/shots/ ✅ |
| 7 | RTM 行级收口 + 台账五件套同批 | 本批提交（代码/verify/周报/RTM/缺陷账〔零新增〕）✅ |

## T3-4 全局回归收口（机器数字，make check / npm test 实测）

| 门槛 | 结果 |
|---|---|
| 后端 pytest | **360/360 passed**（347 存量零改动 + 13 test_usage_api 纯新增）|
| 前端 vitest | **423/423 passed**（40 文件；411 存量复跑〔3 处改写映射在内存量〕+ 12 UsagePane.spec 纯新增）|
| ruff / guard:style | 全部通过（零令牌自引用、零未豁免裸色值）|
| 生产构建 | 通过（vue-tsc + vite build）|
| 走查 walkthrough-21（新增） | 32 PASS / 0 FAIL / 2 N/A（真实 Chrome + 真实后端，四分支态 + 双态双主题）|
| 走查 walkthrough-20（复跑） | 38 PASS / 0 FAIL（桌面/移动零回退；条 18 计数断言改写映射，条 19b 交叉引用实际 423）|
| 缺陷 | T3 当轮零 DEF（三轮脚本自迭代 FAIL 全为脚本断言问题——drawer 隐藏判定/账号字面/条 17 口径，零产品缺陷）|

- 功能性删除为零；既有用例改写 3 处逐条登记映射（T3-2）；度量全部机器采集（铁律 5）。
- RTM：REQ-052 行整行收口 + 全局回归基线「用量面」行收口（本批同批提交）。
- CHG-015 落地核对清单：第 5 项 ✅（proto 占位示意随 design-iter-21 基线同批）；第 6 项 ✅（iter-21 计划）——清单全勾闭环。
