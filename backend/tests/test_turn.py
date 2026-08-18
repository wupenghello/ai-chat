"""iter-13 T1：回合端点 + agent 运行时 + schema:2 守卫（CHG-007 REQ-030~034 / REQ-022 增补）。

上游以 httpx.MockTransport 模拟（同 test_proxy 惯例）；SSE v2 事件流逐帧断言。
"""

import asyncio
import json
import re
import time
from contextlib import contextmanager
from pathlib import Path

import httpx
import pytest
from app.config import Settings, get_settings
from app.main import create_app
from fastapi.testclient import TestClient

from tests.conftest import register

UPSTREAM = "http://upstream.test"
UNIFIED_KEY = "sk-unified-test"
UNIFIED_MODEL = "deepseek-test"


# ---------- 上游脚本化帧 ----------

def _frame(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


def text_then_done(text: str, tokens: int):
    return _frame({"choices": [{"delta": {"content": text}}]}) + \
        _frame({"choices": [], "usage": {"total_tokens": tokens}}) + "data: [DONE]\n\n"


def tool_call_then_done(prefix_text: str, tool: str, args: str, tokens: int):
    """文本 → tool_calls 首片（id+name+半截 arguments）→ 续片（按 index 对齐）→ usage。"""
    return (
        _frame({"choices": [{"delta": {"content": prefix_text}}]}) +
        _frame({"choices": [{"delta": {"tool_calls": [
            {"index": 0, "id": "c_1", "function": {"name": tool, "arguments": args[:3]}}]}}]}) +
        _frame({"choices": [{"delta": {"tool_calls": [
            {"index": 0, "function": {"arguments": args[3:]}}]}}]}) +
        _frame({"choices": [], "usage": {"total_tokens": tokens}}) +
        "data: [DONE]\n\n"
    )



def _sse(body: str) -> httpx.Response:
    """MockTransport 流式响应：bytes content 会在构造时被 read()（is_stream_consumed），
    必须用 async 生成器承载（test_proxy._sse_response 同因）。整段一块：帧切分由解析器做。"""

    async def gen():
        yield body.encode()

    return httpx.Response(200, content=gen())


@contextmanager
def turn_app(tmp_path: Path, handler, *, settings_extra: dict | None = None):
    kwargs: dict = {
        "db_path": str(tmp_path / "t.db"),
        "unified_key": UNIFIED_KEY,
        "unified_base_url": UPSTREAM,
        "unified_model": UNIFIED_MODEL,
    }
    kwargs.update(settings_extra or {})
    settings = Settings(**kwargs)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    seen: list[httpx.Request] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request, len(seen))

    with TestClient(app) as c:
        c.app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(wrapped))
        yield c, seen


def _put_session(c, sid, messages, *, schema=None):
    doc: dict = {"id": sid, "title": "t", "messages": messages, "updatedAt": 1}
    if schema is not None:
        doc["schema"] = schema
    r = c.put(f"/api/sessions/{sid}", json=doc)
    assert r.status_code == 200, r.text


def _events(c: TestClient, sid: str, message: str, **extra) -> list[dict]:
    with c.stream("POST", "/api/chat/turn",
                  json={"session_id": sid, "message": message, **extra}) as r:
        assert r.status_code == 200, r.headers
        assert r.headers["content-type"].startswith("text/event-stream")
        out = []
        for line in r.iter_lines():
            if line.startswith("data: "):
                out.append(json.loads(line[6:]))
    return out


def _upstream_messages(req: httpx.Request) -> list[dict]:
    return json.loads(req.content.decode())["messages"]


def _plain(c, seen, sid="s1"):
    """注册普通用户 + 空会话。"""
    register(c, "alice")
    _put_session(c, sid, [])
    return sid


@pytest.fixture
def tmp(tmp_path):
    return tmp_path


# ---------- REQ-030 验收 1：事件序逐帧断言 ----------

def test_两步工具回合_事件序逐帧(tmp):
    def handler(_req, n):
        if n == 1:
            return _sse(tool_call_then_done(
                "我先查一下", "demo_weather", '{"city":"北京"}', 1200))
        return _sse(text_then_done("北京：晴。", 900))

    with turn_app(tmp, handler) as (c, seen):
        sid = _plain(c, seen)
        raw_lines = []
        with c.stream("POST", "/api/chat/turn",
                      json={"session_id": sid, "message": "北京天气？"}) as r:
            for line in r.iter_lines():
                if line.startswith("data: "):
                    raw_lines.append(line)
        evs = [json.loads(ln[6:]) for ln in raw_lines]

        assert [e["type"] for e in evs] == [
            "turn.start", "turn.step", "text.delta", "tool.call", "tool.result",
            "turn.step", "text.delta", "usage", "turn.end",
        ]
        assert evs[1] == {"type": "turn.step", "step": 1, "max_steps": 10}
        assert evs[2] == {"type": "text.delta", "text": "我先查一下"}
        assert evs[3] == {"type": "tool.call", "tool_call_id": "c_1",
                          "name": "demo_weather", "arguments": '{"city":"北京"}'}
        assert evs[4]["type"] == "tool.result"
        assert evs[4]["tool_call_id"] == "c_1"
        assert evs[4]["status"] == "ok"
        assert evs[4]["result"] == "北京：晴，最高 32°C"
        assert evs[4]["duration_ms"] >= 0
        assert evs[5] == {"type": "turn.step", "step": 2, "max_steps": 10}
        assert evs[6] == {"type": "text.delta", "text": "北京：晴。"}
        assert evs[7] == {"type": "usage", "requests": 2, "tokens": 2100}
        assert evs[8] == {"type": "turn.end", "reason": "done"}
        # 帧格式：单行 JSON（design-iter-13 协议约束），无多行 data
        assert all("\n" not in ln for ln in raw_lines)


def test_echo_演示工具_端到端(tmp):
    def handler(_req, n):
        if n == 1:
            return _sse(tool_call_then_done(
                "echo", "echo", '{"text":"往返验证"}', 100))
        return _sse(text_then_done("完成", 50))

    with turn_app(tmp, handler) as (c, seen):
        sid = _plain(c, seen)
        # 空会话直接发消息（PUT-late 流：库内无本条消息，由请求补）
        evs = _events(c, sid, "测一下")
        tool_result = [e for e in evs if e["type"] == "tool.result"][0]
        assert tool_result["status"] == "ok"
        assert tool_result["result"] == "往返验证"


# ---------- REQ-030 验收 2/3：步数上限与工具超时 ----------

def test_步数上限_第2步后截停_不悬挂(tmp):
    def handler(_req, n):
        return _sse(tool_call_then_done(
            f"第{n}步", "echo", '{"text":"x"}', 100))

    with turn_app(tmp, handler, settings_extra={"agent_max_steps": 2}) as (c, seen):
        sid = _plain(c, seen)
        evs = _events(c, sid, "q")
        assert evs[-1] == {"type": "turn.end", "reason": "max_steps"}
        assert len(seen) == 2  # 第 3 次上游调用不发起
        assert evs[-2]["requests"] == 2  # usage 已发生部分如实累计


def test_工具超时_该步取消_回合降级直答(tmp):
    import app.tools as gw
    from app.tools import ToolDef

    async def slow(_args):
        await asyncio.sleep(1.0)
        return "late"

    gw.register_tool(ToolDef(name="t_slow_demo", description="",
                             parameters={"type": "object",
                                         "properties": {"text": {"type": "string"}},
                                         "required": ["text"]},
                             handler=slow, timeout=0.05, admin_only=True))

    def handler(_req, n):
        if n == 1:
            return _sse(tool_call_then_done(
                "查", "t_slow_demo", '{"text":"x"}', 100))
        return _sse(text_then_done("降级直答。", 50))

    with turn_app(tmp, handler) as (c, seen):
        sid = _plain(c, seen)
        evs = _events(c, sid, "q")
        tool_result = [e for e in evs if e["type"] == "tool.result"][0]
        assert tool_result["status"] == "timeout"
        assert tool_result["result"] == "工具执行超时"
        assert evs[-1] == {"type": "turn.end", "reason": "done"}  # 回合继续，模型拿到超时结果直答
    gw._REGISTRY.pop("t_slow_demo", None)  # 全局注册表清理，防污染后续用例


# ---------- REQ-034：配额回合计 ----------

def test_配额_第6回合拦截_零上游调用(tmp):
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler, settings_extra={"quota_free_daily": 5}) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", [])
        for i in range(5):
            evs = _events(c, "s1", f"m{i}")
            assert evs[-1]["reason"] == "done"
        assert len(seen) == 5
        r = c.post("/api/chat/turn", json={"session_id": "s1", "message": "m5"})
        assert r.status_code == 429
        assert r.json()["code"] == "quota_exhausted"
        assert len(seen) == 5  # 拦截回合零上游调用（REQ-024 取证口径延续）


def test_回合计_tokens如实累计(tmp):
    def handler(_req, n):
        if n < 3:
            return _sse(tool_call_then_done(
                f"t{n}", "echo", '{"text":"x"}', 1200 if n == 1 else 1500))
        return _sse(text_then_done("done", 900))

    with turn_app(tmp, handler) as (c, seen):
        sid = _plain(c, seen)
        evs = _events(c, sid, "q")
        usage = [e for e in evs if e["type"] == "usage"][0]
        assert usage == {"type": "usage", "requests": 3, "tokens": 3600}  # 1200+1500+900
        import sqlite3
        conn = sqlite3.connect(c.app.state.db_path)
        row = conn.execute(
            "SELECT requests, turns, tokens FROM usage_daily WHERE mode='unified'").fetchone()
        conn.close()
        assert row == (1, 1, 3600)  # 3 次调用 = 1 回合；tokens 如实累计


# ---------- REQ-033：服务端组装（等价 / 窗口 / 工具回合窗口同构） ----------

def _mk_turns(n: int) -> list[dict]:
    return [{"id": f"m{i}", "role": "user" if i % 2 == 0 else "assistant",
             "content": f"msg{i}", "status": "done"} for i in range(n * 2)]


def test_组装_系统段恒含当前时间行():
    """CHG-008（2026-08-18 CEO 验收反馈）：模型无时钟，上下文恒注入当前时间行。"""
    from app.agent import _now_line, assemble_context

    assert re.fullmatch(
        r"当前时间：\d{4}-\d{2}-\d{2}（周[一二三四五六日]）\d{2}:\d{2}（北京时间）",
        _now_line(),
    )
    ctx = assemble_context([], "hi", None)
    assert ctx[0]["role"] == "system"
    assert ctx[0]["content"] == _now_line()  # 无用户提示词 → 系统段仅时间行
    assert ctx[-1] == {"role": "user", "content": "hi"}
    ctx2 = assemble_context([], "hi", "你是助手")
    assert ctx2[0]["content"] == f"你是助手\n\n{_now_line()}"  # 有则拼接其后


def test_组装等价_系统提示词首位加最近20轮(tmp):
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(30))  # 30 轮存量（不含本条新消息）
        evs = _events(c, "s1", "current question", system_prompt="你是助手")
        assert evs[-1]["reason"] == "done"

        msgs = _upstream_messages(seen[-1])
        # CHG-008（2026-08-18）：系统段恒存在 = 用户系统提示词 + 当前时间行（时间动态，正则断言）
        assert msgs[0]["role"] == "system"
        assert msgs[0]["content"].startswith("你是助手\n\n当前时间：")
        time_pat = r"当前时间：\d{4}-\d{2}-\d{2}（周[一二三四五六日]）\d{2}:\d{2}（北京时间）"
        assert re.search(time_pat, msgs[0]["content"])
        expected = [msgs[0]]
        # 等价口径（旧 buildContext）：30 轮存量 + 本条 = 31 轮，取最近 20 轮
        # = 第 12 轮 user 起（m22..m59）+ 本条；旧法「最近 40 条 + 丢悬空 assistant」同结果
        for i in range(22, 60):
            role = "user" if i % 2 == 0 else "assistant"
            expected.append({"role": role, "content": f"msg{i}"})
        expected.append({"role": "user", "content": "current question"})
        assert msgs == expected  # 逐字段等价（验收 6；系统段外逐字）


def test_组装_库内已含本条消息_不重复追加(tmp):
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler) as (c, seen):
        register(c, "alice")
        doc_msgs = _mk_turns(2) + [{"id": "m_now", "role": "user",
                                    "content": "current question", "status": "done"}]
        _put_session(c, "s1", doc_msgs)
        _events(c, "s1", "current question")
        msgs = _upstream_messages(seen[-1])
        user_now = [m for m in msgs if m["content"] == "current question"]
        assert len(user_now) == 1  # 先 PUT 再发回合的流向下不重复（去重护栏）


def test_组装_工具回合窗口同构(tmp):
    def handler(_req, n):
        if n == 1:
            return _sse(tool_call_then_done(
                "", "echo", '{"text":"x"}', 100))
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler) as (c, seen):
        register(c, "alice")
        # v2 blocks 存量回合（工具消息属助手侧不占轮，REQ-033 验收 4）
        v2_round = [
            {"id": "a1", "role": "user", "content": "问1", "status": "done"},
            {"id": "a2", "role": "assistant", "content": [
                {"type": "text", "text": "查一下"},
                {"type": "tool_call", "tool_call_id": "c0", "name": "echo",
                 "arguments": '{"text":"1"}'},
                {"type": "tool_result", "tool_call_id": "c0", "status": "ok", "result": "1"},
                {"type": "text", "text": "答1"},
            ], "status": "done"},
        ]
        _put_session(c, "s1", v2_round + _mk_turns(1))
        _events(c, "s1", "next question")
        msgs = _upstream_messages(seen[-1])
        # v1/v2 混流归一化：blocks 展开 assistant(tool_calls) + tool 消息
        assert {"role": "tool", "tool_call_id": "c0", "content":
                "<tool_result>\n1\n</tool_result>"} in msgs
        wire_tc = [m for m in msgs if m.get("tool_calls")]
        assert wire_tc and wire_tc[0]["tool_calls"][0]["function"]["name"] == "echo"
        # 窗口：v2 回合（1 轮）+ _mk_turns(1)（1 轮）+ 本条 = 3 轮全在 20 轮内
        assert sum(1 for m in msgs if m["role"] == "user") == 3


# ---------- 工具可用性（定夺①④） ----------

def test_非admin用户_上游载荷不含tools(tmp):
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler) as (c, seen):
        register(c, "root")  # 首个注册用户自动成为管理员（迁移 v5）
        c.post("/api/auth/logout")
        register(c, "bob")  # 第二个用户 = 普通用户
        _put_session(c, "s1", [])
        _events(c, "s1", "q")
        payload = json.loads(seen[-1].content.decode())
        assert "tools" not in payload  # 演示工具仅 admin（定夺④）


def test_admin用户_上游载荷含工具定义(tmp):
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler) as (c, seen):
        register(c, "root")  # 首个注册用户自动成为管理员（迁移 v5）
        _put_session(c, "s1", [])
        _events(c, "s1", "q")
        payload = json.loads(seen[-1].content.decode())
        assert [t["function"]["name"] for t in payload["tools"]] == ["echo", "demo_weather"]


def test_自填档案_工具开关关_无工具模式组装(tmp):
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler) as (c, seen):
        register(c, "alice")
        r = c.post("/api/profiles", json={"name": "p", "base_url": UPSTREAM,
                                          "model": "m1", "api_key": "sk-x"})
        assert r.status_code in (200, 201), r.text
        import sqlite3
        conn = sqlite3.connect(c.app.state.db_path)
        conn.execute("UPDATE profiles SET is_active = 1, tools_enabled = 0")
        conn.commit()
        conn.close()
        _put_session(c, "s1", [])
        _events(c, "s1", "q")
        payload = json.loads(seen[-1].content.decode())
        assert "tools" not in payload  # 定夺①：开关为关 → 无工具模式组装


# ---------- 错误映射（REQ-030 验收 5：十场景体系复用） ----------

@pytest.mark.parametrize("status,code", [
    (401, "upstream_auth"), (403, "upstream_auth"), (429, "upstream_rate_limited"),
    (500, "upstream_error"),
])
def test_上游错误_映射为error事件_回合不崩(tmp, status, code):
    def handler(_req, n):
        return httpx.Response(status, json={"error": "x"})

    with turn_app(tmp, handler) as (c, seen):
        sid = _plain(c, seen)
        evs = _events(c, sid, "q")
        types = [e["type"] for e in evs]
        assert types == ["turn.start", "turn.step", "error", "usage", "turn.end"]
        assert evs[2]["code"] == code
        assert evs[3] == {"type": "usage", "requests": 0, "tokens": 0}
        assert evs[4] == {"type": "turn.end", "reason": "error"}


# ---------- 端点校验 ----------

def test_会话不存在_404(tmp):
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler) as (c, seen):
        register(c, "alice")
        r = c.post("/api/chat/turn", json={"session_id": "ghost", "message": "q"})
        assert r.status_code == 404
        assert r.json()["code"] == "session_not_found"


def test_会话属他人_404(tmp):
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s_alice", [{"id": "m1", "role": "user", "content": "x", "status": "done"}])
        c.post("/api/auth/logout")
        register(c, "bob")
        r = c.post("/api/chat/turn", json={"session_id": "s_alice", "message": "q"})
        assert r.status_code == 404  # 复合主键归属隔离：不泄露他人会话存在性


def test_空消息_422(tmp):
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler) as (c, seen):
        register(c, "alice")
        r = c.post("/api/chat/turn", json={"session_id": "s", "message": ""})
        assert r.status_code == 422
        assert not seen  # 校验失败零上游


# ---------- REQ-022 增补：schema:2 写侧守卫 ----------

def test_守卫_旧格式覆盖新格式_409且存量逐字不动(tmp):
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler) as (c, seen):
        register(c, "alice")
        v2_doc = {"id": "s1", "schema": 2, "title": "新", "updatedAt": 2,
                  "messages": [{"id": "m1", "role": "assistant", "content": [
                      {"type": "text", "text": "答案"},
                      {"type": "tool_call", "tool_call_id": "c1", "name": "echo",
                       "arguments": "{}"},
                      {"type": "tool_result", "tool_call_id": "c1", "status": "ok",
                       "result": "r"}], "status": "done"}]}
        r = c.put("/api/sessions/s1", json=v2_doc)
        assert r.status_code == 200
        stale = {"id": "s1", "title": "旧客户端副本", "updatedAt": 1,
                 "messages": [{"id": "m1", "role": "assistant",
                               "content": "答案", "status": "done"}]}
        r = c.put("/api/sessions/s1", json=stale)
        assert r.status_code == 409
        body = r.json()["detail"]
        assert body["code"] == "session_schema_conflict"
        assert body["message"] == "该会话已升级为新格式，请刷新页面获取最新版本后再编辑"
        stored = [s for s in c.get("/api/sessions").json() if s["id"] == "s1"][0]
        assert stored == v2_doc  # 存量逐字不变


def test_守卫_带标记整档透传回写_200且保留(tmp):
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler) as (c, seen):
        register(c, "alice")
        v2_doc = {"id": "s1", "schema": 2, "title": "t", "updatedAt": 1, "messages": []}
        c.put("/api/sessions/s1", json=v2_doc)
        # 模拟老客户端 GET v2 后改名回写：未知顶层字段透传、标记随档保留
        echoed = dict(c.get("/api/sessions").json()[0])
        echoed["title"] = "renamed"
        echoed["updatedAt"] = 2
        r = c.put("/api/sessions/s1", json=echoed)
        assert r.status_code == 200
        stored = [s for s in c.get("/api/sessions").json() if s["id"] == "s1"][0]
        assert stored["schema"] == 2 and stored["title"] == "renamed"


def test_守卫_v2覆v1与v1覆v1_照常保存(tmp):
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler) as (c, seen):
        register(c, "alice")
        c.put("/api/sessions/s1", json={"id": "s1", "title": "v1", "updatedAt": 1, "messages": []})
        r = c.put("/api/sessions/s1", json={"id": "s1", "schema": 2, "title": "v2",
                                            "updatedAt": 2, "messages": []})
        assert r.status_code == 200  # v2 覆 v1 = 升级，正常保存
        c.put("/api/sessions/s2", json={"id": "s2", "title": "a", "updatedAt": 1, "messages": []})
        r = c.put("/api/sessions/s2",
                  json={"id": "s2", "title": "b", "updatedAt": 2, "messages": []})
        assert r.status_code == 200  # v1 覆 v1 = LWW 照旧


# ---------- 断连取消（REQ-030 验收 4） ----------

def test_断连取消_上游连接关闭_无第二次调用(tmp):
    def handler(_req, n):
        async def gen():
            yield _frame({"choices": [{"delta": {"content": "部分"}}]}).encode()
            await asyncio.sleep(0.05)
            yield _frame({"choices": [], "usage": {"total_tokens": 99}}).encode()
            yield b"data: [DONE]\n\n"

        return httpx.Response(200, content=gen())

    with turn_app(tmp, handler) as (c, seen):
        sid = _plain(c, seen)
        with c.stream("POST", "/api/chat/turn",
                      json={"session_id": sid, "message": "q"}) as r:
            got = 0
            for line in r.iter_lines():
                if line.startswith("data: "):
                    got += 1
                if got >= 2:  # 收到 turn.start + turn.step 即断开
                    break
        # 断开后：上游仅一次调用、无孤儿（回合已计、tokens 未落——99 未达客户端即断）
        deadline = time.monotonic() + 2.0
        while len(seen) > 0 and time.monotonic() < deadline:
            if len(seen) == 1:
                break
            time.sleep(0.02)
        assert len(seen) == 1
        import sqlite3
        conn = sqlite3.connect(c.app.state.db_path)
        row = conn.execute(
            "SELECT requests, turns FROM usage_daily"
            " WHERE mode='unified'").fetchone()
        conn.close()
        assert row == (1, 1)  # 定夺⑧：回合受理即计（已抵上游）
