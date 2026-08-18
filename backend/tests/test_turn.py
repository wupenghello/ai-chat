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


def test_组装等价_空配置回退与基线v5逐字段等价(tmp):
    """REQ-036 验收 5 / REQ-033 验收 1 新口径（CHG-009 改写）。

    改写映射登记见 plans/iter-15-verify T2 段。

    旧用例「组装等价_系统提示词首位加最近20轮」断言 system 首位 = 用户提示词 + 时间行 +
    最近 20 轮逐字段等价；新口径：静态前缀空配置 → 请求体 system 部分与基线 v5 形态
    逐字段等价（回归锚点）。分区在位形态断言见 REQ-036 验收 1/2/3 各用例。
    """
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler, settings_extra={"product_persona": ""}) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(30))  # 30 轮存量（不含本条新消息）
        evs = _events(c, "s1", "current question", system_prompt="你是助手")
        assert evs[-1]["reason"] == "done"

        msgs = _upstream_messages(seen[-1])
        # 基线 v5 形态（CHG-008）：单条 system = 用户系统提示词 + 当前时间行（时间动态，正则断言）
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
        assert msgs == expected  # 逐字段等价（系统段外逐字）


# ---------- REQ-036：两段式分区（CHG-009 定夺②策略一） ----------

PERSONA = "产品人设样件：跨请求字节恒定的静态前缀内容物。"


def test_分区_静态前缀跨用户跨会话跨时刻字节恒定(tmp):
    """REQ-036 验收 1：任意两回合 system[0] content 逐字节相同（MockTransport 捕获比对）。"""
    from app import agent as agent_mod

    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler, settings_extra={"product_persona": PERSONA}) as (c, seen):
        register(c, "root")  # 首注册 = admin
        _put_session(c, "s1", [])
        _events(c, "s1", "第一个问题")
        c.post("/api/auth/logout")
        register(c, "bob")  # 不同用户
        _put_session(c, "s2", [])
        # 不同时刻：时间行跨两次请求不同（_now_line 按请求序号给两个不同值）
        times = ["当前时间：2026-08-19（周三）09:00（北京时间）",
                 "当前时间：2026-08-19（周三）21:30（北京时间）"]
        original = agent_mod._now_line
        agent_mod._now_line = lambda: times[min(len(seen), 1)]
        try:
            _events(c, "s2", "第二个问题")
        finally:
            agent_mod._now_line = original

        first, second = _upstream_messages(seen[0]), _upstream_messages(seen[1])
        assert first[0] == {"role": "system", "content": PERSONA}
        assert second[0] == {"role": "system", "content": PERSONA}
        # 逐字节相同（跨用户/跨会话/跨时刻）
        assert first[0]["content"].encode() == second[0]["content"].encode()


def test_分区_动态尾区完整性与隔离(tmp):
    """REQ-036 验收 2：用户提示词与时间行仅在 system[1]；system[0] 检索不到二者。"""
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler, settings_extra={"product_persona": PERSONA}) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", [])
        _events(c, "s1", "q", system_prompt="你是简洁的翻译助手")
        msgs = _upstream_messages(seen[-1])

        assert msgs[0]["content"] == PERSONA
        assert msgs[1]["role"] == "system"
        assert msgs[1]["content"].startswith("你是简洁的翻译助手\n\n当前时间：")
        # 隔离：system[0] 检索不到时间串与用户提示词
        assert "当前时间" not in msgs[0]["content"]
        assert "你是简洁的翻译助手" not in msgs[0]["content"]
        # 完整性：非 system 消息段不含时间行/用户提示词（仅动态尾区承载）
        rest = [m for m in msgs[2:] if m["role"] != "system"]
        assert all("当前时间：" not in m["content"] for m in rest if isinstance(m["content"], str))


def test_分区_用户提示词留空_动态尾区仅时间行(tmp):
    """REQ-036 异常分支：用户系统提示词留空 → 动态尾区仅含时间行（现状口径不变）。"""
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler, settings_extra={"product_persona": PERSONA}) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", [])
        _events(c, "s1", "q")
        msgs = _upstream_messages(seen[-1])
        assert msgs[0]["content"] == PERSONA
        assert re.fullmatch(
            r"当前时间：\d{4}-\d{2}-\d{2}（周[一二三四五六日]）\d{2}:\d{2}（北京时间）",
            msgs[1]["content"])


def test_分区_第30轮窗口零变化_仍仅最近20轮(tmp):
    """REQ-036 验收 3 + REQ-002 复验：分区在位时 20 轮窗口与 user 锚定截断零变化。"""
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler, settings_extra={"product_persona": PERSONA}) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(30))
        _events(c, "s1", "current question")
        msgs = _upstream_messages(seen[-1])
        assert msgs[0]["content"] == PERSONA and msgs[1]["role"] == "system"
        window = msgs[2:]
        # 最近 20 轮 = 第 12 轮 user 起（m22..m59 共 38 条）+ 本条 user（当轮尚无 assistant）
        assert len(window) == 39
        assert window[0] == {"role": "user", "content": "msg22"}
        assert window[-1] == {"role": "user", "content": "current question"}


def test_分区_超20轮系统提示词仍在动态尾区段首位(tmp):
    """REQ-008 验收 3（CHG-009 分区改口径）：超 20 轮时用户提示词在动态尾区段首位、不被截断。"""
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler, settings_extra={"product_persona": PERSONA}) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(25))
        _events(c, "s1", "q", system_prompt="你是简洁的翻译助手")
        msgs = _upstream_messages(seen[-1])
        assert msgs[0]["content"] == PERSONA  # 静态前缀段在其前
        assert msgs[1]["content"].startswith("你是简洁的翻译助手\n\n当前时间：")  # 动态尾区段首位


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


# ---------- 旧透传端点退役映射：回合端点等价口径收编用例 ----------
# （定夺④方案 A 下线执行，test_proxy 16 例退役映射登记见 plans/iter-15-verify T2 段；
# 以下为旧断言在回合端点的等价收编面，功能性删除为零口径的承接）

def test_turn_未登录_401(tmp):
    """退役映射收编（旧 TestAuthGate::test_未登录_401）：鉴权门禁同源。"""
    def handler(_req, n):
        raise AssertionError("未登录请求不得抵达上游")

    with turn_app(tmp, handler) as (c, seen):
        r = c.post("/api/chat/turn", json={"session_id": "s", "message": "q"})
        assert r.status_code == 401
        assert seen == []


def test_turn_统一密钥未配置_503_引导文案(tmp):
    """退役映射收编（旧 TestUnifiedMode::test_统一密钥未配置_503_引导文案）。"""
    def handler(_req, n):
        raise AssertionError("未配置密钥不得调用上游")

    with turn_app(tmp, handler, settings_extra={"unified_key": ""}) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", [])
        r = c.post("/api/chat/turn", json={"session_id": "s1", "message": "q"})
        assert r.status_code == 503
        body = r.json()
        assert body["code"] == "unified_key_missing"
        assert body["detail"] == "服务端未配置统一密钥，请联系管理员"
        assert seen == []


def test_turn_载荷_model取服务端配置(tmp):
    """退役映射收编（旧 TestUnifiedMode::test_转发请求_模型取服务端配置_body_model_被忽略）：
    回合端点请求体本无 model 字段（TurnRequest），模型恒取服务端配置。"""
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", [])
        _events(c, "s1", "q")
        (req,) = seen
        assert str(req.url) == f"{UPSTREAM}/chat/completions"
        assert req.headers["authorization"] == f"Bearer {UNIFIED_KEY}"
        payload = json.loads(req.content)
        assert payload["model"] == UNIFIED_MODEL
        assert payload["stream_options"] == {"include_usage": True}


def test_turn_自填档案_路由到档案上游与密钥_回退统一key(tmp):
    """退役映射收编（旧 TestProfileRouting 两例）：生效档案路由 + 回退统一 key。"""
    def handler(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp, handler) as (c, seen):
        register(c, "alice")
        r = c.post("/api/profiles", json={"name": "GLM", "base_url": "http://glm.test/v1",
                                          "model": "glm-5.3", "api_key": "sk-glm-test"})
        assert r.status_code == 201
        pid = r.json()["id"]
        assert c.post(f"/api/profiles/{pid}/activate").status_code == 200
        _put_session(c, "s1", [])
        _events(c, "s1", "q")
        (req,) = seen
        assert str(req.url) == "http://glm.test/v1/chat/completions"
        assert req.headers["authorization"] == "Bearer sk-glm-test"
        assert json.loads(req.content)["model"] == "glm-5.3"

        # 删除生效档案 → 回退统一 key 路由
        c.delete("/api/profiles/active")
        _events(c, "s1", "q2")
        req2 = seen[-1]
        assert str(req2.url) == f"{UPSTREAM}/chat/completions"
        assert req2.headers["authorization"] == f"Bearer {UNIFIED_KEY}"
        assert json.loads(req2.content)["model"] == UNIFIED_MODEL


@pytest.mark.parametrize("exc", [httpx.ConnectTimeout("upstream timeout"),
                                 httpx.ConnectError("connection refused")])
def test_turn_上游连接异常_error事件(tmp, exc):
    """退役映射收编（旧 test_上游超时_504 / test_上游连接失败_502_unreachable）。

    回合端点以 SSE error 事件承载（HTTP 层恒 200 流式，语义码同源 §3.1）。"""
    def handler(_req, n):
        raise exc

    expected = "upstream_timeout" if isinstance(exc, httpx.TimeoutException) \
        else "upstream_unreachable"

    with turn_app(tmp, handler) as (c, seen):
        sid = _plain(c, seen)
        evs = _events(c, sid, "q")
        assert [e["type"] for e in evs] == ["turn.start", "turn.step", "error", "usage", "turn.end"]
        assert evs[2]["code"] == expected
        assert evs[-1] == {"type": "turn.end", "reason": "error"}


def test_turn_上游流中断_error事件_回合不崩(tmp):
    """退役映射收编（旧 TestStreamInterrupt::test_上游流中断_补帧_已收内容保留）：
    回合端点语义 = 中断映射 upstream_unreachable error 事件（SSE v2 无补帧机制，事件表口径）。"""
    def handler(_req, n):
        async def gen():
            yield _frame({"choices": [{"delta": {"content": "部分"}}]}).encode()
            raise httpx.ReadError("upstream dropped")

        return httpx.Response(200, content=gen())

    with turn_app(tmp, handler) as (c, seen):
        sid = _plain(c, seen)
        evs = _events(c, sid, "q")
        types = [e["type"] for e in evs]
        assert types == ["turn.start", "turn.step", "text.delta", "error", "usage", "turn.end"]
        assert evs[3]["code"] == "upstream_unreachable"
        assert evs[-1] == {"type": "turn.end", "reason": "error"}


def test_turn_旧透传端点已下线_404(tmp):
    """定夺④下线执行取证：/api/chat/completions 已删除，请求 404（回合端点为唯一对话入口）。

    保留为回归守卫：防止旧透传端点被静默恢复（双轨维护面回潮）。
    """
    def handler(_req, n):
        raise AssertionError("已下线端点不得有上游调用")

    with turn_app(tmp, handler) as (c, seen):
        register(c, "alice")
        r = c.post("/api/chat/completions",
                   json={"messages": [{"role": "user", "content": "你好"}]})
        assert r.status_code == 404
        assert seen == []
