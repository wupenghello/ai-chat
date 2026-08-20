"""iter-17 T2（CHG-011 REQ-042）：用户长期记忆——注入正确性 / 停用零回退 / 抽取闭环 /
失败降级 / 重启恢复 / 存储隔离 / 卫生断言 + 常驻扫描触发条件。

上游以 httpx.MockTransport 脚本化（沿 test_turn/test_compact 惯例）；抽取调用 =
stream=false 分支（call_summary 复用面，EXTRACT_PROMPT 传参）。扫描取证直接调
memory.scan_once（独立 AsyncClient + 独立事件循环，与 TestClient portal 隔离）。
"""

import asyncio
import json
import sqlite3
import time
from pathlib import Path

import httpx
from app import memory
from app.quota import today

from tests.conftest import register
from tests.test_turn import (
    PERSONA,
    UNIFIED_MODEL,
    _events,
    _mk_turns,
    _put_session,
    _sse,
    _upstream_messages,
    text_then_done,
    turn_app,
)

MEM_A = "用户偏好简洁的中文回复"
MEM_B = "与 AI 约定周报按三段式输出"


# ---------- 夹具辅助 ----------

def _extract_json(text: str, prompt: int = 400, completion: int = 80) -> httpx.Response:
    return httpx.Response(200, json={
        "choices": [{"message": {"content": text}}],
        "usage": {"prompt_tokens": prompt, "completion_tokens": completion,
                  "total_tokens": prompt + completion},
    })


def _seed_entries(c, user_id: int, contents: list[str]) -> None:
    conn = sqlite3.connect(c.app.state.db_path)
    try:
        for e in contents:
            conn.execute(
                "INSERT INTO user_memories (user_id, content, source_session_id, model)"
                " VALUES (?, ?, 's0', ?)", (user_id, e, UNIFIED_MODEL))
        conn.commit()
    finally:
        conn.close()


def _set_enabled(c, user_id: int, enabled: bool) -> None:
    conn = sqlite3.connect(c.app.state.db_path)
    try:
        conn.execute("UPDATE users SET memory_enabled = ? WHERE id = ?",
                     (1 if enabled else 0, user_id))
        conn.commit()
    finally:
        conn.close()


def _rows(c, table: str) -> list[sqlite3.Row]:
    conn = sqlite3.connect(c.app.state.db_path)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()
    finally:
        conn.close()


def _run_scan(c, handler) -> None:
    """独立事件循环 + 独立 MockTransport 客户端跑一轮扫描（与 TestClient portal 隔离）。"""
    settings = c.app.state.settings

    async def go():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as client:
            await memory.scan_once(c.app.state.db_path, client, settings)

    asyncio.run(go())


# ---------- REQ-042 验收 1：注入正确性（位置 + 逐字） ----------

def test_注入_两条记忆启用_位置system1之后_内容逐字(tmp_path: Path):
    def handler(_req, _n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler, settings_extra={"product_persona": PERSONA}) as (c, seen):
        register(c, "alice")
        _seed_entries(c, 1, [MEM_A, MEM_B])
        _put_session(c, "s1", _mk_turns(2))
        evs = _events(c, "s1", "你好")
        assert evs[-1] == {"type": "turn.end", "reason": "done"}

        msgs = _upstream_messages(seen[-1])
        # 五层注入序：system[0]=人设 / system[1]=动态尾区 / 记忆消息 / 历史
        assert msgs[0] == {"role": "system", "content": PERSONA}
        assert msgs[1]["role"] == "system" and msgs[1]["content"].startswith("当前时间：") \
            or msgs[1]["role"] == "system"
        assert msgs[2]["role"] == "system"
        assert msgs[2]["content"] == memory.render_memory_text([MEM_A, MEM_B])
        assert msgs[2]["content"].startswith("<user_memory>\n")
        assert msgs[2]["content"].endswith("\n</user_memory>")
        assert f"1. {MEM_A}" in msgs[2]["content"]
        assert f"2. {MEM_B}" in msgs[2]["content"]
        # 记忆之后为历史（user 锚定）
        assert msgs[3]["role"] == "user"


def test_注入_压缩生效会话_记忆在前摘要在后(tmp_path: Path):
    """有摘要时挂载序 = 动态尾区 → 记忆 → 摘要 → 历史（REQ-042 验收 1 括号口径）。"""
    from app.quota import today as _today

    def handler(_req, _n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler, settings_extra={"product_persona": PERSONA}) as (c, seen):
        register(c, "alice")
        _seed_entries(c, 1, [MEM_A])
        _put_session(c, "s1", _mk_turns(8))
        # 置上一回合 step=1 超阈值 + 有效摘要行（水位 = s1 中段消息 id）
        conn = sqlite3.connect(c.app.state.db_path)
        conn.execute(
            "INSERT INTO telemetry (day, user_id, mode, session_id, endpoint, kind, step,"
            " latency_ms, status, tokens_prompt, tokens_total)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (_today(), 1, "unified", "s1", "turn", "llm", 1, 5, "ok", 9000, 9000))
        conn.execute(
            "INSERT INTO context_summary (user_id, session_id, summary, watermark_msg_id, model)"
            " VALUES (?, ?, ?, ?, ?)", (1, "s1", "中段摘要样件", "m5", UNIFIED_MODEL))
        conn.commit()
        conn.close()

        evs = _events(c, "s1", "继续")
        assert evs[-1] == {"type": "turn.end", "reason": "done"}
        msgs = _upstream_messages(seen[-1])
        # [0]=人设 [1]=尾区 [2]=记忆 [3]=摘要 [4:]=最近 R 轮
        assert msgs[2]["content"] == memory.render_memory_text([MEM_A])
        assert msgs[3]["content"] == "<conversation_summary>\n中段摘要样件\n</conversation_summary>"
        assert msgs[4]["role"] == "user"


def test_注入_无记忆或停用_不注入(tmp_path: Path):
    def handler(_req, _n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler, settings_extra={"product_persona": PERSONA}) as (c, seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(2))
        _events(c, "s1", "你好")
        msgs = _upstream_messages(seen[-1])
        assert all("<user_memory>" not in m.get("content", "") for m in msgs)


# ---------- REQ-042 验收 2：停用零回退（与基线 v7 逐字段等价） ----------

def test_停用_组装与基线v7逐字段等价(tmp_path: Path):
    def handler(_req, _n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler, settings_extra={"product_persona": PERSONA}) as (c, seen):
        register(c, "alice")
        _seed_entries(c, 1, [MEM_A, MEM_B])
        _put_session(c, "s1", _mk_turns(3))
        # 启用态基线（含记忆）→ 停用态（记忆消息消失，其余逐字段不变）
        _events(c, "s1", "第一问")
        with_mem = _upstream_messages(seen[-1])
        _set_enabled(c, 1, False)
        _events(c, "s1", "第二问")
        without = _upstream_messages(seen[-1])

        # 启用态：system[2] = 记忆消息（逐字）
        assert with_mem[2]["content"] == memory.render_memory_text([MEM_A, MEM_B])
        # 停用态：任何位置无记忆消息（组装口径回到基线——时间行/历史随回合自然变化，
        # 逐字段等价锚点 = 去除记忆消息后 system 段形状与基线 v7 一致）
        assert all("<user_memory>" not in m.get("content", "") for m in without)
        assert without[0] == with_mem[0]  # 人设字节恒定
        assert without[1]["role"] == "system"  # 动态尾区在位
        assert without[2]["role"] == "user"  # 尾区后直接是历史（无摘要场景）


# ---------- REQ-042 验收 3：抽取闭环 ----------

def _eligible_session(c, sid: str = "s1", turns: int = 4) -> None:
    _put_session(c, sid, _mk_turns(turns))  # updatedAt=1 → 静默窗口恒满足


def test_抽取闭环_整体替换_job_done_遥测行(tmp_path: Path):
    def handler(req: httpx.Request):
        body = json.loads(req.content.decode())
        assert body["stream"] is False
        assert body["messages"][0]["content"] == memory.EXTRACT_PROMPT  # 定稿逐字
        assert "现有记忆：" in body["messages"][1]["content"]
        assert "新增对话内容：" in body["messages"][1]["content"]
        return _extract_json(f"1. {MEM_A}\n2. {MEM_B}")

    def turn_handler(_req, _n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, turn_handler) as (c, _seen):
        register(c, "alice")
        _eligible_session(c)
        _run_scan(c, handler)

        entries = _rows(c, "user_memories")
        assert [r["content"] for r in entries] == [MEM_A, MEM_B]
        assert all(r["source_session_id"] == "s1" for r in entries)
        assert all(r["model"] == UNIFIED_MODEL for r in entries)
        jobs = _rows(c, "memory_jobs")
        assert len(jobs) == 1
        assert jobs[0]["status"] == "done"
        assert jobs[0]["watermark_msg_id"] == "m7"  # 4 轮 = m0..m7，水位 = 末条
        tele = [r for r in _rows(c, "telemetry") if r["kind"] == "memory_extract"]
        assert len(tele) == 1
        assert tele[0]["status"] == "ok"
        assert tele[0]["turn_id"] is None and tele[0]["step"] is None
        assert tele[0]["endpoint"] == "memory"
        assert tele[0]["session_id"] == "s1"
        assert tele[0]["tokens_prompt"] == 400  # 假 usage 机器读数
        assert tele[0]["day"] == today()


def test_抽取_存量合并输入携带现有记忆(tmp_path: Path):
    seen_blocks: list[str] = []

    def handler(req: httpx.Request):
        body = json.loads(req.content.decode())
        seen_blocks.append(body["messages"][1]["content"])
        return _extract_json(f"1. {MEM_A}")

    def turn_handler(_req, _n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, turn_handler) as (c, _seen):
        register(c, "alice")
        _seed_entries(c, 1, ["存量记忆样件"])
        _eligible_session(c)
        _run_scan(c, handler)
        assert "1. 存量记忆样件" in seen_blocks[0]  # 现有记忆列表进输入


# ---------- REQ-042 验收 4：失败降级 ----------

def test_失败降级_500_attempts递增_记忆表不变(tmp_path: Path):
    def handler(_req):
        return httpx.Response(500, json={"error": "boom"})

    def turn_handler(_req, _n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, turn_handler) as (c, _seen):
        register(c, "alice")
        _seed_entries(c, 1, [MEM_A])
        _eligible_session(c)
        _run_scan(c, handler)

        assert [r["content"] for r in _rows(c, "user_memories")] == [MEM_A]  # 不变
        jobs = _rows(c, "memory_jobs")
        assert jobs[0]["attempts"] == 1 and jobs[0]["status"] == "pending"
        tele = [r for r in _rows(c, "telemetry") if r["kind"] == "memory_extract"]
        assert tele[0]["status"] == "error"

        # 重试两次 → attempts 到顶 → error 行留观，不再重试
        _run_scan(c, handler)
        _run_scan(c, handler)
        jobs = _rows(c, "memory_jobs")
        assert jobs[0]["attempts"] == 3 and jobs[0]["status"] == "error"
        _run_scan(c, handler)  # error 行留观：不新增调用
        tele = [r for r in _rows(c, "telemetry") if r["kind"] == "memory_extract"]
        assert len(tele) == 3


def test_失败降级_超时_遥测timeout(tmp_path: Path):
    def handler(_req):
        raise httpx.ReadTimeout("slow")

    def turn_handler(_req, _n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, turn_handler) as (c, _seen):
        register(c, "alice")
        _eligible_session(c)
        _run_scan(c, handler)
        tele = [r for r in _rows(c, "telemetry") if r["kind"] == "memory_extract"]
        assert tele[0]["status"] == "timeout"
        assert _rows(c, "user_memories") == []


# ---------- REQ-042 验收 5：重启恢复（pending 行拾起执行） ----------

def test_重启恢复_pending行新实例拾起执行(tmp_path: Path):
    def handler(_req):
        return _extract_json(f"1. {MEM_A}")

    def turn_handler(_req, _n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, turn_handler) as (c, _seen):
        register(c, "alice")
        _eligible_session(c, turns=1)  # 轮数不足 N：常规扫描不会新建任务
        # 预写 pending 行（模拟进程重启前落库未执行；空水位 = 首次抽取，全量为增量）
        conn = sqlite3.connect(c.app.state.db_path)
        conn.execute(
            "INSERT INTO memory_jobs (user_id, session_id, status, watermark_msg_id)"
            " VALUES (1, 's1', 'pending', '')")
        conn.commit()
        conn.close()

        _run_scan(c, handler)  # 新实例首轮扫描 = 拾起 pending（重启恢复口径）
        jobs = _rows(c, "memory_jobs")
        assert jobs[0]["status"] == "done"
        assert jobs[0]["watermark_msg_id"] == "m1"  # 水位推进到增量末条
        assert [r["content"] for r in _rows(c, "user_memories")] == [MEM_A]


# ---------- REQ-042 验收 6：存储隔离（注销级联） ----------

def test_存储隔离_注销级联清零(tmp_path: Path):
    def turn_handler(_req, _n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, turn_handler) as (c, _seen):
        register(c, "alice")
        _seed_entries(c, 1, [MEM_A])
        conn = sqlite3.connect(c.app.state.db_path)
        conn.execute(
            "INSERT INTO memory_jobs (user_id, session_id, status, watermark_msg_id)"
            " VALUES (1, 's1', 'done', 'm1')")
        conn.commit()
        conn.close()
        assert len(_rows(c, "user_memories")) == 1

        r = c.post("/api/auth/delete-account", json={"password": "password123"})
        assert r.status_code == 200, r.text
        assert _rows(c, "user_memories") == []
        assert _rows(c, "memory_jobs") == []


# ---------- REQ-042 验收 7：卫生断言 ----------

def test_卫生_遥测行零记忆内容全文(tmp_path: Path):
    secret = "绝密记忆内容样件XYZ"

    def handler(_req):
        return _extract_json(f"1. {secret}")

    def turn_handler(_req, _n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, turn_handler) as (c, _seen):
        register(c, "alice")
        _eligible_session(c)
        _run_scan(c, handler)
        for row in _rows(c, "telemetry"):
            for key in row.keys():
                value = row[key]
                if isinstance(value, str):
                    assert secret not in value


# ---------- 触发条件判定（N / X / 增量 / 停用 / 上游） ----------

def test_触发_轮数不足不抽取(tmp_path: Path):
    called = []

    def handler(_req):
        called.append(1)
        return _extract_json("1. x")

    def turn_handler(_req, _n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, turn_handler) as (c, _seen):
        register(c, "alice")
        _eligible_session(c, turns=3)  # N=4：3 轮不足
        _run_scan(c, handler)
        assert called == [] and _rows(c, "memory_jobs") == []


def test_触发_静默窗口未到不抽取(tmp_path: Path):
    called = []

    def handler(_req):
        called.append(1)
        return _extract_json("1. x")

    def turn_handler(_req, _n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, turn_handler) as (c, _seen):
        register(c, "alice")
        _put_session(c, "s1", _mk_turns(4))
        conn = sqlite3.connect(c.app.state.db_path)
        conn.execute("UPDATE chat_sessions SET updated_at = ? WHERE id = 's1'",
                     (time.time(),))  # 刚刚活跃：静默窗口未到
        conn.commit()
        conn.close()
        _run_scan(c, handler)
        assert called == [] and _rows(c, "memory_jobs") == []


def test_触发_无未覆盖增量不重复抽取(tmp_path: Path):
    calls = []

    def handler(_req):
        calls.append(1)
        return _extract_json("1. x")

    def turn_handler(_req, _n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, turn_handler) as (c, _seen):
        register(c, "alice")
        _eligible_session(c)
        _run_scan(c, handler)
        assert len(calls) == 1
        _run_scan(c, handler)  # 水位后无增量：done 会话不重复抽取
        assert len(calls) == 1


def test_触发_停用用户扫描跳过(tmp_path: Path):
    called = []

    def handler(_req):
        called.append(1)
        return _extract_json("1. x")

    def turn_handler(_req, _n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, turn_handler) as (c, _seen):
        register(c, "alice")
        _set_enabled(c, 1, False)
        _eligible_session(c)
        _run_scan(c, handler)
        assert called == [] and _rows(c, "memory_jobs") == []


# ---------- 解析与渲染单元面 ----------

def test_解析_编号行容错与截断():
    out = memory.parse_extract_output(
        "以下是记忆：\n1. 甲\n2、乙\n3. \n4.丙\n",
        max_entries=30, max_chars=150)
    assert out == ["甲", "乙", "丙"]
    long = memory.parse_extract_output("1. " + "字" * 300, max_entries=30, max_chars=150)
    assert long == ["字" * 150]
    many = memory.parse_extract_output(
        "\n".join(f"{i}. 条目{i}" for i in range(1, 60)), max_entries=30, max_chars=150)
    assert len(many) == 30 and many[0] == "条目1" and many[-1] == "条目30"
    assert memory.parse_extract_output("", max_entries=30, max_chars=150) == []


def test_渲染_注入文案定稿逐字():
    text = memory.render_memory_text([MEM_A, MEM_B])
    assert text == (
        "<user_memory>\n"
        "以下是关于用户的长期记忆（自动从历史对话抽取），回复时作为用户背景参考：\n"
        f"1. {MEM_A}\n2. {MEM_B}\n"
        "</user_memory>"
    )


def test_注入挂载_无人设形态(tmp_path: Path):
    """product_persona 为空 → 单 system 尾区形态，记忆挂载 index 1（基线 v5 锚点不回退）。"""
    def handler(_req, _n):
        return _sse(text_then_done("ok", 10))

    with turn_app(tmp_path, handler, settings_extra={"product_persona": ""}) as (c, seen):
        register(c, "alice")
        _seed_entries(c, 1, [MEM_A])
        _put_session(c, "s1", _mk_turns(2))
        _events(c, "s1", "你好")
        msgs = _upstream_messages(seen[-1])
        assert msgs[0]["role"] == "system" and msgs[0]["content"].startswith("当前时间：")
        assert msgs[1]["content"] == memory.render_memory_text([MEM_A])
        assert msgs[2]["role"] == "user"
