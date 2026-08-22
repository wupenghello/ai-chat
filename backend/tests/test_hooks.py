"""iter-19 T2：生命周期事件 hooks（CHG-013 REQ-048 验收 1~7）。

夹具沿 test_turn 体例（turn_app + MockTransport 脚本化帧）；hook 捕获列表由异步
回调在事件循环线程写入、主线程 deadline 轮询消费；注册表与任务集合每用例隔离。
hooks.dispatch 经模块级 get_settings 读配置——非默认 hook_timeout / 停用态以
monkeypatch 对齐（体例同 dependency_overrides 之于路由依赖）。
"""

import asyncio
import contextlib
import json
import time
from dataclasses import asdict
from pathlib import Path

import httpx
import pytest
from app import agent, hooks
from app.config import Settings
from app.research import ResearchProfile
from app.tools import ToolDef

from tests.test_turn import (
    UNIFIED_KEY,
    _events,
    _plain,
    _sse,
    text_then_done,
    tool_call_then_done,
    turn_app,
)

SECRET_MSG = "机密消息正文标记"  # 卫生探针：消息正文与工具结果均含此串
SECRET_TOOL_RESULT = "工具结果全文标记"


@pytest.fixture
def clean_hooks():
    """注册表与任务集合每用例隔离（模块级单例的测试卫生）。"""
    saved = list(hooks._REGISTRY)
    hooks._REGISTRY.clear()
    hooks._TASKS.clear()
    yield
    hooks._REGISTRY.clear()
    hooks._TASKS.clear()
    hooks._REGISTRY.extend(saved)


def _capture(got: list, *, name: str = "cap", evs: set[str] | None = None) -> None:
    async def cb(event: hooks.HookEvent) -> None:
        got.append(event)

    hooks.register_hook(name, cb, events=evs)


def _wait_for(cond, timeout: float = 2.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if cond():
            return True
        time.sleep(0.02)
    return cond()


def _one_step_handler(_req, _n):
    return _sse(text_then_done("你好", 42))


def _two_step_handler(_req, n):
    if n == 1:
        return _sse(tool_call_then_done("先查", "echo",
                                        f'{{"text":"{SECRET_TOOL_RESULT}"}}', 100))
    return _sse(text_then_done("完成", 50))


# ---------- 验收 1：分发与载荷（含卫生探针） ----------

def test_验收1_五回合事件真实时序与公共载荷(tmp_path: Path, clean_hooks):
    got: list = []
    _capture(got)

    with turn_app(tmp_path, _two_step_handler) as (c, seen):
        sid = _plain(c, seen)
        evs = _events(c, sid, SECRET_MSG)
        assert _wait_for(lambda: len(got) >= 4)
        assert [e.event for e in got] == [
            "turn.accepted", "tool.before", "tool.after", "turn.end"]
        turn_id = evs[0]["turn_id"]
        for e in got:
            assert e.turn_id == turn_id  # 与 SSE turn.start 同源
            assert e.session_id == "s1"
            assert e.user_id  # 注册用户主键非空
            assert e.mode == "chat"
            assert e.timestamp and "T" in e.timestamp  # UTC ISO8601


def test_验收1_工具与终态事件专有字段(tmp_path: Path, clean_hooks):
    got: list = []
    _capture(got)

    with turn_app(tmp_path, _two_step_handler) as (c, seen):
        sid = _plain(c, seen)
        _events(c, sid, "q")
        assert _wait_for(lambda: len(got) >= 4)
        before, after, end = got[1], got[2], got[3]
        assert (before.step, before.tool_name) == (1, "echo")
        assert before.status is None and before.duration_ms is None
        assert after.status == "ok"
        assert after.duration_ms is not None and after.duration_ms >= 0
        assert end.reason == "done"
        assert end.requests == 2 and end.tokens == 150


def test_验收1_载荷与warning日志卫生探针(tmp_path: Path, clean_hooks, caplog):
    async def bad(ev: hooks.HookEvent) -> None:
        raise RuntimeError("hook boom 标记")

    got: list = []
    _capture(got)
    hooks.register_hook("bad", bad)

    with turn_app(tmp_path, _two_step_handler) as (c, seen):
        sid = _plain(c, seen)
        caplog.clear()
        with caplog.at_level("WARNING", logger="ai-chat.hooks"):
            _events(c, sid, SECRET_MSG)
            assert _wait_for(lambda: "hook bad failed" in caplog.text)
        assert _wait_for(lambda: len(got) >= 4)

    dump = json.dumps([asdict(e) for e in got], ensure_ascii=False, default=str)
    assert SECRET_MSG not in dump            # 消息正文不进载荷
    assert SECRET_TOOL_RESULT not in dump    # 工具结果全文不进载荷
    assert UNIFIED_KEY not in dump           # key 不进载荷
    assert SECRET_MSG not in caplog.text     # warning 日志不含消息正文（hook 名/事件名 only）
    assert UNIFIED_KEY not in caplog.text


# ---------- 验收 2/3：故障隔离与超时护栏 ----------

BASELINE_TYPES = [
    "turn.start", "turn.step", "text.delta", "tool.call", "tool.result",
    "turn.step", "text.delta", "usage", "turn.end",
]


def test_验收2_必抛与超时hook_事件序基线一致_无任务泄漏(
        tmp_path: Path, clean_hooks, caplog, monkeypatch):
    monkeypatch.setattr(hooks, "get_settings",
                        lambda: Settings(hook_timeout=0.15))

    async def bad(ev: hooks.HookEvent) -> None:
        raise RuntimeError("boom")

    async def slow(ev: hooks.HookEvent) -> None:
        await asyncio.sleep(2.0)

    hooks.register_hook("bad", bad)
    hooks.register_hook("slow", slow)

    with turn_app(tmp_path, _two_step_handler) as (c, seen):
        sid = _plain(c, seen)
        with caplog.at_level("WARNING", logger="ai-chat.hooks"):
            evs = _events(c, sid, "q")
        # 事件序与 REQ-030 验收 1 基线逐帧一致（有 hook 不改变 SSE 流）
        assert [e["type"] for e in evs] == BASELINE_TYPES
        assert evs[-1] == {"type": "turn.end", "reason": "done"}
        # 分发任务终态自移除（无泄漏、无引用累积）
        assert _wait_for(lambda: len(hooks._TASKS) == 0)
        assert "hook bad failed" in caplog.text
        assert "hook slow timed out" in caplog.text


def test_验收3_超时护栏_回合不因hook拖累(tmp_path: Path, clean_hooks, monkeypatch):
    monkeypatch.setattr(hooks, "get_settings",
                        lambda: Settings(hook_timeout=0.1))

    async def slow(ev: hooks.HookEvent) -> None:
        await asyncio.sleep(3.0)

    hooks.register_hook("slow", slow)

    with turn_app(tmp_path, _one_step_handler) as (c, seen):
        sid = _plain(c, seen)
        t0 = time.monotonic()
        evs = _events(c, sid, "q")
        elapsed = time.monotonic() - t0
    assert evs[-1]["reason"] == "done"
    assert elapsed < 1.0  # hook 悬挂 3s 不拖累回合（护栏 0.1s 放弃 + 余量）


def test_吞取消坏公民hook_护栏有界_任务自移除(clean_hooks, monkeypatch):
    """T0-1 组 3b 回归：hook 吞 CancelledError 不重抛，wait_for 仍在护栏值处返回。"""
    monkeypatch.setattr(hooks, "get_settings",
                        lambda: Settings(hook_timeout=0.15))

    async def bad_citizen(ev: hooks.HookEvent) -> None:
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.sleep(5.0)

    hooks.register_hook("bad", bad_citizen)

    def go() -> float:
        async def scenario() -> float:
            t0 = time.monotonic()
            hooks.dispatch(hooks.HookEvent(
                event=hooks.TURN_END, turn_id="t", session_id="s", user_id=1,
                mode="chat", timestamp="now", reason="done", requests=1, tokens=1))
            while hooks._TASKS and time.monotonic() - t0 < 1.0:
                await asyncio.sleep(0.02)
            return time.monotonic() - t0
        return asyncio.run(scenario())

    elapsed = go()
    assert not hooks._TASKS  # 正常终态自移除（吞取消 → wait_for 返回 → 任务完成）
    assert elapsed < 1.0      # 护栏 0.15s 有界，不悬挂


# ---------- 验收 4：断连终态（直驱 run_turn，取消传播等价代理层路径） ----------

def test_验收4_断连取消_turn_cancelled且无turn_end(clean_hooks):
    def go() -> list:
        async def scenario() -> list:
            got: list = []
            _capture(got)

            async def slow_tool(_args):
                await asyncio.sleep(5.0)
                return "late"

            import app.tools as gw
            defn = ToolDef(name="hk_slow_demo", description="",
                           parameters={"type": "object", "properties": {}},
                           handler=slow_tool, timeout=10.0)
            gw.register_tool(defn)
            try:
                return await _drive_and_cancel(defn, got)
            finally:
                gw._REGISTRY.pop("hk_slow_demo", None)  # 全局注册表不留污染（测试卫生）

        return asyncio.run(scenario())

    async def _drive_and_cancel(defn, got: list) -> list:
        def handler(_req):
            return _sse(tool_call_then_done("查", "hk_slow_demo", "{}", 10))

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        agen = agent.run_turn(
            client=client, base_url="http://up.test", api_key="k", model="m",
            session_id="s-cxl", user_id=7,
            messages=[{"role": "user", "content": "q"}],
            tool_defs=[defn], max_steps=3, step_timeout=10.0,
            tool_result_limit=1024,
        )
        got_tool_call = asyncio.Event()

        async def consume() -> None:
            async for ev in agen:
                if ev.get("type") == "tool.call":
                    got_tool_call.set()

        task = asyncio.create_task(consume())
        await got_tool_call.wait()
        await asyncio.sleep(0.05)  # 工具已挂起（slow_tool 5s 窗口内）
        task.cancel()              # 等价代理层断连：取消注入工具 await 点
        with contextlib.suppress(asyncio.CancelledError):
            await task
        await asyncio.sleep(0.1)   # 驱动 fire-and-forget hook 任务
        return list(got)

    got = go()
    events = [e.event for e in got]
    assert hooks.TURN_CANCELLED in events
    assert hooks.TURN_END not in events          # 断连终态不产 turn.end（现行口径）
    assert hooks.TOOL_BEFORE in events           # tool.call 后、取消前已触发
    assert all(e.mode == "chat" for e in got)


# ---------- 验收 5：零注册 / 停用 = 零回退 ----------

def test_验收5_注册表空_零任务_事件序正常(tmp_path: Path, clean_hooks):
    with turn_app(tmp_path, _two_step_handler) as (c, seen):
        sid = _plain(c, seen)
        evs = _events(c, sid, "q")
    assert [e["type"] for e in evs] == BASELINE_TYPES
    assert hooks._TASKS == set()  # 短路路径全程零任务创建


def test_验收5_停用开关_零分发_流逐帧等价(tmp_path: Path, clean_hooks, monkeypatch):
    got: list = []
    _capture(got)

    def _strip_turn_id(evs: list) -> list:
        return [{k: v for k, v in e.items() if k != "turn_id"} for e in evs]

    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    # 停用补丁先于两回合：a 基线采集与 b 断言面同为停用态（基线语义 = 无 hook 效果）
    monkeypatch.setattr(hooks, "get_settings",
                        lambda: Settings(hooks_enabled=False))
    with turn_app(tmp_path / "a", _one_step_handler) as (c, seen):
        sid = _plain(c, seen)
        baseline = _strip_turn_id(_events(c, sid, "q"))
    with turn_app(tmp_path / "b", _one_step_handler) as (c, seen):
        sid = _plain(c, seen)
        evs = _events(c, sid, "q")
    assert _strip_turn_id(evs) == baseline  # 除 turn_id 外逐帧等价
    assert got == []                        # 停用零分发
    assert hooks._TASKS == set()            # 短路零任务


# ---------- 验收 6：research 回合同管线覆盖 ----------

def test_验收6_research回合_同管线触发_mode字段(clean_hooks):
    def go() -> list:
        async def scenario() -> list:
            got: list = []
            _capture(got)
            client = httpx.AsyncClient(transport=httpx.MockTransport(
                lambda _req: _sse(text_then_done("你好", 42))))
            agen = agent.run_turn(
                client=client, base_url="http://up.test", api_key="k", model="m",
                session_id="s-rs", user_id=9,
                messages=[{"role": "user", "content": "q"}],
                tool_defs=[], max_steps=10, step_timeout=10.0,
                tool_result_limit=1024,
                research=ResearchProfile(max_steps=16, total_timeout=900.0),
            )
            async for _ev in agen:
                pass
            await asyncio.sleep(0.1)
            return list(got)

        return asyncio.run(scenario())

    got = go()
    assert [e.event for e in got] == ["turn.end"]  # 无工具回合仅终态（accepted 属 proxy 侧）
    assert all(e.mode == "research" for e in got)


# ---------- 验收 7：被拒回合零事件 ----------

def test_验收7_配额拒绝_零事件(tmp_path: Path, clean_hooks):
    with turn_app(tmp_path, _one_step_handler,
                  settings_extra={"quota_free_daily": 1}) as (c, seen):
        sid = _plain(c, seen)
        got: list = []
        _capture(got)
        _events(c, sid, "第一回合耗尽配额")
        got.clear()  # 第一回合事件不计入断言面
        r = c.post("/api/chat/turn", json={"session_id": sid, "message": "第二回合"})
        assert r.status_code == 429
        time.sleep(0.1)
        assert got == []  # 429 被拒回合零事件（受理成立点未达）


def test_验收7_research门控拒绝_零事件(tmp_path: Path, clean_hooks):
    got: list = []
    _capture(got)

    with turn_app(tmp_path, _one_step_handler) as (c, seen):  # search_key 空 → 三与门不满足
        sid = _plain(c, seen)
        r = c.post("/api/chat/turn",
                   json={"session_id": sid, "message": "q", "mode": "research"})
        assert r.status_code == 422
        assert got == []


# ---------- 注册语义补充面 ----------

def test_订阅过滤_仅收订阅事件(tmp_path: Path, clean_hooks):
    got: list = []
    _capture(got, evs={hooks.TURN_END})

    with turn_app(tmp_path, _one_step_handler) as (c, seen):
        sid = _plain(c, seen)
        _events(c, sid, "q")
        assert _wait_for(lambda: len(got) >= 1)
    assert [e.event for e in got] == ["turn.end"]


def test_同事件多hook_各自分发(tmp_path: Path, clean_hooks):
    got_a: list = []
    got_b: list = []
    _capture(got_a, name="a")
    _capture(got_b, name="b")

    with turn_app(tmp_path, _one_step_handler) as (c, seen):
        sid = _plain(c, seen)
        _events(c, sid, "q")
        assert _wait_for(lambda: len(got_a) >= 2 and len(got_b) >= 2)
    assert [e.event for e in got_a] == ["turn.accepted", "turn.end"]
    assert [e.event for e in got_b] == ["turn.accepted", "turn.end"]


def test_未注册工具_前后事件照常_error终态(tmp_path: Path, clean_hooks):
    def handler(_req, n):
        if n == 1:
            return _sse(tool_call_then_done("调", "no_such_tool", "{}", 10))
        return _sse(text_then_done("降级直答", 20))

    got: list = []
    _capture(got)

    with turn_app(tmp_path, handler) as (c, seen):
        sid = _plain(c, seen)
        evs = _events(c, sid, "q")
        assert _wait_for(lambda: len(got) >= 4)
    assert [e.event for e in got] == [
        "turn.accepted", "tool.before", "tool.after", "turn.end"]
    before, after = got[1], got[2]
    assert before.tool_name == "no_such_tool"   # 未注册路径同点触发
    assert after.status == "error"              # error 终态已知
    assert evs[-1]["reason"] == "done"          # 降级直答回合继续
