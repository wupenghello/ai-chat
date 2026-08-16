"""流式代理（REQ-023，iter-7 T1/T2）：OpenAI 兼容 chat completions 经服务端转发。

- 模式路由（T2 起，REQ-018）：每请求读该用户当前生效档案——有 = 自填模式（档案三要素
  转发），无 = 统一 key 模式（.env 三变量，design-iter-7 定夺①）；「当前生效」在请求开始时
  读取，生成中切换档案天然「当前回复旧配置跑完、下一次请求生效」（CHG-002）
- 错误映射文案 = design-iter-7 §3.1 定稿；上游 401/403 映射为 502
  （避免与 Cookie 会话失效的 401 混淆触发前端跳登录）
- 上游流中断：向流末尾补 upstream_interrupted 帧，前端转「生成中断」标注（REQ-001/003）
- 密钥安全：发往上游的请求头全新构造（绝不透传 Cookie），任何响应/日志不含 key
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from app import quota
from app.config import Settings, get_settings
from app.db import DatabaseDep
from app.routers.auth import CurrentUser

router = APIRouter(prefix="/api", tags=["chat"])

logger = logging.getLogger("ai-chat.quota")

_INTERRUPTED_FRAME = b'data: {"upstream_interrupted": true}\n\n'


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatCompletionRequest(BaseModel):
    messages: list[ChatMessage]
    stream: bool = True  # 本端点只支持流式（spec 主流程）；字段保留兼容显式 stream=true


def _error(
    status: int, code: str, message: str, upstream_status: int | None = None
) -> JSONResponse:
    body: dict[str, object] = {"detail": message, "code": code}
    if upstream_status is not None:
        body["upstream_status"] = upstream_status
    return JSONResponse(body, status_code=status)


@router.post("/chat/completions")
async def chat_completions(
    body: ChatCompletionRequest,
    user: CurrentUser,
    request: Request,
    conn: DatabaseDep,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    # REQ-024（iter-8 T1）配额检查位：按用户当前密钥模式档位校验，不足时在此直接拒绝（不调用上游）；
    # 档位联动口径见 app/quota.py（同日总消耗对当前档位限额判定）
    profile = conn.execute(
        "SELECT base_url, model, api_key FROM profiles WHERE user_id = ? AND is_active = 1",
        (user.id,),
    ).fetchone()
    if profile is not None:  # 自填模式：当前生效档案三要素（REQ-018）
        base_url = profile["base_url"]
        api_key = profile["api_key"]
        model = profile["model"]
    elif settings.unified_key:  # 统一 key 模式：.env 三变量（零配置）
        base_url = settings.unified_base_url
        api_key = settings.unified_key
        model = settings.unified_model
    else:
        return _error(503, "unified_key_missing", "服务端未配置统一密钥，请联系管理员")

    mode = quota.MODE_SELF if profile is not None else quota.MODE_UNIFIED
    blocked = quota.check_and_consume(conn, user.id, mode, settings)
    if blocked is not None:
        # REQ-024 验收取证：被拦截请求未抵达上游（服务端日志可观测）
        status_code, code, detail = blocked
        logger.info("chat blocked user_id=%s mode=%s code=%s", user.id, mode, code)
        return _error(status_code, code, detail)

    upstream: httpx.AsyncClient = request.app.state.http
    payload = {
        "model": model,
        "messages": [m.model_dump() for m in body.messages],
        "stream": True,
        # usage 帧请上游压轴下发（OpenAI 兼容），token 用量据此落库（REQ-025 统计口径）
        "stream_options": {"include_usage": True},
    }
    try:
        resp = await upstream.send(
            upstream.build_request(
                "POST",
                f"{base_url}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}", "Accept": "text/event-stream"},
            ),
            stream=True,
        )
    except httpx.TimeoutException:
        return _error(504, "upstream_timeout", "请求超时，请稍后重试")
    except httpx.HTTPError:
        return _error(502, "upstream_unreachable", "上游服务暂时不可用，请稍后重试")

    if resp.status_code in (401, 403):
        status = resp.status_code
        await resp.aclose()
        return _error(
            502, "upstream_auth", "请求失败：API 密钥无效，请检查高级设置中的供应商配置", status
        )
    if resp.status_code == 429:
        await resp.aclose()
        return _error(429, "upstream_rate_limited", "请求过于频繁，已被限流。请稍后重试", 429)
    if resp.status_code >= 400:
        status = resp.status_code
        await resp.aclose()
        return _error(502, "upstream_error", "上游服务暂时不可用，请稍后重试", status)

    logger.info(
        "chat forwarded user_id=%s mode=%s upstream_status=%s", user.id, mode, resp.status_code
    )

    async def relay() -> AsyncIterator[bytes]:
        raw = bytearray()
        try:
            async for chunk in resp.aiter_raw():
                raw += chunk
                yield chunk
        except httpx.HTTPError:
            yield _INTERRUPTED_FRAME
        finally:
            await resp.aclose()
            # 逐字节透传不变，仅在旁路累积观测 usage 帧（不改写字节）
            tokens = quota.extract_total_tokens(bytes(raw))
            quota.record_tokens(request.app.state.db_path, user.id, mode, tokens)

    return StreamingResponse(relay(), media_type="text/event-stream")


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
        "daily_limit": quota.limit_for(settings, mode),
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
