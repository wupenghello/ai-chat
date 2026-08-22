# iter-19 验收与取证留档 — ai-chat

> 状态：T0 段已交付（2026-08-22）；T2 段待实现后回填。
>
> 对应计划：plans/iter-19.md（T0 前置取证与技术基线）；对应需求：REQ-048（基线 req-baseline-v10）；机制口径权威源：changes.md CHG-013（内容 3 机制写实 / 定夺项）。
>
> 本文档为 REQ-048 验收 8（机制写实留档）的载体，T0 产出为 T2 开发唯一实现输入（串行口径，CHG-013 定夺⑧）。

## T0 段 — 前置取证与技术基线（2026-08-22，零产品代码改动）

### T0-1 asyncio 分发语义实测（五组，脚本 /tmp/hooks-t0-asyncio-probe.py，Python 3.12.14 = backend/.venv 同解释器）

实测输出原文（逐行，机器产物）：

```text
python 3.12.14 (main, Aug 14 2026, 15:24:41) [Clang 22.1.3]
============================================================
[1] create_task 弱引用与 GC
  1a 持强引用：done=True task.done=True
  1b 无引用+gc.collect：存活并完成 —— done=True
  1c 无引用无gc：done=True
[2] 取消路径
  2a 传播重抛：handler 在 await-point 收到，等待方收到 CancelledError ✅
  2b 吞取消：任务正常返回 'swallowed'，task.cancelled()=False（等待方不感知取消）
  2c 完成后 cancel：no-op，result=1
[3] wait_for 超时钩子
  3a 超时：0.10s 后 TimeoutError，hook 收到取消=True ✅
  3b 吞取消：wait_for 在 0.10s 返回 'bad'（超时护栏仍生效，不悬挂）
[4] fire-and-forget 异常消费
  4b done_callback 消费：RuntimeError ✅
  4a 无人消费：留待 loop 关闭（预期 stderr「Task exception was never retrieved」）
[5] 强引用集合 + 终态自移除（dispatch 引用管理方案）
  完成后集合大小=0（应为 0，无累积），完成序=[0, 1, 2, 3, 4]
============================================================
（loop 关闭后 stderr 实际输出：）
Task exception was never retrieved
future: <Task finished name='Task-9' coro=<boom() ...> exception=RuntimeError('hook boom')>
```

结论与对 hooks.py 实现的直接约束（逐组）：

- **组 1（弱引用与 GC）**：3.12.14 实测「无引用 + 显式 gc.collect()」下任务仍存活并完成——挂起中的任务经其等待的 future 回调链持有事实引用，常见「弱引用中途回收」描述在本版本未复现。但 **CPython 官方文档口径不变**（asyncio.create_task 要求「Save a reference … to avoid a task disappearing mid-execution」），且不同挂起点/实现版本存在差异——**强引用集合 + 终态自移除维持必设**（REQ-048 异常分支原文），组 5 验证该方案零累积（完成后集合 0、完成序正确）。
- **组 2（取消路径）**：① 挂起点取消 → CancelledError 注入、重抛后等待方收到（标准语义，hook 内 try/finally 清理可用）；② **坏公民 hook 吞取消不重抛** → 任务正常返回、等待方不感知——对 dispatch 无害（dispatch 本就不 await hook 结果）；③ 取消已完成任务为 no-op——进程关停时对已终态任务 cancel 无风险。
- **组 3（wait_for 超时护栏）**：① 正常路径 0.10s 即 TimeoutError 且 hook 收到取消 ✅；② **关键发现：吞取消的坏公民 hook，wait_for 仍在护栏值处返回（0.10s 返回 hook 返回值），不悬挂**——超时护栏对任意 hook 均有界，dispatch 的「超时 → 放弃 + warning」语义对坏公民同样成立（该情形 wait_for 不抛 TimeoutError 而是返回，任务自然终态自移除，语义无损）。
- **组 4（fire-and-forget 异常消费）**：无人消费的抛异常任务在 loop 关闭时实测产生「Task exception was never retrieved」stderr 告警（Task-9 复现）——**每个分发任务必须 add_done_callback 消费异常**（消费路径组 4b 验证干净）。warning 日志（hook 名/事件名）与异常消费由同一 done_callback 承载。
- **组 5（引用管理方案）**：强引用集合 + done_callback discard 方案验证通过（零累积、顺序无干扰）——与组 1 结论合并构成 dispatch 任务生命周期的完整依据。

### T0-2 事件点位核对表（亲读回填，与 CHG-013 内容 3.1 对照）

主会话逐行亲读 backend/app/agent.py（507 行）/ backend/app/routers/proxy.py / config.py / main.py 核对（2026-08-22）：

| 事件 | 落点（亲读核对后） | CHG-013 3.1 原文 | 一致性 |
|------|------------------|-----------------|--------|
| turn.accepted | routers/proxy.py chat_turn：L232 `turn_id = uuid...` 之后、L233 snip 组装开始前（配额已计 L214-221；拒绝分支 404 L197-198 / 503 L200-202 / 422 L209-212 / 429 L216-221 全部位于 L232 之前） | 「配额通过后、turn_id 生成后（L232 之后）、组装开始前」 | ✅ 一致 |
| tool.before | agent.py run_turn 工具段：L458-459 tool.call 事件 yield 之后、L460 defn 查找 / L463-466 execute_tool 之前（未注册→error 路径 L460-462 同点覆盖） | 同 | ✅ 一致 |
| tool.after | agent.py run_turn：L466 execute_tool 返回后、L468-470 tool 遥测行同点位（execution 三终态与 duration_ms 已知） | 「tool 遥测行同点位（L468-470）」 | ✅ 一致 |
| turn.end | agent.py run_turn：L493 turn.end 事件之后（reason 四值与累计 calls/tokens 已知） | 同 | ✅ 一致 |
| turn.cancelled | agent.py run_turn：L494-503 取消处理器内、L498-502 补 cancelled 遥测行之后、L503 `raise` 之前（fire-and-forget 为 create_task 同步调用，**不引入新 await 点**——与取消处理器「同步写入不引入新 await 点」既有注释口径一致） | 同 | ✅ 一致 |

辅助核对（实现输入）：

- config.py：hook 参数加法位置 = L69 heartbeat_interval 之后，体例沿独立超时护栏三先例（summary_timeout L51 / memory_extract_timeout L60 / heartbeat_interval L69）。
- main.py：search import 即注册先例 L16；lifespan 常驻任务先例 L52-60（本机制无常驻任务——注册表为 import 时代码态）。
- proxy.py stream() watchdog（L319-373）：fire-and-forget 任务收尾体例参照（ensure_future L348 / finally cancel + suppress await L366-373）——hook 分发任务不入 stream finally（dispatch 自持强引用 + 终态自移除，回合流不等待 hook）。

### T0-3 hook_timeout 定档

**定档 5.0s（维持 CHG-013 拟值，授权区间 1~30s 内取值，登记不走变更）**：

- 消费者画像：首版可预见消费者为通知/审计/自动化类——轻量 IO（写日志、发通知首包、投内存队列），秒级内完成；5s 已容纳慢速通知端点首包。
- 量级区分：与 summary_timeout 30s（一次上游 LLM 调用）/ agent_step_timeout 120s（上游流式窗口）明确拉开量级——hook 为旁路扩展，不应获得比核心路径更宽的时间预算。
- 实测支撑：组 3 验证护栏对坏公民 hook 有界（超时即弃），5s 不会转化为回合延迟（旁路语义）。
- .env 可覆盖（AI_CHAT_HOOK_TIMEOUT），部署者可按自接消费者调整。

### T0-4 dispatcher 注入方式定案

**定案：模块级单例直接调用（hooks.dispatch(...)），不采用 telemetry_sink 式回调形参注入**（实现级决策，CHG-013 内容 3.3 授权 T0 定案）：

- telemetry_sink/on_finish 形参注入的前提是「每回合不同的闭包 sink」（proxy 在受理时构造、携带 day/user_id/mode 回合上下文）；hook dispatcher 是**全局静态注册表 + 全局配置**（hooks_enabled / hook_timeout 均部署级），无回合差异化——与 tools._REGISTRY 同性质，模块级调用语义更直。
- run_turn 签名已 14 参数（CHG-012 又参数化 research），再加形参持续膨胀；埋点处 hooks.dispatch() 单行调用与 _emit 体例同重。
- turn.cancelled 埋点位于取消处理器内（不引入新 await 点）：dispatch 为同步函数（内部 create_task），模块级调用完全满足。
- 测试面：monkeypatch 模块级函数直接（与既有 test 对 telemetry_sink 的验证路径区分开——hook 测试注册捕获 hook 即 REQ-048 验收 1 体例，无需注入桩）。

### T0-5 交付声明

- 零产品代码改动（全部为脚本级实测与文档）；无未登记变更；无新 DEF。
- 实测脚本 /tmp/hooks-t0-asyncio-probe.py（临时产物不入仓库，输出原文已全量留档本文档 T0-1——复现命令 `.venv/bin/python` 直跑）。
- pytest --collect-only 实测核实存量 332（v1.4.16 C 机器采集，2026-08-22）。
- 本段为 REQ-048 验收 8 载体 + CHG-013 落地核对清单第 7 项交付；T2 开发解锁（T0→T2 串行口径满足）。

## T2 段 — 后端实现与 D2 面收口（2026-08-22 交付）

### T2-1 实现面（与 T0 技术基线逐项对应）

- **app/hooks.py 新模块**（沿 research.py 薄模块先例）：5 事件常量（闭合枚举）+ `HookEvent` frozen dataclass（元数据-only 字段表 = CHG-013 内容 3.2；不适用字段恒 None）+ `register_hook(name, callback, events=None)` 部署侧静态注册（同事件多 hook 各自分发）+ `dispatch()` 同步入口（注册表空 / hooks_enabled 关 → 短路零任务）+ `_run()` 任务体（wait_for(hook, hook_timeout)；TimeoutError / Exception 分记 warning；CancelledError 重抛）+ `_drain()` done_callback（终态自移除 + 异常消费——T0-1 组 4 必设项）+ `_TASKS` 强引用集合（T0-1 组 1/5 必设项）+ `emit()` 埋点便捷入口（timestamp 内部填 UTC ISO8601 毫秒；未知 extra 字段在 dataclass 构造处 TypeError 开发期暴露）。
- **埋点 5 处**（点位 = T0-2 核对表）：agent.py run_turn 内 4 处（tool.before = tool.call yield 后执行前〔含未注册→error 路径〕/ tool.after = execute_tool 返回后遥测行同位 / turn.end = 事件后〔reason 与累计值已知〕/ turn.cancelled = 取消处理器内补行后 raise 前〔emit 为同步调用，不引入新 await 点〕）+ proxy.py chat_turn 内 1 处（turn.accepted = turn_id 生成后组装开始前；拒绝分支 404/503/422/429 全在其前返回）。
- **config.py +2 参数**：`hooks_enabled: bool = True` / `hook_timeout: float = 5.0`（T0-3 定档值；.env 经 AI_CHAT_ 前缀可覆盖）+ .env.example 无需占位（默认值即文档——与 summary_timeout 等先例一致，无新 env 必填项）。main.py 注册挂载点注释示例（定夺④部署者参照）。
- **零改动面核证**：db.py / telemetry.py / quota.py / 前端全部零改动；零新表零迁移（SCHEMA_VERSION 维持 10）；SSE v2 零新帧类型；遥测 kind/endpoint 枚举零变化。

### T2-2 实现级决策登记（CHG-013 内容 3.3 授权 T0/实现期定案，不走变更）

1. **run_turn 加 `user_id: str | None = None` 形参**：载荷公共字段 user_id 的来源（T0-4 定案模块级单例时未覆盖载荷字段传递）；加法带默认值，既有调用零破坏，proxy 恒传 user.id、直驱测试可 None。
2. **载荷 mode 字段语义 = 回合模式（"chat" | "research"）**：CHG-013「mode 进载荷」指回合模式（chat 与 research 同管线区分），非配额模式（self/unified）；agent 侧由 research 参数推断、proxy 侧由 body.mode 判定，两侧口径一致。
3. **timestamp = UTC ISO8601 毫秒**（`datetime.now(UTC).isoformat(timespec="milliseconds")`）：机器消费中性时区，与服务器本地自然日配额口径互不干扰。
4. **dispatch 停用/超时读全局 `get_settings()`**：模块级单例定案（T0-4）的落实；测试以 monkeypatch `hooks.get_settings` 对齐非默认值（体例同 dependency_overrides 之于路由依赖）。
5. **warning 文案**：`hook {name} failed on {event}`（含 exc_info）/ `hook {name} timed out on {event} ({timeout}s)`——hook 名/事件名 only，无消息内容（验收 1 卫生断言面）。

### T2-3 REQ-048 验收 1~8 逐条对照（tests/test_hooks.py，15 用例）

| 验收 | 承载用例 | 结论 |
|------|---------|------|
| 1 分发与载荷 + 卫生探针 | 验收1_五回合事件真实时序与公共载荷 / 验收1_工具与终态事件专有字段 / 验收1_载荷与warning日志卫生探针 | ✅ 五事件真实时序〔accepted→before→after→end〕；公共字段逐项（turn_id 与 SSE turn.start 同源/session_id/user_id 非空/mode/timestamp ISO）；专有字段（step/tool_name/status/duration_ms/reason/requests/tokens 数值断言）；卫生——载荷 dump 与 caplog 检索不到消息正文标记、工具结果全文标记、UNIFIED_KEY |
| 2 故障隔离 | 验收2_必抛与超时hook_事件序基线一致_无任务泄漏 | ✅ 必抛 + 超时（0.15s）hook 双挂：SSE 九帧序与 REQ-030 验收 1 基线逐帧一致、回合 done、两条 warning 落日志、`_TASKS` 收敛为空（无任务泄漏/无引用累积） |
| 3 超时护栏 | 验收3_超时护栏_回合不因hook拖累 + 吞取消坏公民hook_护栏有界_任务自移除 | ✅ hook 悬挂 3s、护栏 0.1s——回合耗时 < 1.0s 不拖累；坏公民（吞 CancelledError 不重抛）护栏仍有界（T0-1 组 3b 回归）、任务正常终态自移除 |
| 4 断连终态 | 验收4_断连取消_turn_cancelled且无turn_end | ✅ 直驱 run_turn 工具挂起期取消消费 task（等价代理层取消传播路径）：turn.cancelled 触发、无 turn.end、tool.before 已先达、取消口径零变化（REQ-030 验收 4 面沿既有断言） |
| 5 零注册零回退 | 验收5_注册表空_零任务_事件序正常 + 验收5_停用开关_零分发_流逐帧等价 | ✅ 注册表空——九帧序正常 + `_TASKS` 恒空（短路零任务）；hooks_enabled=False + 有注册——零分发零任务、SSE 流除 turn_id 外逐帧等价（strip 对比） |
| 6 research 覆盖 | 验收6_research回合_同管线触发_mode字段 | ✅ run_turn(research=ResearchProfile) 同管线触发 turn.end 且 mode='research'（无工具回合仅终态——accepted 属 proxy 侧，如实断言） |
| 7 被拒回合零事件 | 验收7_配额拒绝_零事件 + 验收7_research门控拒绝_零事件 | ✅ 配额 429（quota_free_daily=1 耗尽后）与 research 三与门 422（search_key 空）两态零事件 |
| 8 机制写实留档 | T0 段承载（本文档） | ✅ T2 引用收口 |
| — 注册语义补充 | 订阅过滤_仅收订阅事件 / 同事件多hook_各自分发 / 未注册工具_前后事件照常_error终态 | events 过滤、多 hook 独立分发、未注册工具名 before/after 同点触发且 after.status='error' 降级直答 |

### T2-4 D2 面收口与回归

- **pytest 332 → 347 全绿**（+15 test_hooks 纯新增；主会话亲跑采信，v1.4.14 B）；ruff clean。
- **改写映射为零 ✅**：347 = 332 存量 + 15 新增，git diff 证实既有测试文件零改动（CHG-013 测试基线段「预计零既有用例改写」兑现）。
- 开发中插曲如实登记：首轮全量运行 6 例既有用例失败（test_search 开关矩阵 4 + test_turn 工具定义 2）——根因为 test_hooks 验收 4 用例注册的临时工具 `hk_slow_demo` 污染全局工具注册表（测试卫生问题，非产品缺陷）；已以用例内 finally 清理修复，修复后全量全绿；零既有用例改写维持。
- **前端 vitest 378/378 复跑背书**（零触达面：client.ts/sessions.ts/组件零改动，主会话亲跑）；无 UI 走查面（零 UI）。
- 台账五件套随本批：代码 + 本 verify + 周报节（落 weekly-W34——iter-19 当周为 W34〔08-17~08-23〕，PM 计划原写 W35 为周次计算偏差，实现级修正登记于此）+ RTM REQ-048 行与全局回归基线 D2 面行同批收口 + 缺陷账（本轮无新 DEF，DEF-001~038 维持全闭环）。
