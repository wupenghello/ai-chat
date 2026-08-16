"""FastAPI 入口：应用工厂 + 生命周期内建库迁移。

本地开发：uv run uvicorn app.main:app --reload
（前端 dev server 经 Vite proxy 转发 /api 至本服务，同源无需 CORS——见 backend/README.md）
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from app.config import Settings
from app.db import connect, db_version, init_db
from app.routers import auth, profiles, proxy, sessions


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        conn = connect(settings.db_path)
        try:
            init_db(conn)
            app.state.db_path = settings.db_path
            app.state.db_version = db_version(conn)
        finally:
            conn.close()
        # 共享上游连接池：代理端点复用已建 TLS 会话，压低首块额外延迟（REQ-023 ≤500ms 验收）
        app.state.http = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)
        )
        try:
            yield
        finally:
            await app.state.http.aclose()

    app = FastAPI(title="ai-chat backend", version="0.1.0", lifespan=lifespan)
    app.include_router(auth.router)
    app.include_router(sessions.router)
    app.include_router(profiles.router)
    app.include_router(proxy.router)

    @app.get("/api/health", tags=["dev"])
    def health() -> dict[str, object]:
        return {"status": "ok", "db_version": app.state.db_version}

    return app


app = create_app()
