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
import uuid
from collections.abc import AsyncIterator
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app import agent, compress, quota, telemetry
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


async def _assemble_pipeline(
    *,
    conn,
    db_path: str,
    http: httpx.AsyncClient,
    doc: dict[str, Any],
    history: list[dict[str, Any]],
    message: str,
    system_prompt: str | None,
    user_id: int,
    session_id: str,
    day: str,
    mode: str,
    base_url: str,
    api_key: str,
    model: str,
    turn_id: str,
    settings: Settings,
) -> tuple[list[dict[str, Any]], int]:
    """三级压缩管道（CHG-010/REQ-039，iter-16 T2），组装阶段执行。

    返回 (组装 messages, 摘要调用 tokens)。一级 snip 已由调用方对 history 执行；
    本函数承载三级阈值判定 + 二级 compact 注入。降级方向恒为基线 v6 组装
    （20 轮窗口 + snip），回合不阻塞、用户无感（REQ-039 异常分支）。
    """

    def baseline() -> list[dict[str, Any]]:
        return agent.assemble_context(
            history, message, system_prompt,
            product_persona=settings.product_persona,
        )

    # 三级阈值判定：该会话上一回合 step=1 telemetry tokens_prompt 机器实测值
    last_tokens = compress.last_turn_prompt_tokens(conn, user_id, session_id)
    if last_tokens is None or last_tokens <= settings.compact_threshold:
        return baseline(), 0  # 未超阈值 / 无记录（保守不造数）→ 基线 v6 零回退

    plan = compress.plan_compact(doc, message, settings.compact_recent_turns)
    if plan is None:
        return baseline(), 0  # 无可压缩中段（总轮数 ≤ R）→ 跳过 compact
    mid, watermark = plan

    def compact_with(summary_text: str) -> list[dict[str, Any]]:
        return compress.assemble_compact(
            history, message, system_prompt, compress.wrap_summary(summary_text),
            max_turns=settings.compact_recent_turns,
            product_persona=settings.product_persona,
        )

    # 超阈值且有有效摘要（水位消息仍在当前 messages）→ 直接注入（零摘要调用）
    existing = compress.load_summary(conn, user_id, session_id)
    if existing is not None and compress.watermark_valid(doc, existing["watermark_msg_id"]):
        return compact_with(existing["summary"]), 0

    # 超阈值且无有效摘要 → 执行摘要调用（非流式、独立超时护栏、跟随回合当前模式）
    outcome = await compress.call_summary(
        http, base_url, api_key, model, compress.render_transcript(mid),
        settings.summary_timeout,
    )
    # compress 行（机器采集，铁律 5）：turn 端点自动回合关联、tokens_after=NULL 待 T3 懒回填
    telemetry.record_compress(
        db_path, day=day, user_id=user_id, mode=mode, turn_id=turn_id,
        endpoint="turn", model=model, latency_ms=outcome.latency_ms,
        status=outcome.status, usage=outcome.usage, error_code=outcome.error_code,
        tokens_before=last_tokens, tokens_after=None, session_id=session_id,
    )
    if outcome.status != "ok":
        # 失败降级：error/timeout/空摘要/4xx/5xx → 回退不压缩组装（回合正常完成）
        logger.warning("compact summary degraded status=%s session_id=%s",
                       outcome.status, session_id)
        return baseline(), 0

    compress.save_summary(conn, user_id, session_id, outcome.text, watermark, model)
    return compact_with(outcome.text), outcome.tokens_total


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

    # CHG-010/REQ-039（iter-16 T2）三级压缩管道（组装阶段，run_turn 收到的 messages 为产物）：
    # 一级 snip 每次组装无条件执行（wire 层确定性裁剪，不触库）→ 三级阈值判定 → 二级 compact
    turn_id = uuid.uuid4().hex[:12]
    history = compress.snip_tool_results(
        doc, agent.wire_messages_from_doc(doc), settings.snip_keep_recent_tools)
    messages, summary_tokens = await _assemble_pipeline(
        conn=conn, db_path=request.app.state.db_path, http=request.app.state.http,
        doc=doc, history=history, message=body.message,
        system_prompt=body.system_prompt or None,
        user_id=user.id, session_id=body.session_id, day=day, mode=mode,
        base_url=base_url, api_key=api_key, model=model, turn_id=turn_id,
        settings=settings,
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
        # 写入面自身吞 sqlite 异常（主路径隔离），此处仅补公共维度字段。
        # CHG-010（iter-16 T2）：session_id 会话关联列（迁移 v9 加法列）——llm 行携带，
        # 供三级阈值判定读「该会话上一回合 step=1 tokens_prompt」（REQ-039）
        common = {"day": day, "user_id": user.id, "mode": mode,
                  "turn_id": row.get("turn_id"), "endpoint": "turn",
                  "session_id": body.session_id}
        if row["kind"] == "llm":
            telemetry.record_llm(
                request.app.state.db_path, **common,
                step=row["step"], model=row["model"], latency_ms=row["latency_ms"],
                status=row["status"], usage=row.get("usage"), error_code=row.get("error_code"),
            )
            # CHG-010/REQ-041（iter-16 T3）tokens_after 懒回填：该会话 step=1 上游调用
            # usage 到达 → 独立短连接回填待测 compress 行（失败不阻塞、不补造——usage
            # 无 prompt_tokens 记分行则不回填，铁律 5）
            if row["step"] == 1:
                prompt_tokens = (row.get("usage") or {}).get("prompt_tokens")
                if isinstance(prompt_tokens, (int, float)):
                    telemetry.backfill_tokens_after(
                        request.app.state.db_path, user_id=user.id,
                        session_id=body.session_id, tokens_after=int(prompt_tokens),
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

    # 进行中回合登记（REQ-040 409 判定的服务端唯一权威，design-iter-16 §2.3 定夺④）：
    # 受理置位，流终态（正常耗尽/断连关闭生成器）finally 清除
    generating: set = request.app.state.generating_sessions
    gen_key = (user.id, body.session_id)
    generating.add(gen_key)

    async def stream() -> AsyncIterator[bytes]:
        try:
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
                summary_tokens=summary_tokens,
                turn_id=turn_id,
                on_finish=record_usage,
                telemetry_sink=telemetry_sink,
            ):
                yield ("data: " + json.dumps(ev, ensure_ascii=False) + "\n\n").encode()
        finally:
            generating.discard(gen_key)

    return StreamingResponse(stream(), media_type="text/event-stream")


class CompactRequest(BaseModel):
    """手动压缩请求体（design-iter-16 §5.1 定案）：body 仅 session_id 一字段。"""
    session_id: str = Field(min_length=1, max_length=64)


@router.post("/chat/compact")
async def chat_compact(
    body: CompactRequest,
    user: CurrentUser,
    request: Request,
    conn: DatabaseDep,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    """手动压缩（CHG-010 REQ-040，iter-16 T3；design-iter-16 §5.1 四语义逐字定案）。

    同步执行完整管道（全量 compact，不受阈值判定约束；一级 snip 为组装层无状态变换，
    下一回合组装照常执行，管道口径天然含摄）。**不计回合**（定夺⑧）：quota.py 零调用、
    usage_daily 零写入，摘要 tokens 仅落 telemetry compress 行（endpoint='compact'、
    turn_id=NULL、tokens_after=NULL 待该会话下一次 step=1 usage 懒回填）。
    detail 形状 {code, message} 沿 sessions.py 409 session_schema_conflict 先例。
    失败/超时：context_summary 零变化（原摘要仍有效则保留）、会话档任何分支零写入。
    """
    row = conn.execute(
        "SELECT data FROM chat_sessions WHERE user_id = ? AND id = ?",
        (user.id, body.session_id),
    ).fetchone()
    if row is None:  # 不存在或属他人一律 404（不泄露归属，REQ-040 验收 4）
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={
            "code": "session_not_found", "message": "会话不存在"})

    # 409 服务端唯一判定（定夺④）：该会话有进行中回合即拒——多设备竞态唯一权威
    if (user.id, body.session_id) in request.app.state.generating_sessions:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={
            "code": "session_generating",
            "message": "该会话正在生成回复，暂不能压缩，请等生成完成后再试"})

    try:
        doc = json.loads(row["data"])
        if not isinstance(doc, dict) or not isinstance(doc.get("messages"), list):
            raise ValueError("session doc unreadable")
    except (json.JSONDecodeError, ValueError, TypeError):
        # corrupted 双保险（前端菜单已禁用；turn 端点容错空历史，本端点拒绝）
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={
            "code": "session_uncompactable", "message": "无法读取的会话不可压缩"}) from None

    # 不受阈值约束直接规划中段；总轮数 ≤ R → 无需压缩（零上游调用、零计费）
    plan = compress.plan_compact(doc, "", settings.compact_recent_turns, incoming=False)
    if plan is None:
        return JSONResponse({"status": "skipped", "reason": "too_short"})
    mid, watermark = plan

    tokens_before = compress.last_turn_prompt_tokens(conn, user.id, body.session_id)
    profile, base_url, api_key, model = _resolve_upstream(conn, user, settings)
    mode = quota.MODE_SELF if profile is not None else quota.MODE_UNIFIED
    day = quota.today()
    if not api_key:
        # 统一 key 未配置且无生效档案 → 摘要调用不可执行，归失败分支如实记行（铁律 5）
        telemetry.record_compress(
            request.app.state.db_path, day=day, user_id=user.id, mode=quota.MODE_UNIFIED,
            turn_id=None, endpoint="compact", model="", latency_ms=0, status="error",
            error_code="summary_error", tokens_before=tokens_before, tokens_after=None,
            session_id=body.session_id,
        )
        logger.warning("compact refused: upstream key missing user_id=%s session_id=%s",
                       user.id, body.session_id)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail={
            "code": "compact_failed", "message": "压缩失败，请稍后再试"})

    outcome = await compress.call_summary(
        request.app.state.http, base_url, api_key, model,
        compress.render_transcript(mid), settings.summary_timeout,
    )
    telemetry.record_compress(
        request.app.state.db_path, day=day, user_id=user.id, mode=mode,
        turn_id=None, endpoint="compact", model=model, latency_ms=outcome.latency_ms,
        status=outcome.status, usage=outcome.usage, error_code=outcome.error_code,
        tokens_before=tokens_before, tokens_after=None, session_id=body.session_id,
    )
    if outcome.status != "ok":
        # 502/504 共用 code 与 message——用户侧失败 toast 恒为一句（C7），
        # 子类区分归 warning 日志与 compress 行 status/error_code
        logger.warning("manual compact failed status=%s session_id=%s",
                       outcome.status, body.session_id)
        code = (status.HTTP_504_GATEWAY_TIMEOUT if outcome.status == "timeout"
                else status.HTTP_502_BAD_GATEWAY)
        raise HTTPException(code, detail={
            "code": "compact_failed", "message": "压缩失败，请稍后再试"})

    compress.save_summary(conn, user.id, body.session_id, outcome.text, watermark, model)
    # tokens_before 对新会话/无遥测记录会话为 NULL（不估算）；前端不呈现该值（设计定夺③）
    return JSONResponse({"status": "compacted", "tokens_before": tokens_before})


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
