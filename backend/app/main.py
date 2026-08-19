"""FastAPI 入口：应用工厂 + 生命周期内建库迁移。

本地开发：uv run uvicorn app.main:app --reload
（前端 dev server 经 Vite proxy 转发 /api 至本服务，同源无需 CORS——见 backend/README.md）
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from app import search as searchsvc  # noqa: F401 —— import 即静态注册 search 工具（REQ-035）
from app.config import Settings
from app.db import connect, db_version, init_db
from app.routers import admin, auth, profiles, proxy, sessions

# 可观测（非功能条款）：quota/转发结果日志默认可见（uvicorn 只配置自家 logger，
# root 无 handler 时 INFO 会被吞掉；basicConfig 幂等，已有 handler 时不重复加）
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


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
        # 联网搜索运行时绑定（REQ-035 / design-iter-14 §6.1）：key 配置才绑定——search 工具
        # 的下发门控（admin 开关 ∧ key）在回合受理处按 settings 判定，此处只管客户端与 key
        if settings.search_key:
            searchsvc.bind(app.state.http, settings.search_key)
        try:
            yield
        finally:
            searchsvc.unbind()
            await app.state.http.aclose()

    app = FastAPI(title="ai-chat backend", version="0.1.0", lifespan=lifespan)
    # 进行中回合登记（CHG-010/REQ-040，iter-16 T3）：(user_id, session_id) 集合——回合受理
    # 置位、流终态（含断连）清除；手动压缩端点 409 判定的服务端唯一权威（多设备竞态，
    # design-iter-16 §2.3 定夺④）。进程内内存态：重启即清零 = 无进行中回合，语义自洽。
    app.state.generating_sessions = set()
    app.include_router(auth.router)
    app.include_router(sessions.router)
    app.include_router(profiles.router)
    app.include_router(proxy.router)
    app.include_router(admin.router)

    @app.get("/api/health", tags=["dev"])
    def health() -> dict[str, object]:
        return {"status": "ok", "db_version": app.state.db_version}

    return app


app = create_app()
