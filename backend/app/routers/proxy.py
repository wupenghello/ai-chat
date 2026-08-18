"""对话入口（回合端点，CHG-007/CHG-009）：POST /api/chat/turn 为唯一对话入口。

- 定夺④（CHG-009，iter-15 T2）：旧透传端点 POST /api/chat/completions 已随 B1 下线删除，
  回合端点成为唯一对话入口；本文件原「流式代理（REQ-023）」透传层随之退役。
  下线序列与取证（legacy 行流量取证 → 端点删除 404 → test_proxy 16 例退役映射 →
  proxy_smoke 迁 turn）留档 plans/iter-15-verify.md T2 段。
- 模式路由（REQ-018）：每回合规该用户当前生效档案——有 = 自填模式（档案三要素），
  无 = 统一 key 模式（.env 三变量，design-iter-7 定夺①）。
- 密钥安全：发往上游的请求头全新构造（绝不透传 Cookie），任何响应/日志不含 key。
"""

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app import agent, quota, telemetry
from app.config import Settings, get_settings
from app.db import DatabaseDep, is_search_enabled
from app.routers.auth import CurrentUser
from app.tools import tools_for_user

router = APIRouter(prefix="/api", tags=["chat"])

logger = logging.getLogger("ai-chat.quota")


class TurnRequest(BaseModel):
    """回合端点请求体（CHG-007 REQ-033 / design-iter-13 §4.2）：无历史数组。

    system_prompt 为可选第三字段（REQ-008 的全局系统提示词存前端 localStorage，
    服务端组装需随回合上传——design-iter-13 基线后补注，随 verify 文档登记）。
    """
    session_id: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=32768)
    system_prompt: str | None = Field(default=None, max_length=8000)


def _resolve_upstream(
    conn, user, settings: Settings
) -> tuple[object | None, str, str, str] | None:
    """双模式上游解析（REQ-018）：返回 (profile_row | None, base_url, api_key, model)。

    profile_row 非 None = 自填模式（含 tools_enabled，回合端点判定工具可用性）；
    返回 None = 统一 key 未配置（调用方回 503 unified_key_missing）。
    """
    profile = conn.execute(
        "SELECT base_url, model, api_key, tools_enabled FROM profiles"
        " WHERE user_id = ? AND is_active = 1",
        (user.id,),
    ).fetchone()
    if profile is not None:  # 自填模式：当前生效档案三要素（REQ-018）
        return profile, profile["base_url"], profile["api_key"], profile["model"]
    if settings.unified_key:  # 统一 key 模式：.env 三变量（零配置）
        return None, settings.unified_base_url, settings.unified_key, settings.unified_model
    return None, "", "", ""


def _error(
    status: int, code: str, message: str, upstream_status: int | None = None
) -> JSONResponse:
    body: dict[str, object] = {"detail": message, "code": code}
    if upstream_status is not None:
        body["upstream_status"] = upstream_status
    return JSONResponse(body, status_code=status)


@router.post("/chat/turn")
async def chat_turn(
    body: TurnRequest,
    user: CurrentUser,
    request: Request,
    conn: DatabaseDep,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    """回合端点（CHG-007 REQ-030~034，iter-13 T1，design-iter-13 定夺⑦：独立端点）。

    服务端组装上下文（自库取会话消息归一化，无历史数组上传）→ ReAct 循环 → SSE v2 事件流。
    配额按回合：回合受理即计（429 时零上游调用、零事件流，JSON 直返——design-iter-13 §4.2）。
    """
    row = conn.execute(
        "SELECT data FROM chat_sessions WHERE user_id = ? AND id = ?",
        (user.id, body.session_id),
    ).fetchone()
    if row is None:
        return _error(404, "session_not_found", "会话不存在或已删除")

    resolved = _resolve_upstream(conn, user, settings)
    if resolved is None or (resolved[0] is None and not resolved[2]):
        return _error(503, "unified_key_missing", "服务端未配置统一密钥，请联系管理员")
    profile, base_url, api_key, model = resolved

    mode = quota.MODE_SELF if profile is not None else quota.MODE_UNIFIED
    day, blocked = quota.check_and_consume(conn, user.id, mode, settings)
    if blocked is not None:
        status_code, code, detail = blocked
        # 配额拦截取证标记沿 REQ-024 既有口径「chat blocked」（iter-8 定稿；定夺④下线后
        # 回合端点为唯一对话入口，标记统一承继——test_quota 零改动复跑的断言面）
        logger.info("chat blocked user_id=%s mode=%s code=%s", user.id, mode, code)
        return _error(status_code, code, detail)

    try:
        doc = json.loads(row["data"])
        if not isinstance(doc, dict):
            raise ValueError("session doc not an object")
    except (json.JSONDecodeError, ValueError):
        doc = {"messages": []}  # 沿现有「无法读取」容错口径，空历史参与组装
    history = agent.wire_messages_from_doc(doc)
    # CHG-009/REQ-036（iter-15 T2）：两段式分区——system[0] 静态前缀（产品人设，
    # .env 注入，跨请求字节恒定）+ system[1] 动态尾区；人设留空回退基线 v5 单 system 形态
    messages = agent.assemble_context(
        history, body.message, body.system_prompt or None,
        product_persona=settings.product_persona,
    )

    # 工具可用性（design-iter-14 §6.2/§6.3）：自填档案「支持工具」开关（定夺①，默认开；
    # 统一 key 恒开）× admin 联网搜索总开关（KV 落库，回合受理时实时读——PUT 后下一回合
    # 生效）× key 已配置（缺失时开关状态可存但 search 不注册，§6.1）。
    # admin 关闭或 key 缺失 → search 不进下发 → 上游 tools 定义不含 search（模型不知其存在）。
    tools_allowed = profile is None or bool(profile["tools_enabled"])
    tool_defs = tools_for_user(
        is_admin=user.is_admin,
        gates={"search": is_search_enabled(conn) and bool(settings.search_key)},
    ) if tools_allowed else []

    def record_usage(calls: int, tokens: int) -> None:
        # 回合结束/断连后落账 tokens（定夺⑧：已抵上游则回合已计，tokens 记已发生部分）
        quota.record_tokens(request.app.state.db_path, user.id, mode, tokens, day)

    def telemetry_sink(row: dict[str, Any]) -> None:
        # CHG-009/REQ-037（iter-15 T2）：请求级遥测落库——turn 端点 llm/tool 行（turn_id 关联）；
        # 写入面自身吞 sqlite 异常（主路径隔离），此处仅补公共维度字段
        common = {"day": day, "user_id": user.id, "mode": mode,
                  "turn_id": row.get("turn_id"), "endpoint": "turn"}
        if row["kind"] == "llm":
            telemetry.record_llm(
                request.app.state.db_path, **common,
                step=row["step"], model=row["model"], latency_ms=row["latency_ms"],
                status=row["status"], usage=row.get("usage"), error_code=row.get("error_code"),
            )
        else:
            telemetry.record_tool(
                request.app.state.db_path, **common,
                step=row["step"], tool_name=row["tool_name"],
                latency_ms=row["latency_ms"], status=row["status"],
            )

    upstream: httpx.AsyncClient = request.app.state.http
    logger.info("turn accepted user_id=%s mode=%s session_id=%s tools=%s",
                user.id, mode, body.session_id, len(tool_defs))

    async def stream() -> AsyncIterator[bytes]:
        async for ev in agent.run_turn(
            client=upstream,
            base_url=base_url,
            api_key=api_key,
            model=model,
            session_id=body.session_id,
            messages=messages,
            tool_defs=tool_defs,
            max_steps=settings.agent_max_steps,
            step_timeout=settings.agent_step_timeout,
            tool_result_limit=settings.tool_result_limit,
            on_finish=record_usage,
            telemetry_sink=telemetry_sink,
        ):
            yield ("data: " + json.dumps(ev, ensure_ascii=False) + "\n\n").encode()

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.get("/quota")
def read_quota(
    user: CurrentUser,
    conn: DatabaseDep,
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    """当前用户配额口径（REQ-024/014 联动：KeyModeCard「每日 — 次」占位参数化，前端 T2 接入）。"""
    profile = conn.execute(
        "SELECT 1 FROM profiles WHERE user_id = ? AND is_active = 1", (user.id,)
    ).fetchone()
    mode = quota.MODE_SELF if profile is not None else quota.MODE_UNIFIED
    return {
        "mode": mode,
        "daily_limit": quota.limit_for(conn, user.id, mode, settings),
        "used_today": quota.user_used(conn, user.id),
        "reset_at": "明日 00:00",
    }


@router.get("/dev/sse-echo")
async def sse_echo(
    user: CurrentUser,
    text: str = Query(default="ping", max_length=64),
    chunks: int = Query(default=5, ge=1, le=20),
) -> StreamingResponse:
    """SSE 技术形态验证端点（iter-6 风险 2 应对，保留至 iter-8 部署收口按环境裁剪）。"""

    async def stream() -> AsyncIterator[str]:
        for i in range(chunks):
            yield f"data: {text} #{i + 1}\n\n"
            await asyncio.sleep(0.05)

    return StreamingResponse(stream(), media_type="text/event-stream")
