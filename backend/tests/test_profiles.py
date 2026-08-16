"""REQ-018（iter-7 T2）：供应商档案迁服务端——CRUD / 模式切换 / 掩码 / 隔离 / 0600。

key 明文只入库；任何响应只回掩码（design-iter-7 定夺②受保护条款③，本文件逐响应断言）。
"""

import stat

from fastapi.testclient import TestClient

from tests.conftest import register


def make_profile(c: TestClient, name="DeepSeek", key="sk-live-12345678", **overrides) -> dict:
    payload = {
        "name": name,
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
        "api_key": key,
    }
    payload.update(overrides)
    r = c.post("/api/profiles", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


class TestGate:
    def test_未登录_全部方法_401(self, client: TestClient):
        assert client.get("/api/profiles").status_code == 401
        assert client.post("/api/profiles", json={}).status_code == 401
        assert client.put("/api/profiles/x", json={}).status_code == 401
        assert client.delete("/api/profiles/x").status_code == 401
        assert client.post("/api/profiles/x/activate").status_code == 401
        assert client.delete("/api/profiles/active").status_code == 401


class TestCrud:
    def test_创建_返回掩码_明文不出现在响应(self, client: TestClient):
        register(client, "alice")
        p = make_profile(client, key="sk-live-abcd1234")
        assert p["api_key_masked"] == "sk-****1234"
        assert p["is_active"] is False
        assert "sk-live-abcd1234" not in str(p)

    def test_添加时_key_空_422(self, client: TestClient):
        register(client, "alice")
        r = client.post(
            "/api/profiles",
            json={"name": "x", "base_url": "https://a.test", "model": "m", "api_key": "  "},
        )
        assert r.status_code == 422

    def test_添加时_base_url_非法_422(self, client: TestClient):
        register(client, "alice")
        r = client.post(
            "/api/profiles",
            json={"name": "x", "base_url": "ftp://a.test", "model": "m", "api_key": "k"},
        )
        assert r.status_code == 422

    def test_列表_按创建序(self, client: TestClient):
        register(client, "alice")
        make_profile(client, "A")
        make_profile(client, "B")
        names = [p["name"] for p in client.get("/api/profiles").json()]
        assert names == ["A", "B"]

    def test_编辑_key_留空_沿用原值(self, client: TestClient):
        register(client, "alice")
        p = make_profile(client, key="sk-live-abcd1234")
        r = client.put(
            f"/api/profiles/{p['id']}",
            json={"name": "改名", "base_url": "https://b.test", "model": "m2", "api_key": ""},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["name"] == "改名"
        assert body["api_key_masked"] == "sk-****1234"  # 原值沿用（编辑不回显设计）

    def test_编辑_key_非空_覆盖(self, client: TestClient):
        register(client, "alice")
        p = make_profile(client, key="sk-old-abcd1111")
        r = client.put(
            f"/api/profiles/{p['id']}",
            json={
                "name": "n",
                "base_url": "https://b.test",
                "model": "m",
                "api_key": "sk-new-2222",
            },
        )
        assert r.json()["api_key_masked"] == "sk-****2222"

    def test_删除_非当前(self, client: TestClient):
        register(client, "alice")
        p = make_profile(client)
        assert client.delete(f"/api/profiles/{p['id']}").status_code == 200
        assert client.get("/api/profiles").json() == []


class TestModeSwitch:
    """模式判定：存在生效档案 = 自填模式；无 = 统一 key 模式（design-iter-7 §1 定稿）。"""

    def test_activate_后_is_active(self, client: TestClient):
        register(client, "alice")
        p = make_profile(client)
        assert client.post(f"/api/profiles/{p['id']}/activate").status_code == 200
        (row,) = client.get("/api/profiles").json()
        assert row["is_active"] is True

    def test_activate_第二个_自动切换(self, client: TestClient):
        register(client, "alice")
        a = make_profile(client, "A")
        b = make_profile(client, "B")
        client.post(f"/api/profiles/{a['id']}/activate")
        client.post(f"/api/profiles/{b['id']}/activate")
        states = {p["name"]: p["is_active"] for p in client.get("/api/profiles").json()}
        assert states == {"A": False, "B": True}

    def test_回退_清除生效_档案保留(self, client: TestClient):
        register(client, "alice")
        p = make_profile(client)
        client.post(f"/api/profiles/{p['id']}/activate")
        assert client.delete("/api/profiles/active").status_code == 200
        (row,) = client.get("/api/profiles").json()
        assert row["is_active"] is False  # 档案保留、可再启用
        client.post(f"/api/profiles/{p['id']}/activate")  # 再启用不受影响
        assert client.get("/api/profiles").json()[0]["is_active"] is True

    def test_当前生效档案禁删_409(self, client: TestClient):
        register(client, "alice")
        p = make_profile(client)
        client.post(f"/api/profiles/{p['id']}/activate")
        r = client.delete(f"/api/profiles/{p['id']}")
        assert r.status_code == 409
        assert "不可删除" in r.json()["detail"]
        # 回退后可删
        client.delete("/api/profiles/active")
        assert client.delete(f"/api/profiles/{p['id']}").status_code == 200


class TestIsolation:
    def test_跨用户_不可见_不可操作(self, client_factory):
        alice, bob = client_factory(), client_factory()
        register(alice, "alice")
        register(bob, "bob")
        p = make_profile(alice)
        valid = {"name": "x", "base_url": "https://b.test", "model": "m", "api_key": "k"}
        assert bob.get("/api/profiles").json() == []
        assert bob.put(f"/api/profiles/{p['id']}", json=valid).status_code == 404
        assert bob.delete(f"/api/profiles/{p['id']}").status_code == 404
        assert bob.post(f"/api/profiles/{p['id']}/activate").status_code == 404

    def test_掩码互不可推_明文仅在本人库内(self, client_factory):
        alice, bob = client_factory(), client_factory()
        register(alice, "alice")
        register(bob, "bob")
        make_profile(alice, key="sk-alice-secret9999")
        assert "sk-alice-secret9999" not in str(bob.get("/api/profiles").json())


class TestProtectedStorage:
    def test_库文件权限_0600(self, client: TestClient):
        """REQ-014 受保护条款⑤（design-iter-7 定夺②）。"""
        import os

        db_path = client.app.state.db_path  # type: ignore[attr-defined]
        mode = stat.S_IMODE(os.stat(db_path).st_mode)
        assert mode == 0o600

    def test_库内可检索到明文_响应检索不到(self, client: TestClient, db_conn):
        """明文仅存库（受保护条款的边界：SQLite 明文是定案口径，保护=不出库）。"""
        register(client, "alice")
        make_profile(client, key="sk-live-zzzz8888")
        rows = db_conn.execute("SELECT api_key FROM profiles").fetchall()
        assert rows[0]["api_key"] == "sk-live-zzzz8888"
        assert "sk-live-zzzz8888" not in str(client.get("/api/profiles").json())
