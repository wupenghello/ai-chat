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

from datetime import datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from pydantic.types import StrictBool

from app import quota, telemetry
from app.config import Settings, get_settings
from app.db import DatabaseDep, is_search_enabled, set_search_enabled
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


class AppSettingsBody(BaseModel):
    """PUT /api/admin/settings 请求体（design-iter-14 §6.1 定案形状，逐字对照）。

    search_enabled 必填布尔：缺字段/非布尔 422（StrictBool 拒绝 "false"/1 等隐式转换，
    design §6.1「非布尔 422」逐字）。
    """

    search_enabled: StrictBool


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
        "SUM(d.requests) AS requests, SUM(d.tokens) AS tokens, "
        # CHG-007 REQ-034/025（iter-13 T1）：回合数——turns 列随回合递增；历史行 turns=0 而
        # requests 即历史回合数（1 请求 = 1 回合，定夺⑥不回填），以 COALESCE 折算展示
        "SUM(CASE WHEN d.turns > 0 THEN d.turns ELSE d.requests END) AS turns "
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
        # CHG-007 REQ-025 改写：用量列表口径 = 回合数与 token 数（加法扩展，形状零回退）
        "turns": r["turns"],
    }


@router.put("/settings")
def put_settings(body: AppSettingsBody, admin: AdminUser, conn: DatabaseDep) -> dict[str, bool]:
    """服务端设置写入（design-iter-14 §6.1 定夺⑥：B1 配置面板可扩展复用的独立写端点）。

    联网搜索整体开关（REQ-025 A2 句）：落库运行时生效——PUT 后下一回合生效，无需重启；
    幂等（重复 PUT 同值 200）；key 与开关分离（key = .env 部署配置改需重启，开关 = 落库）。
    """
    set_search_enabled(conn, body.search_enabled)
    return {"search_enabled": body.search_enabled}


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
    iter-14 T2 加法扩展两字段（design-iter-14 §6.1）：search_enabled（KV 落库实值）+
    search_key_configured（只报有无，不泄露 key 内容）。
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
        "search_enabled": is_search_enabled(conn),
        "search_key_configured": bool(settings.search_key),
    }


# ---------- REQ-038（iter-15 T3）：遥测聚合端点（design-iter-15 §5 口径逐字实现） ----------
# 加法扩展：既有六端点 + PUT settings 形状零变化（REQ-038 验收 1）；本端点只读、
# 全机器聚合无手工修正入口（铁律 5）；缺失与未配置不估算不造数（NULL→null、cost_* null）。

def _price_configured(settings: Settings) -> bool:
    """单价三变量全已配置且非负（design-iter-15 §5：元/1M tokens 非负小数；
    任一缺失/非法 → configured=false → 成本不估算并提示）。"""
    prices = (settings.price_input, settings.price_output, settings.price_cache_hit)
    return all(p is not None and p >= 0 for p in prices)


@router.get("/telemetry")
def telemetry_view(
    admin: AdminUser,
    conn: DatabaseDep,
    settings: Annotated[Settings, Depends(get_settings)],
    days: int = Query(default=7, ge=1, le=90),
) -> dict[str, object]:
    """遥测聚合视图（CHG-009 REQ-038；design-iter-15 §5 定案形状逐字）。

    - 时间窗 = 截至服务器本地今日（quota.today 口径，与 usage_daily.day/telemetry.day 同源）
      的近 N 个自然日；days 整数 1~90 默认 7，越界/非整数 422
    - 门禁 get_admin_user（与既有六端点同一依赖）：非 admin → 403，响应体零遥测字段
    - 成本 = Σtokens×单价÷1e6 三项分项，仅 mode='unified' llm 行（定夺⑥）；
      单价未配置 → price.configured=false 且全部 cost_* 为 null（tokens 如实）
    - cache_rate = Σhit/(Σhit+Σmiss)，日级仅计带缓存字段行（定夺⑤部分缺失口径）；
      整天无带字段行 → cache_* 与 cache_rate 为 null（前端显「缺失」，永不显 0）
    - daily 仅列有数据日（缺失时段由前端以窗口天数比对判定）；
      tools = GROUP BY tool_name,status，排序固定 tool_name ASC, status ASC（确定性）
    """
    date_to = quota.today()
    date_from = (datetime.now() - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    window = (date_from, date_to)

    llm_rows = conn.execute(
        "SELECT day, mode, tokens_prompt, tokens_completion, tokens_total, "
        "cache_hit_tokens, cache_miss_tokens FROM telemetry "
        "WHERE kind = 'llm' AND day >= ? AND day <= ?",
        window,
    ).fetchall()
    tool_rows = conn.execute(
        "SELECT day, tool_name, status, latency_ms FROM telemetry "
        "WHERE kind = 'tool' AND day >= ? AND day <= ?",
        window,
    ).fetchall()

    # 按日聚合：llm 行供成本/命中率，tool 行仅贡献「有数据日」（零 llm 行的工具日亦列出）
    acc: dict[str, dict] = {}

    def _day(day: str) -> dict:
        return acc.setdefault(day, {
            "prompt": 0, "completion": 0, "self": 0,
            "hit": 0, "miss": 0, "has_cache": False,       # 显示口径：全模式带字段行
            "cost_hit": 0,                                   # 成本口径：仅 unified 带字段行
        })

    for r in llm_rows:
        d = _day(r["day"])
        if r["mode"] == quota.MODE_UNIFIED:
            d["prompt"] += r["tokens_prompt"] or 0
            d["completion"] += r["tokens_completion"] or 0
            if r["cache_hit_tokens"] is not None:
                d["cost_hit"] += r["cache_hit_tokens"]
        else:
            d["self"] += r["tokens_total"] or 0
        if r["cache_hit_tokens"] is not None:
            d["hit"] += r["cache_hit_tokens"]
            d["miss"] += r["cache_miss_tokens"] or 0
            d["has_cache"] = True
    for r in tool_rows:
        _day(r["day"])

    configured = _price_configured(settings)
    pin, pout, phit = settings.price_input, settings.price_output, settings.price_cache_hit

    def _cost6(prompt: int, completion: int, cost_hit: int) -> dict:
        """成本三分项 + 合计（后端保留 6 位小数；单价未配置 → 全 null，tokens 不受影响）。"""
        if not configured:
            return {"input": None, "output": None, "cache_hit": None, "total": None}
        ci = round(prompt * pin / 1_000_000, 6)
        co = round(completion * pout / 1_000_000, 6)
        cc = round(cost_hit * phit / 1_000_000, 6)
        return {"input": ci, "output": co, "cache_hit": cc, "total": round(ci + co + cc, 6)}

    daily = []
    for day in sorted(acc, reverse=True):
        d = acc[day]
        cost = _cost6(d["prompt"], d["completion"], d["cost_hit"])
        if d["has_cache"]:
            denom = d["hit"] + d["miss"]
            rate = round(d["hit"] / denom, 6) if denom > 0 else 0.0
            hit, miss = d["hit"], d["miss"]
        else:  # 整天无带字段行 → null（前端显「缺失」，永不显 0；铁律 5）
            rate, hit, miss = None, None, None
        daily.append({
            "day": day,
            "tokens_prompt": d["prompt"],
            "tokens_completion": d["completion"],
            "cache_hit_tokens": hit,
            "cache_miss_tokens": miss,
            "cache_rate": rate,
            "cost_total": cost["total"],
            "self_tokens_total": d["self"],
        })

    t = acc.get(date_to)
    cost = _cost6(*(t["prompt"], t["completion"], t["cost_hit"]) if t else (0, 0, 0))
    if t is None:
        # 今日零遥测行：tokens 真值 0（无调用即无 tokens/无命中，非造数）；缓存列同显 0
        today_cost: dict[str, object] = {"cache_hit_tokens": 0}
    else:
        # 今日有行但整天无带字段行 → null（与 daily 缺失口径一致，永不显 0）
        today_cost = {"cache_hit_tokens": t["hit"] if t["has_cache"] else None}
    today_cost.update({
        "day": date_to,
        "tokens_prompt": t["prompt"] if t else 0,
        "tokens_completion": t["completion"] if t else 0,
        "cost_input": cost["input"],
        "cost_output": cost["output"],
        "cost_cache_hit": cost["cache_hit"],
        "cost_total": cost["total"],
        "self_tokens_total": t["self"] if t else 0,
    })

    tools_acc: dict[tuple[str, str], list[int]] = {}
    for r in tool_rows:
        item = tools_acc.setdefault((r["tool_name"], r["status"]), [0, 0])
        item[0] += 1
        item[1] += r["latency_ms"]
    tools = [
        {"tool_name": name, "status": st, "count": n, "avg_duration_ms": round(total / n)}
        for (name, st), (n, total) in sorted(tools_acc.items())
    ]

    return {
        "window": {"days": days, "date_from": date_from, "date_to": date_to},
        "price": {
            "configured": configured,
            "input_per_mtok": settings.price_input,
            "output_per_mtok": settings.price_output,
            "cache_hit_per_mtok": settings.price_cache_hit,
        },
        "today_cost": today_cost,
        "daily": daily,
        "tools": tools,
        "retention_days": telemetry.RETENTION_DAYS,
    }
