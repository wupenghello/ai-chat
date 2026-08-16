"""管理后台 API（REQ-025，iter-8 T2）：用户治理 / 配额覆盖 / 用量统计 / 全站配额条。

- 管理员标记：首个注册用户自动成为管理员（register 引导 + 迁移 v5 存量补标）
- 门禁：非管理员一律 403——入口隐藏只是 UI 层，接口 403 才是安全边界（设计定夺③）
- 配额覆盖：按用户固定日限（双模式统一生效）；NULL = 恢复默认档（档位联动，设计定夺①）
- 用量统计：按用户按日聚合（mode 合并），与 usage_daily 同源（REQ-024 验收抽样比对口径）；
  日期窗口/排序由前端控制（设计定夺④），后端只做过滤
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app import quota
from app.config import Settings, get_settings
from app.db import DatabaseDep
from app.routers.auth import CurrentUser, UserOut

router = APIRouter(prefix="/api/admin", tags=["admin"])


def get_admin_user(user: CurrentUser, conn: DatabaseDep) -> UserOut:
    row = conn.execute("SELECT is_admin FROM users WHERE id = ?", (user.id,)).fetchone()
    if row is None or not row["is_admin"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "无权访问管理后台")
    return user


AdminUser = Annotated[UserOut, Depends(get_admin_user)]


class QuotaBody(BaseModel):
    daily_limit: int | None  # None = 恢复默认档；正整数 = 自定义固定日限（设计定夺①）


def _require_user(conn, user_id: int):
    row = conn.execute(
        "SELECT id, username, is_admin, banned FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "用户不存在")
    return row


@router.get("/users")
def list_users(
    admin: AdminUser,
    conn: DatabaseDep,
    settings: Annotated[Settings, Depends(get_settings)],
) -> list[dict]:
    """用户列表：注册时间 / 状态 / 密钥模式 / 配额档位与当日用量（design-iter-8 §1.2 六列）。"""
    day = quota.today()
    rows = conn.execute(
        """
        SELECT u.id, u.username, u.is_admin, u.banned, u.created_at, u.quota_override,
               EXISTS(SELECT 1 FROM profiles p WHERE p.user_id = u.id AND p.is_active = 1)
                   AS mode_self,
               COALESCE((SELECT SUM(d.requests) FROM usage_daily d
                         WHERE d.user_id = u.id AND d.day = ?), 0) AS used_today
        FROM users u
        ORDER BY u.created_at, u.id
        """,
        (day,),
    ).fetchall()
    out: list[dict] = []
    for r in rows:
        mode = quota.MODE_SELF if r["mode_self"] else quota.MODE_UNIFIED
        out.append(
            {
                "id": r["id"],
                "username": r["username"],
                "is_admin": bool(r["is_admin"]),
                "banned": bool(r["banned"]),
                "created_at": r["created_at"],
                "mode": mode,
                "quota_override": r["quota_override"],
                "daily_limit": quota.limit_for(conn, r["id"], mode, settings),
                "used_today": r["used_today"],
            }
        )
    return out


@router.post("/users/{user_id}/ban")
def ban_user(user_id: int, admin: AdminUser, conn: DatabaseDep) -> dict[str, str]:
    """封禁：登录与受保护调用均被拒（既有 banned 门禁，iter-6/7 已落地）。管理员不可被封禁。"""
    row = _require_user(conn, user_id)
    if row["is_admin"]:
        # spec：管理员尝试封禁自己被阻止；当前单管理员模型下即唯一管理员
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "不允许封禁管理员")
    with conn:
        conn.execute("UPDATE users SET banned = 1 WHERE id = ?", (user_id,))
    return {"detail": "已封禁"}


@router.post("/users/{user_id}/unban")
def unban_user(user_id: int, admin: AdminUser, conn: DatabaseDep) -> dict[str, str]:
    _require_user(conn, user_id)
    with conn:
        conn.execute("UPDATE users SET banned = 0 WHERE id = ?", (user_id,))
    return {"detail": "已解封"}


@router.put("/users/{user_id}/quota")
def set_quota(
    user_id: int,
    body: QuotaBody,
    admin: AdminUser,
    conn: DatabaseDep,
) -> dict[str, object]:
    """按用户覆盖配额（REQ-024 联动：下一次请求即按新值判定）。"""
    _require_user(conn, user_id)
    if body.daily_limit is not None and body.daily_limit < 1:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "自定义配额须为正整数")
    with conn:
        conn.execute(
            "UPDATE users SET quota_override = ? WHERE id = ?", (body.daily_limit, user_id)
        )
    return {"user_id": user_id, "quota_override": body.daily_limit}


@router.get("/usage")
def usage(
    admin: AdminUser,
    conn: DatabaseDep,
    user_id: int | None = None,
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
) -> list[dict]:
    """按用户按日用量（mode 合并聚合；过滤：用户 + 日期范围；排序交前端，设计定夺④）。"""
    sql = (
        "SELECT d.day, d.user_id, u.username, "
        "SUM(d.requests) AS requests, SUM(d.tokens) AS tokens "
        "FROM usage_daily d JOIN users u ON u.id = d.user_id "
        "WHERE (:user_id IS NULL OR d.user_id = :user_id) "
        "AND (:date_from IS NULL OR d.day >= :date_from) "
        "AND (:date_to IS NULL OR d.day <= :date_to) "
        "GROUP BY d.day, d.user_id, u.username "
        "ORDER BY d.day DESC, u.username"
    )
    rows = conn.execute(
        sql, {"user_id": user_id, "date_from": date_from, "date_to": date_to}
    ).fetchall()
    return [
        {
            "day": r["day"],
            "user_id": r["user_id"],
            "username": r["username"],
            "requests": r["requests"],
            "tokens": r["tokens"],
        }
        for r in rows
    ]


@router.get("/overview")
def overview(
    admin: AdminUser,
    conn: DatabaseDep,
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    """全站配额条数据（design-iter-8 §1.2：统一 key 当日消耗 / 总量，前端判级渲染）。"""
    return {
        "day": quota.today(),
        "unified_used": quota.site_unified_used(conn),
        "unified_daily_total": settings.unified_daily_total,
    }
