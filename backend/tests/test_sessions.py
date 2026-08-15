"""REQ-022 核心：会话 CRUD——逐字恢复 / LWW 覆盖 / 归属隔离 / 401 门禁。"""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import login, register

pytestmark = pytest.mark.usefixtures("db_conn")


def session_payload(sid: str, **overrides) -> dict:
    base = {
        "id": sid,
        "title": "测试会话",
        "createdAt": 1755300000000,
        "updatedAt": 1755300001000,
        "messages": [
            {"id": "m1", "role": "user", "content": "你好", "status": "done"},
            {"id": "m2", "role": "assistant", "content": "你好！", "status": "done"},
        ],
        "renamed": False,
        "branches": {
            "f1": [{"id": "m2-old", "role": "assistant", "content": "旧版", "status": "done"}]
        },
    }
    base.update(overrides)
    return base


@pytest.fixture
def alice(client_factory) -> TestClient:
    c = client_factory()
    register(c, "alice")
    return c


@pytest.fixture
def bob(client_factory) -> TestClient:
    c = client_factory()
    register(c, "bob")
    return c


class TestRoundtrip:
    def test_empty_list(self, alice: TestClient):
        assert alice.get("/api/sessions").json() == []

    def test_save_then_list_verbatim(self, alice: TestClient):
        """逐字恢复：存什么取什么（含 branches/renamed 等全部字段）。"""
        payload = session_payload("s1")
        assert alice.put("/api/sessions/s1", json=payload).status_code == 200
        got = alice.get("/api/sessions").json()
        assert got == [payload]

    def test_overwrite_last_write_wins(self, alice: TestClient):
        """LWW：整档覆盖，旧内容不残留。"""
        alice.put("/api/sessions/s1", json=session_payload("s1", title="第一版", updatedAt=1000))
        alice.put("/api/sessions/s1", json=session_payload("s1", title="第二版", updatedAt=2000))
        got = alice.get("/api/sessions").json()
        assert len(got) == 1
        assert got[0]["title"] == "第二版"

    def test_list_ordered_by_updated_at_desc(self, alice: TestClient):
        alice.put("/api/sessions/old", json=session_payload("old", updatedAt=1000))
        alice.put("/api/sessions/new", json=session_payload("new", updatedAt=9000))
        got = alice.get("/api/sessions").json()
        assert [s["id"] for s in got] == ["new", "old"]

    def test_delete_removes(self, alice: TestClient):
        alice.put("/api/sessions/s1", json=session_payload("s1"))
        assert alice.delete("/api/sessions/s1").status_code == 200
        assert alice.get("/api/sessions").json() == []

    def test_delete_idempotent(self, alice: TestClient):
        assert alice.delete("/api/sessions/never-existed").status_code == 200

    def test_save_rejects_id_mismatch(self, alice: TestClient):
        resp = alice.put("/api/sessions/s1", json=session_payload("other-id"))
        assert resp.status_code == 422

    def test_save_rejects_missing_messages(self, alice: TestClient):
        resp = alice.put("/api/sessions/s1", json={"id": "s1", "title": "x", "updatedAt": 1})
        assert resp.status_code == 422


class TestIsolation:
    def test_bob_cannot_see_alice_sessions(self, alice: TestClient, bob: TestClient):
        alice.put("/api/sessions/s1", json=session_payload("s1"))
        assert bob.get("/api/sessions").json() == []

    def test_bob_cannot_overwrite_alice_session(self, alice: TestClient, bob: TestClient):
        """bob 写同 id：只写进自己的行，alice 的原样（复合主键隔离）。"""
        alice.put("/api/sessions/s1", json=session_payload("s1", title="爱丽丝的"))
        resp = bob.put("/api/sessions/s1", json=session_payload("s1", title="抢注"))
        assert resp.status_code == 200
        assert alice.get("/api/sessions").json()[0]["title"] == "爱丽丝的"
        assert bob.get("/api/sessions").json()[0]["title"] == "抢注"

    def test_same_id_separated_per_user(self, alice: TestClient, bob: TestClient):
        """两人各存同 id 会话：互不可见、互不覆盖（各自一行）。"""
        alice.put("/api/sessions/shared", json=session_payload("shared", title="A 的"))
        bob.put("/api/sessions/shared", json=session_payload("shared", title="B 的"))
        assert alice.get("/api/sessions").json()[0]["title"] == "A 的"
        assert bob.get("/api/sessions").json()[0]["title"] == "B 的"

    def test_bob_delete_alice_session_no_effect(self, alice: TestClient, bob: TestClient):
        alice.put("/api/sessions/s1", json=session_payload("s1"))
        bob.delete("/api/sessions/s1")
        assert len(alice.get("/api/sessions").json()) == 1


class TestGuard:
    @pytest.mark.parametrize(
        ("method", "path", "body"),
        [
            ("GET", "/api/sessions", None),
            ("PUT", "/api/sessions/s1", {"id": "s1", "messages": []}),
            ("DELETE", "/api/sessions/s1", None),
        ],
    )
    def test_requires_login(self, client: TestClient, method: str, path: str, body):
        assert client.request(method, path, json=body).status_code == 401

    def test_login_again_after_logout_sees_sessions(self, alice: TestClient):
        """换设备模拟：登出 → 重新登录，会话仍在（云端恢复）。"""
        alice.put("/api/sessions/s1", json=session_payload("s1"))
        alice.post("/api/auth/logout")
        assert login(alice, "alice", "password123").status_code == 200
        assert len(alice.get("/api/sessions").json()) == 1
