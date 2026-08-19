"""iter-16 T3（CHG-010 REQ-040 全量 + REQ-041 懒回填）：POST /api/chat/compact 端点
四语义（200 compacted / 200 skipped too_short / 409 session_generating / 502·504
compact_failed）+ 归属隔离 404 + corrupted 双保险 422 + 不计回合（定夺⑧）+
tokens_after 懒回填一致性（REQ-041 验收 1 完整面，T2 遗留）。

实现依据：design-iter-16 §5.1 API 口径定案（四语义逐字）+ CHG-010 定夺⑧
（手动压缩不计回合、usage_daily 零写入、tokens 仅落遥测）。
上游以 httpx.MockTransport 脚本化（沿 test_turn/test_compact 惯例）。
"""

import json
import sqlite3
from pathlib import Path

import httpx
from app import compress
from app.config import Settings, get_settings
from app.main import create_app
from app.quota import today
from fastapi.testclient import TestClient

from tests.conftest import register
from tests.test_compact import SUMMARY_TEXT, _rows, _seed_last_tokens, _summary_json
from tests.test_turn import (
    UNIFIED_MODEL,
    _events,
    _frame,
    _mk_turns,
    _put_session,
    _sse,
    _upstream_messages,
    text_then_done,
    turn_app,
)


def _compact(c, sid: str):
    return c.post("/api/chat/compact", json={"session_id": sid})


def _summary_rows(c) -> list[sqlite3.Row]:
    conn = sqlite3.connect(c.app.state.db_path)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute("SELECT * FROM context_summary ORDER BY user_id").fetchall()
    finally:
        conn.close()


def _payload(req: httpx.Request) -> dict:
    return json.loads(req.content.decode())


def _usage_turn(prompt: int, completion: int = 40):
    """step=1 带 prompt_tokens 机器读数的回合帧（懒回填一致性断言的 usage 源）。"""
    return _frame({"choices": [{"delta": {"content": "回答。"}}]}) + \
        _frame({"choices": [], "usage": {"prompt_tokens": prompt,
                                         "completion_tokens": completion,
                                         "total_tokens": prompt + completion}}) + \
        "data: [DONE]\n\n"


# ---------- REQ-040 验收 1：compress 行 + context_summary 更新 + usage_daily 零变化 ----------

def test_手动压缩_compress行endpoint_compact_turn_id_NULL_usage_daily零变化(tmp_path: Path):
    def handler(req, n):
        assert _payload(req).get("stream") is False  # 手动压缩 = 非流式摘要调用
        return _summary_json(SUMMARY_TEXT, prompt=500, completion=100)

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        _seed_last_tokens(c, "s1", 8000)  # 触发依据实测值（tokens_before 来源）
        r = _compact(c, "s1")
        assert r.status_code == 200
        assert r.json() == {"status": "compacted", "tokens_before": 8000}

        # compress 行：endpoint='compact'、turn_id=NULL、tokens_after=NULL 待懒回填
        rows = [x for x in _rows(c) if x["kind"] == "compress"]
        assert len(rows) == 1
        row = rows[0]
        assert row["endpoint"] == "compact"
        assert row["turn_id"] is None
        assert row["status"] == "ok" and row["error_code"] is None
        assert row["model"] == UNIFIED_MODEL
        assert row["tokens_prompt"] == 500 and row["tokens_total"] == 600
        assert row["tokens_before"] == 8000
        assert row["tokens_after"] is None
        assert row["session_id"] == "s1" and row["step"] is None

        # context_summary 更新（摘要 + 水位 m15：12 轮档保留最近 R-1=4 轮，中段 = 1~8 轮）
        (srow,) = _summary_rows(c)
        assert srow["summary"] == SUMMARY_TEXT
        assert srow["watermark_msg_id"] == "m15"
        assert srow["model"] == UNIFIED_MODEL

        # 不计回合（定夺⑧）：usage_daily 零写入、quota 面零触达
        conn = sqlite3.connect(c.app.state.db_path)
        assert conn.execute("SELECT COUNT(*) FROM usage_daily").fetchone()[0] == 0
        conn.close()
        # 上游调用恰 1 次（摘要调用本体，无回合流式调用）
        assert len(seen) == 1 and _payload(seen[0])["stream"] is False


def test_手动压缩_无遥测记录_tokens_before为null(tmp_path: Path):
    """新会话/遥测缺失 → tokens_before=null（不估算，铁律 5）；压缩照常执行。"""
    def handler(req, n):
        if _payload(req).get("stream") is False:
            return _summary_json(SUMMARY_TEXT)
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))  # 不置遥测记录
        r = _compact(c, "s1")
        assert r.status_code == 200
        assert r.json() == {"status": "compacted", "tokens_before": None}
        (row,) = [x for x in _rows(c) if x["kind"] == "compress"]
        assert row["tokens_before"] is None


# ---------- REQ-040 验收 2：手动压缩后下一回合请求体含摘要 ----------

def test_手动压缩后_下一回合请求体含摘要_零重复摘要调用(tmp_path: Path):
    def handler(req, n):
        if _payload(req).get("stream") is False:
            return _summary_json(SUMMARY_TEXT)
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        assert _compact(c, "s1").status_code == 200
        summary_calls_after_compact = len(seen)

        _seed_last_tokens(c, "s1", 7001)  # 下一回合超阈值
        evs = _events(c, "s1", "current question")
        assert evs[-1] == {"type": "turn.end", "reason": "done"}

        # 请求体含摘要 system 消息（水位有效 → 复用手动压缩产物，零新摘要调用）
        msgs = _upstream_messages(seen[-1])
        assert any(m.get("role") == "system"
                   and m.get("content") == compress.wrap_summary(SUMMARY_TEXT)
                   for m in msgs)
        assert len([r for r in seen if _payload(r).get("stream") is False]) \
            == summary_calls_after_compact  # 复用非执行（零重复摘要调用）


# ---------- REQ-040 验收 3：无需压缩分支（零上游调用、零计费） ----------

def test_无需压缩_轮数不超R_200_skipped_零上游调用(tmp_path: Path):
    def handler(_req, n):
        raise AssertionError("无需压缩分支零上游调用")

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(5))  # 5 轮 ≤ R=5
        _seed_last_tokens(c, "s1", 9999)     # 阈值无关：手动路径不受阈值约束
        r = _compact(c, "s1")
        assert r.status_code == 200
        assert r.json() == {"status": "skipped", "reason": "too_short"}
        assert seen == []                                # 假传输层零调用断言
        assert not [x for x in _rows(c) if x["kind"] == "compress"]  # 零 compress 行
        assert not _summary_rows(c)
        conn = sqlite3.connect(c.app.state.db_path)
        assert conn.execute("SELECT COUNT(*) FROM usage_daily").fetchone()[0] == 0
        conn.close()


def test_无需压缩_空会话(tmp_path: Path):
    def handler(_req, n):
        raise AssertionError("空会话零上游调用")

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", [])
        r = _compact(c, "s1")
        assert r.status_code == 200 and r.json()["status"] == "skipped"
        assert seen == []


# ---------- REQ-040 验收 4：归属隔离（他人 session_id → 404；普通用户无 admin 门槛） ----------

def test_归属隔离_他人会话404_普通用户无admin门槛(tmp_path: Path):
    def handler(req, n):
        if _payload(req).get("stream") is False:
            return _summary_json(SUMMARY_TEXT)
        return _sse(text_then_done("ok", 10))

    settings = Settings(db_path=str(tmp_path / "t.db"), unified_key="sk-u",
                        unified_base_url="http://upstream.test",
                        unified_model=UNIFIED_MODEL)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    seen: list[httpx.Request] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request, len(seen))

    created = []

    def make():
        cc = TestClient(app)
        created.append(cc.__enter__())
        return cc

    try:
        alice = make()   # 首注册用户 = admin
        bob = make()     # 普通用户
        register(alice, "alice")
        register(bob, "bob")
        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(wrapped))
        _put_session(alice, "s_a", _mk_turns(12))
        _put_session(bob, "s_b", _mk_turns(12))

        # 他人 session_id → 404（不泄露归属）；不存在 → 404
        r = _compact(bob, "s_a")
        assert r.status_code == 404
        assert r.json() == {"detail": {"code": "session_not_found", "message": "会话不存在"}}
        assert _compact(bob, "nope").status_code == 404

        # 普通用户操作正常、无 admin 门槛（bob 非 admin）
        r = _compact(bob, "s_b")
        assert r.status_code == 200 and r.json()["status"] == "compacted"
        assert _compact(alice, "s_a").status_code == 200
    finally:
        for cc in created:
            cc.__exit__(None, None, None)


# ---------- 409 生成中（服务端唯一判定，design-iter-16 §2.3 定夺④） ----------

def test_409_生成中拒绝_detail逐字_零副作用(tmp_path: Path):
    def handler(req, n):
        if _payload(req).get("stream") is False:
            raise AssertionError("409 分支零摘要调用")
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        c.app.state.generating_sessions.add((1, "s1"))  # 该会话有进行中回合（登记即权威）
        r = _compact(c, "s1")
        assert r.status_code == 409
        assert r.json() == {"detail": {
            "code": "session_generating",
            "message": "该会话正在生成回复，暂不能压缩，请等生成完成后再试"}}
        assert seen == []                                # 零上游调用
        assert not [x for x in _rows(c) if x["kind"] == "compress"]
        assert not _summary_rows(c)                      # 会话数据与摘要零变化


def test_turn受理登记_流终态清除_生成中注册生命周期(tmp_path: Path):
    """回合受理置位 (user_id, session_id)，流终态清除——409 判定的数据面生命周期。
    观测点在摘要/上游调用 handler 内（流在途的确定性时点：add 之后、discard 之前）。"""
    observed: list[bool] = []
    captured: dict = {}

    def handler(_req, n):
        observed.append((1, "s1") in captured["app"].state.generating_sessions)
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler) as (c, seen):
        captured["app"] = c.app
        register(c, "alice")
        _put_session(c, "s1", [])
        assert (1, "s1") not in c.app.state.generating_sessions  # 受理前空
        evs = _events(c, "s1", "q")
        assert evs[-1] == {"type": "turn.end", "reason": "done"}
        assert observed == [True]                                # 在途（上游调用时刻）已登记
        assert (1, "s1") not in c.app.state.generating_sessions  # 流终态后清除


# ---------- 失败分支（502/504 共用 code 与 message；原摘要保留、会话档零写入） ----------

def test_摘要失败_502_原摘要保留_会话档零写入(tmp_path: Path):
    def handler(req, n):
        if _payload(req).get("stream") is False:
            return httpx.Response(500, json={"error": "boom"})
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
        before = [s for s in c.get("/api/sessions").json() if s["id"] == "s1"][0]

        r = _compact(c, "s1")
        assert r.status_code == 502
        assert r.json() == {"detail": {"code": "compact_failed",
                                       "message": "压缩失败，请稍后再试"}}
        (row,) = [x for x in _rows(c) if x["kind"] == "compress"]
        assert row["status"] == "error" and row["endpoint"] == "compact"
        # context_summary 零变化（原摘要仍有效则保留）+ 会话档零写入
        (srow,) = _summary_rows(c)
        assert srow["summary"] == "既有摘要" and srow["model"] == "m-old"
        after = [s for s in c.get("/api/sessions").json() if s["id"] == "s1"][0]
        assert before == after


def test_摘要超时_504_compress行timeout(tmp_path: Path):
    def handler(req, n):
        if _payload(req).get("stream") is False:
            raise httpx.ReadTimeout("summary slow")
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler, settings_extra={"summary_timeout": 0.01}) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        r = _compact(c, "s1")
        assert r.status_code == 504
        assert r.json()["detail"] == {"code": "compact_failed",
                                      "message": "压缩失败，请稍后再试"}
        (row,) = [x for x in _rows(c) if x["kind"] == "compress"]
        assert row["status"] == "timeout" and row["error_code"] == "summary_timeout"
        assert not _summary_rows(c)


def test_corrupted会话_422双保险(tmp_path: Path):
    def handler(_req, n):
        raise AssertionError("corrupted 分支零上游调用")

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        conn = sqlite3.connect(c.app.state.db_path)
        conn.execute(
            "INSERT INTO chat_sessions (id, user_id, data, updated_at)"
            " VALUES ('s_bad', 1, '{not-json', 1)")
        conn.commit()
        conn.close()
        r = _compact(c, "s_bad")
        assert r.status_code == 422
        assert r.json() == {"detail": {"code": "session_uncompactable",
                                       "message": "无法读取的会话不可压缩"}}
        assert seen == []


def test_请求体校验_缺字段与非字符串422(tmp_path: Path):
    with turn_app(tmp_path, lambda req, n: _sse(text_then_done("ok", 10))) as (c, seen):
        register(c, "alice")
        assert c.post("/api/chat/compact", json={}).status_code == 422
        assert c.post("/api/chat/compact", json={"session_id": 123}).status_code == 422
        assert c.post("/api/chat/compact", json={"session_id": ""}).status_code == 422


def test_上游密钥未配置_502_如实记行(tmp_path: Path):
    """统一 key 未配置且无生效档案 → 摘要调用不可执行，归失败分支：
    502 compact_failed（共用文案）+ compress 行 status=error 如实记（铁律 5）。"""
    def handler(_req, n):
        raise AssertionError("无密钥分支零上游调用")

    seen: list[httpx.Request] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request, len(seen))

    # 显式置空（Settings 缺省会加载 backend/.env 的真实 key，显式参数覆盖）
    settings = Settings(db_path=str(tmp_path / "t.db"), unified_key="")
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        c.app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(wrapped))
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        r = _compact(c, "s1")
        assert r.status_code == 502
        assert r.json() == {"detail": {"code": "compact_failed",
                                       "message": "压缩失败，请稍后再试"}}
        assert seen == []
        (row,) = [x for x in _rows(c) if x["kind"] == "compress"]
        assert row["status"] == "error" and row["endpoint"] == "compact"
        assert not _summary_rows(c)


# ---------- REQ-041 验收 1 完整面：tokens_after 懒回填一致性（T2 遗留） ----------

def test_懒回填_手动压缩后_下一回合step1_usage回填_与llm行一致(tmp_path: Path):
    def handler(req, n):
        payload = _payload(req)
        if payload.get("stream") is False:
            return _summary_json(SUMMARY_TEXT)
        return _sse(_usage_turn(4321))  # 下一回合 step=1 机器读数

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        assert _compact(c, "s1").status_code == 200
        (row,) = [x for x in _rows(c) if x["kind"] == "compress"]
        assert row["tokens_after"] is None  # 压缩执行时刻未测得

        evs = _events(c, "s1", "下一问")  # 阈值无关：任何下一回合 step=1 usage 到达即回填
        assert evs[-1] == {"type": "turn.end", "reason": "done"}

    rows = _rows(c)
    (crow,) = [x for x in rows if x["kind"] == "compress"]
    (lrow,) = [x for x in rows if x["kind"] == "llm" and x["step"] == 1]
    assert lrow["tokens_prompt"] == 4321          # 机器读数如实
    assert crow["tokens_after"] == 4321           # 懒回填 = 下一回合 step=1 实测值
    assert crow["tokens_after"] == lrow["tokens_prompt"]  # REQ-041 验收 1 一致性断言


def test_懒回填_自动压缩回合内回填_与step1_llm行一致(tmp_path: Path):
    """自动路径：compress 行创建于组装阶段（step=1 调用前）→ 本回合 step=1 usage 即首测值。"""
    def handler(req, n):
        payload = _payload(req)
        if payload.get("stream") is False:
            return _summary_json(SUMMARY_TEXT)
        return _sse(_usage_turn(5678))

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        _seed_last_tokens(c, "s1", 7001)  # 超阈值触发自动压缩
        evs = _events(c, "s1", "q")
        assert evs[-1] == {"type": "turn.end", "reason": "done"}

    rows = _rows(c)
    (crow,) = [x for x in rows if x["kind"] == "compress"]
    step1 = [x for x in rows if x["kind"] == "llm" and x["step"] == 1
             and x["turn_id"] == crow["turn_id"]]
    assert crow["endpoint"] == "turn" and crow["tokens_before"] == 7001
    assert len(step1) == 1 and step1[0]["tokens_prompt"] == 5678
    assert crow["tokens_after"] == 5678  # 回合内懒回填（压缩后首测 = 本回合 step=1）


def test_懒回填_usage无prompt_tokens_不回填不补造(tmp_path: Path):
    """上游不返回 prompt_tokens → llm 行记 NULL、compress 行维持 NULL（铁律 5 不造数）。"""
    def handler(req, n):
        payload = _payload(req)
        if payload.get("stream") is False:
            return _summary_json(SUMMARY_TEXT)
        return _sse(text_then_done("ok", 10))  # usage 仅 total_tokens

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        assert _compact(c, "s1").status_code == 200
        _events(c, "s1", "下一问")

    rows = _rows(c)
    (crow,) = [x for x in rows if x["kind"] == "compress"]
    (lrow,) = [x for x in rows if x["kind"] == "llm" and x["step"] == 1]
    assert lrow["tokens_prompt"] is None
    assert crow["tokens_after"] is None  # 未测得恒 NULL（聚合显缺失）


def test_懒回填_失败行不回填(tmp_path: Path):
    """status=error/timeout 行不计降幅、不参与懒回填（REQ-041 异常分支口径）。"""
    state = {"fail": True}

    def handler(req, n):
        payload = _payload(req)
        if payload.get("stream") is False:
            if state["fail"]:
                return httpx.Response(500, json={"error": "boom"})
            return _summary_json(SUMMARY_TEXT)
        return _sse(_usage_turn(777))

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        assert _compact(c, "s1").status_code == 502     # 失败行落库
        state["fail"] = False
        assert _compact(c, "s1").status_code == 200     # 成功行落库
        _events(c, "s1", "下一问")

    rows = [x for x in _rows(c) if x["kind"] == "compress"]
    failed = [x for x in rows if x["status"] == "error"]
    ok = [x for x in rows if x["status"] == "ok"]
    assert len(failed) == 1 and failed[0]["tokens_after"] is None  # 失败行不回填
    assert len(ok) == 1 and ok[0]["tokens_after"] == 777


# ---------- 成本口径配套：手动压缩 compress 行 mode 随回合当前模式 ----------

def test_手动压缩_compress行mode_unified(tmp_path: Path):
    """统一 key 模式 → compress 行 mode='unified'（成本聚合纳入依据，REQ-041 口径）。"""
    def handler(req, n):
        if _payload(req).get("stream") is False:
            return _summary_json(SUMMARY_TEXT)
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(12))
        assert _compact(c, "s1").status_code == 200
        (row,) = [x for x in _rows(c) if x["kind"] == "compress"]
        assert row["mode"] == "unified"
        assert row["day"] == today()
