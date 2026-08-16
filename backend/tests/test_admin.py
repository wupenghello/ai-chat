"""REQ-025（iter-8 T2）：管理后台——管理员引导 / 403 门禁 / 封禁治理 / 配额覆盖 / 用量统计。
REQ-029（iter-12 T1）：用户搜索 / 分页信封 / 用量排序后端化 / 概览统计（design-iter-12 §4）。

- 复用 test_proxy.upstream_app 基座（配额覆盖与代理的联动验收需要 mock 上游）
- 管理员引导：新库首注册用户由 register 引导；「管理员空缺时最早用户补标」以同款 SQL
  取证（与迁移 v5 语句一致——完整 v3→v5 链路在每个测试的全新库上顺带覆盖）
- 既有 19 用例零改动 = 兼容硬门槛（design-iter-12 §4：默认形状零变化，定夺①）；
  分页测试的批量用户经直插 SQL 造数（bcrypt 单次哈希复用，绕开注册接口成本与限频）
"""

from datetime import datetime, timedelta
from pathlib import Path

import pytest
from app import quota
from app.db import connect

from tests.conftest import login, register
from tests.test_proxy import chat, ok_handler, upstream_app
from tests.test_quota import usage_handler

ADMIN_ENDPOINTS = ["/api/admin/users", "/api/admin/usage", "/api/admin/overview"]

# 今天 / 昨天 / 前天（usage_daily.day 同源口径：服务器本地自然日）
_TODAY = datetime.now().strftime("%Y-%m-%d")
_YDAY = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
_D2 = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d")


def quota_db(c) -> object:
    return connect(c.app.state.db_path)  # type: ignore[attr-defined]


def _insert_users(c, names: list[str]) -> None:
    """直插 users 行（分页/搜索造数）：username_key 小写归一同款口径；这些用户不登录，
    哈希占位即可（经注册接口造 45 用户 = 45 次 bcrypt，成本不可接受）。"""
    conn = quota_db(c)
    try:
        with conn:
            conn.executemany(
                "INSERT INTO users (username, username_key, password_hash) "
                "VALUES (?, ?, 'placeholder')",
                [(n, n.lower()) for n in names],
            )
    finally:
        conn.close()


def _seed_usage(c, rows: list[tuple[str, int, str, int, int]]) -> None:
    """直插 usage_daily（排序/分页/统计造数）：(day, user_id, mode, requests, tokens)。"""
    conn = quota_db(c)
    try:
        with conn:
            conn.executemany(
                "INSERT INTO usage_daily (day, user_id, mode, requests, tokens) "
                "VALUES (?, ?, ?, ?, ?)",
                rows,
            )
    finally:
        conn.close()


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


# ---------- REQ-029（iter-12 T1）：design-iter-12 §4.1 用户搜索 + 分页 ----------

class TestUsersSearch:
    def test_命中与大小写不敏感_信封默认20页(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            register(c, "spam-bot-2026")
            register(c, "bob")
            login(c, "alice", "password123")
            body = c.get("/api/admin/users", params={"search": "SPAM"}).json()
            assert body["total"] == 1
            assert [u["username"] for u in body["items"]] == ["spam-bot-2026"]
            assert body["limit"] == 20
            assert body["offset"] == 0

    def test_空结果_total0空页_offset钳0(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            body = c.get(
                "/api/admin/users", params={"search": "nobody", "offset": 40}
            ).json()
            assert body["total"] == 0
            assert body["items"] == []
            assert body["offset"] == 0  # 越界钳制到空页 offset 0（§8-②）

    def test_空串与纯空白等于不筛选_但触发信封(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            register(c, "bob")
            login(c, "alice", "password123")
            for s in ("", "   "):
                body = c.get("/api/admin/users", params={"search": s}).json()
                assert isinstance(body, dict)
                assert body["total"] == 2  # 不筛选（§4.1：trim 后空串 = 不筛选）

    def test_下划线与百分号按字面量匹配(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "a_b")
            register(c, "axb")
            login(c, "a_b", "password123")
            _insert_users(c, ["a%b"])  # 注册接口字符集不含 %，直插补 ESCAPE 对立面
            assert [u["username"] for u in c.get(
                "/api/admin/users", params={"search": "a_b"}
            ).json()["items"]] == ["a_b"]  # axb 不命中：_ 已转义为字面量
            assert [u["username"] for u in c.get(
                "/api/admin/users", params={"search": "a%b"}
            ).json()["items"]] == ["a%b"]  # % 不作通配符

    def test_搜索与分页组合_offset钳制(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            register(c, "spam-bot-2026")
            login(c, "alice", "password123")
            body = c.get(
                "/api/admin/users", params={"search": "spam", "offset": 5}
            ).json()
            assert body["total"] == 1
            assert body["offset"] == 0  # 唯一命中，offset 钳回首
            assert len(body["items"]) == 1


class TestUsersPagination:
    def test_首页中间页末页_真实total(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "admin-u")  # 首注册 = 管理员（id 1）
            _insert_users(c, [f"u{i:02d}" for i in range(1, 16)])  # 共 16 用户
            body = c.get(
                "/api/admin/users", params={"limit": 7, "offset": 0}
            ).json()
            assert body["total"] == 16
            assert len(body["items"]) == 7
            assert body["items"][0]["username"] == "admin-u"  # created_at,id 序
            assert len(c.get(
                "/api/admin/users", params={"limit": 7, "offset": 7}
            ).json()["items"]) == 7
            tail = c.get(
                "/api/admin/users", params={"limit": 7, "offset": 14}
            ).json()
            assert len(tail["items"]) == 2
            assert tail["offset"] == 14

    def test_越界钳制到最后一页(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "admin-u")
            _insert_users(c, [f"u{i:02d}" for i in range(1, 16)])  # 16 用户，页大小 7
            for bad in (16, 100):
                body = c.get(
                    "/api/admin/users", params={"limit": 7, "offset": bad}
                ).json()
                assert body["offset"] == 14  # floor((16-1)/7)*7 = 14（§8-②）
                assert len(body["items"]) == 2
                assert body["total"] == 16

    @pytest.mark.parametrize("params", [
        {"limit": 0}, {"limit": 101}, {"offset": -1},
    ])
    def test_参数非法_422(self, tmp_path: Path, params: dict):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            assert c.get("/api/admin/users", params=params).status_code == 422

    def test_无参数_纯列表形状等价现状(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            register(c, "spam-bot-2026")
            register(c, "bob")
            login(c, "alice", "password123")
            rows = c.get("/api/admin/users").json()
            assert isinstance(rows, list)  # 非信封（定夺①：默认形状零变化）
            assert [r["username"] for r in rows] == ["alice", "spam-bot-2026", "bob"]
            assert set(rows[0]) == {
                "id", "username", "is_admin", "banned", "created_at",
                "mode", "quota_override", "daily_limit", "used_today",
            }


# ---------- REQ-029（iter-12 T1）：design-iter-12 §4.2 用量排序后端化 + 分页 ----------

# 三用户 × 三日造数（tie：alice/bob 今日同为 5 请求，验 tie-break username 升序）
_USAGE_ROWS = [
    (_TODAY, 1, "unified", 5, 100),
    (_TODAY, 2, "unified", 5, 50),
    (_TODAY, 3, "unified", 9, 900),
    (_YDAY, 1, "self", 7, 700),
    (_YDAY, 2, "unified", 1, 10),
    (_D2, 3, "unified", 2, 2000),
]


class TestUsageSortPagination:
    def test_排序三键升降与tie_break(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            register(c, "bob")
            register(c, "carol")
            login(c, "alice", "password123")
            _seed_usage(c, _USAGE_ROWS)

            def names(**params):
                return [
                    (r["day"], r["username"])
                    for r in c.get("/api/admin/usage", params=params).json()["items"]
                ]

            assert names(sort_key="requests", sort_dir="desc") == [
                (_TODAY, "carol"), (_YDAY, "alice"),
                (_TODAY, "alice"), (_TODAY, "bob"),  # 同 5 请求：alice < bob
                (_D2, "carol"), (_YDAY, "bob"),
            ]
            assert names(sort_key="tokens", sort_dir="asc") == [
                (_YDAY, "bob"), (_TODAY, "bob"), (_TODAY, "alice"),
                (_YDAY, "alice"), (_TODAY, "carol"), (_D2, "carol"),
            ]
            assert names(sort_key="day", sort_dir="asc") == [
                (_D2, "carol"), (_YDAY, "alice"), (_YDAY, "bob"),
                (_TODAY, "alice"), (_TODAY, "bob"), (_TODAY, "carol"),
            ]

    @pytest.mark.parametrize("params", [
        {"sort_key": "evil"}, {"sort_dir": "up"},
        {"sort_key": "requests", "limit": 0},
    ])
    def test_非法排序与分页参数_422(self, tmp_path: Path, params: dict):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            assert c.get("/api/admin/usage", params=params).status_code == 422

    def test_分页total与distinct_days不受翻页影响(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            register(c, "bob")
            register(c, "carol")
            login(c, "alice", "password123")
            _seed_usage(c, _USAGE_ROWS)
            body = c.get(
                "/api/admin/usage", params={"limit": 4, "offset": 0}
            ).json()
            assert (body["total"], body["distinct_days"]) == (6, 3)
            assert len(body["items"]) == 4
            page2 = c.get(
                "/api/admin/usage", params={"limit": 4, "offset": 4}
            ).json()
            assert len(page2["items"]) == 2
            assert page2["distinct_days"] == 3  # 全窗口判定，非当页
            # 用户过滤下 total/distinct_days 同步收窄
            u1 = c.get("/api/admin/usage",
                       params={"user_id": 1, "limit": 20}).json()
            assert (u1["total"], u1["distinct_days"]) == (2, 2)

    def test_越界钳制与空窗口空页(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            register(c, "bob")
            register(c, "carol")
            login(c, "alice", "password123")
            _seed_usage(c, _USAGE_ROWS)
            body = c.get(
                "/api/admin/usage", params={"limit": 4, "offset": 6}
            ).json()
            assert body["offset"] == 4  # floor((6-1)/4)*4 = 4
            assert len(body["items"]) == 2
            empty = c.get(
                "/api/admin/usage",
                params={"date_from": "2999-01-01", "limit": 20},
            ).json()
            assert empty["total"] == 0
            assert empty["items"] == []
            assert empty["distinct_days"] == 0
            assert empty["offset"] == 0

    def test_仅既有三过滤参数_纯列表现状默认序(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            register(c, "bob")
            register(c, "carol")
            login(c, "alice", "password123")
            _seed_usage(c, _USAGE_ROWS)
            rows = c.get("/api/admin/usage",
                         params={"user_id": 1, "date_to": "2999-12-31"}).json()
            assert isinstance(rows, list)  # 非信封（定夺①）
            assert [(r["day"], r["username"]) for r in rows] == [
                (_TODAY, "alice"), (_YDAY, "alice"),
            ]  # 现状默认序：day DESC, username


# ---------- REQ-029（iter-12 T1）：design-iter-12 §4.3 概览统计聚合 ----------

class TestOverviewStats:
    def test_全模式合计_昨日不计入_不估算(self, tmp_path: Path):
        with upstream_app(tmp_path, usage_handler) as (c, _):
            register(c, "alice")
            assert chat(c).status_code == 200  # alice 今日 1 请求 × 18 token（unified）
            register(c, "bob")
            login(c, "alice", "password123")
            _seed_usage(c, [
                (_YDAY, 1, "unified", 4, 400),  # 昨日不计入今日聚合
                (_TODAY, 2, "self", 2, 200),     # 自填模式计入合计
            ])
            body = c.get("/api/admin/overview").json()
            assert body["day"] == quota.today()
            assert body["total_users"] == 2
            assert body["today_requests"] == 3  # 1（chat）+ 2（self）
            assert body["today_tokens"] == 218  # 18 + 200
            assert body["unified_used"] == 1    # 仅 unified 今日（昨日 4 不计）
            assert body["unified_daily_total"] == 2000

    def test_无记录为0_含封禁与管理员(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            register(c, "bob")
            assert login(c, "alice", "password123").status_code == 200
            assert c.post("/api/admin/users/2/ban").status_code == 200
            body = c.get("/api/admin/overview").json()
            assert body["total_users"] == 2  # 含已封禁与管理员（§4.3）
            assert body["today_requests"] == 0
            assert body["today_tokens"] == 0
            assert body["unified_used"] == 0
