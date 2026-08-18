"""iter-15 T2（CHG-009 REQ-037）：请求级遥测——迁移 v8 + 双端采集 + 字段映射 + 主路径隔离
+ 卫生 + 90 天惰性清理 + 工具遥测同源。

验收 3（test_quota 零改动复跑全绿）与 quota.py/usage_daily 数据面零改动为文件级取证，
见 plans/iter-15-verify.md T2 段（本文件不复制 test_quota 用例）。
"""

import asyncio
import json
import sqlite3
from pathlib import Path

import httpx
from app import telemetry

from tests.conftest import register
from tests.test_search import SEARCH_KEY, _tavily_ok, search_bound
from tests.test_turn import (
    _events,
    _plain,
    _put_session,
    _sse,
    text_then_done,
    tool_call_then_done,
    turn_app,
)


def _frame(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


def _rows(c) -> list[sqlite3.Row]:
    conn = sqlite3.connect(c.app.state.db_path)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute("SELECT * FROM telemetry ORDER BY id").fetchall()
    finally:
        conn.close()


def _sleep_sse(body: str):
    """含 5ms 真实延迟的流式响应（latency_ms>0 断言的确定性锚点）。"""

    async def gen():
        await asyncio.sleep(0.005)
        yield body.encode()

    return httpx.Response(200, content=gen())


# ---------- REQ-037 验收 1：3 次上游调用恰 3 条 llm 行 ----------

def test_三调用回合_恰3条llm行_逐值一致(tmp_path: Path):
    def handler(_req, n):
        if n < 3:
            return _sleep_sse(tool_call_then_done(
                f"t{n}", "echo", '{"text":"x"}', 1200 if n == 1 else 1500))
        return _sleep_sse(text_then_done("done", 900))

    with turn_app(tmp_path, handler) as (c, seen):
        sid = _plain(c, seen)
        evs = _events(c, sid, "q")

    llm_rows = [r for r in _rows(c) if r["kind"] == "llm"]
    assert len(llm_rows) == 3  # 3 次上游调用恰 3 行
    assert [r["tokens_total"] for r in llm_rows] == [1200, 1500, 900]  # 与 usage 帧逐行一致
    assert all(r["latency_ms"] > 0 for r in llm_rows)
    turn_ids = {r["turn_id"] for r in llm_rows}
    assert len(turn_ids) == 1 and None not in turn_ids  # 同回合关联
    assert [r["step"] for r in llm_rows] == [1, 2, 3]  # step 连续
    assert all(r["endpoint"] == "turn" and r["status"] == "ok"
               and r["error_code"] is None for r in llm_rows)
    # 与 SSE usage 帧口径同源（回合事件面零变化）
    usage_ev = [e for e in evs if e["type"] == "usage"][0]
    assert usage_ev == {"type": "usage", "requests": 3, "tokens": 3600}
    assert evs[-1] == {"type": "turn.end", "reason": "done"}


# ---------- REQ-037 验收 2：缓存字段如实性（T0 取证 §2.4 映射口径） ----------

def _usage_frame(usage: dict) -> str:
    return _frame({"choices": [], "usage": usage}) + "data: [DONE]\n\n"


def test_缓存字段_上游返回_逐值落库(tmp_path: Path):
    """DeepSeek usage 形状（T0 §2.1 原文形状样件）：三分项 + hit/miss 逐值一致。"""
    usage = {"prompt_tokens": 183, "completion_tokens": 2, "total_tokens": 185,
             "prompt_tokens_details": {"cached_tokens": 128},
             "prompt_cache_hit_tokens": 128, "prompt_cache_miss_tokens": 55}

    def handler(_req, n):
        return _sse(_frame({"choices": [{"delta": {"content": "ok"}}]}) + _usage_frame(usage))

    with turn_app(tmp_path, handler) as (c, seen):
        sid = _plain(c, seen)
        _events(c, sid, "q")

    (row,) = [r for r in _rows(c) if r["kind"] == "llm"]
    assert row["tokens_prompt"] == 183
    assert row["tokens_completion"] == 2
    assert row["tokens_total"] == 185
    assert row["cache_hit_tokens"] == 128
    assert row["cache_miss_tokens"] == 55


def test_缓存字段_上游不返回_记NULL不造数(tmp_path: Path):
    """自填端点/GLM 类无缓存概念（T0 §3.2）：缓存列 NULL（聚合显缺失的数据层语义），
    分项缺失记 NULL、total 如实记（REQ-037 异常分支）。"""
    def handler(_req, n):
        return _sse(_frame({"choices": [{"delta": {"content": "ok"}}]})
                    + _usage_frame({"total_tokens": 77}))

    with turn_app(tmp_path, handler) as (c, seen):
        sid = _plain(c, seen)
        _events(c, sid, "q")

    (row,) = [r for r in _rows(c) if r["kind"] == "llm"]
    assert row["cache_hit_tokens"] is None
    assert row["cache_miss_tokens"] is None
    assert row["tokens_prompt"] is None
    assert row["tokens_completion"] is None
    assert row["tokens_total"] == 77  # total 如实记（现状 include_usage 口径）


# ---------- REQ-037 验收 4：遥测写失败不阻塞主路径 ----------

def test_遥测写故障注入_回合正常完成(tmp_path: Path, monkeypatch):
    def boom(_path):
        raise sqlite3.OperationalError("disk full")

    monkeypatch.setattr(telemetry, "connect", boom)

    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler) as (c, seen):
        sid = _plain(c, seen)
        evs = _events(c, sid, "q")  # 主路径不受遥测故障影响

    assert evs[-1] == {"type": "turn.end", "reason": "done"}
    assert [e["type"] for e in evs] == ["turn.start", "turn.step", "text.delta",
                                        "usage", "turn.end"]
    # 不补造（铁律 5）：故障期间零遥测行
    conn = sqlite3.connect(c.app.state.db_path)
    n = conn.execute("SELECT count(*) FROM telemetry").fetchone()[0]
    conn.close()
    assert n == 0


# ---------- REQ-037 验收 5：卫生（零 key、零消息内容、零工具结果全文） ----------

def test_卫生_表与日志零key零内容零工具结果全文(tmp_path: Path, caplog):
    import logging

    secret_key = "sk-hygiene-probe-9527"
    user_msg = "卫生探针用户消息QX7"
    sys_prompt = "卫生探针用户提示词ZK3"
    tool_result = "卫生探针工具结果全文VB5"

    def handler(_req, n):
        if n == 1:
            return _sse(tool_call_then_done(
                "", "echo", json.dumps({"text": tool_result}, ensure_ascii=False), 100))
        return _sse(text_then_done("完成", 50))

    caplog.set_level(logging.DEBUG)
    with turn_app(tmp_path, handler,
                  settings_extra={"unified_key": secret_key}) as (c, seen):
        register(c, "root")
        _put_session(c, "s1", [])
        _events(c, "s1", user_msg, system_prompt=sys_prompt)

    rows = _rows(c)
    assert rows  # 有行可查（llm 2 + tool 1）
    dump = "|".join("|".join(str(v) for v in tuple(r)) for r in rows)
    for probe in (secret_key, user_msg, sys_prompt, tool_result):
        assert probe not in dump  # 表行检索不到 key / 消息内容 / 工具结果全文
    logs = caplog.text
    for probe in (secret_key, user_msg, sys_prompt, tool_result):
        assert probe not in logs  # 相关日志同样零泄露


# ---------- REQ-037 验收 6：工具遥测与网关日志四字段同源 ----------

def test_工具遥测_search与echo各一次_与网关日志同源(tmp_path: Path, caplog):
    import logging

    def llm(_req, n):
        if n == 1:
            return _sse(tool_call_then_done("搜", "search", '{"query":"探针"}', 100))
        if n == 2:
            return _sse(tool_call_then_done("再验证", "echo", '{"text":"hy"}', 100))
        return _sse(text_then_done("完成", 50))

    caplog.set_level(logging.INFO, logger="ai-chat.tools")
    with turn_app(tmp_path, llm, settings_extra={"search_key": SEARCH_KEY}) as (c, seen):
        with search_bound(lambda _req: _tavily_ok()):
            register(c, "root")  # admin：search + 演示工具均可见
            _put_session(c, "s1", [])
            evs = _events(c, "s1", "q")
    assert evs[-1] == {"type": "turn.end", "reason": "done"}

    tool_rows = [r for r in _rows(c) if r["kind"] == "tool"]
    assert [(r["tool_name"], r["status"]) for r in tool_rows] == [("search", "ok"), ("echo", "ok")]
    assert all(r["latency_ms"] >= 0 and r["turn_id"] and r["step"] for r in tool_rows)

    # 网关日志四字段（name/status/duration_ms/truncated）：行内三字段与日志逐值同源
    log_lines = [ln for ln in caplog.text.splitlines() if "tool executed" in ln]
    assert len(log_lines) == 2
    for row, line in zip(tool_rows, log_lines, strict=True):
        assert f"name={row['tool_name']}" in line
        assert f"status={row['status']}" in line
        assert f"duration_ms={row['latency_ms']}" in line
    assert all("truncated=False" in ln for ln in log_lines)  # 第四字段仅日志侧（schema 无该列）


# ---------- 错误/超时/取消终态行（REQ-037 主流程 1「含错误/超时/取消终态」） ----------

def test_llm行_上游5xx_error终态带映射码(tmp_path: Path):
    def handler(_req, n):
        return httpx.Response(500, json={"error": "x"})

    with turn_app(tmp_path, handler) as (c, seen):
        sid = _plain(c, seen)
        _events(c, sid, "q")

    (row,) = [r for r in _rows(c) if r["kind"] == "llm"]
    assert row["status"] == "error"
    assert row["error_code"] == "upstream_error"
    assert row["tokens_total"] == 0  # 未达 usage 帧：现状口径 0


def test_llm行_断连取消_cancelled终态(tmp_path: Path):
    """REQ-037 异常分支：在途调用遭断连取消（生产路径 = Starlette 任务取消 →
    CancelledError 抛入生成器 await 点）→ 已发生调用落 cancelled 行。"""
    from app import agent

    def handler(_req):
        async def gen():
            yield _frame({"choices": [{"delta": {"content": "部分"}}]}).encode()
            await asyncio.sleep(0.5)  # 拖住流，等取消抵达
            yield _frame({"choices": [], "usage": {"total_tokens": 99}}).encode()
            yield b"data: [DONE]\n\n"

        return httpx.Response(200, content=gen())

    rows: list[dict] = []

    async def scenario():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            gen = agent.run_turn(
                client=client, base_url="http://upstream.test", api_key="k",
                model="m-test", session_id="s1",
                messages=[{"role": "user", "content": "q"}],
                tool_defs=[], max_steps=10, step_timeout=5.0,
                tool_result_limit=1024, telemetry_sink=rows.append)
            await gen.__anext__()  # turn.start
            await gen.__anext__()  # turn.step
            ev = await gen.__anext__()  # 首段 text.delta（mock 首帧立即到）
            assert ev["type"] == "text.delta"
            task = asyncio.create_task(gen.__anext__())  # 生成器进入等下一帧的 await 窗口
            await asyncio.sleep(0.05)
            task.cancel()  # 模拟断连：取消抛入生成器 await 点
            try:
                await task
            except asyncio.CancelledError:
                pass
        finally:
            await client.aclose()

    asyncio.run(scenario())

    llm_rows = [r for r in rows if r["kind"] == "llm"]
    assert len(llm_rows) == 1
    row = llm_rows[0]
    assert row["status"] == "cancelled"
    assert row["error_code"] is None
    assert row["turn_id"] and row["step"] == 1  # 已发生的调用照常落行
    assert row["usage"] == {}  # usage 帧未抵达：tokens 计已发生部分（无帧 = 现状口径 0）


# ---------- 90 天按自然日惰性清理（定夺⑤） ----------

def test_清理_90天外惰性删除_边界保留(tmp_path: Path):
    from datetime import datetime, timedelta

    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler) as (c, seen):
        # 预置三种账龄行：91 天前（超期）/ 90 天前（边界内）/ 今日
        conn = sqlite3.connect(c.app.state.db_path)
        base = [{"id": None, "user_id": 1, "mode": "unified", "endpoint": "turn",
                 "kind": "llm", "latency_ms": 1, "status": "ok", "tokens_total": 1}
                for _ in range(3)]
        days = [(datetime.now() - timedelta(days=d)).strftime("%Y-%m-%d")
                for d in (91, 89, 0)]
        # 先注册用户（user_id 外键）
        register(c, "alice")
        for row, day in zip(base, days, strict=True):
            conn.execute(
                "INSERT INTO telemetry (day, user_id, mode, endpoint, kind,"
                " latency_ms, status, tokens_total) VALUES (?,?,?,?,?,?,?,?)",
                (day, row["user_id"], row["mode"], row["endpoint"], row["kind"],
                 row["latency_ms"], row["status"], row["tokens_total"]))
        conn.commit()
        conn.close()

        _put_session(c, "s1", [])
        _events(c, "s1", "q")  # 本次写入触发惰性清理

    rows = _rows(c)
    remaining_days = {r["day"] for r in rows}
    assert days[0] not in remaining_days  # 91 天前超期行已清
    assert days[1] in remaining_days      # 90 天窗口边界（含今日 90 个自然日）保留
    # 剩余 llm 行 = 边界行（89 天前）+ 预置今日行 + 本回合新行
    assert len([r for r in rows if r["kind"] == "llm"]) == 3


def test_清理失败_不阻断行写入(tmp_path: Path, monkeypatch):
    def bad_get(_conn, _key, default=None):
        raise sqlite3.OperationalError("kv locked")

    monkeypatch.setattr(telemetry, "kv_get", bad_get)

    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler) as (c, seen):
        sid = _plain(c, seen)
        evs = _events(c, sid, "q")

    assert evs[-1] == {"type": "turn.end", "reason": "done"}
    assert len([r for r in _rows(c) if r["kind"] == "llm"]) == 1  # 清理失败不丢行


# ---------- legacy 行采集（定夺④下线序列第一步）已随端点删除退役 ----------
# 取证留档：端点删除前该端点每请求落一行（endpoint='legacy'，turn_id=NULL，total 如实、
# 分项/缓存 NULL）已实测全绿，逐字留档 plans/iter-15-verify.md T2 §下线序列取证；
# 端点删除后请求 404 取证见 tests/test_turn.py::test_turn_旧透传端点已下线_404。

