"""SSE 技术形态验证端点与健康检查（iter-6 风险 2 应对 / 部署验收）。"""

from fastapi.testclient import TestClient

from tests.conftest import register


def test_health(client: TestClient):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert resp.json()["db_version"] >= 1  # 存储结构带版本号（非功能「数据」条款）


def test_sse_echo_streams_frames(client: TestClient):
    """SSE 分帧逐块送达，Content-Type 正确——确认 iter-7 流式代理的骨架形态。"""
    register(client, "sse-user")
    with client.stream(
        "GET", "/api/dev/sse-echo", params={"text": "hello", "chunks": 3}
    ) as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        body = "".join(resp.iter_text())
    assert body == "data: hello #1\n\ndata: hello #2\n\ndata: hello #3\n\n"


def test_sse_echo_requires_login(client: TestClient):
    assert client.get("/api/dev/sse-echo").status_code == 401
