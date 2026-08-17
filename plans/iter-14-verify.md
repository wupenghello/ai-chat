# iter-14 验证留档（T0 段）

> T0 = QA OBS-2 前置取证（plans/iter-14.md T0 行）：自填端点真实回合联调补账。T1（design-iter-14 基线）起的交付证据随后续任务分段补登。

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
