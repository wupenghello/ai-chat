"""记忆管理 API（CHG-011 REQ-043 数据面，iter-17 T2；design-iter-17 §4 口径定案）。

四端点：GET /api/memory（列表 + 停用状态 + 注入预览）/ PUT /api/memory/{id}（条目编辑）/
DELETE /api/memory/{id}（条目删除）/ PUT /api/memory/settings（memory_enabled 开关）。
用户 token scope：user_id = token 身份，他人数据天然不可见不可操作——跨用户标识操作
404（归属隔离沿复合主键哲学，REQ-043 验收 5）。
PUT 来源归零语义（design-iter-17 随稿定案）：编辑后 source_session_id/model 归零、
UI 落「手工编辑」分支。注入预览 = 组装时点同源取值（memory.build_injection 单一链路，
「看到的就是注入的」，定夺⑨；前端零本地拼装）。
无 POST 端点 = 不能手动新增记忆（CHG-011 内容 3.7 框架有意边界，design-iter-17 反向
走查断言）；「手工编辑」仅指对既有抽取条目的改写。
"""

from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app import memory
from app.db import DatabaseDep
from app.routers.auth import CurrentUser

router = APIRouter(prefix="/api/memory", tags=["memory"])


class MemoryEntryUpdate(BaseModel):
    """条目编辑请求体（content ≤150 字——T0 体量复核定案上限，超限 422）。"""
    content: str = Field(min_length=1, max_length=150)


class MemorySettingsUpdate(BaseModel):
    memory_enabled: bool


@router.get("")
def get_memory(user: CurrentUser, conn: DatabaseDep) -> dict[str, Any]:
    """列表 + 停用状态 + 注入预览（预览 = 组装时点同源取值，单一链路）。"""
    enabled = memory.is_memory_enabled(conn, user.id)
    entries = [
        {
            "id": r["id"],
            "content": r["content"],
            "source_session_id": r["source_session_id"],
            "model": r["model"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        }
        for r in memory.load_entries(conn, user.id)
    ]
    return {
        "entries": entries,
        "memory_enabled": enabled,
        "injection_preview": memory.build_injection(conn, user.id),
    }


@router.put("/settings")
def update_memory_settings(
    body: MemorySettingsUpdate,
    user: CurrentUser,
    conn: DatabaseDep,
) -> dict[str, Any]:
    """整体停用开关（审核稿「可整体停用」验收口径）：停用后注入跳过且扫描跳过
    （不新抽取；存量记忆保留，重新启用即恢复注入）。
    注册序在 /{entry_id} 之前（路径匹配先具体后参数）。"""
    with conn:
        conn.execute(
            "UPDATE users SET memory_enabled = ? WHERE id = ?",
            (1 if body.memory_enabled else 0, user.id),
        )
    return {"ok": True, "memory_enabled": body.memory_enabled}


@router.put("/{entry_id}")
def update_entry(
    entry_id: int,
    body: MemoryEntryUpdate,
    user: CurrentUser,
    conn: DatabaseDep,
) -> dict[str, Any]:
    """条目编辑：来源归零（source_session_id/model → NULL，UI 落「手工编辑」分支）。
    他人条目或不存在 → 404（归属隔离，不泄露存在性）。下一回合组装即生效。"""
    row = conn.execute(
        "SELECT id FROM user_memories WHERE id = ? AND user_id = ?",
        (entry_id, user.id),
    ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "记忆条目不存在或已删除")
    with conn:
        conn.execute(
            "UPDATE user_memories SET content = ?, source_session_id = NULL, model = NULL,"
            " updated_at = datetime('now') WHERE id = ? AND user_id = ?",
            (body.content, entry_id, user.id),
        )
    return {"ok": True}


@router.delete("/{entry_id}")
def delete_entry(entry_id: int, user: CurrentUser, conn: DatabaseDep) -> dict[str, Any]:
    """条目删除：他人条目或不存在 → 404（归属隔离）。下一回合组装即生效。"""
    row = conn.execute(
        "SELECT id FROM user_memories WHERE id = ? AND user_id = ?",
        (entry_id, user.id),
    ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "记忆条目不存在或已删除")
    with conn:
        conn.execute(
            "DELETE FROM user_memories WHERE id = ? AND user_id = ?",
            (entry_id, user.id),
        )
    return {"ok": True}
