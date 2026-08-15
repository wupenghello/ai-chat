"""流式代理 —— iter-7 实现（REQ-023）。

本文件当前只提供 SSE 技术形态验证端点（iter-6 风险 2 应对）：
确认 FastAPI StreamingResponse + async 生成器的 SSE 分帧可被前端正确消费，
为 iter-7 的真实上游代理消除骨架返工风险。不在本迭代实现真实代理。
"""

import asyncio
from collections.abc import AsyncIterator

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.routers.auth import CurrentUser

router = APIRouter(prefix="/api/dev", tags=["dev"])


@router.get("/sse-echo")
async def sse_echo(
    user: CurrentUser,
    text: str = Query(default="ping", max_length=64),
    chunks: int = Query(default=5, ge=1, le=20),
) -> StreamingResponse:
    async def stream() -> AsyncIterator[str]:
        for i in range(chunks):
            yield f"data: {text} #{i + 1}\n\n"
            await asyncio.sleep(0.05)

    return StreamingResponse(stream(), media_type="text/event-stream")
