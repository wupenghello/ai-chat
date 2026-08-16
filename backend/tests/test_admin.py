"""REQ-025（iter-8 T2）：管理后台——管理员引导 / 403 门禁 / 封禁治理 / 配额覆盖 / 用量统计。

- 复用 test_proxy.upstream_app 基座（配额覆盖与代理的联动验收需要 mock 上游）
- 管理员引导：新库首注册用户由 register 引导；「管理员空缺时最早用户补标」以同款 SQL
  取证（与迁移 v5 语句一致——完整 v3→v5 链路在每个测试的全新库上顺带覆盖）
"""

from pathlib import Path

import pytest
from app import quota
from app.db import connect

from tests.conftest import login, register
from tests.test_proxy import chat, ok_handler, upstream_app
from tests.test_quota import usage_handler

ADMIN_ENDPOINTS = ["/api/admin/users", "/api/admin/usage", "/api/admin/overview"]


def quota_db(c) -> object:
    return connect(c.app.state.db_path)  # type: ignore[attr-defined]


# 迁移 v5 的补标语句（存量库管理员空缺时最早用户补标）
_BACKFILL_SQL = (
    "UPDATE users SET is_admin = 1 "
    "WHERE NOT EXISTS (SELECT 1 FROM users WHERE is_admin = 1) "
    "AND id = (SELECT MIN(id) FROM users)"
)


class TestAdminBootstrap:
    def test_首个注册用户管理员_第二个普通用户(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            assert c.get("/api/auth/me").json()["is_admin"] is True
            register(c, "bob")
            assert c.get("/api/auth/me").json()["is_admin"] is False

    def test_管理员空缺时_最早用户补标_同款SQL与迁移v5一致(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            register(c, "bob")
            conn = quota_db(c)
            try:
                with conn:  # 模拟存量库无管理员
                    conn.execute("UPDATE users SET is_admin = 0")
                with conn:
                    conn.execute(_BACKFILL_SQL)
                admins = [r["username"] for r in conn.execute(
                    "SELECT username FROM users WHERE is_admin = 1"
                )]
            finally:
                conn.close()
            assert admins == ["alice"]

    def test_已有管理员时不改标(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            register(c, "bob")
            conn = quota_db(c)
            try:
                with conn:
                    conn.execute(_BACKFILL_SQL)
                admins = [r["username"] for r in conn.execute(
                    "SELECT username FROM users WHERE is_admin = 1"
                )]
            finally:
                conn.close()
            assert admins == ["alice"]  # bob 不被补标


class TestAdminGate:
    @pytest.mark.parametrize("ep", ADMIN_ENDPOINTS)
    def test_未登录_401(self, tmp_path: Path, ep: str):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            assert c.get(ep).status_code == 401

    @pytest.mark.parametrize("ep", ADMIN_ENDPOINTS)
    def test_普通用户_403_不暴露数据(self, tmp_path: Path, ep: str):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")  # 管理员
            register(c, "bob")    # 当前会话 = bob（普通用户）
            r = c.get(ep)
            assert r.status_code == 403
            assert "alice" not in r.text  # 不泄露任何后台数据

    def test_普通用户_封禁与调配额接口_403(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            register(c, "bob")
            assert c.post("/api/admin/users/1/unban").status_code == 403
            assert c.put(
                "/api/admin/users/1/quota", json={"daily_limit": 5}
            ).status_code == 403


class TestBan:
    def test_封禁后登录被拒_解封恢复(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            register(c, "bob")  # 当前 = bob
            assert c.get("/api/sessions").status_code == 200
            assert login(c, "alice", "password123").status_code == 200  # 管理员操作
            assert c.post("/api/admin/users/2/ban").status_code == 200
            # 登录被拒 + 明确封禁提示（既有 token 的门禁由 test_auth 封禁守卫用例覆盖）
            r = login(c, "bob", "password123")
            assert r.status_code == 403
            assert r.json()["detail"] == "账号已被封禁"
            # 解封恢复
            assert login(c, "alice", "password123").status_code == 200
            assert c.post("/api/admin/users/2/unban").status_code == 200
            assert login(c, "bob", "password123").status_code == 200

    def test_封禁管理员本人被阻止(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")  # 管理员
            r = c.post("/api/admin/users/1/ban")
            assert r.status_code == 400
            assert r.json()["detail"] == "不允许封禁管理员"
            assert c.get("/api/auth/me").status_code == 200  # 自身不受影响

    def test_用户不存在_404(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            assert c.post("/api/admin/users/999/ban").status_code == 404
            assert c.post("/api/admin/users/999/unban").status_code == 404
            assert c.put("/api/admin/users/999/quota",
                         json={"daily_limit": 5}).status_code == 404


class TestQuotaOverride:
    def test_覆盖后实际可用量按新值生效_与REQ024联动(self, tmp_path: Path):
        extra = {"quota_free_daily": 10}
        with upstream_app(tmp_path, ok_handler, settings_extra=extra) as (c, seen):
            register(c, "alice")
            register(c, "bob")  # 当前 = bob
            assert login(c, "alice", "password123").status_code == 200
            assert c.put("/api/admin/users/2/quota",
                         json={"daily_limit": 2}).status_code == 200
            assert login(c, "bob", "password123").status_code == 200
            body = c.get("/api/quota").json()
            assert body["daily_limit"] == 2  # 覆盖优先于默认档（/api/quota 口径同步）
            assert chat(c).status_code == 200
            assert chat(c).status_code == 200  # 覆盖值 2 用尽
            r = chat(c)
            assert r.status_code == 429
            assert r.json()["code"] == "quota_exhausted"
            assert len(seen) == 2  # 第 3 次未抵达上游
            # 清除覆盖 → 恢复默认档 10
            assert login(c, "alice", "password123").status_code == 200
            assert c.put("/api/admin/users/2/quota",
                         json={"daily_limit": None}).status_code == 200
            assert login(c, "bob", "password123").status_code == 200
            assert c.get("/api/quota").json()["daily_limit"] == 10
            assert chat(c).status_code == 200

    def test_自定义配额须正整数_422(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            assert c.put("/api/admin/users/1/quota",
                         json={"daily_limit": 0}).status_code == 422

    def test_用户列表_字段与当日用量(self, tmp_path: Path):
        with upstream_app(tmp_path, usage_handler) as (c, _):
            register(c, "alice")
            assert chat(c).status_code == 200  # alice 1 次（unified）
            register(c, "bob")
            login(c, "alice", "password123")  # 切回管理员视角
            rows = c.get("/api/admin/users").json()
            assert [r["username"] for r in rows] == ["alice", "bob"]
            alice_row = rows[0]
            assert alice_row["is_admin"] is True
            assert alice_row["banned"] is False
            assert alice_row["mode"] == "unified"
            assert alice_row["quota_override"] is None
            assert alice_row["daily_limit"] == 30  # 默认免费档
            assert alice_row["used_today"] == 1
            assert rows[1]["used_today"] == 0


class TestUsage:
    def test_按用户按日聚合_与配额计数同源(self, tmp_path: Path):
        with upstream_app(tmp_path, usage_handler) as (c, _):
            register(c, "alice")
            assert chat(c).status_code == 200
            assert chat(c).status_code == 200  # alice 2 次 × 18 token
            register(c, "bob")
            assert chat(c).status_code == 200  # bob 1 次
            login(c, "alice", "password123")
            rows = c.get("/api/admin/usage").json()
            by_user = {r["username"]: r for r in rows}
            assert by_user["alice"]["requests"] == 2
            assert by_user["alice"]["tokens"] == 36
            assert by_user["bob"]["requests"] == 1
            day = quota.today()
            assert all(r["day"] == day for r in rows)

    def test_用户过滤与日期窗口(self, tmp_path: Path):
        with upstream_app(tmp_path, usage_handler) as (c, _):
            register(c, "alice")
            chat(c)
            register(c, "bob")
            login(c, "alice", "password123")
            rows = c.get("/api/admin/usage", params={"user_id": 2}).json()
            assert rows == []  # bob 无用量
            rows = c.get("/api/admin/usage",
                         params={"date_from": "2999-01-01"}).json()
            assert rows == []  # 未来窗口为空
            rows = c.get("/api/admin/usage",
                         params={"user_id": 1, "date_to": "2999-12-31"}).json()
            assert len(rows) == 1
            assert rows[0]["username"] == "alice"


class TestOverview:
    def test_全站配额条数据(self, tmp_path: Path):
        extra = {"unified_daily_total": 2000}
        with upstream_app(tmp_path, usage_handler, settings_extra=extra) as (c, _):
            register(c, "alice")
            chat(c)
            register(c, "bob")
            login(c, "alice", "password123")
            body = c.get("/api/admin/overview").json()
            assert body["day"] == quota.today()
            assert body["unified_used"] == 1
            assert body["unified_daily_total"] == 2000
