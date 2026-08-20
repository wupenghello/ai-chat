"""记忆管理 API（CHG-011 REQ-043 数据面，iter-17 T2；形状随 design-iter-17 §4 基线定案）。

四端点：GET /api/memory（列表 + 停用状态 + 注入预览）/ PUT /api/memory/{id}（条目编辑）/
DELETE /api/memory/{id}（条目删除）/ PUT /api/memory/settings（memory_enabled 开关）。
用户 token scope：user_id = token 身份，他人数据天然不可见不可操作——跨用户标识操作
一律 404 memory_not_found（归属隔离沿复合主键哲学，不泄露归属，REQ-043 验收 5）。
PUT 来源归零语义（design-iter-17 §4.2 随稿定案）：编辑后 source_session_id/model 归零、
UI 落「手工编辑」分支（M12）。注入预览 = 组装时点同源取值（memory.build_injection 单一
链路，「看到的就是注入的」，定夺⑨；前端零本地拼装）。detail 对象形状沿 sessions.py
409 session_schema_conflict 先例（{code, message}，client.ts 既有消费链路直接支持）。
无 POST 端点 = 不能手动新增记忆（CHG-011 内容 3.7 框架有意边界；「手工编辑」仅指对既有
抽取条目的改写，design-iter-17 §4.5）。
"""

import json
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app import memory
from app.db import DatabaseDep
from app.routers.auth import CurrentUser

router = APIRouter(prefix="/api/memory", tags=["memory"])

_CONTENT_MAX = 150  # 单条字符上限（T0 体量复核定案；服务端为唯一权威校验，前端 maxlength 双保险）


class MemoryEntryUpdate(BaseModel):
    content: str


class MemorySettingsUpdate(BaseModel):
    memory_enabled: bool


def _not_found() -> HTTPException:
    return HTTPException(
        status.HTTP_404_NOT_FOUND,
        detail={"code": "memory_not_found", "message": "记忆不存在"},
    )


def _entry_out(conn, row) -> dict[str, Any]:
    """条目出参（design-iter-17 §4.1）：source_session_title = 组装时读会话档 title，
    会话已删 → null（UI 落 M11 分支）；顺序 = 注入组装顺序（前端不排序）。"""
    title = None
    if row["source_session_id"]:
        srow = conn.execute(
            "SELECT data FROM chat_sessions WHERE user_id = ? AND id = ?",
            (row["user_id"], row["source_session_id"]),
        ).fetchone()
        if srow is not None:
            try:
                doc = json.loads(srow["data"])
                if isinstance(doc, dict) and isinstance(doc.get("title"), str):
                    title = doc["title"]
            except (json.JSONDecodeError, TypeError):
                title = None
    return {
        "id": row["id"],
        "content": row["content"],
        "source_session_id": row["source_session_id"],
        "source_session_title": title,
        "model": row["model"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


@router.get("")
def get_memory(user: CurrentUser, conn: DatabaseDep) -> dict[str, Any]:
    """列表 + 停用状态 + 注入预览（预览 = 组装时点同源取值，单一链路；
    memory_enabled=0 或无条目 → null——没有注入发生，不呈现注入物，铁律 5）。"""
    rows = memory.load_entries(conn, user.id)
    return {
        "entries": [_entry_out(conn, r) for r in rows],
        "memory_enabled": memory.is_memory_enabled(conn, user.id),
        "injection_preview": memory.build_injection(conn, user.id),
    }


@router.put("/settings")
def update_memory_settings(
    body: MemorySettingsUpdate,
    user: CurrentUser,
    conn: DatabaseDep,
) -> dict[str, Any]:
    """整体停用开关（审核稿「可整体停用」验收口径）：停用后注入跳过且扫描跳过
    （不新抽取；存量记忆保留，重新启用即恢复注入）。注册序在 /{entry_id} 之前。"""
    with conn:
        conn.execute(
            "UPDATE users SET memory_enabled = ? WHERE id = ?",
            (1 if body.memory_enabled else 0, user.id),
        )
    return {"memory_enabled": body.memory_enabled}


@router.put("/{entry_id}")
def update_entry(
    entry_id: int,
    body: MemoryEntryUpdate,
    user: CurrentUser,
    conn: DatabaseDep,
) -> dict[str, Any]:
    """条目编辑：来源归零（source_session_id/model → NULL，UI 落 M12 手工编辑分支）。
    校验为服务端唯一权威：trim 为空 / 超 150 字 → 422 memory_content_invalid。
    成功返回更新后条目全形（下一回合组装即生效，REQ-042 主流程 4）。"""
    content = body.content.strip()
    if not content or len(content) > _CONTENT_MAX:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "memory_content_invalid",
                "message": "记忆内容不能为空，且不超过 150 字",
            },
        )
    row = conn.execute(
        "SELECT * FROM user_memories WHERE id = ? AND user_id = ?",
        (entry_id, user.id),
    ).fetchone()
    if row is None:
        raise _not_found()
    with conn:
        conn.execute(
            "UPDATE user_memories SET content = ?, source_session_id = NULL, model = NULL,"
            " updated_at = datetime('now') WHERE id = ? AND user_id = ?",
            (content, entry_id, user.id),
        )
    updated = conn.execute(
        "SELECT * FROM user_memories WHERE id = ?", (entry_id,)
    ).fetchone()
    return _entry_out(conn, updated)


@router.delete("/{entry_id}")
def delete_entry(entry_id: int, user: CurrentUser, conn: DatabaseDep) -> dict[str, Any]:
    """条目删除：响应形状沿 sessions.py DELETE 先例（{detail: 'deleted'}）。
    他人条目或不存在 → 404 memory_not_found（归属隔离）。下一回合组装即生效。"""
    row = conn.execute(
        "SELECT id FROM user_memories WHERE id = ? AND user_id = ?",
        (entry_id, user.id),
    ).fetchone()
    if row is None:
        raise _not_found()
    with conn:
        conn.execute(
            "DELETE FROM user_memories WHERE id = ? AND user_id = ?",
            (entry_id, user.id),
        )
    return {"detail": "deleted"}
