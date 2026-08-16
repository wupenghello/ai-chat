"""流式代理（REQ-023，iter-7 T1）：OpenAI 兼容 chat completions 经服务端转发。

- 统一 key 模式：服务端 .env 三变量（design-iter-7 定夺①）直连默认上游，前端零配置
- 自填模式（T1 过渡态）：档案三要素随请求 provider 字段传入；T2 起改读服务端受保护存储，
  本字段移除
- 错误映射文案 = design-iter-7 §3.1 定稿；上游 401/403 映射为 502
  （避免与 Cookie 会话失效的 401 混淆触发前端跳登录）
- 上游流中断：向流末尾补 upstream_interrupted 帧，前端转「生成中断」标注（REQ-001/003）
- 密钥安全：发往上游的请求头全新构造（绝不透传 Cookie），任何响应/日志不含 key
"""

import asyncio
from collections.abc import AsyncIterator
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, field_validator

from app.config import Settings, get_settings
from app.routers.auth import CurrentUser

router = APIRouter(prefix="/api", tags=["chat"])

_INTERRUPTED_FRAME = b'data: {"upstream_interrupted": true}\n\n'


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ProviderOverride(BaseModel):
    """T1 过渡态：自填档案随请求传入（T2 移除，改读服务端档案）。"""

    base_url: str
    api_key: str
    model: str

    @field_validator("base_url")
    @classmethod
    def base_url_rule(cls, v: str) -> str:
        if not v.startswith(("http://", "https://")):
            raise ValueError("base_url 必须以 http(s):// 开头")
        return v.rstrip("/")


class ChatCompletionRequest(BaseModel):
    messages: list[ChatMessage]
    model: str | None = None  # 统一 key 模式下忽略（模型由服务端配置决定）
    stream: bool = True
    provider: ProviderOverride | None = None


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
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    # REQ-024（iter-8）配额检查位：按用户当前密钥模式档位校验，不足时在此直接拒绝（不调用上游）
    if body.provider is not None:
        base_url = body.provider.base_url
        api_key = body.provider.api_key
        model = body.provider.model
    elif settings.unified_key:
        base_url = settings.unified_base_url
        api_key = settings.unified_key
        model = settings.unified_model
    else:
        return _error(503, "unified_key_missing", "服务端未配置统一密钥，请联系管理员")

    upstream: httpx.AsyncClient = request.app.state.http
    payload = {"model": model, "messages": [m.model_dump() for m in body.messages], "stream": True}
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

    async def relay() -> AsyncIterator[bytes]:
        try:
            async for chunk in resp.aiter_raw():
                yield chunk
        except httpx.HTTPError:
            yield _INTERRUPTED_FRAME
        finally:
            await resp.aclose()

    return StreamingResponse(relay(), media_type="text/event-stream")


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
