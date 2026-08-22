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
