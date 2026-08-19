"""iter-16 T2（CHG-010 REQ-039/041）：三级压缩管道——一级 snip / 二级 compact / 三级阈值判定
/ 失败降级 / 30 轮验收 / 存储语义 / 产物独立 / compress 行数据面。

上游以 httpx.MockTransport 脚本化（沿 test_turn 惯例）；摘要调用 = stream=false 分支。
REQ-033 验收 1「组装等价」含旧工具回合的既有零用例受影响（K=2 保留口径下，存量用例工具
消息数均 ≤2，逐条核查见 plans/iter-16-verify.md T2 段改写映射登记——功能性删除为零）。
"""

import json
import sqlite3
from pathlib import Path

import httpx
from app import compress
from app.quota import today

from tests.conftest import register
from tests.test_turn import (
    PERSONA,
    UNIFIED_MODEL,
    _events,
    _frame,
    _mk_turns,
    _plain,
    _put_session,
    _sse,
    _upstream_messages,
    text_then_done,
    turn_app,
)

SUMMARY_TEXT = "用户名叫小明，正在开发名为「喵喵」的 AI 聊天产品；其余为知识性问答。"


# ---------- 夹具辅助 ----------

def _summary_json(text: str, prompt: int = 500, completion: int = 100) -> httpx.Response:
    return httpx.Response(200, json={
        "choices": [{"message": {"content": text}}],
        "usage": {"prompt_tokens": prompt, "completion_tokens": completion,
                  "total_tokens": prompt + completion},
    })


def _seed_last_tokens(c, sid: str, tokens: int, user_id: int = 1) -> None:
    """置该会话上一回合 step=1 llm 行 tokens_prompt 机器实测值（阈值判定触发依据）。"""
    conn = sqlite3.connect(c.app.state.db_path)
    conn.execute(
        "INSERT INTO telemetry (day, user_id, mode, session_id, endpoint, kind, step,"
        " latency_ms, status, tokens_prompt, tokens_total)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (today(), user_id, "unified", sid, "turn", "llm", 1, 5, "ok", tokens, tokens))
    conn.commit()
    conn.close()


def _rows(c) -> list[sqlite3.Row]:
    conn = sqlite3.connect(c.app.state.db_path)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute("SELECT * FROM telemetry ORDER BY id").fetchall()
    finally:
        conn.close()


def _summary_rows(c) -> list[sqlite3.Row]:
    conn = sqlite3.connect(c.app.state.db_path)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute("SELECT * FROM context_summary ORDER BY user_id").fetchall()
    finally:
        conn.close()


def _tool_doc(results: list[tuple[str, str]]) -> list[dict]:
    """N 个工具回合的 v2 blocks 会话档：user + assistant(text/tool_call/tool_result/text)。"""
    msgs: list[dict] = []
    for i, (result, status) in enumerate(results):
        msgs.append({"id": f"u{i}", "role": "user", "content": f"问题{i}", "status": "done"})
        msgs.append({"id": f"a{i}", "role": "assistant", "status": "done", "content": [
            {"type": "text", "text": f"查一下{i}"},
            {"type": "tool_call", "tool_call_id": f"c{i}", "name": "echo",
             "arguments": json.dumps({"text": result}, ensure_ascii=False)},
            {"type": "tool_result", "tool_call_id": f"c{i}", "status": status,
             "result": result},
            {"type": "text", "text": f"答案{i}"},
        ]})
    return msgs


def _payload(req: httpx.Request) -> dict:
    return json.loads(req.content.decode())


# ---------- REQ-039 验收 1：snip 确定性（逐字断言） ----------

def test_snip_五工具回合_仅最近2条保留全文(tmp_path: Path):
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    doc_msgs = _tool_doc([("结果甲", "ok"), ("结果乙", "error"), ("结果丙", "ok"),
                          ("结果丁", "ok"), ("结果戊", "timeout")])
    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", doc_msgs)
        evs = _events(c, "s1", "下一问")
        assert evs[-1] == {"type": "turn.end", "reason": "done"}

        msgs = _upstream_messages(seen[-1])
        tool_msgs = [m for m in msgs if m["role"] == "tool"]
        assert len(tool_msgs) == 5
        # 更早 3 条 = 裁剪占位文案（逐字：工具名 · 状态）
        assert tool_msgs[0]["content"] == "[旧工具结果已裁剪：echo · ok]"
        assert tool_msgs[1]["content"] == "[旧工具结果已裁剪：echo · error]"
        assert tool_msgs[2]["content"] == "[旧工具结果已裁剪：echo · ok]"
        # 最近 2 条保留结果全文（注入包裹口径零变化）
        assert tool_msgs[3]["content"] == "<tool_result>\n结果丁\n</tool_result>"
        assert tool_msgs[4]["content"] == "<tool_result>\n结果戊\n</tool_result>"


def test_snip_每次组装无条件执行_阈值下同样生效(tmp_path: Path):
    """一级 snip 与阈值判定无关：无遥测记录（未超阈值）时旧工具结果同样被裁剪。"""
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    doc_msgs = _tool_doc([("r1", "ok"), ("r2", "ok"), ("r3", "ok")])
    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", doc_msgs)  # 不置遥测记录 → 按未超阈值处理
        _events(c, "s1", "q")
        tool_msgs = [m for m in _upstream_messages(seen[-1]) if m["role"] == "tool"]
        assert tool_msgs[0]["content"] == "[旧工具结果已裁剪：echo · ok]"
        assert tool_msgs[1]["content"] == "<tool_result>\nr2\n</tool_result>"
        assert tool_msgs[2]["content"] == "<tool_result>\nr3\n</tool_result>"


# ---------- REQ-039 验收 2：自动触发（摘要挂载 system[1] 之后、历史仅 R=5 轮） ----------

def test_超阈值_摘要注入_挂载位置与R轮窗口(tmp_path: Path):
    def handler(req, n):
        if _payload(req).get("stream") is False:
            return _summary_json(SUMMARY_TEXT)
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler, settings_extra={"product_persona": PERSONA}) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))  # 12 轮存量（> R=5，有可压缩中段）
        _seed_last_tokens(c, "s1", 7001)  # 阈值+1
        evs = _events(c, "s1", "current question")
        assert evs[-1] == {"type": "turn.end", "reason": "done"}

        # 摘要调用（非流式）：prompt = R2 定稿逐字 + 中段历史文本
        summary_req = _payload(seen[0])
        assert summary_req["stream"] is False
        assert summary_req["model"] == UNIFIED_MODEL  # 模型名随模式默认
        assert summary_req["messages"][0] == {"role": "system",
                                              "content": compress.SUMMARY_PROMPT}
        assert summary_req["messages"][1]["role"] == "user"
        assert "msg0" in summary_req["messages"][1]["content"]  # 中段历史入摘要输入

        # 回合 step=1 请求体：system[0] 人设 + system[1] 动态尾区 + 摘要 system + 最近 R=5 轮
        msgs = _upstream_messages(seen[-1])
        assert msgs[0] == {"role": "system", "content": PERSONA}
        assert msgs[1]["role"] == "system" and msgs[1]["content"].startswith("当前时间：")
        assert msgs[2] == {"role": "system", "content": compress.wrap_summary(SUMMARY_TEXT)}
        # 历史仅最近 5 轮：12 轮存量 + 本条 = 13 轮 → 第 9 轮 user（m16）起
        assert msgs[3:] == [
            *[{"role": "user" if i % 2 == 0 else "assistant", "content": f"msg{i}"}
              for i in range(16, 24)],
            {"role": "user", "content": "current question"},
        ]

        # context_summary 落库：摘要 + 水位（m15 = 中段最后一条消息 id）
        (row,) = _summary_rows(c)
        assert row["summary"] == SUMMARY_TEXT
        assert row["watermark_msg_id"] == "m15"
        assert row["model"] == UNIFIED_MODEL


# ---------- REQ-039 验收 3：阈值下零回退（纯文本会话与基线 v6 逐字段等价） ----------

def test_阈值下_纯文本会话_基线v6逐字段等价(tmp_path: Path):
    """纯文本会话等价口径不变（snip 无 tool 消息可裁剪 → 零影响）。"""
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler, settings_extra={"product_persona": ""}) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(30))
        _seed_last_tokens(c, "s1", 6999)  # 阈值-1 → 未超阈值
        evs = _events(c, "s1", "current question", system_prompt="你是助手")
        assert evs[-1]["reason"] == "done"

        msgs = _upstream_messages(seen[-1])
        assert msgs[0]["role"] == "system"
        assert msgs[0]["content"].startswith("你是助手\n\n当前时间：")
        expected = [msgs[0]]
        for i in range(22, 60):  # 最近 20 轮 = m22..m59 + 本条（基线 v6 口径）
            expected.append({"role": "user" if i % 2 == 0 else "assistant",
                             "content": f"msg{i}"})
        expected.append({"role": "user", "content": "current question"})
        assert msgs == expected
        # 零摘要调用（全部请求均为流式回合调用）
        assert all(_payload(r).get("stream") is not False for r in seen)


def test_无遥测记录_按未超阈值处理(tmp_path: Path):
    """新会话/遥测缺失 → 保守不造数：基线组装、零摘要调用、零 compress 行。"""
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler) as (c, seen):
        sid = _plain(c, seen)
        evs = _events(c, sid, "q")
        assert evs[-1]["reason"] == "done"
        assert len(seen) == 1 and _payload(seen[0])["stream"] is True
        assert not [r for r in _rows(c) if r["kind"] == "compress"]


# ---------- REQ-039 验收 4：失败降级（500 / 超时 / 空摘要 → 回退不压缩） ----------

def test_摘要500_回退不压缩_compress行error(tmp_path: Path):
    def handler(req, n):
        if _payload(req).get("stream") is False:
            return httpx.Response(500, json={"error": "boom"})
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        _seed_last_tokens(c, "s1", 7001)
        evs = _events(c, "s1", "current question")
        assert evs[-1] == {"type": "turn.end", "reason": "done"}  # 回合不阻塞

        # 请求体回退不压缩形态：无摘要 system 消息，20 轮窗口（13 轮全量）+ snip
        msgs = _upstream_messages(seen[-1])
        assert all(compress.SUMMARY_TAG_OPEN not in str(m.get("content", "")) for m in msgs)
        assert sum(1 for m in msgs if m["role"] == "user") == 13

        # compress 行如实记 status=error（铁律 5），tokens_after=NULL
        (row,) = [r for r in _rows(c) if r["kind"] == "compress"]
        assert row["status"] == "error"
        assert row["error_code"] == "summary_error"
        assert row["tokens_before"] == 7001  # 触发依据实测值
        assert row["tokens_after"] is None
        assert row["endpoint"] == "turn"
        turn_id = [e for e in evs if e["type"] == "turn.start"][0]["turn_id"]
        assert row["turn_id"] == turn_id  # 自动回合关联
        # llm 行 step 连续性零变化（compress 行不占 step 序列；预置遥测行按 turn_id 排除）
        assert [r["step"] for r in _rows(c)
                if r["kind"] == "llm" and r["turn_id"] == turn_id] == [1]
        assert not _summary_rows(c)  # 失败不落摘要产物


def test_摘要超时_回退_compress行timeout(tmp_path: Path):
    def handler(req, n):
        if _payload(req).get("stream") is False:
            raise httpx.ReadTimeout("summary slow")
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler, settings_extra={"summary_timeout": 0.01}) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        _seed_last_tokens(c, "s1", 7001)
        evs = _events(c, "s1", "q")
        assert evs[-1] == {"type": "turn.end", "reason": "done"}
        (row,) = [r for r in _rows(c) if r["kind"] == "compress"]
        assert row["status"] == "timeout"
        assert row["error_code"] == "summary_timeout"


def test_空摘要_回退_compress行error(tmp_path: Path):
    def handler(req, n):
        if _payload(req).get("stream") is False:
            return _summary_json("   ")  # 空摘要
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        _seed_last_tokens(c, "s1", 7001)
        evs = _events(c, "s1", "q")
        assert evs[-1] == {"type": "turn.end", "reason": "done"}
        (row,) = [r for r in _rows(c) if r["kind"] == "compress"]
        assert row["status"] == "error" and row["error_code"] == "summary_empty"
        assert not _summary_rows(c)


# ---------- REQ-039 验收 5：30 轮会话（假上游脚本化，机器读数 ≤ 7000 + 关键事实） ----------

FINAL_Q = "我叫什么名字？我在开发什么产品？"
SUMMARY_FACTS = "用户名叫小明，正在开发名为「喵喵」的 AI 聊天产品。其余为知识性问答与搜索。"
_PAD = "这是一段用于凑够体量的知识性回答内容。" * 14  # 每轮回答体量锚点
_BIG = "闻" * 4000  # 搜索工具结果体量锚点（单工具回合膨胀请求体的实证形态）
# 体量校准（确定性推导，est = messages JSON 长度 // 2）：第 16 回合 step=1 首超阈值 7000
# → 第 17 回合起压缩且压缩回合恒为奇数轮 → 第 31 回合为压缩形态（摘要承载关键事实）


def _est_prompt_tokens(req: httpx.Request) -> int:
    """假上游 usage 机器读数：由请求体 messages 确定性推导（不手数 token，铁律 5）。"""
    return len(json.dumps(_payload(req)["messages"], ensure_ascii=False)) // 2


def _usage_frame(prompt: int, completion: int = 60) -> str:
    return _frame({"choices": [], "usage": {
        "prompt_tokens": prompt, "completion_tokens": completion,
        "total_tokens": prompt + completion}})


def test_30轮验收_第31次请求体机器读数不超阈值_关键事实可答(tmp_path: Path):
    state = {"round": 0}

    def handler(req, n):
        payload = _payload(req)
        if payload.get("stream") is False:  # 摘要调用分支
            assert payload["messages"][0]["content"] == compress.SUMMARY_PROMPT
            return _summary_json(SUMMARY_FACTS)
        msgs = payload["messages"]
        last = msgs[-1] if msgs else {}
        if last.get("role") == "user":
            state["round"] += 1
        rnd = state["round"]
        prompt = _est_prompt_tokens(req)
        if last.get("role") == "user" and rnd in (7, 15, 23):  # 工具回合（search 形态以 echo 承载）
            return _sse(_frame({"choices": [{"delta": {"tool_calls": [
                {"index": 0, "id": f"c_{rnd}", "function": {
                    "name": "echo",
                    "arguments": json.dumps({"text": _BIG}, ensure_ascii=False)}}]}}]})
                + _usage_frame(prompt, 40) + "data: [DONE]\n\n")
        if last.get("role") == "user" and last.get("content") == FINAL_Q:
            has_summary = any(m.get("role") == "system"
                              and compress.SUMMARY_TAG_OPEN in str(m.get("content", ""))
                              for m in msgs)
            answer = "你叫小明，正在开发「喵喵」。" if has_summary else "我不记得了。"
            return _sse(_frame({"choices": [{"delta": {"content": answer}}]})
                        + _usage_frame(prompt) + "data: [DONE]\n\n")
        return _sse(_frame({"choices": [{"delta": {"content": f"第{rnd}轮回答。{_PAD}"}}]})
                    + _usage_frame(prompt) + "data: [DONE]\n\n")

    questions = [f"第{i}个问题：知识问答" for i in range(1, 31)]
    questions[0] = "我叫小明，我正在开发一款叫「喵喵」的 AI 聊天产品。"
    questions[6] = "帮我搜索一下今天的科技新闻。"
    questions[14] = "搜索一下最近关于大模型的消息。"
    questions[22] = "今天有什么行业新闻？搜索一下。"
    turns = questions + [FINAL_Q]

    with turn_app(tmp_path, handler, settings_extra={"quota_free_daily": 100}) as (c, seen):
        register(c, "root")  # 首个注册用户 = admin（echo 工具可见）
        doc: dict = {"id": "s30", "schema": 2, "title": "t", "messages": [], "updatedAt": 1}
        _put_session(c, "s30", [])
        final_text = ""
        for i, msg in enumerate(turns, start=1):
            doc["messages"].append({"id": f"u{i}", "role": "user", "content": msg,
                                    "status": "done"})
            doc["updatedAt"] = i
            _put_session(c, "s30", doc["messages"])
            evs = _events(c, "s30", msg)
            assert evs[-1] == {"type": "turn.end", "reason": "done"}, f"回合 {i} 未完成"
            # 回合定型：assistant blocks 落档（前端同构流：text + tool_call + tool_result）
            blocks: list[dict] = []
            text_parts: list[str] = []
            for e in evs:
                if e["type"] == "text.delta":
                    text_parts.append(e["text"])
                elif e["type"] == "tool.call":
                    if text_parts:
                        blocks.append({"type": "text", "text": "".join(text_parts)})
                        text_parts = []
                    blocks.append({"type": "tool_call", "tool_call_id": e["tool_call_id"],
                                   "name": e["name"], "arguments": e["arguments"]})
                elif e["type"] == "tool.result":
                    blocks.append({"type": "tool_result", "tool_call_id": e["tool_call_id"],
                                   "status": e["status"], "result": e["result"]})
            if text_parts:
                blocks.append({"type": "text", "text": "".join(text_parts)})
            doc["messages"].append({"id": f"a{i}", "role": "assistant",
                                    "content": blocks if blocks else "".join(text_parts),
                                    "status": "done"})
            doc["updatedAt"] = i + 0.5
            _put_session(c, "s30", doc["messages"])
            if i == 31:
                final_text = "".join(e["text"] for e in evs if e["type"] == "text.delta")

        # 关键信息问答断言：第 1 轮关键事实（小明/喵喵）在第 31 轮可答对（压缩摘要承载）
        assert "小明" in final_text and "喵喵" in final_text
        # 第 31 次请求体含摘要注入（摘要承载关键事实）
        last_turn_req = [r for r in seen if _payload(r).get("stream") is True][-1]
        summary_msgs = [m for m in _upstream_messages(last_turn_req)
                        if m.get("role") == "system"
                        and compress.SUMMARY_TAG_OPEN in str(m.get("content", ""))]
        assert summary_msgs and "小明" in summary_msgs[0]["content"] \
            and "喵喵" in summary_msgs[0]["content"]

    # 机器读数（铁律 5）：step=1 llm 行 tokens_prompt 恰 31 行，第 31 次 ≤ 7000
    step1 = [r for r in _rows(c) if r["kind"] == "llm" and r["step"] == 1]
    assert len(step1) == 31
    assert step1[-1]["tokens_prompt"] is not None
    assert step1[-1]["tokens_prompt"] <= 7000  # X = 7000（T0 定死）
    # 增长实证：压缩触发前基线组装确曾超阈值（触发必要性成立，非恒未触发）
    assert max(r["tokens_prompt"] for r in step1[:30]) > 7000
    # compress 行：触发即压缩、复用零重复调用
    compress_rows = [r for r in _rows(c) if r["kind"] == "compress"]
    assert compress_rows and all(r["status"] == "ok" for r in compress_rows)
    assert all(r["tokens_before"] > 7000 for r in compress_rows)
    # tokens_after 懒回填（iter-16 T3 承载落地，改写映射见 plans/iter-16-verify.md T3 段）：
    # 压缩回合 step=1 usage 到达即回填，与同回合 step=1 llm 行 tokens_prompt 一致
    for r in compress_rows:
        (lrow,) = [x for x in step1 if x["turn_id"] == r["turn_id"]]
        assert r["tokens_after"] == lrow["tokens_prompt"]
    summary_calls = [r for r in seen if _payload(r).get("stream") is False]
    assert len(summary_calls) == 1  # 首次压缩生成，后续水位有效复用（零重复摘要调用）


# ---------- REQ-039 验收 6：存储语义（会话档 messages 数量与全文逐字不变） ----------

def test_压缩前后_会话档逐字不变_GET输出不变(tmp_path: Path):
    def handler(req, n):
        if _payload(req).get("stream") is False:
            return _summary_json(SUMMARY_TEXT)
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        _seed_last_tokens(c, "s1", 7001)
        before = [s for s in c.get("/api/sessions").json() if s["id"] == "s1"][0]
        evs = _events(c, "s1", "q")
        assert evs[-1]["reason"] == "done"
        after = [s for s in c.get("/api/sessions").json() if s["id"] == "s1"][0]

    assert before == after  # messages 数量与全文逐字不变（压缩只影响发给上游的内容）
    assert len(after["messages"]) == 24


# ---------- REQ-039 验收 7（pytest 面）：产物仅存 context_summary ----------

def test_产物独立_仅存context_summary_会话档与遥测零摘要文本(tmp_path: Path):
    def handler(req, n):
        if _payload(req).get("stream") is False:
            return _summary_json(SUMMARY_TEXT)
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        _seed_last_tokens(c, "s1", 7001)
        _events(c, "s1", "q")
        doc = [s for s in c.get("/api/sessions").json() if s["id"] == "s1"][0]

    (row,) = _summary_rows(c)
    assert row["summary"] == SUMMARY_TEXT  # 产物在 context_summary 表
    assert SUMMARY_TEXT not in json.dumps(doc, ensure_ascii=False)  # 会话档零摘要
    assert "summary" not in doc  # PUT 载荷形状零变化的服务端对偶：顶层无摘要字段
    dump = "|".join("|".join(str(v) for v in tuple(r)) for r in _rows(c))
    assert SUMMARY_TEXT not in dump  # telemetry 表零摘要文本（卫生）


# ---------- REQ-041 数据面：compress 行完整性 + 计账 ----------

def test_compress行完整性_恰1条_触发依据值_tokens_after为NULL(tmp_path: Path):
    def handler(req, n):
        if _payload(req).get("stream") is False:
            return _summary_json(SUMMARY_TEXT, prompt=500, completion=100)
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        _seed_last_tokens(c, "s1", 7500)
        evs = _events(c, "s1", "q")

    compress_rows = [r for r in _rows(c) if r["kind"] == "compress"]
    assert len(compress_rows) == 1  # 一次自动压缩恰 1 条
    row = compress_rows[0]
    assert row["tokens_before"] == 7500  # = 触发依据值
    assert row["tokens_after"] is None  # 待 T3 懒回填
    assert row["status"] == "ok" and row["error_code"] is None
    assert row["kind"] == "compress" and row["endpoint"] == "turn"
    assert row["model"] == UNIFIED_MODEL
    assert row["tokens_prompt"] == 500  # 摘要调用自身消耗（同列口径）
    assert row["tokens_total"] == 600
    assert row["session_id"] == "s1"
    assert row["step"] is None  # 不占回合 step 序列
    turn_id = [e for e in evs if e["type"] == "turn.start"][0]["turn_id"]
    assert row["turn_id"] == turn_id
    assert row["latency_ms"] >= 0


def test_摘要tokens计入回合累计_usage与usage_daily含摘要消耗(tmp_path: Path):
    """计账（定夺⑧）：摘要 tokens 计入回合累计；quota.py 与 usage_daily 数据面零改动。"""
    def handler(req, n):
        if _payload(req).get("stream") is False:
            return _summary_json(SUMMARY_TEXT, prompt=500, completion=100)  # total 600
        return _sse(text_then_done("ok", 900))  # 回合内 step 调用 total 900

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        _seed_last_tokens(c, "s1", 7001)
        evs = _events(c, "s1", "q")

    usage_ev = [e for e in evs if e["type"] == "usage"][0]
    # requests = 回合内步数（摘要调用不占 step 序列）；tokens = 600+900 含摘要消耗
    assert usage_ev == {"type": "usage", "requests": 1, "tokens": 1500}
    conn = sqlite3.connect(c.app.state.db_path)
    row = conn.execute(
        "SELECT requests, turns, tokens FROM usage_daily WHERE mode='unified'").fetchone()
    conn.close()
    assert row == (1, 1, 1500)  # 计 1 回合，tokens 含摘要消耗如实累计


# ---------- 水位语义：复用 / 失效重压缩 / 无可压缩中段 ----------

def test_有效摘要_直接注入_零摘要调用(tmp_path: Path):
    def handler(req, n):
        assert _payload(req).get("stream") is not False, "有效摘要不得再发摘要调用"
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        conn = sqlite3.connect(c.app.state.db_path)
        conn.execute(
            "INSERT INTO context_summary (user_id, session_id, summary, watermark_msg_id, model)"
            " VALUES (1, 's1', '既有摘要', 'm9', 'm-old')")
        conn.commit()
        conn.close()
        _seed_last_tokens(c, "s1", 7001)
        evs = _events(c, "s1", "q")
        assert evs[-1]["reason"] == "done"

        msgs = _upstream_messages(seen[-1])
        assert any(m.get("content") == compress.wrap_summary("既有摘要") for m in msgs)
        # 历史仅最近 R=5 轮（压缩注入形态：档内第 9~12 轮 + 本条 = 5 个 user 锚定轮）
        assert sum(1 for m in msgs if m["role"] == "user") == 5
        # 零 compress 行（复用非执行）、摘要行未被覆盖
        assert not [r for r in _rows(c) if r["kind"] == "compress"]
        (row,) = _summary_rows(c)
        assert row["summary"] == "既有摘要" and row["model"] == "m-old"


def test_水位失效_重压缩覆盖更新(tmp_path: Path):
    """watermark_msg_id 不在当前 messages → 视同失效（编辑重建/版本分支两分支同判定）。"""
    def handler(req, n):
        if _payload(req).get("stream") is False:
            return _summary_json(SUMMARY_TEXT)
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        conn = sqlite3.connect(c.app.state.db_path)
        conn.execute(
            "INSERT INTO context_summary (user_id, session_id, summary, watermark_msg_id, model)"
            " VALUES (1, 's1', '旧摘要', 'gone_by_edit', 'm-old')")  # 水位消息已被编辑删除
        conn.commit()
        conn.close()
        _seed_last_tokens(c, "s1", 7001)
        _events(c, "s1", "q")

        summary_calls = [r for r in seen if _payload(r).get("stream") is False]
        assert len(summary_calls) == 1  # 失效 → 重新摘要
        # 重压缩 = 同主键覆盖更新（每会话至多一份当前摘要）
        (row,) = _summary_rows(c)
        assert row["summary"] == SUMMARY_TEXT
        assert row["watermark_msg_id"] == "m15" and row["watermark_msg_id"] != "gone_by_edit"
        assert row["model"] == UNIFIED_MODEL


def test_总轮数不超R_跳过compact(tmp_path: Path):
    """无可压缩中段（总轮数 ≤ R=5）→ 零摘要调用、零 compress 行（「无需压缩」数据面）。"""
    def handler(req, n):
        assert _payload(req).get("stream") is not False, "无需压缩分支零上游摘要调用"
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(4))  # 4 轮 ≤ R=5
        _seed_last_tokens(c, "s1", 9999)
        evs = _events(c, "s1", "q")
        assert evs[-1]["reason"] == "done"
        assert not [r for r in _rows(c) if r["kind"] == "compress"]
        assert not _summary_rows(c)
