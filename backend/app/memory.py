"""用户长期记忆子系统（CHG-011 REQ-042，iter-17 T2）：五层记忆体系第三层。

- 存储：迁移 v10 user_memories（用户级实体，独立于会话档，与 LWW/409 守卫/整档透传
  零交互）+ memory_jobs 任务表（「落库 + 重启恢复」口径的唯一权威）+ users.memory_enabled
  整体停用开关（定夺⑥）。
- 抽取：服务端常驻后台静默窗口扫描（定夺②：轮数 ≥ N + 静默 ≥ X 分钟 + 有未覆盖增量）
  → 任务行落库 → 一次非流式抽取调用（沿 B2 call_summary 基建：独立超时护栏/三终态降级/
  跟随该用户当前模式，定夺⑧）→ 模型输出合并后完整新列表、后端同事务先删后插整体替换
  （去重/冲突交模型、后端只限条数，定夺⑤）。**抽取不计回合、usage_daily 零写入、tokens
  仅落 telemetry memory_extract 行（定夺③，quota.py 零改动）**。
- 注入：回合组装时记忆以 `<user_memory>` 字面包裹作为独立 system 消息注入，挂载点 =
  system[1] 动态尾区之后、摘要消息之前（定夺④五层注入序；B1 前缀缓存零劣化，
  changes.md CHG-011 内容 3.1）。记忆只影响「发给上游的内容」；停用/无记忆时组装口径
  与基线 v7 逐字段等价（REQ-042 验收 2）。
- 失败降级：error/timeout/空输出/4xx/5xx → attempts+1（上限 3 留 error 行待观察），
  记忆表不变，恒为「无新记忆、存量照常注入」，回合主路径零阻塞、用户无感。
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import sqlite3
import time
from typing import Any

import httpx

from app import compress, telemetry
from app.config import Settings
from app.quota import MODE_SELF, MODE_UNIFIED, today

logger = logging.getLogger("ai-chat.memory")

# ---- 定死参数（plans/iter-17-verify.md T0；config 提供同名字段，.env 可覆盖） ----
# 抽取 prompt R1 定稿（后端拥有、逐字断言面 = plans/iter-17-verify.md §2，逐字使用；
# 条数上限 30/单条 150 字为 T0 体量复核定案——50×200 字满载实测 6079 tokens 占阈值 86.8%，
# 行使 CHG-011 内容 3.1 收紧授权）
EXTRACT_PROMPT = (
    "请根据「现有记忆」与「新增对话内容」，产出该用户更新后的完整记忆列表。要求：\n"
    "一、记忆只收录关于用户的长期信息：身份与处境、偏好与习惯、对 AI 的要求、与 AI 达成的约定；"
    "一次性任务与知识问答的细节不收录。\n"
    "二、合并规则：现有记忆中仍然成立的条目保留；新增对话中出现的新记忆点补充；"
    "新旧冲突时以最新信息为准并移除过时条目；含义重复的条目合并为一条。\n"
    "三、每条是一个独立记忆点，单条不超过 150 字，用陈述句客观转述，不加评论。\n"
    "四、总条数不超过 30 条；若超出，优先保留身份、约定与偏好类条目。\n"
    "五、输出格式：按序号每行一条，形如「1. 记忆内容」；直接输出列表本身，"
    "不要任何前缀、解释或代码块标记。\n"
    "若没有任何值得记录的记忆，输出空内容。"
)

# 注入文案定稿（plans/iter-17-verify.md §5 逐字断言面；REQ-043 注入预览同源取值）
MEMORY_TAG_OPEN = "<user_memory>"
MEMORY_TAG_CLOSE = "</user_memory>"
MEMORY_PREAMBLE = "以下是关于用户的长期记忆（自动从历史对话抽取），回复时作为用户背景参考："

JOB_MAX_ATTEMPTS = 3  # 失败计数上限：超限留 error 行待观察，不无限重试（REQ-042 异常分支）

_NUMBERED_LINE = re.compile(r"^\s*\d+\s*[\.、．]\s*(.+?)\s*$")


def render_memory_text(entries: list[str]) -> str:
    """注入文案组装（定稿模板逐字）：包裹标签 + 说明行 + 编号条目行。

    回合组装与记忆页注入预览（REQ-043 定夺⑨「看到的就是注入的」）共用本函数——
    单一链路，前端零本地拼装。
    """
    lines = "\n".join(f"{i}. {e}" for i, e in enumerate(entries, 1))
    return f"{MEMORY_TAG_OPEN}\n{MEMORY_PREAMBLE}\n{lines}\n{MEMORY_TAG_CLOSE}"


def parse_extract_output(text: str, *, max_entries: int, max_chars: int) -> list[str]:
    """模型输出 → 记忆条目列表（格式纪律解析：仅取编号行，容错前缀噪音）。

    单条按 max_chars 截断、总数按 max_entries 截断（模型输出顺序，定夺⑤口径）；
    空列表返回 []（调用方按 spec 口径处理）。
    """
    entries: list[str] = []
    for line in text.splitlines():
        m = _NUMBERED_LINE.match(line)
        if not m:
            continue
        item = m.group(1).strip()
        if not item:
            continue
        entries.append(item[:max_chars])
        if len(entries) >= max_entries:
            break
    return entries


# ---------- 记忆读写（user_memories / users.memory_enabled） ----------

def is_memory_enabled(conn: sqlite3.Connection, user_id: int) -> bool:
    row = conn.execute(
        "SELECT memory_enabled FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    return bool(row["memory_enabled"]) if row is not None else False


def load_entries(conn: sqlite3.Connection, user_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT id, content, source_session_id, model, created_at, updated_at"
        " FROM user_memories WHERE user_id = ? ORDER BY id",
        (user_id,),
    ).fetchall()


def replace_entries(
    conn: sqlite3.Connection,
    user_id: int,
    entries: list[str],
    *,
    source_session_id: str | None,
    model: str | None,
) -> None:
    """整体替换（定夺⑤定案：先删后插同事务——唯一无歧义可断言的落库语义）。"""
    with conn:
        conn.execute("DELETE FROM user_memories WHERE user_id = ?", (user_id,))
        conn.executemany(
            "INSERT INTO user_memories (user_id, content, source_session_id, model)"
            " VALUES (?, ?, ?, ?)",
            [(user_id, e, source_session_id, model) for e in entries],
        )


def build_injection(conn: sqlite3.Connection, user_id: int) -> str | None:
    """回合组装时点的记忆注入文本：停用或无条目返回 None（组装口径与基线 v7 等价）。"""
    if not is_memory_enabled(conn, user_id):
        return None
    rows = load_entries(conn, user_id)
    if not rows:
        return None
    return render_memory_text([r["content"] for r in rows])


def inject_into_messages(
    messages: list[dict[str, Any]], memory_text: str, *, has_persona: bool
) -> list[dict[str, Any]]:
    """五层注入序挂载（定夺④）：记忆独立 system 消息 = system[1] 动态尾区之后、
    摘要消息（如有）之前。组装产物形状确定性：system[0]=人设（如有）+ system[1]=动态尾区
    恒为前 2/1 条，插入位 = 2（有人设）/ 1（无人设）——压缩生效时摘要消息在其后，
    记忆在前摘要在后（REQ-042 验收 1 口径）。
    """
    insert_at = 2 if has_persona else 1
    return messages[:insert_at] + [{"role": "system", "content": memory_text}] \
        + messages[insert_at:]


# ---------- 抽取任务（memory_jobs）与执行 ----------

def _resolve_upstream_for_user(
    conn: sqlite3.Connection, user_id: int, settings: Settings
) -> tuple[str, str, str, str] | None:
    """抽取调用的上游解析（同回合模式路由哲学，定夺⑧）：返回 (mode, base_url, key, model)；
    统一 key 未配置且无生效档案 → None（扫描跳过不落 job 行，REQ-042 异常分支）。"""
    profile = conn.execute(
        "SELECT base_url, model, api_key FROM profiles"
        " WHERE user_id = ? AND is_active = 1",
        (user_id,),
    ).fetchone()
    if profile is not None:
        return MODE_SELF, profile["base_url"], profile["api_key"], profile["model"]
    if settings.unified_key:
        return MODE_UNIFIED, settings.unified_base_url, settings.unified_key, \
            settings.unified_model
    return None


def _doc_messages(doc: dict[str, Any]) -> list[dict[str, Any]]:
    return [m for m in doc.get("messages") or [] if isinstance(m, dict)]


def _increment_after_watermark(
    messages: list[dict[str, Any]], watermark_id: str | None
) -> list[dict[str, Any]]:
    """未覆盖增量 = 水位之后的消息；无水位（首次抽取）→ 全量。水位 id 不在当前消息中
    （编辑重建等）→ 视同全量（保守方向：重复覆盖由模型合并消化，不丢信息）。"""
    if not watermark_id:
        return messages
    for i, m in enumerate(messages):
        if str(m.get("id")) == watermark_id:
            return messages[i + 1:]
    return messages


def _extract_user_block(existing_contents: list[str], transcript: str) -> str:
    """抽取调用用户块（与 T0 冒烟逐字同形，plans/iter-17-verify.md §2）。"""
    existing = "\n".join(f"{i}. {e}" for i, e in enumerate(existing_contents, 1)) \
        if existing_contents else "（空）"
    return f"现有记忆：\n{existing}\n\n新增对话内容：\n{transcript}"


async def execute_job(
    conn: sqlite3.Connection,
    client: httpx.AsyncClient,
    settings: Settings,
    *,
    user_id: int,
    session_id: str,
) -> None:
    """执行一个抽取任务（pending 行已落库）。失败降级：记忆表不变、attempts+1
    （上限 3 置 error），memory_extract 行如实记（铁律 5）。"""
    row = conn.execute(
        "SELECT data FROM chat_sessions WHERE user_id = ? AND id = ?",
        (user_id, session_id),
    ).fetchone()
    if row is None:  # 会话已删除：job 随之级联清理的边界竞态，静默收尾
        with conn:
            conn.execute(
                "DELETE FROM memory_jobs WHERE user_id = ? AND session_id = ?",
                (user_id, session_id),
            )
        return
    try:
        doc = json.loads(row["data"])
        if not isinstance(doc, dict):
            raise ValueError("session doc not an object")
    except (json.JSONDecodeError, ValueError):
        doc = {"messages": []}
    messages = _doc_messages(doc)

    job = conn.execute(
        "SELECT watermark_msg_id, attempts FROM memory_jobs"
        " WHERE user_id = ? AND session_id = ?",
        (user_id, session_id),
    ).fetchone()
    if job is None:
        return
    increment = _increment_after_watermark(messages, job["watermark_msg_id"])
    if not increment:  # 增量已被其他路径覆盖（防御面）：直接收尾
        with conn:
            conn.execute(
                "UPDATE memory_jobs SET status = 'done', updated_at = datetime('now')"
                " WHERE user_id = ? AND session_id = ?",
                (user_id, session_id),
            )
        return

    resolved = _resolve_upstream_for_user(conn, user_id, settings)
    if resolved is None:
        return  # 上游不可解析：不落行不执行（扫描侧已拦，双保险）
    mode, base_url, api_key, model = resolved

    existing = [r["content"] for r in load_entries(conn, user_id)]
    transcript = compress.render_transcript(increment)
    outcome = await compress.call_summary(
        client, base_url, api_key, model,
        _extract_user_block(existing, transcript),
        settings.memory_extract_timeout,
        system_prompt=EXTRACT_PROMPT,
    )
    telemetry.record_memory_extract(
        settings.db_path, day=today(), user_id=user_id, mode=mode,
        session_id=session_id, model=model, latency_ms=outcome.latency_ms,
        status=outcome.status, usage=outcome.usage, error_code=outcome.error_code,
    )
    attempts = int(job["attempts"]) + 1
    if outcome.status != "ok":
        new_status = "error" if attempts >= JOB_MAX_ATTEMPTS else "pending"
        with conn:
            conn.execute(
                "UPDATE memory_jobs SET attempts = ?, status = ?, updated_at = datetime('now')"
                " WHERE user_id = ? AND session_id = ?",
                (attempts, new_status, user_id, session_id),
            )
        logger.warning("memory extract degraded user_id=%s session_id=%s status=%s",
                       user_id, session_id, outcome.status)
        return

    entries = parse_extract_output(
        outcome.text,
        max_entries=settings.memory_max_entries,
        max_chars=settings.memory_entry_max_chars,
    )
    if not entries:  # 空输出：按 spec 失败分支（attempts+1），记忆表不变
        new_status = "error" if attempts >= JOB_MAX_ATTEMPTS else "pending"
        with conn:
            conn.execute(
                "UPDATE memory_jobs SET attempts = ?, status = ?, updated_at = datetime('now')"
                " WHERE user_id = ? AND session_id = ?",
                (attempts, new_status, user_id, session_id),
            )
        logger.warning("memory extract empty output user_id=%s session_id=%s",
                       user_id, session_id)
        return

    replace_entries(
        conn, user_id, entries, source_session_id=session_id, model=model)
    # 成功：水位推进到本次增量末条（「本次抽取覆盖至的消息 id」= 下次增量判定依据）
    covered = str(increment[-1].get("id") or job["watermark_msg_id"])
    with conn:
        conn.execute(
            "UPDATE memory_jobs SET status = 'done', attempts = ?, watermark_msg_id = ?,"
            " updated_at = datetime('now') WHERE user_id = ? AND session_id = ?",
            (attempts, covered, user_id, session_id),
        )


# ---------- 常驻扫描（lifespan 挂载，七期首个常驻后台任务） ----------

def _session_eligible(
    doc: dict[str, Any],
    updated_at: float,
    *,
    min_turns: int,
    silence_minutes: int,
    last_watermark: str | None,
    now: float,
) -> bool:
    """触发条件判定：轮数 ≥ N + 静默 ≥ X 分钟 + 有未覆盖增量。"""
    messages = _doc_messages(doc)
    turns = sum(1 for m in messages if m.get("role") == "user")
    if turns < min_turns:
        return False
    if now - updated_at < silence_minutes * 60:
        return False
    if not _increment_after_watermark(messages, last_watermark):
        return False
    return bool(messages) and bool(messages[-1].get("id"))


async def scan_once(db_path: str, client: httpx.AsyncClient, settings: Settings) -> None:
    """一轮静默窗口扫描：候选会话落 pending 行 → 执行；pending 存量行拾起执行
    （重启恢复口径：memory_jobs 持久化为唯一权威）。"""
    from app.db import connect  # 局部导入避免模块初始化环

    conn = connect(db_path)
    try:
        now = time.time()
        # 1) 重启恢复面：存量 pending 行（含进程重启前落库未执行的）优先拾起
        pending = conn.execute(
            "SELECT user_id, session_id FROM memory_jobs WHERE status = 'pending'"
        ).fetchall()
        for job in pending:
            await execute_job(
                conn, client, settings,
                user_id=job["user_id"], session_id=job["session_id"],
            )
        # 2) 候选扫描：全部会话逐一判定（单部署流量规模下成本可忽略）
        sessions = conn.execute(
            "SELECT cs.user_id, cs.id, cs.data, cs.updated_at, u.memory_enabled,"
            "       mj.status AS job_status, mj.watermark_msg_id AS job_watermark"
            " FROM chat_sessions cs"
            " JOIN users u ON u.id = cs.user_id"
            " LEFT JOIN memory_jobs mj"
            "   ON mj.user_id = cs.user_id AND mj.session_id = cs.id"
        ).fetchall()
        for s in sessions:
            if not s["memory_enabled"]:
                continue  # 整体停用：注入跳过且扫描跳过（不新抽取）
            if s["job_status"] in ("pending", "error"):
                continue  # pending 已在恢复面处理；error 留观不重试（done/无 job 走增量判定）
            try:
                doc = json.loads(s["data"])
                if not isinstance(doc, dict):
                    continue
            except (json.JSONDecodeError, TypeError):
                continue
            # done 之外的增量判定（无 job 行 = 首次）：上一轮 done 水位由 LEFT JOIN 携带
            if not _session_eligible(
                doc, float(s["updated_at"]),
                min_turns=settings.memory_min_turns,
                silence_minutes=settings.memory_silence_minutes,
                last_watermark=s["job_watermark"],
                now=now,
            ):
                continue
            if _resolve_upstream_for_user(conn, s["user_id"], settings) is None:
                continue  # 上游不可解析：扫描跳过不落 job 行（REQ-042 异常分支）
            # pending 行的 watermark = 上次覆盖水位（首次 = 空串哨兵）；执行成功后推进到
            # 本次增量末条（execute_job）——创建时不预写目标位，否则增量判定自吞
            with conn:
                conn.execute(
                    "INSERT INTO memory_jobs (user_id, session_id, status, watermark_msg_id)"
                    " VALUES (?, ?, 'pending', ?)"
                    " ON CONFLICT(user_id, session_id) DO UPDATE SET"
                    "   status = 'pending',"
                    "   watermark_msg_id = excluded.watermark_msg_id,"
                    "   attempts = 0,"
                    "   updated_at = datetime('now')",
                    (s["user_id"], s["id"], s["job_watermark"] or ""),
                )
            await execute_job(
                conn, client, settings, user_id=s["user_id"], session_id=s["id"])
    finally:
        conn.close()


async def scan_loop(app) -> None:
    """常驻扫描循环（main.py lifespan 挂载）：每轮异常自吞不杀循环，取消即退。
    settings 取 app.state.settings（lifespan 注入，与本次应用实例同源——测试夹具
    settings 与全局 get_settings() 缓存不同源时不失配）。"""
    settings = app.state.settings
    while True:
        try:
            await scan_once(app.state.db_path, app.state.http, settings)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 —— 常驻任务自保：任何异常不杀循环
            logger.warning("memory scan iteration failed", exc_info=True)
        await asyncio.sleep(settings.memory_scan_interval)
