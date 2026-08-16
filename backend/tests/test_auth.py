"""REQ-020 认证 API 测试：对齐 iter-6 T1 验收标准与 spec 验收条目。"""

from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.config import Settings, get_settings
from app.main import create_app
from fastapi.testclient import TestClient

from tests.conftest import login, register

WRONG_LOGIN = "用户名或密码错误"


class TestRegister:
    def test_register_success_logs_in_directly(self, client: TestClient):
        """注册成功直接登录：返回用户 + 签发 Cookie + /me 可用（主流程 3）。"""
        resp = register(client, "猫南北")
        assert resp.status_code == 201
        assert resp.json() == {"id": 1, "username": "猫南北"}
        assert client.get("/api/auth/me").status_code == 200
        assert client.get("/api/auth/me").json()["username"] == "猫南北"

    def test_cookie_is_httponly_samesite_lax(self, client: TestClient):
        """token 经 HttpOnly Cookie（SameSite=Lax，CEO 定案）。"""
        resp = register(client, "alice")
        raw = resp.headers.get("set-cookie", "")
        assert "ai_chat_session=" in raw
        assert "httponly" in raw.lower()
        assert "samesite=lax" in raw.lower()

    def test_duplicate_username_conflict(self, client: TestClient, db_conn):
        register(client, "alice")
        resp = register(client, "alice")
        assert resp.status_code == 409
        assert resp.json()["detail"] == "用户名已存在"
        count = db_conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        assert count == 1  # 用户数不增加

    def test_username_case_insensitive_uniqueness(self, client: TestClient):
        """Alice 与 alice 视为同一用户名（spec 验收）。"""
        register(client, "Alice")
        resp = register(client, "alice")
        assert resp.status_code == 409
        assert resp.json()["detail"] == "用户名已存在"

    def test_username_length_and_charset_rejected(self, client: TestClient, db_conn):
        """1 字符 / 33 字符 / 含 @：后端拦截并提示规则，用户数不增（spec 验收）。"""
        for bad in ("a", "a" * 33, "user@name"):
            resp = register(client, bad)
            assert resp.status_code == 422, bad
            assert "用户名" in resp.json()["detail"][0]["msg"]
        count = db_conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        assert count == 0

    def test_password_too_short_rejected(self, client: TestClient):
        resp = register(client, "bob", password="1234567")
        assert resp.status_code == 422
        assert "密码" in resp.json()["detail"][0]["msg"]

    def test_password_too_long_rejected(self, client: TestClient):
        """密码上限 128（design-iter-6 §2.1，NCR-iter6-002 ⑧ 整改）。"""
        resp = register(client, "bob", password="x" * 129)
        assert resp.status_code == 422
        assert "密码最长 128" in resp.json()["detail"][0]["msg"]

    def test_chinese_username_and_valid_charset_accepted(self, tmp_path: Path):
        """规则允许的字符全通过：中文/字母/数字/_/-。

        本用例 4 个有效注册超出默认注册限频（每 IP 每日 3，REQ-024 iter-8 T1），
        用限频豁免实例专测字符集——限频行为由 test_quota.py 覆盖。
        """
        settings = Settings(db_path=str(tmp_path / "charset.db"), register_ip_daily_limit=99)
        app = create_app(settings)
        app.dependency_overrides[get_settings] = lambda: settings
        with TestClient(app) as c:
            for name in ("猫南北", "user_01", "a-b_9", "Zz"):
                resp = register(c, name)
                assert resp.status_code == 201, name

    def test_no_password_plaintext_in_db(self, client: TestClient, db_conn):
        """数据库检索不到密码明文：全部为 bcrypt 哈希（spec 验收）。"""
        register(client, "carol", password="s3cret-password")
        rows = db_conn.execute("SELECT password_hash FROM users").fetchall()
        assert rows and all(r["password_hash"].startswith("$2") for r in rows)
        dump = str(
            db_conn.execute("SELECT * FROM users").fetchall()
        ) + str(db_conn.execute("SELECT * FROM auth_sessions").fetchall())
        assert "s3cret-password" not in dump


class TestLogin:
    def test_login_success_sets_session(self, client: TestClient):
        register(client, "dave")
        client.post("/api/auth/logout")
        resp = login(client, "dave", "password123")
        assert resp.status_code == 200
        assert client.get("/api/auth/me").json()["username"] == "dave"

    def test_login_case_insensitive(self, client: TestClient):
        register(client, "Dave")
        client.post("/api/auth/logout")
        assert login(client, "dave", "password123").status_code == 200

    def test_wrong_password_unified_error(self, client: TestClient):
        register(client, "erin")
        resp = login(client, "erin", "wrong-password")
        assert resp.status_code == 401
        assert resp.json()["detail"] == WRONG_LOGIN

    def test_unknown_username_same_error(self, client: TestClient):
        """用户名不存在与密码错误同一文案，不泄露账号存在性（spec 异常分支）。"""
        resp = login(client, "no-such-user", "password123")
        assert resp.status_code == 401
        assert resp.json()["detail"] == WRONG_LOGIN


class TestLogoutAndGuard:
    def test_logout_invalidates_token(self, client: TestClient):
        """登出后 token 失效：受保护端点 401（T1 验收全链路终点）。"""
        register(client, "frank")
        assert client.post("/api/auth/logout").status_code == 200
        assert client.get("/api/auth/me").status_code == 401

    def test_logout_idempotent_without_session(self, client: TestClient):
        assert client.post("/api/auth/logout").status_code == 200

    def test_protected_endpoint_requires_login(self, client: TestClient):
        assert client.get("/api/auth/me").status_code == 401

    def test_expired_token_rejected(self, client: TestClient, db_conn):
        """token 过期：受保护请求 401（spec 异常分支）。"""
        register(client, "grace")
        past = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
        with db_conn:
            db_conn.execute("UPDATE auth_sessions SET expires_at = ?", (past,))
        assert client.get("/api/auth/me").status_code == 401

    def test_banned_user_rejected_on_guard(self, client: TestClient, db_conn):
        """封禁标记（REQ-025 iter-8 启用治理流）在门禁处先行生效。"""
        register(client, "heidi")
        with db_conn:
            db_conn.execute("UPDATE users SET banned = 1 WHERE username_key = 'heidi'")
        resp = client.get("/api/auth/me")
        assert resp.status_code == 403
        assert resp.json()["detail"] == "账号已被封禁"
