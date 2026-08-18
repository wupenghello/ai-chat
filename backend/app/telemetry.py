"""请求级遥测采集（CHG-009 REQ-037，iter-15 T2）：telemetry 明细表写入面。

- 双端采集：回合端点 llm 行/tool 行（turn_id 关联）+ 旧透传端点 legacy 行
  （turn_id=NULL；定夺④下线执行完成前保留采集，为下线提供流量证据）
- 机器采集（铁律 5）：token 分项/缓存字段上游不返回记 NULL，不估算不造数；
  表与日志不含 key、消息内容、工具结果全文（沿 REQ-031 卫生口径）
- 主路径隔离：独立短连接写入（沿 quota.record_tokens 先例），写失败 warning 不阻塞、
  不补造（REQ-037 异常分支）
- 保留期 90 天（定夺⑤）：按自然日惰性清理——每次写入时机会式检查，清理失败不阻断
- 既有 usage_daily 回合/token 落账零变化：遥测为并行新轨（REQ-024/025/034 口径零回退）
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timedelta
from typing import Any

from app.db import connect, kv_get, kv_set
from app.quota import today

logger = logging.getLogger("ai-chat.telemetry")

RETENTION_DAYS = 90  # 明细保留期（CHG-009 定夺⑤定案）
_PURGED_DAY_KEY = "telemetry_purged_day"  # 上次清理覆盖到的自然日（惰性清理水位）

# 允许落库的列白名单：组装器只能给出 schema 内字段（防御面；卫生自查锚点）
_COLUMNS = (
    "day", "user_id", "mode", "turn_id", "endpoint", "kind", "step", "model",
    "latency_ms", "status", "tokens_prompt", "tokens_completion", "tokens_total",
    "cache_hit_tokens", "cache_miss_tokens", "tool_name", "error_code",
)


def _maybe_purge(conn: sqlite3.Connection) -> None:
    """90 天按自然日惰性清理：水位 = 上次清理日，跨自然日才执行一次。

    保留口径：含今日在内最近 RETENTION_DAYS 个自然日（day < 今日-(90-1) 天的行删除）。
    清理失败不阻断主路径（调用方整体 try/except 兜底，REQ-037 定夺⑤口径）。
    """
    day = today()
    if kv_get(conn, _PURGED_DAY_KEY) == day:
        return
    cutoff = (datetime.now() - timedelta(days=RETENTION_DAYS - 1)).strftime("%Y-%m-%d")
    conn.execute("DELETE FROM telemetry WHERE day < ?", (cutoff,))
    kv_set(conn, _PURGED_DAY_KEY, day)


def _write(db_path: str, row: dict[str, Any]) -> None:
    """单行落库：独立短连接 + 事务，写失败仅 warning（回合主路径不受影响，铁律 5 不补造）。

    清理与写入分事务：惰性清理失败不阻断本行写入（定夺⑤「清理失败不影响主路径」）。
    """
    try:
        conn = connect(db_path)
        try:
            try:
                with conn:
                    _maybe_purge(conn)
            except sqlite3.Error:
                logger.warning("telemetry purge failed", exc_info=True)
            with conn:
                keys = [k for k in _COLUMNS if k in row]
                placeholders = ", ".join("?" for _ in keys)
                conn.execute(
                    f"INSERT INTO telemetry ({', '.join(keys)}) VALUES ({placeholders})",
                    tuple(row[k] for k in keys),
                )
        finally:
            conn.close()
    except sqlite3.Error:
        logger.warning("telemetry write failed kind=%s endpoint=%s",
                       row.get("kind"), row.get("endpoint"), exc_info=True)


def record_llm(
    db_path: str,
    *,
    day: str,
    user_id: int,
    mode: str,
    turn_id: str | None,
    endpoint: str,
    step: int | None,
    model: str,
    latency_ms: int,
    status: str,
    usage: dict[str, Any] | None = None,
    error_code: str | None = None,
) -> None:
    """上游 LLM 调用行（kind=llm）。usage 字段映射口径 = T0 取证结论
    （plans/iter-15-verify.md §2.4，REQ-037 字段映射唯一实现输入）：
    tokens_prompt ← prompt_tokens / tokens_completion ← completion_tokens /
    tokens_total ← total_tokens / cache_hit_tokens ← prompt_cache_hit_tokens /
    cache_miss_tokens ← prompt_cache_miss_tokens；上游不返回的分项记 NULL（铁律 5），
    total 缺失记现状口径 0（REQ-037 描述句）；prompt_tokens_details.cached_tokens
    为镜像字段不重复映射（T0 §2.2）。
    """
    usage = usage or {}

    def _int(name: str) -> int | None:
        value = usage.get(name)
        return int(value) if isinstance(value, (int, float)) else None

    _write(db_path, {
        "day": day,
        "user_id": user_id,
        "mode": mode,
        "turn_id": turn_id,
        "endpoint": endpoint,
        "kind": "llm",
        "step": step,
        "model": model,
        "latency_ms": latency_ms,
        "status": status,
        "tokens_prompt": _int("prompt_tokens"),
        "tokens_completion": _int("completion_tokens"),
        # total 缺失记现状口径 0（agent UpstreamCall.usage 同义；REQ-037 描述句）
        "tokens_total": int(usage.get("total_tokens") or 0),
        "cache_hit_tokens": _int("prompt_cache_hit_tokens"),
        "cache_miss_tokens": _int("prompt_cache_miss_tokens"),
        "error_code": error_code,
    })


def record_tool(
    db_path: str,
    *,
    day: str,
    user_id: int,
    mode: str,
    turn_id: str | None,
    endpoint: str,
    step: int | None,
    tool_name: str,
    latency_ms: int,
    status: str,
) -> None:
    """工具执行行（kind=tool）：与 REQ-031 网关日志四字段同源并存
    （name/status/duration 三字段随行；truncated 仅网关日志侧——schema 无该列，
    CHG-009 内容 4.2 定稿）。"""
    _write(db_path, {
        "day": day,
        "user_id": user_id,
        "mode": mode,
        "turn_id": turn_id,
        "endpoint": endpoint,
        "kind": "tool",
        "step": step,
        "tool_name": tool_name,
        "latency_ms": latency_ms,
        "status": status,
    })
