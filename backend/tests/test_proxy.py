"""REQ-023（iter-7 T1）：流式代理——鉴权门禁 / 模式路由 / SSE 透传 / 错误映射 / 密钥不出响应。

上游以 httpx.MockTransport 模拟（真实上游的统一 key / 自填双模式对话在验收取证留档，不走 pytest）；
MockTransport 的 base_url 指向 http://upstream.test，settings 经 dependency_overrides 注入，
显式传参的 unified_* 优先级高于 .env，真实密钥不进入测试进程断言面。
"""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import httpx
import pytest
from app.config import Settings, get_settings
from app.main import create_app
from fastapi.testclient import TestClient

from tests.conftest import register

UPSTREAM = "http://upstream.test"
UNIFIED_KEY = "sk-unified-test"
UNIFIED_MODEL = "deepseek-test"

SSE_FRAMES = [
    'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
    "data: [DONE]\n\n",
]
SSE_OK = "".join(SSE_FRAMES).encode()


def _sse_response(*frames: str) -> httpx.Response:
    """MockTransport 流式响应：async 生成器 content（async client 仅接受 AsyncByteStream），
    每帧一块——顺带覆盖「代理逐块转发不破坏帧边界」。"""

    async def gen():
        for f in frames:
            yield f.encode()

    return httpx.Response(200, content=gen())


@contextmanager
def upstream_app(
    tmp_path: Path, handler, *, unified_key: str = UNIFIED_KEY
) -> Iterator[tuple[TestClient, list[httpx.Request]]]:
    """带 mock 上游的应用：dependency_overrides 注入 settings，app.state.http 换 MockTransport。
    显式传参的 unified_* 优先级高于 .env，真实密钥不进入测试断言面。"""
    settings = Settings(
        db_path=str(tmp_path / "t.db"),
        unified_key=unified_key,
        unified_base_url=UPSTREAM,
        unified_model=UNIFIED_MODEL,
    )
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    seen: list[httpx.Request] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    with TestClient(app) as c:
        c.app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(wrapped))
        yield c, seen


def chat(c: TestClient, **body) -> httpx.Response:
    base = {"messages": [{"role": "user", "content": "你好"}]}
    base.update(body)
    return c.post("/api/chat/completions", json=base)


def ok_handler(request: httpx.Request) -> httpx.Response:
    return _sse_response(*SSE_FRAMES)


class TestAuthGate:
    def test_未登录_401(self, tmp_path: Path):
        def handler(request: httpx.Request) -> httpx.Response:
            raise AssertionError("未登录请求不得抵达上游")

        with upstream_app(tmp_path, handler) as (c, seen):
            assert chat(c).status_code == 401
            assert seen == []


class TestUnifiedMode:
    def test_转发_sse_逐字节透传(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            r = chat(c)
            assert r.status_code == 200
            assert r.headers["content-type"].startswith("text/event-stream")
            assert r.content == SSE_OK

    def test_转发请求_模型取服务端配置_body_model_被忽略(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, seen):
            register(c, "alice")
            chat(c, model="user-supplied-model")
            (req,) = seen
            assert str(req.url) == f"{UPSTREAM}/chat/completions"
            assert req.headers["authorization"] == f"Bearer {UNIFIED_KEY}"
            payload = json.loads(req.content)
            assert payload == {
                "model": UNIFIED_MODEL,
                "messages": [{"role": "user", "content": "你好"}],
                "stream": True,
            }
            # provider 过渡字段绝不进入转发体
            assert "provider" not in payload

    def test_统一密钥未配置_503_引导文案(self, tmp_path: Path):
        def handler(request: httpx.Request) -> httpx.Response:
            raise AssertionError("未配置密钥不得调用上游")

        with upstream_app(tmp_path, handler, unified_key="") as (c, seen):
            register(c, "alice")
            r = chat(c)
            assert r.status_code == 503
            body = r.json()
            assert body["code"] == "unified_key_missing"
            assert body["detail"] == "服务端未配置统一密钥，请联系管理员"
            assert seen == []


class TestProfileRouting:
    """T2（REQ-018）：自填模式 = 服务端当前生效档案路由；激活在请求开始时读取（CHG-002）。"""

    def test_生效档案_路由到档案上游与密钥(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, seen):
            register(c, "alice")
            r = c.post(
                "/api/profiles",
                json={
                    "name": "GLM",
                    "base_url": "http://glm.test/v1",
                    "model": "glm-5.3",
                    "api_key": "sk-glm-test",
                },
            )
            assert r.status_code == 201
            pid = r.json()["id"]
            assert c.post(f"/api/profiles/{pid}/activate").status_code == 200
            r = chat(c)
            assert r.status_code == 200
            (req,) = seen
            assert str(req.url) == "http://glm.test/v1/chat/completions"
            assert req.headers["authorization"] == "Bearer sk-glm-test"
            assert json.loads(req.content)["model"] == "glm-5.3"
            # 统一 key 不会被带出（档案模式覆盖）
            assert UNIFIED_KEY.encode() not in r.content

    def test_无生效档案_回退统一_key_路由(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, seen):
            register(c, "alice")
            r = c.post(
                "/api/profiles",
                json={
                    "name": "GLM",
                    "base_url": "http://glm.test/v1",
                    "model": "glm-5.3",
                    "api_key": "sk-glm-test",
                },
            )
            pid = r.json()["id"]
            c.post(f"/api/profiles/{pid}/activate")
            c.delete("/api/profiles/active")  # 回退统一密钥
            r = chat(c)
            assert r.status_code == 200
            (req,) = seen
            assert str(req.url) == f"{UPSTREAM}/chat/completions"
            assert req.headers["authorization"] == f"Bearer {UNIFIED_KEY}"
            assert json.loads(req.content)["model"] == UNIFIED_MODEL

    def test_档案_明文密钥不出现在任何响应(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            r = c.post(
                "/api/profiles",
                json={
                    "name": "GLM",
                    "base_url": UPSTREAM,
                    "model": "m",
                    "api_key": "sk-glm-test",
                },
            )
            assert "sk-glm-test" not in r.text
            assert "sk-glm-test" not in str(c.get("/api/profiles").json())
            assert b"sk-glm-test" not in chat(c).content


class TestUpstreamErrors:
    """design-iter-7 §3.1 错误映射定稿；上游 401/403 → 502（不与 Cookie 会话 401 混淆）。"""

    @pytest.mark.parametrize("upstream_status", [401, 403])
    def test_上游_401_403_映射_502_密钥无效文案(self, tmp_path: Path, upstream_status: int):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(upstream_status, json={"error": {"message": "bad key"}})

        with upstream_app(tmp_path, handler) as (c, _):
            register(c, "alice")
            r = chat(c)
            assert r.status_code == 502
            body = r.json()
            assert body["code"] == "upstream_auth"
            assert body["upstream_status"] == upstream_status
            assert body["detail"] == "请求失败：API 密钥无效，请检查高级设置中的供应商配置"

    def test_上游_429_透传_限流文案(self, tmp_path: Path):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(429, json={"error": {"message": "rate limited"}})

        with upstream_app(tmp_path, handler) as (c, _):
            register(c, "alice")
            r = chat(c)
            assert r.status_code == 429
            body = r.json()
            assert body["code"] == "upstream_rate_limited"
            assert body["detail"] == "请求过于频繁，已被限流。请稍后重试"

    @pytest.mark.parametrize("upstream_status", [500, 503])
    def test_上游_5xx_映射_502_不可用文案(self, tmp_path: Path, upstream_status: int):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(upstream_status, text="boom")

        with upstream_app(tmp_path, handler) as (c, _):
            register(c, "alice")
            r = chat(c)
            assert r.status_code == 502
            body = r.json()
            assert body["code"] == "upstream_error"
            assert body["detail"] == "上游服务暂时不可用，请稍后重试"

    def test_上游超时_504(self, tmp_path: Path):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectTimeout("upstream timeout")

        with upstream_app(tmp_path, handler) as (c, _):
            register(c, "alice")
            r = chat(c)
            assert r.status_code == 504
            body = r.json()
            assert body["code"] == "upstream_timeout"
            assert body["detail"] == "请求超时，请稍后重试"

    def test_上游连接失败_502_unreachable(self, tmp_path: Path):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused")

        with upstream_app(tmp_path, handler) as (c, _):
            register(c, "alice")
            r = chat(c)
            assert r.status_code == 502
            body = r.json()
            assert body["code"] == "upstream_unreachable"
            assert body["detail"] == "上游服务暂时不可用，请稍后重试"


class TestStreamInterrupt:
    def test_上游流中断_补帧_已收内容保留(self, tmp_path: Path):
        head = 'data: {"choices":[{"delta":{"content":"部分"}}]}\n\n'

        def handler(request: httpx.Request) -> httpx.Response:
            async def gen():
                yield head.encode()
                raise httpx.ReadError("upstream dropped")

            return httpx.Response(200, content=gen())

        with upstream_app(tmp_path, handler) as (c, _):
            register(c, "alice")
            r = chat(c)
            assert r.status_code == 200
            assert r.content.startswith(head.encode())
            assert r.content.endswith(b'data: {"upstream_interrupted": true}\n\n')


class TestKeyHygiene:
    def test_全部响应体检索不到任何密钥(self, tmp_path: Path):
        calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            if calls == 1:
                return httpx.Response(401, json={"error": {"message": "bad"}})
            return _sse_response(*SSE_FRAMES)

        with upstream_app(tmp_path, handler) as (c, _):
            register(c, "alice")
            for r in (chat(c), chat(c)):
                assert UNIFIED_KEY.encode() not in r.content
