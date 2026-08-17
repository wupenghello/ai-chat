"""REQ-024（iter-8 T1）：用量配额与滥用防护——注册限频 / 每用户按日配额 / 统一 key 全站熔断。

- 计数粒度 (day, user_id, mode)：档位随请求时密钥模式判定（统一 key=免费档 / 自填=高档），
  同日切换模式不重复给量——按当日总消耗对当前档位限额校验
- 「先查后计」：被拦截请求不计数、绝不抵达上游（验收以服务端日志取证，proxy 检查位打点）；
  查与计非原子，极端并发下可能放过 limit+N 个请求——量级无害，换实现简单性（此处留档）
- 短事务 + WAL（DEF-015 线程绑定前科）：每笔计数一个事务，无长事务持锁
- token 数取自上游 usage 帧（机器采集；解析不到记 0，不估算不编造——铁律 5 同源精神）
- 配额默认值：CEO 拍板 2026-08-16 随 iter-8 计划定案（config.Settings，0 = 不限）
"""

from __future__ import annotations

import logging
import re
import sqlite3
from datetime import datetime

from app.config import Settings
from app.db import connect

logger = logging.getLogger("ai-chat.quota")

MODE_UNIFIED = "unified"
MODE_SELF = "self"

# design-iter-7 §3.1 行 20 定稿文案（占位参数化由后端下发，前端零 UI 改动接入）
QUOTA_EXHAUSTED_UNIFIED = "配额已用尽，将于明日 00:00 重置。可在高级设置使用自有密钥解锁更高配额"
QUOTA_EXHAUSTED_SELF = "配额已用尽，将于明日 00:00 重置"
UNIFIED_PAUSED = "服务今日对话用量已达上限，暂停新对话，明日 00:00 恢复"
REGISTER_LIMITED = "注册过于频繁，请明日再试"

# usage 帧在 [DONE] 前由上游压轴下发，取最后一个匹配即 usage 帧的 total_tokens
_USAGE_TOTAL_RE = re.compile(rb'"total_tokens"\s*:\s*(\d+)')


def today() -> str:
    """自然日（服务器本地时区）——重置周期口径（REQ-024）。"""
    return datetime.now().strftime("%Y-%m-%d")


def limit_for(conn: sqlite3.Connection, user_id: int, mode: str, settings: Settings) -> int:
    """有效日限：管理员按用户覆盖优先（REQ-025，双模式统一）；否则按密钥模式默认档。"""
    row = conn.execute(
        "SELECT quota_override FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    if row is not None and row["quota_override"] is not None:
        return int(row["quota_override"])
    return settings.quota_self_daily if mode == MODE_SELF else settings.quota_free_daily


def register_try_consume(conn: sqlite3.Connection, ip: str, limit: int) -> bool:
    """注册限频：先查后计，超出不再计数；422 校验失败不进 handler 天然不计。"""
    if limit <= 0:
        return True
    day = today()
    row = conn.execute(
        "SELECT count FROM register_log WHERE day = ? AND ip = ?", (day, ip)
    ).fetchone()
    if row is not None and row["count"] >= limit:
        logger.info("register blocked ip=%s day=%s count=%s limit=%s", ip, day, row["count"], limit)
        return False
    with conn:
        conn.execute(
            "INSERT INTO register_log (day, ip, count) VALUES (?, ?, 1) "
            "ON CONFLICT (day, ip) DO UPDATE SET count = count + 1",
            (day, ip),
        )
    return True


def user_used(conn: sqlite3.Connection, user_id: int, day: str | None = None) -> int:
    """该用户当日全部模式的总请求数（档位联动的校验口径，REQ-025 用量统计同源）。"""
    row = conn.execute(
        "SELECT COALESCE(SUM(requests), 0) AS n FROM usage_daily WHERE day = ? AND user_id = ?",
        (day or today(), user_id),
    ).fetchone()
    return int(row["n"])


def site_unified_used(conn: sqlite3.Connection, day: str | None = None) -> int:
    row = conn.execute(
        "SELECT COALESCE(SUM(requests), 0) AS n FROM usage_daily WHERE day = ? AND mode = ?",
        (day or today(), MODE_UNIFIED),
    ).fetchone()
    return int(row["n"])


def check_and_consume(
    conn: sqlite3.Connection, user_id: int, mode: str, settings: Settings
) -> tuple[str, tuple[int, str, str] | None]:
    """代理配额检查位（REQ-023 预留位，REQ-024 落地）。

    返回 (day, blocked)：day = 请求落账自然日（流结束补记 token 需同归属，跨零点一致——
    Code Review 观察项①）；blocked = None 通过（已计数），否则 (status, code, detail) 拦截。
    """
    day = today()
    limit = limit_for(conn, user_id, mode, settings)
    if limit > 0 and user_used(conn, user_id, day) >= limit:
        detail = QUOTA_EXHAUSTED_SELF if mode == MODE_SELF else QUOTA_EXHAUSTED_UNIFIED
        return (day, (429, "quota_exhausted", detail))
    if mode == MODE_UNIFIED and settings.unified_daily_total > 0:
        if site_unified_used(conn, day) >= settings.unified_daily_total:
            return (day, (503, "unified_daily_exceeded", UNIFIED_PAUSED))
    with conn:
        # CHG-007 REQ-034（iter-13 T1）：turns 列随 requests 同步递增——历史行 turns=0 而
        # requests 即历史回合数（1 请求 = 1 回合），SUM(requests) 口径对新旧数据恒等；
        # 旧透传端点与本回合端点共用此检查位（两入口配额同源同语义）
        conn.execute(
            "INSERT INTO usage_daily (day, user_id, mode, requests, turns)"
            " VALUES (?, ?, ?, 1, 1) "
            "ON CONFLICT (day, user_id, mode)"
            " DO UPDATE SET requests = requests + 1, turns = turns + 1",
            (day, user_id, mode),
        )
    return (day, None)


def extract_total_tokens(raw: bytes) -> int:
    found = _USAGE_TOTAL_RE.findall(raw)
    return int(found[-1]) if found else 0


def record_tokens(db_path: str, user_id: int, mode: str, tokens: int, day: str) -> None:
    """流结束后补记 token 用量：独立短连接（不依赖请求连接生命周期），失败不影响已发响应。

    day = 请求时 check_and_consume 落账的自然日（Code Review 观察项①）：流跨零点结束时
    token 仍归请求日，而非此刻 today()——与 requests 同一 (day, user_id, mode) 行。
    """
    if tokens <= 0:
        return
    try:
        conn = connect(db_path)
        try:
            with conn:
                conn.execute(
                    "UPDATE usage_daily SET tokens = tokens + ? "
                    "WHERE day = ? AND user_id = ? AND mode = ?",
                    (tokens, day, user_id, mode),
                )
        finally:
            conn.close()
    except sqlite3.Error:
        logger.warning("usage token record failed user_id=%s mode=%s", user_id, mode, exc_info=True)
