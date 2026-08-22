"""iter-18 T2（CHG-012 REQ-045/046）：SSE 心跳 + deep-research 编排。

上游以 httpx.MockTransport 模拟（沿 test_turn/test_search 惯例）；SSE v2 事件流逐帧断言；
心跳注释帧原始字节断言；search 以假传输层承载（search_bound，零真实出网——plans iter-14 风险①）。
CHG-018（直派批次）：三档文案逐字锚点改写 + 档位矩阵 / max_tokens / depth 交互 / read 下发面。
"""

import asyncio
import json
import re
import sqlite3
import time
from contextlib import contextmanager, suppress
from pathlib import Path

import httpx
import pytest
from app import research as research_mod
from app.config import Settings
from app.routers.proxy import _heartbeat_interval

from tests.conftest import register
from tests.test_search import SEARCH_KEY, _tavily_ok, search_bound
from tests.test_turn import (
    _events,
    _frame,
    _put_session,
    _sse,
    text_then_done,
    tool_call_then_done,
    turn_app,
)

PERSONA = "产品人设样件：跨请求字节恒定的静态前缀内容物。"

# CHG-018 R2 定稿逐字（plans/chg-018-verify.md §9；物理行拼接仅源码行宽合规，
# 字节值与定稿逐字等价；三档独立转录）
R2_LIGHT = (
    "你现在处于「深度研究」模式（轻量档）：对用户给出的问题完成一次快速的多轮检索核实，"
    "并交付带引用来源标注的简要报告。\n"
    "\n"
    "工作方法：\n"
    "1. 先输出研究计划：把问题拆解为 2~4 个具体、可检索验证的子问题，逐条列出；\n"
    "2. 逐个子问题调用 search 检索（每个至少一次）；关键结论尽量由两个独立来源支撑，"
    "做不到的在报告中如实标注「单一来源」；\n"
    "3. 覆盖后直接输出简要报告（不加前缀、不写过渡小结、不复述计划）："
    "结论先行 + 分点论证；如有关键遗留问题，文末一句话列出。\n"
    "引用标注：事实性内容以 [m-n] 标注——m = 第 m 次调用 search，"
    "n = 该次结果来源列表中的第 n 条，如 [2-1]；引用须与来源真实对应，不得虚构。\n"
    "报告正文不超过 1600 字，宁可精炼、不可超限。\n"
    "\n"
    "中间文字保持简洁，一句话说明正在查什么即可；完整论述只在报告展开。"
)

R2_STANDARD = (
    "你现在处于「深度研究」模式：对用户给出的开放问题完成一次完整的多轮检索研究，"
    "并交付带引用来源标注的综合报告。\n"
    "\n"
    "研究方法（两轮推进）：\n"
    "1. 广度轮：先输出研究计划——把问题拆解为 3~6 个具体、可检索验证的子问题，"
    "逐条列出；随即逐个子问题调用 search 检索。拟词要多角度：同义改写、中英文交替，"
    "不要一个角度只搜一次。\n"
    "2. 深度轮：审视已有证据，找出三类点——论证最薄弱的关键点、来源单一的关键结论、"
    "来源之间相互矛盾之处——对它们换角度重新拟词检索、交叉验证。"
    "关键结论须有至少两个相互独立的来源支撑；矛盾未能裁决时，如实呈现分歧。\n"
    "3. 检索纪律：某次检索结果泛化、跑题或单薄，必须换查询词重检，不得将就使用；"
    "仍无所得的，在报告中如实说明，不得以猜测充当结论。"
    "子问题确无需检索即可回答的，须明确说明理由。\n"
    "\n"
    "综合报告（进入条件：关键结论均已多来源支撑，或分歧已查证并如实标注）：\n"
    "结构四段：①结论：先行给出，并标注整体置信度（高/中/低）与理由；②分点论证；"
    "③矛盾与分歧：如有，列出各方说法与你的裁断；④未能验证的遗留问题。\n"
    "引用标注：事实性内容以 [m-n] 标注——m = 第 m 次调用 search，"
    "n = 该次结果来源列表中的第 n 条，如 [2-1][3-4]；引用须与来源真实对应，不得虚构。\n"
    "报告正文不超过 3500 字，宁可精炼、不可超限；最后一步直接输出报告正文："
    "不加「好的」「以下是报告」等前缀、不写过渡性小结、不复述研究计划。\n"
    "\n"
    "计划与检索过程中的中间文字会流式展示给用户：保持简洁，"
    "一句话说明正在查什么、为什么；完整论述只在最后的综合报告展开。"
)


R2_DEEP = (
    "你现在处于「深度研究」模式（深度档）：对用户给出的开放问题完成一次深入、"
    "多轮、可核验的检索研究，并交付带引用来源标注的综合报告。\n"
    "\n"
    "研究方法（三轮推进）：\n"
    "1. 广度轮：先输出研究计划——把问题拆解为 4~8 个具体、可检索验证的子问题，"
    "逐条列出；随即逐个子问题调用 search 检索。拟词要多角度：同义改写、中英文交替。\n"
    "2. 深读轮：从广度轮来源中挑出最权威、信息密度最高的 2~6 个来源调用 read "
    "读取原文；证据以原文为准——搜索摘要与原文冲突时，以原文为准并标注；"
    "数字、日期、版本号类事实从原文核对。\n"
    "3. 验证轮：审视全部证据，找出论证最薄弱的关键点、来源单一的关键结论、"
    "来源矛盾之处——换角度重检、交叉验证。每个关键结论须有至少两个相互独立的来源支撑；"
    "矛盾未能裁决的，如实呈现分歧。\n"
    "4. 检索纪律：结果泛化、跑题或单薄，必须换查询词重检；"
    "仍无所得的如实说明，不得以猜测充当结论。\n"
    "\n"
    "综合报告（进入条件：关键结论均已多来源支撑或原文核验，分歧已查证并如实标注）：\n"
    "结构四段：①结论：先行给出，并标注整体置信度（高/中/低）与理由；②分点论证；"
    "③矛盾与分歧：各方说法与你的裁断；④未能验证的遗留问题。\n"
    "引用标注：事实性内容以 [m-n] 标注——m = 第 m 次工具调用（search 或 read 均计入），"
    "n = 该次结果来源列表中的第 n 条，如 [2-1][5-3]（read 只有一个来源，如 [4-1]）；"
    "引用须与来源真实对应，不得虚构。\n"
    "报告正文不超过 7000 字，宁可精炼、不可超限；最后一步直接输出报告正文："
    "不加前缀、不写过渡性小结、不复述研究计划。\n"
    "\n"
    "计划与检索过程中的中间文字会流式展示给用户：保持简洁，"
    "一句话说明正在查什么、为什么；完整论述只在最后的综合报告展开。"
)



R2_ALL = (R2_LIGHT, R2_STANDARD, R2_DEEP)

@contextmanager
def research_app(tmp_path: Path, handler, *, settings_extra: dict | None = None):
    """research 回合集成夹具：turn_app（LLM 假上游）+ search_bound（Tavily 假端点）。

    三与门第三项 search_key 由本夹具注入；search 运行时绑定假传输层（零真实出网）。
    """
    extra = dict(settings_extra or {})
    extra["search_key"] = SEARCH_KEY
    with turn_app(tmp_path, handler, settings_extra=extra) as (c, llm_seen):
        with search_bound(lambda _req: _tavily_ok()) as tav_seen:
            yield c, llm_seen, tav_seen


def _raw_stream(c, sid: str, message: str, **extra) -> bytes:
    """整段 SSE 原始字节（含心跳注释帧）——注释帧断言面。"""
    raw = b""
    with c.stream("POST", "/api/chat/turn",
                  json={"session_id": sid, "message": message, **extra}) as r:
        assert r.status_code == 200, r.headers
        for chunk in r.iter_bytes():
            raw += chunk
    return raw


def _data_events(raw: bytes) -> list[dict]:
    """原始字节流 → 仅 data: 行的事件序（注释帧天然排除，前端 parseSse 视角）。"""
    return [json.loads(ln[6:]) for ln in raw.split(b"\n\n")
            if ln.strip().startswith(b"data: ")]


# ---------- REQ-045 验收 1~3 + 异常分支 ----------

def test_心跳_静默保活_注释帧与间隔(tmp_path: Path):
    """验收 1：假上游静默窗口（interval 0.2s 注入压测）→ ≥2 注释帧、相邻间隔 ≤ interval+容差。

    实测口径缩小映射（verify 登记）：20s→0.2s、45s 静默→0.7s、+5s 容差→+1.0s。
    """
    def handler(_req, n):
        async def gen():
            yield _frame({"choices": [{"delta": {"content": "开场"}}]}).encode()
            await asyncio.sleep(0.7)  # 静默窗口：0.2s 心跳下 ≥3 个周期
            yield _frame({"choices": [], "usage": {"total_tokens": 10}}).encode()
            yield b"data: [DONE]\n\n"
        return httpx.Response(200, content=gen())

    with turn_app(tmp_path, handler, settings_extra={"heartbeat_interval": 0.2}) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", [])
        ping_times: list[float] = []
        ping_count = 0
        with c.stream("POST", "/api/chat/turn",
                      json={"session_id": "s1", "message": "q"}) as r:
            for line in r.iter_lines():
                if line == ": ping":
                    ping_count += 1
                    ping_times.append(time.monotonic())
        assert ping_count >= 2

    # 相邻间隔断言（行到达时间戳）：≤ interval + 容差（实测缩小映射 +1.0s）
    gaps = [b - a for a, b in zip(ping_times, ping_times[1:], strict=False)]
    assert gaps and all(g <= 0.2 + 1.0 for g in gaps)


def test_心跳_注释帧不进事件流(tmp_path: Path):
    """验收 2（pytest 面）：注释帧不产事件——data: 行序列 = 完整事件序，无 ping 混入。"""
    def handler(_req, n):
        async def gen():
            yield _frame({"choices": [{"delta": {"content": "你好"}}]}).encode()
            await asyncio.sleep(0.5)
            yield _frame({"choices": [], "usage": {"total_tokens": 5}}).encode()
            yield b"data: [DONE]\n\n"
        return httpx.Response(200, content=gen())

    with turn_app(tmp_path, handler, settings_extra={"heartbeat_interval": 0.15}) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", [])
        raw = _raw_stream(c, "s1", "q")
        evs = _data_events(raw)
        assert [e["type"] for e in evs] == [
            "turn.start", "turn.step", "text.delta", "usage", "turn.end"]
        assert all("ping" not in json.dumps(e, ensure_ascii=False) for e in evs)


def test_心跳_普通回合零回退_事件序不变(tmp_path: Path):
    """验收 3：delta 密集回合心跳共存但事件序逐帧不变（REQ-030 验收 1 等价序）。"""
    import app.tools as gw
    from app.tools import ToolDef

    async def slow(_args):
        await asyncio.sleep(0.4)
        return "done"

    gw.register_tool(ToolDef(name="t_hb_demo", description="",
                             parameters={"type": "object",
                                         "properties": {"text": {"type": "string"}},
                                         "required": ["text"]},
                             handler=slow, timeout=2.0, admin_only=True))

    def handler(_req, n):
        if n == 1:
            return _sse(tool_call_then_done("我先查一下", "t_hb_demo", '{"text":"x"}', 100))
        return _sse(text_then_done("答。", 50))

    try:
        with turn_app(tmp_path, handler, settings_extra={"heartbeat_interval": 0.15}) as (c, seen):
            register(c, "root")
            _put_session(c, "s1", [])
            raw = _raw_stream(c, "s1", "q")
    finally:
        gw._REGISTRY.pop("t_hb_demo", None)

    assert b": ping" in raw  # 工具执行 0.4s 空闲窗口 ≥1 注释帧（心跳在位）
    evs = _data_events(raw)
    assert [e["type"] for e in evs] == [
        "turn.start", "turn.step", "text.delta", "tool.call", "tool.result",
        "turn.step", "text.delta", "usage", "turn.end",
    ]
    assert evs[7] == {"type": "usage", "requests": 2, "tokens": 150}
    assert evs[8] == {"type": "turn.end", "reason": "done"}


def test_心跳_间隔非法值兜底_default():
    """REQ-045 异常分支：间隔 ≤0 兜底默认 20s；正值原样。"""
    assert _heartbeat_interval(Settings(heartbeat_interval=0)) == 20.0
    assert _heartbeat_interval(Settings(heartbeat_interval=-5)) == 20.0
    assert _heartbeat_interval(Settings(heartbeat_interval=7.5)) == 7.5


def test_research_指令逐字_与定稿一致():
    """逐字纪律锚点（CHG-018 改写映射）：三档常量与 R2 定稿（测试独立转录）逐字节一致。"""
    assert research_mod.RESEARCH_PROMPT_LIGHT == R2_LIGHT
    assert research_mod.RESEARCH_PROMPT_STANDARD == R2_STANDARD
    assert research_mod.RESEARCH_PROMPT_DEEP == R2_DEEP
    assert len(research_mod.RESEARCH_PROMPT_LIGHT) == len(R2_LIGHT)
    assert len(research_mod.RESEARCH_PROMPT_STANDARD) == len(R2_STANDARD)
    assert len(research_mod.RESEARCH_PROMPT_DEEP) == len(R2_DEEP)
    # 三档互异（档位文案不共享字节序列）
    assert len({R2_LIGHT, R2_STANDARD, R2_DEEP}) == 3


# ---------- REQ-046 验收 1：帧级断言 + 注入位 ----------

def test_research_帧级断言_规划两搜索综合_逐帧(tmp_path: Path):
    """验收 1（帧级）：规划 + 2×search + 综合 → 事件序逐帧；首步请求体 research 指令
    位置（system[1] 之后）与逐字；system[0] 人设/时间行口径不回退。"""
    def llm(_req, n):
        if n == 1:
            return _sse(tool_call_then_done(
                "研究计划：子问题A、子问题B。", "search", '{"query":"子问题A"}', 100))
        if n == 2:
            return _sse(tool_call_then_done("查第二个。", "search", '{"query":"子问题B"}', 150))
        return _sse(text_then_done("综合报告正文。", 200))

    with research_app(tmp_path, llm, settings_extra={"product_persona": PERSONA}) as (
            c, llm_seen, _):
        register(c, "root")
        _put_session(c, "s1", [])
        evs = _events(c, "s1", "开放式问题", mode="research")

    assert [e["type"] for e in evs] == [
        "turn.start", "turn.step", "text.delta", "tool.call", "tool.result",
        "turn.step", "text.delta", "tool.call", "tool.result",
        "turn.step", "text.delta", "usage", "turn.end",
    ]
    assert evs[1] == {"type": "turn.step", "step": 1, "max_steps": 16}
    assert evs[2]["text"] == "研究计划：子问题A、子问题B。"
    assert evs[9] == {"type": "turn.step", "step": 3, "max_steps": 16}
    assert evs[11] == {"type": "usage", "requests": 3, "tokens": 450}
    assert evs[12] == {"type": "turn.end", "reason": "done"}
    for tr in (evs[4], evs[8]):  # 两次 search：sources 非空（引用卡数据面）
        assert tr["status"] == "ok" and len(tr["sources"]) == 5

    msgs = json.loads(llm_seen[0].content.decode())["messages"]
    assert msgs[0] == {"role": "system", "content": PERSONA}  # system[0] 人设不回退
    assert msgs[1]["role"] == "system"
    assert re.fullmatch(r"当前时间：\d{4}-\d{2}-\d{2}（周[一二三四五六日]）\d{2}:\d{2}（北京时间）",
                        msgs[1]["content"])  # system[1] 时间行口径不回退
    # 指令逐字（缺省档 standard）
    assert msgs[2] == {"role": "system", "content": research_mod.RESEARCH_PROMPT_STANDARD}
    assert msgs[3] == {"role": "user", "content": "开放式问题"}  # 无记忆/摘要 → 指令后即历史


def test_research_注入位_记忆预置_指令在记忆前_普通回合不含(tmp_path: Path):
    """验收 1（含记忆预置）：六层注入序 = 人设 → 动态尾区 → research 指令 → 记忆 → 历史；
    普通回合（mode 缺省）不含 research 指令、记忆注入序零变化。"""
    def llm(_req, n):
        return _sse(text_then_done("ok", 10))

    with research_app(tmp_path, llm, settings_extra={"product_persona": PERSONA}) as (c, seen, _):
        register(c, "alice")
        conn = sqlite3.connect(c.app.state.db_path)
        conn.execute("UPDATE users SET memory_enabled = 1 WHERE username = 'alice'")
        conn.execute("INSERT INTO user_memories (user_id, content, source_session_id, model)"
                     " VALUES (1, '用户偏好简洁回答', 's1', 'm')")
        conn.commit()
        conn.close()
        _put_session(c, "s1", [])

        evs = _events(c, "s1", "问题", mode="research")
        assert evs[-1]["reason"] == "done"
        msgs = json.loads(seen[-1].content.decode())["messages"]
        assert msgs[0]["content"] == PERSONA
        assert msgs[1]["role"] == "system"
        assert msgs[2] == {"role": "system", "content": research_mod.RESEARCH_PROMPT_STANDARD}
        assert msgs[3]["role"] == "system" and "用户偏好简洁回答" in msgs[3]["content"]

        evs2 = _events(c, "s1", "普通问题")  # mode 缺省
        assert evs2[-1]["reason"] == "done"
        msgs2 = json.loads(seen[-1].content.decode())["messages"]
        assert all(m.get("content") not in R2_ALL for m in msgs2)
        assert msgs2[0]["content"] == PERSONA
        assert msgs2[2]["role"] == "system" and "用户偏好简洁回答" in msgs2[2]["content"]


# ---------- REQ-046 验收 2/3：双护栏 ----------

def test_research_步数硬上限_第3步后截停_不悬挂(tmp_path: Path):
    """验收 2：max_research_steps=3 注入 + 需 4 步假上游 → 3 步后 turn.end(max_steps)、
    已生成内容保留、进程不悬挂（流正常耗尽）。"""
    def llm(_req, n):
        return _sse(tool_call_then_done(f"第{n}步", "search", '{"query":"q"}', 100))

    with research_app(tmp_path, llm, settings_extra={"max_research_steps": 3}) as (c, seen, _):
        register(c, "root")
        _put_session(c, "s1", [])
        evs = _events(c, "s1", "q", mode="research")

    assert evs[-1] == {"type": "turn.end", "reason": "max_steps"}
    assert len(seen) == 3  # 第 4 次上游调用不发起
    assert evs[-2] == {"type": "usage", "requests": 3, "tokens": 300}
    assert evs[2] == {"type": "text.delta", "text": "第1步"}  # 已生成内容保留


def test_research_时长护栏_工具拖超_time_limit_无孤儿(tmp_path: Path):
    """验收 3：假工具拖超 research_total_timeout → turn.end('time_limit')、无孤儿任务。"""
    import app.tools as gw
    from app.tools import ToolDef

    async def drag(_args):
        await asyncio.sleep(0.6)
        return "late"

    gw.register_tool(ToolDef(name="t_drag_demo", description="",
                             parameters={"type": "object",
                                         "properties": {"text": {"type": "string"}},
                                         "required": ["text"]},
                             handler=drag, timeout=2.0, admin_only=True))

    def llm(_req, n):
        return _sse(tool_call_then_done("查", "t_drag_demo", '{"text":"x"}', 100))

    try:
        with research_app(tmp_path, llm, settings_extra={"research_total_timeout": 0.3}) as (
                c, seen, _):
            register(c, "root")
            _put_session(c, "s1", [])
            evs = _events(c, "s1", "q", mode="research")
    finally:
        gw._REGISTRY.pop("t_drag_demo", None)

    assert evs[-1] == {"type": "turn.end", "reason": "time_limit"}
    assert len(seen) == 1  # 到顶后无新上游调用
    assert evs[-2] == {"type": "usage", "requests": 1, "tokens": 100}
    assert evs[2]["text"] == "查"  # 已生成内容保留


def test_research_时长护栏_上游流中到顶_time_limit(tmp_path: Path):
    """时长护栏压进步内（流式中到顶）：上游 delta 间静默超总时长 → time_limit 终态、
    已产出 delta 保留、无孤儿（响应连接关闭）。"""
    def llm(_req, n):
        async def gen():
            yield _frame({"choices": [{"delta": {"content": "部分"}}]}).encode()
            await asyncio.sleep(0.5)
            yield _frame({"choices": [], "usage": {"total_tokens": 99}}).encode()
            yield b"data: [DONE]\n\n"
        return httpx.Response(200, content=gen())

    with research_app(tmp_path, llm, settings_extra={"research_total_timeout": 0.2}) as (
            c, seen, _):
        register(c, "alice")
        _put_session(c, "s1", [])
        evs = _events(c, "s1", "q", mode="research")

    assert evs[-1] == {"type": "turn.end", "reason": "time_limit"}
    assert evs[-2] == {"type": "usage", "requests": 0, "tokens": 0}  # 未完成调用不计（步超时体例）
    assert len(seen) == 1
    assert evs[2] == {"type": "text.delta", "text": "部分"}  # 已产出 delta 保留


# ---------- REQ-046 验收 4：计费口径 ----------

def test_research_计费_一回合5次上游调用_turns1_tokens和(tmp_path: Path):
    """验收 4：一回合并 5 次上游调用 → usage_daily turns+1、tokens=5 次之和（数值断言）。"""
    def llm(_req, n):
        if n < 5:
            return _sse(tool_call_then_done(f"t{n}", "search", '{"query":"q"}', n * 100))
        return _sse(text_then_done("done", 500))

    with research_app(tmp_path, llm) as (c, seen, _):
        register(c, "root")
        _put_session(c, "s1", [])
        evs = _events(c, "s1", "q", mode="research")

    assert evs[-1] == {"type": "turn.end", "reason": "done"}
    assert evs[-2] == {"type": "usage", "requests": 5, "tokens": 1500}
    conn = sqlite3.connect(c.app.state.db_path)
    row = conn.execute(
        "SELECT requests, turns, tokens FROM usage_daily WHERE mode='unified'").fetchone()
    conn.close()
    assert row == (1, 1, 1500)  # 5 次内部调用 = 1 回合；tokens 如实累计


# ---------- REQ-046 验收 5：门控拒绝 ----------

def test_research_门控拒绝_admin关搜索_422零上游(tmp_path: Path):
    def llm(_req, n):
        raise AssertionError("门控拒绝不得抵达上游")

    with research_app(tmp_path, llm) as (c, seen, _):
        register(c, "root")
        _put_session(c, "s1", [])
        assert c.put("/api/admin/settings", json={"search_enabled": False}).status_code == 200
        r = c.post("/api/chat/turn",
                   json={"session_id": "s1", "message": "q", "mode": "research"})
        assert r.status_code == 422
        body = r.json()
        assert body["code"] == "research_unavailable"
        assert body["detail"] == (
            "research 模式不可用：需要管理员开启搜索并配置搜索 key，且当前档案允许工具")
        assert seen == []  # 零上游调用
        # 零事件流 = JSON 直返（非 SSE content-type）
        assert "text/event-stream" not in r.headers.get("content-type", "")


def test_research_门控拒绝_key缺失_422(tmp_path: Path):
    def llm(_req, n):
        raise AssertionError("门控拒绝不得抵达上游")

    with turn_app(tmp_path, llm) as (c, seen):  # 不设 search_key
        register(c, "root")
        _put_session(c, "s1", [])
        r = c.post("/api/chat/turn",
                   json={"session_id": "s1", "message": "q", "mode": "research"})
        assert r.status_code == 422
        assert r.json()["code"] == "research_unavailable"
        assert seen == []


def test_research_门控拒绝_档案工具关_422(tmp_path: Path):
    def llm(_req, n):
        raise AssertionError("门控拒绝不得抵达上游")

    with turn_app(tmp_path, llm, settings_extra={"search_key": SEARCH_KEY}) as (c, seen):
        register(c, "alice")
        r = c.post("/api/profiles", json={"name": "p", "base_url": "http://upstream.test",
                                          "model": "m", "api_key": "sk-x"})
        pid = r.json()["id"]
        c.post(f"/api/profiles/{pid}/activate")
        conn = sqlite3.connect(c.app.state.db_path)
        conn.execute("UPDATE profiles SET tools_enabled = 0")
        conn.commit()
        conn.close()
        _put_session(c, "s1", [])
        r = c.post("/api/chat/turn",
                   json={"session_id": "s1", "message": "q", "mode": "research"})
        assert r.status_code == 422
        assert r.json()["code"] == "research_unavailable"
        assert seen == []


def test_research_mode缺省普通回合零影响(tmp_path: Path):
    """验收 5（mode 缺省普通回合零影响）：无 research 指令注入、无三与门拒绝（key 缺也放行）。"""
    def llm(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, llm) as (c, seen):  # 不设 search_key
        register(c, "alice")
        _put_session(c, "s1", [])
        evs = _events(c, "s1", "q")
        assert evs[-1]["reason"] == "done"
        msgs = json.loads(seen[-1].content.decode())["messages"]
        assert all(m.get("content") not in R2_ALL for m in msgs)
        # 显式 mode='chat' 等价普通回合
        evs2 = _events(c, "s1", "q2", mode="chat")
        assert evs2[-1]["reason"] == "done"


def test_research_mode非法值_422(tmp_path: Path):
    def llm(_req, n):
        raise AssertionError("校验失败不得抵达上游")

    with turn_app(tmp_path, llm) as (c, seen):
        register(c, "alice")
        r = c.post("/api/chat/turn", json={"session_id": "s1", "message": "q", "mode": "deep"})
        assert r.status_code == 422
        assert seen == []


# ---------- REQ-046 验收 6：网关复用 + endpoint 落库 ----------

def test_research_网关复用_非法入参error回填_endpoint落库(tmp_path: Path):
    """验收 6：research 路径走 execute_tool 网关——非法入参 search → error 回填回合继续；
    llm/tool 行 endpoint='research' 落库。"""
    def llm(_req, n):
        if n == 1:
            return _sse(tool_call_then_done("查", "search", '{"query": 123}', 100))
        return _sse(text_then_done("降级直答。", 50))

    with research_app(tmp_path, llm) as (c, seen, _):
        register(c, "root")
        _put_session(c, "s1", [])
        evs = _events(c, "s1", "q", mode="research")

    tr = [e for e in evs if e["type"] == "tool.result"][0]
    assert tr["status"] == "error"
    assert tr["result"] == "参数 query 类型应为 string"
    assert "sources" not in tr
    assert evs[-1] == {"type": "turn.end", "reason": "done"}  # error 回填 → 回合继续

    conn = sqlite3.connect(c.app.state.db_path)
    conn.row_factory = sqlite3.Row
    llm_eps = [r["endpoint"] for r in conn.execute(
        "SELECT endpoint FROM telemetry WHERE kind='llm' ORDER BY step").fetchall()]
    tool_rows = [tuple(r) for r in conn.execute(
        "SELECT endpoint, tool_name, status FROM telemetry WHERE kind='tool'").fetchall()]
    conn.close()
    assert llm_eps == ["research", "research"]
    assert tool_rows == [("research", "search", "error")]


# ---------- REQ-046 验收 7：断连取消 ----------

def test_research_断连取消_检索中断开_无孤儿(tmp_path: Path):
    """验收 7：断连取消（CancelledError）在检索执行中生效——工具协程终止、
    零新增上游调用、无孤儿任务。

    实现级决策登记（verify）：TestClient 的 stream break 不触发服务端取消（回合跑满、
    无法端点层确定性断言），本用例以 asyncio task 取消直接驱动 run_turn（真实断连的
    CancelledError 传播由 REQ-030 既有路径承载），断言取消传播与无孤儿契约。
    """
    from app import agent as agent_mod
    from app.tools import ToolDef

    calls = 0

    def handler(_req):
        nonlocal calls
        calls += 1
        return _sse(tool_call_then_done("", "search", '{"query":"q"}', 100))

    async def slow_search(_args):
        await asyncio.sleep(5.0)  # 长检索：取消在途时生效（超时 30s 兜底，不触发）
        return "never"

    defn = ToolDef(name="search", description="", parameters={
        "type": "object", "properties": {"query": {"type": "string"}},
        "required": ["query"]}, handler=slow_search, timeout=30.0)

    async def scenario():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        consumed: list[dict] = []

        async def consume():
            async for ev in agent_mod.run_turn(
                client=client, base_url="http://u", api_key="k", model="m",
                session_id="s", messages=[{"role": "user", "content": "q"}],
                tool_defs=[defn], max_steps=6, step_timeout=120.0,
                tool_result_limit=1024):
                consumed.append(ev)

        task = asyncio.create_task(consume())
        while not any(e.get("type") == "tool.call" for e in consumed):
            await asyncio.sleep(0.01)
        task.cancel()  # 检索执行中取消（断连等价面）
        with suppress(asyncio.CancelledError):
            await task
        await client.aclose()
        return calls

    assert asyncio.run(scenario()) == 1  # 取消后零新增上游调用；慢工具随取消终止（无孤儿）


# ---------- REQ-046 验收 8：卫生 ----------

def test_research_卫生_指令事件流遥测零key(tmp_path: Path):
    """验收 8：research 指令/事件流/遥测行检索不到 search key（沿 REQ-037 验收 5 体例）。"""
    def llm(_req, n):
        if n == 1:
            return _sse(tool_call_then_done("查", "search", '{"query":"q"}', 100))
        return _sse(text_then_done("报告。", 50))

    with research_app(tmp_path, llm) as (c, seen, _):
        register(c, "root")
        _put_session(c, "s1", [])
        raw = _raw_stream(c, "s1", "q", mode="research")

    assert SEARCH_KEY not in raw.decode()
    assert all(SEARCH_KEY not in p for p in R2_ALL)
    conn = sqlite3.connect(c.app.state.db_path)
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute("SELECT * FROM telemetry").fetchall()]
    conn.close()
    assert SEARCH_KEY not in json.dumps(rows, ensure_ascii=False)


# ---------- REQ-047 加法字段（design-iter-18 §6.1，T2 只出后端字段） ----------

def test_quota端点_research_available_三与门(tmp_path: Path):
    """GET /api/quota 加法字段 research_available = 三与门判定（快照非订阅，设计 §6.3）。"""
    def llm(_req, n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, llm, settings_extra={"search_key": SEARCH_KEY}) as (c, seen):
        register(c, "root")
        body = c.get("/api/quota").json()
        assert set(body) == {"mode", "daily_limit", "used_today", "reset_at", "research_available"}
        assert body["research_available"] is True  # 统一 key + 开关开 + key 配

        assert c.put("/api/admin/settings", json={"search_enabled": False}).status_code == 200
        assert c.get("/api/quota").json()["research_available"] is False  # admin 关搜索
        assert c.put("/api/admin/settings", json={"search_enabled": True}).status_code == 200

        r = c.post("/api/profiles", json={"name": "p", "base_url": "http://upstream.test",
                                          "model": "m", "api_key": "sk-x"})
        pid = r.json()["id"]
        c.post(f"/api/profiles/{pid}/activate")
        conn = sqlite3.connect(c.app.state.db_path)
        conn.execute("UPDATE profiles SET tools_enabled = 0")
        conn.commit()
        conn.close()
        assert c.get("/api/quota").json()["research_available"] is False  # 档案工具关

        c.delete("/api/profiles/active")
        assert c.get("/api/quota").json()["research_available"] is True  # 回退统一 key

    # key 缺失分支（独立夹具，不设 search_key）
    with turn_app(tmp_path, llm) as (c2, _):
        register(c2, "bob")
        assert c2.get("/api/quota").json()["research_available"] is False


# ---------- CHG-018：档位矩阵 / max_tokens 载荷 / depth 交互（REQ-046 验收 9） ----------

def test_档位矩阵_护栏参数_按档取值():
    """REQ-046 验收 9（参数面）：research_profile 按档取 config 值——light 8/300、
    standard 16/900（既有参数语义收窄）、deep 32/900；max_tokens 三档同值 8192。"""
    s = Settings()
    assert research_mod.research_profile(s, "light") == research_mod.ResearchProfile(
        max_steps=8, total_timeout=300.0, max_tokens=8192)
    assert research_mod.research_profile(s, "standard") == research_mod.ResearchProfile(
        max_steps=16, total_timeout=900.0, max_tokens=8192)
    assert research_mod.research_profile(s) == research_mod.research_profile(s, "standard")
    assert research_mod.research_profile(s, "deep") == research_mod.ResearchProfile(
        max_steps=32, total_timeout=900.0, max_tokens=8192)
    # .env 覆盖面：档位参数独立可覆盖
    s2 = Settings(research_steps_light=5, research_timeout_light=60.0,
                  research_steps_deep=9, research_timeout_deep=120.0)
    assert research_mod.research_profile(s2, "light").max_steps == 5
    assert research_mod.research_profile(s2, "deep") == research_mod.ResearchProfile(
        max_steps=9, total_timeout=120.0, max_tokens=8192)


@pytest.mark.parametrize("depth,prompt_const,steps", [
    ("light", "RESEARCH_PROMPT_LIGHT", 8),
    ("standard", "RESEARCH_PROMPT_STANDARD", 16),
    ("deep", "RESEARCH_PROMPT_DEEP", 32),
])
def test_档位矩阵_回合级_文案注入与步数上限(tmp_path: Path, depth, prompt_const, steps):
    """REQ-046 验收 9（回合面）：depth 逐档 → 首步请求体指令 = 对应档文案逐字 +
    turn.step max_steps = 档位步数；缺省不传 depth = standard。"""
    def llm(_req, n):
        return _sse(text_then_done("ok", 10))

    with research_app(tmp_path, llm) as (c, seen, _):
        register(c, "alice")
        _put_session(c, "s1", [])
        evs = _events(c, "s1", "q", mode="research", depth=depth)
        assert evs[-1]["reason"] == "done"
        assert evs[1] == {"type": "turn.step", "step": 1, "max_steps": steps}
        msgs = json.loads(seen[-1].content.decode())["messages"]
        # 指令注入位：动态尾区（含时间行）之后、首条 user 之前（有无人设两形态皆适配）
        idx = next(i for i, m in enumerate(msgs)
                   if m.get("content") == getattr(research_mod, prompt_const))
        assert idx in (1, 2)
        assert msgs[idx - 1]["role"] == "system"
        assert "当前时间" in msgs[idx - 1]["content"]
        assert msgs[idx + 1]["role"] == "user"

        # 缺省不传 depth = standard（等价显式）
        evs2 = _events(c, "s1", "q2", mode="research")
        assert evs2[1]["max_steps"] == 16


def test_档位_上游载荷_max_tokens_research有_chat无(tmp_path: Path):
    """REQ-046 验收 9：research 回合载荷含 max_tokens=8192（T0 发现的生产截断隐患
    修复）；普通回合载荷不含 max_tokens 键（零变化）。"""
    def llm(_req, n):
        return _sse(text_then_done("ok", 10))

    with research_app(tmp_path, llm) as (c, seen, _):
        register(c, "alice")
        _put_session(c, "s1", [])
        _events(c, "s1", "q", mode="research")
        payload = json.loads(seen[-1].content.decode())
        assert payload["max_tokens"] == 8192

        _events(c, "s1", "q2")  # 普通回合
        payload2 = json.loads(seen[-1].content.decode())
        assert "max_tokens" not in payload2


def test_depth非法值_422(tmp_path: Path):
    def llm(_req, n):
        raise AssertionError("校验失败不得抵达上游")

    with turn_app(tmp_path, llm) as (c, seen):
        register(c, "alice")
        r = c.post("/api/chat/turn", json={"session_id": "s1", "message": "q",
                                           "mode": "research", "depth": "ultra"})
        assert r.status_code == 422
        assert seen == []


def test_mode_chat携带depth_忽略_普通回合零变化(tmp_path: Path):
    """REQ-055 异常分支：mode='chat' + depth='deep' → depth 不参与任何判定——
    无 research 指令注入、载荷无 max_tokens、tools 不含 read（research_only）。"""
    def llm(_req, n):
        return _sse(text_then_done("ok", 10))

    with research_app(tmp_path, llm) as (c, seen, _):
        register(c, "alice")
        _put_session(c, "s1", [])
        evs = _events(c, "s1", "q", mode="chat", depth="deep")
        assert evs[-1]["reason"] == "done"
        payload = json.loads(seen[-1].content.decode())
        assert "max_tokens" not in payload
        tool_names = [t["function"]["name"] for t in payload.get("tools", [])]
        assert "read" not in tool_names
        assert all(m.get("content") not in R2_ALL for m in payload["messages"])


def test_read工具_下发面_research回合含_普通回合不含(tmp_path: Path):
    """REQ-054 验收 3：research 回合（任一档）tools 含 read；普通回合不含——
    「普通回合逐字节等价」铁律（定夺④）。"""
    def llm(_req, n):
        return _sse(text_then_done("ok", 10))

    with research_app(tmp_path, llm) as (c, seen, _):
        register(c, "alice")
        _put_session(c, "s1", [])
        for depth in ("light", "standard", "deep"):
            _events(c, "s1", f"q-{depth}", mode="research", depth=depth)
            payload = json.loads(seen[-1].content.decode())
            names = [t["function"]["name"] for t in payload["tools"]]
            assert "read" in names and "search" in names
        _events(c, "s1", "q-chat")
        payload = json.loads(seen[-1].content.decode())
        names = [t["function"]["name"] for t in payload["tools"]]
        assert "read" not in names and "search" in names
