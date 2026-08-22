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

## T2 段 — 后端实现与 D2 面收口（待实现后回填）

（占位：验收 1~7 逐条对照 + 改写映射为零断言 + pytest 计数 + RTM 收口记录）
