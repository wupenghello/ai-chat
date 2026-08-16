"""管理后台 API（REQ-025，iter-8 T2；REQ-029 iter-12 T1 体验重构）：
用户治理 / 配额覆盖 / 用量统计 / 概览统计。

- 管理员标记：首个注册用户自动成为管理员（register 引导 + 迁移 v5 存量补标）
- 门禁：非管理员一律 403——入口隐藏只是 UI 层，接口 403 才是安全边界（设计定夺③）
- 配额覆盖：按用户固定日限（双模式统一生效）；NULL = 恢复默认档（档位联动，设计定夺①）
- 分页/搜索/排序（design-iter-12 §4，定夺①②③⑥）：默认响应形状零变化（不传新参数 =
  纯列表全量，既有消费方与 test_admin 19 用例零感知）；传任一新参数才返回分页信封；
  越界由服务端钳制到最后一页并返回真实 total；排序迁后端（分页后客户端排序跨页语义错误）
- 统计口径（design-iter-12 §4.3，定夺④）：今日 = 服务器本地自然日（usage_daily.day 先例）；
  请求/token 为全模式当日合计，无记录即 0，不估算补齐（铁律 5）
"""

from typing import Annotated, Literal

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


def _page_params(limit: int | None, offset: int | None) -> tuple[int, int]:
    """生效分页参数（design-iter-12 定夺③：默认 20/页，不做页大小切换）。"""
    return (limit if limit is not None else 20, offset if offset is not None else 0)


def _clamp_offset(total: int, limit: int, offset: int) -> int:
    """越界钳制到最后一页（design-iter-12 定夺②）；total=0 → 空页 offset 0。"""
    if total == 0:
        return 0
    if offset < total:
        return offset
    return (total - 1) // limit * limit


@router.get("/users")
def list_users(
    admin: AdminUser,
    conn: DatabaseDep,
    settings: Annotated[Settings, Depends(get_settings)],
    search: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=100),
    offset: int | None = Query(default=None, ge=0),
) -> list[dict] | dict:
    """用户列表：注册时间 / 状态 / 密钥模式 / 配额档位与当日用量（design-iter-8 §1.2 六列）。

    REQ-029（design-iter-12 §4.1，定夺①②③）：search 子串大小写不敏感（%/_ 转义字面量，
    trim 后空串 = 不筛选）；不传 search/limit/offset 任一参数 → 纯列表全量（形状零变化），
    传任一参数 → {items, total, limit, offset} 信封，越界钳制到最后一页。
    """
    day = quota.today()
    where, params = "", []
    if search is not None and search.strip():
        # SQLite LIKE 对 ASCII 天然大小写不敏感；ESCAPE 使 %/_ 按字面量匹配
        esc = (
            search.strip()
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        )
        where = "WHERE u.username LIKE ? ESCAPE '\\'"
        params.append(f"%{esc}%")
    sql = f"""
        SELECT u.id, u.username, u.is_admin, u.banned, u.created_at, u.quota_override,
               EXISTS(SELECT 1 FROM profiles p WHERE p.user_id = u.id AND p.is_active = 1)
                   AS mode_self,
               COALESCE((SELECT SUM(d.requests) FROM usage_daily d
                         WHERE d.user_id = u.id AND d.day = ?), 0) AS used_today
        FROM users u
        {where}
        ORDER BY u.created_at, u.id
    """
    if search is None and limit is None and offset is None:
        rows = conn.execute(sql, (day, *params)).fetchall()
        return [_user_row(conn, r, day, settings) for r in rows]
    eff_limit, req_offset = _page_params(limit, offset)
    total = conn.execute(
        f"SELECT COUNT(*) AS n FROM users u {where}", params
    ).fetchone()["n"]
    eff_offset = _clamp_offset(total, eff_limit, req_offset)
    rows = conn.execute(
        sql + " LIMIT ? OFFSET ?",
        (day, *params, eff_limit, eff_offset),
    ).fetchall()
    return {
        "items": [_user_row(conn, r, day, settings) for r in rows],
        "total": total,
        "limit": eff_limit,
        "offset": eff_offset,
    }


def _user_row(conn, r, day: str, settings: Settings) -> dict:
    mode = quota.MODE_SELF if r["mode_self"] else quota.MODE_UNIFIED
    return {
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
    sort_key: Literal["day", "requests", "tokens"] | None = Query(default=None),
    sort_dir: Literal["asc", "desc"] | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=100),
    offset: int | None = Query(default=None, ge=0),
) -> list[dict] | dict:
    """按用户按日用量（mode 合并聚合；过滤：用户 + 日期范围）。

    REQ-029（design-iter-12 §4.2，定夺①②③⑥）：排序迁后端（分页后客户端排序仅作用当页，
    跨页语义错误）——sort_key（day|requests|tokens，默认 day）/ sort_dir（asc|desc，默认 desc），
    tie-break 固定 username 升序保证翻页不重不漏；仅既有三过滤参数出现 = 纯列表 + 现状默认序；
    传任一新参数 → 信封含 distinct_days（窗口内去重天数，缺失时段「不估算补齐」标注的数据源，
    全窗口判定不受分页影响）。
    """
    base = (
        "SELECT d.day, d.user_id, u.username, "
        "SUM(d.requests) AS requests, SUM(d.tokens) AS tokens "
        "FROM usage_daily d JOIN users u ON u.id = d.user_id "
        "WHERE (:user_id IS NULL OR d.user_id = :user_id) "
        "AND (:date_from IS NULL OR d.day >= :date_from) "
        "AND (:date_to IS NULL OR d.day <= :date_to) "
        "GROUP BY d.day, d.user_id, u.username"
    )
    filt = {"user_id": user_id, "date_from": date_from, "date_to": date_to}
    if sort_key is None and sort_dir is None and limit is None and offset is None:
        rows = conn.execute(base + " ORDER BY d.day DESC, u.username", filt).fetchall()
        return [_usage_row(r) for r in rows]
    key, direction = sort_key or "day", (sort_dir or "desc").upper()
    eff_limit, req_offset = _page_params(limit, offset)
    total = conn.execute(f"SELECT COUNT(*) AS n FROM ({base})", filt).fetchone()["n"]
    distinct_days = conn.execute(
        "SELECT COUNT(DISTINCT d.day) AS n FROM usage_daily d "
        "WHERE (:user_id IS NULL OR d.user_id = :user_id) "
        "AND (:date_from IS NULL OR d.day >= :date_from) "
        "AND (:date_to IS NULL OR d.day <= :date_to)",
        filt,
    ).fetchone()["n"]
    eff_offset = _clamp_offset(total, eff_limit, req_offset)
    rows = conn.execute(
        base + f" ORDER BY {key} {direction}, u.username LIMIT :limit OFFSET :offset",
        {**filt, "limit": eff_limit, "offset": eff_offset},
    ).fetchall()
    return {
        "items": [_usage_row(r) for r in rows],
        "total": total,
        "limit": eff_limit,
        "offset": eff_offset,
        "distinct_days": distinct_days,
    }


def _usage_row(r) -> dict:
    return {
        "day": r["day"],
        "user_id": r["user_id"],
        "username": r["username"],
        "requests": r["requests"],
        "tokens": r["tokens"],
    }


@router.get("/overview")
def overview(
    admin: AdminUser,
    conn: DatabaseDep,
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    """概览统计（design-iter-8 §1.2 全站配额条 → design-iter-12 §4.3 统计卡四指标）。

    既有三字段零变化（全站配额条口径）；REQ-029 加法扩展三字段——今日 = 服务器本地自然日
    （usage_daily.day 同源；流跨零点 token 归请求日由 quota.record_tokens 保证）；
    请求/token 为全模式当日合计；总用户含已封禁与管理员；无记录即 0，不估算补齐（铁律 5）。
    """
    day = quota.today()
    used = conn.execute(
        "SELECT COALESCE(SUM(requests), 0) AS req, COALESCE(SUM(tokens), 0) AS tok "
        "FROM usage_daily WHERE day = ?",
        (day,),
    ).fetchone()
    total_users = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
    return {
        "day": day,
        "unified_used": quota.site_unified_used(conn),
        "unified_daily_total": settings.unified_daily_total,
        "total_users": total_users,
        "today_requests": int(used["req"]),
        "today_tokens": int(used["tok"]),
    }
