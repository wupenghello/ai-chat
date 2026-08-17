"""会话 CRUD API —— REQ-022 核心（iter-6 T3）。

会话为整档 JSON 存储（data 列）：PUT 全量覆盖 = 最后写入覆盖（LWW，CEO 定案）；
GET 返回调用方自己的会话列表（按 updatedAt 降序），内容逐字恢复。
迁移入口（导入本地 IndexedDB 数据）为 iter-8，不在本迭代。
"""

import json
import time
from typing import Annotated, Any

from fastapi import APIRouter, Body, HTTPException, status

from app.db import DatabaseDep
from app.routers.auth import CurrentUser

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

SessionBody = Annotated[dict[str, Any], Body()]


@router.get("")
def list_sessions(user: CurrentUser, conn: DatabaseDep) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT data FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC",
        (user.id,),
    ).fetchall()
    return [json.loads(r["data"]) for r in rows]


@router.put("/{session_id}")
def save_session(
    session_id: str,
    user: CurrentUser,
    conn: DatabaseDep,
    payload: SessionBody,
) -> dict[str, str]:
    if payload.get("id") != session_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "会话 id 与路径不一致")
    if not isinstance(payload.get("messages"), list):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "会话数据不合法（缺少 messages）")
    # schema:2 写侧守卫（CHG-007 定夺②，iter-13 T1）：存量已带 schema:2 而来件为无标记
    # 旧格式（升级窗口期旧客户端陈旧副本）→ 409 拒绝、存量逐字不动；其余（v2 覆 v2 /
    # v2 覆 v1 / v1 覆 v1 / 新建）照常 LWW upsert。老客户端 4xx 非临时性：不入暂存队列、
    # 重放按毒丸丢弃（前端 persistence 取证，CHG-007 4.3），无无限重试。
    existing = conn.execute(
        "SELECT data FROM chat_sessions WHERE user_id = ? AND id = ?",
        (user.id, session_id),
    ).fetchone()
    if existing is not None:
        try:
            existing_doc = json.loads(existing["data"])
        except (json.JSONDecodeError, TypeError):
            existing_doc = None
        if (
            isinstance(existing_doc, dict)
            and existing_doc.get("schema") == 2
            and payload.get("schema") != 2
        ):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail={
                    "code": "session_schema_conflict",
                    "message": "该会话已升级为新格式，请刷新页面获取最新版本后再编辑",
                },
            )
    updated_at = payload.get("updatedAt")
    if not isinstance(updated_at, (int, float)):
        updated_at = time.time()
    with conn:
        # 复合主键 (user_id, id)：覆盖只作用于自己的行，跨用户同 id 互不可见
        conn.execute(
            """
            INSERT INTO chat_sessions (id, user_id, data, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, id) DO UPDATE SET
                data = excluded.data,
                updated_at = excluded.updated_at
            """,
            (session_id, user.id, json.dumps(payload, ensure_ascii=False), float(updated_at)),
        )
    return {"detail": "saved"}


@router.delete("/{session_id}")
def delete_session(session_id: str, user: CurrentUser, conn: DatabaseDep) -> dict[str, str]:
    """幂等：删除自己的会话；不存在或属他人时静默成功（与前端 idb 语义一致）。"""
    with conn:
        conn.execute(
            "DELETE FROM chat_sessions WHERE id = ? AND user_id = ?", (session_id, user.id)
        )
    return {"detail": "deleted"}
