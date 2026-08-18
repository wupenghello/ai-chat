"""旧透传端点退役基座（CHG-009 定夺④，iter-15 T2）。

本文件原承载 REQ-023 流式代理 16 例（POST /api/chat/completions 透传端点），随定夺④
方案 A「旧透传端点随 B1 直接下线」全部退役——16 例退役映射（旧断言 → 退役去向）逐条
登记于 plans/iter-15-verify.md T2 段（决策驱动的功能性移除例外登记，非口径迁移删除）。

保留面 = 共享测试基座（test_quota / test_admin / test_search 仍依赖，文件零改动）：
- upstream_app：带 mock 上游的应用夹具（seen 取证抵达上游的请求）
- chat：配额/用量驱动器——**已从旧透传端点迁至回合端点**（唯一对话入口，配额同源
  同语义；REQ-037 验收 3「test_quota 零改动」由此承接，见 verify T2 §退役映射）
- ok_handler / usage 相关 SSE 帧夹具：上游脚本化响应

密钥卫生：mock 夹具 key 为测试占位值，真实密钥不入测试断言面。
"""

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import httpx
from app.config import Settings, get_settings
from app.main import create_app
from fastapi.testclient import TestClient

UPSTREAM = "http://upstream.test"
UNIFIED_KEY = "sk-unified-test"
UNIFIED_MODEL = "deepseek-test"

SSE_FRAMES = [
    'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
    "data: [DONE]\n\n",
]
SSE_OK = "".join(SSE_FRAMES).encode()

# 配额/用量驱动的回合会话（turn 端点要求会话存在，chat() 幂等置空档承载本条消息）
_DRIVER_SESSION = "quota-driver-session"


def _sse_response(*frames: str) -> httpx.Response:
    """MockTransport 流式响应：async 生成器 content（async client 仅接受 AsyncByteStream），
    每帧一块——顺带覆盖「代理逐块转发不破坏帧边界」。"""

    async def gen():
        for f in frames:
            yield f.encode()

    return httpx.Response(200, content=gen())


@contextmanager
def upstream_app(
    tmp_path: Path,
    handler,
    *,
    unified_key: str = UNIFIED_KEY,
    settings_extra: dict | None = None,
) -> Iterator[tuple[TestClient, list[httpx.Request]]]:
    """带 mock 上游的应用：dependency_overrides 注入 settings，app.state.http 换 MockTransport。
    显式传参的 unified_* 优先级高于 .env，真实密钥不进入测试断言面；
    settings_extra 供配额类测试注入小阈值（REQ-024，iter-8 T1）。"""
    kwargs: dict = {
        "db_path": str(tmp_path / "t.db"),
        "unified_key": unified_key,
        "unified_base_url": UPSTREAM,
        "unified_model": UNIFIED_MODEL,
    }
    kwargs.update(settings_extra or {})
    settings = Settings(**kwargs)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    seen: list[httpx.Request] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    with TestClient(app) as c:
        c.app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(wrapped))
        yield c, seen


def chat(c: TestClient, **_legacy_body) -> httpx.Response:
    """配额/用量驱动器（定夺④迁 turn）：旧透传端点已下线，回合端点为唯一对话入口。

    配额检查位与落账同源（quota.check_and_consume / record_tokens），故 test_quota /
    test_admin 的配额与用量断言语义不变（REQ-037 验收 3）；`**_legacy_body` 仅吞旧透传
    请求形参（messages/model），turn 形态不需要——退役用例已登记映射，现存调用均无参。
    """
    # turn 端点要求会话存在：幂等置空档（每回合仅本条消息，历史不参与配额/用量口径）
    c.put(f"/api/sessions/{_DRIVER_SESSION}",
          json={"id": _DRIVER_SESSION, "title": "t", "updatedAt": 1, "messages": []})
    return c.post("/api/chat/turn",
                  json={"session_id": _DRIVER_SESSION, "message": "你好"})


def ok_handler(request: httpx.Request) -> httpx.Response:
    return _sse_response(*SSE_FRAMES)
