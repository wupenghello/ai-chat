"""REQ-024（iter-8 T1）：注册限频 / 按日配额（档位联动）/ 统一 key 熔断 / 用量落库 / 配额端点。

- 配额数值经 settings_extra 注入小阈值，避免测试依赖默认 30/500/2000
- 自然日重置以 monkeypatch quota.today 模拟（服务器本地时区口径不变）
- 「配额不足不抵达上游」以 upstream_app 的 seen 请求列表取证（对应服务端日志验收）
"""

import logging
from pathlib import Path

import httpx
import pytest
from app import quota
from app.db import connect, init_db

from tests.conftest import login, register
from tests.test_proxy import SSE_FRAMES, _sse_response, chat, ok_handler, upstream_app

# OpenAI 兼容 usage 帧：[DONE] 前压轴下发（stream_options.include_usage）
USAGE_FRAME = (
    'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}}\n\n'
)


def _frames() -> list[str]:
    """按帧重组：既有 delta 帧 + usage 帧 + [DONE]。"""
    return [*SSE_FRAMES[:-1], USAGE_FRAME, SSE_FRAMES[-1]]


def usage_handler(request: httpx.Request) -> httpx.Response:
    return _sse_response(*_frames())


def quota_db(c) -> object:
    """直连测试库——用量/限频计数断言用。"""
    return connect(c.app.state.db_path)  # type: ignore[attr-defined]


class TestRegisterLimit:
    def test_同IP超阈值_第N加1次拒绝_用户数不增(self, tmp_path: Path):
        extra = {"register_ip_daily_limit": 2}
        with upstream_app(tmp_path, ok_handler, settings_extra=extra) as (c, _):
            assert register(c, "alice").status_code == 201
            assert register(c, "bob").status_code == 201
            r = register(c, "carol")
            assert r.status_code == 429
            assert r.json()["detail"] == quota.REGISTER_LIMITED
            conn = quota_db(c)
            try:
                n = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
            finally:
                conn.close()
            assert n == 2

    def test_次日重置_可再注册(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        extra = {"register_ip_daily_limit": 1}
        with upstream_app(tmp_path, ok_handler, settings_extra=extra) as (c, _):
            assert register(c, "alice").status_code == 201
            assert register(c, "bob").status_code == 429
            monkeypatch.setattr(quota, "today", lambda: "2099-01-02")
            assert register(c, "bob").status_code == 201

    def test_不同IP互不影响(self, tmp_path: Path):
        extra = {"register_ip_daily_limit": 1}
        with upstream_app(tmp_path, ok_handler, settings_extra=extra) as (c, _):
            assert register(c, "alice").status_code == 201
            conn = quota_db(c)
            try:
                # TestClient 的 client.host 固定为 testclient，另一 IP 经函数级取证
                assert quota.register_try_consume(conn, "10.0.0.9", 1) is True
            finally:
                conn.close()

    def test_注册限频不影响登录(self, tmp_path: Path):
        extra = {"register_ip_daily_limit": 1}
        with upstream_app(tmp_path, ok_handler, settings_extra=extra) as (c, _):
            assert register(c, "alice").status_code == 201
            assert register(c, "bob").status_code == 429
            assert login(c, "alice", "password123").status_code == 200


class TestUserQuota:
    def test_免费档边界_恰好N次通过_第N加1次拦截且未抵达上游(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ):
        extra = {"quota_free_daily": 2}
        with upstream_app(tmp_path, ok_handler, settings_extra=extra) as (c, seen):
            register(c, "alice")
            assert chat(c).status_code == 200
            assert chat(c).status_code == 200  # 恰好在阈值上：第 2 次仍放行
            with caplog.at_level(logging.INFO, logger="ai-chat.quota"):
                r = chat(c)
            assert r.status_code == 429
            body = r.json()
            assert body["code"] == "quota_exhausted"
            assert body["detail"] == quota.QUOTA_EXHAUSTED_UNIFIED
            assert "解锁更高配额" in body["detail"]  # design-iter-7 §3.1 行 20 定稿文案
            assert len(seen) == 2  # 被拦截请求未抵达上游（服务端日志同口径取证）
            assert any("chat blocked" in rec.message for rec in caplog.records)

    def test_被拦截请求不计数(self, tmp_path: Path):
        extra = {"quota_free_daily": 1}
        with upstream_app(tmp_path, ok_handler, settings_extra=extra) as (c, seen):
            register(c, "alice")
            assert chat(c).status_code == 200
            for _ in range(3):
                assert chat(c).status_code == 429
            conn = quota_db(c)
            try:
                n = conn.execute(
                    "SELECT requests FROM usage_daily WHERE mode = 'unified'"
                ).fetchone()["requests"]
            finally:
                conn.close()
            assert n == 1  # 反复重试不放大计数
            assert len(seen) == 1

    def test_档位联动_统一档用尽_自填档解锁_自填档用尽换文案(self, tmp_path: Path):
        with upstream_app(
            tmp_path, ok_handler, settings_extra={"quota_free_daily": 2, "quota_self_daily": 4}
        ) as (c, seen):
            register(c, "alice")
            assert chat(c).status_code == 200
            assert chat(c).status_code == 200
            assert chat(c).json()["code"] == "quota_exhausted"  # 免费档 2 已用尽
            pid = c.post(
                "/api/profiles",
                json={
                    "name": "DeepSeek",
                    "base_url": "http://upstream.test",
                    "model": "m",
                    "api_key": "sk-self-test",
                },
            ).json()["id"]
            assert c.post(f"/api/profiles/{pid}/activate").status_code == 200
            assert chat(c).status_code == 200  # 自填档解锁（同日总消耗 2 < 4）
            assert chat(c).status_code == 200  # 总消耗 4 = 自填档上限
            r = chat(c)
            assert r.status_code == 429
            assert r.json()["detail"] == quota.QUOTA_EXHAUSTED_SELF  # 自填档文案无解锁引导
            assert len(seen) == 4

    def test_配额次日重置(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        extra = {"quota_free_daily": 1}
        with upstream_app(tmp_path, ok_handler, settings_extra=extra) as (c, _):
            register(c, "alice")
            assert chat(c).status_code == 200
            assert chat(c).status_code == 429
            monkeypatch.setattr(quota, "today", lambda: "2099-01-02")
            assert chat(c).status_code == 200


class TestUnifiedFuse:
    def test_全站熔断_统一模式全拦_自填模式不受影响(self, tmp_path: Path):
        with upstream_app(
            tmp_path, ok_handler, settings_extra={"quota_free_daily": 10, "unified_daily_total": 2}
        ) as (c, seen):
            register(c, "alice")
            register(c, "bob")  # 注册即登录，当前会话为 bob
            assert chat(c).status_code == 200  # bob 1 次（全站 1）
            assert login(c, "alice", "password123").status_code == 200
            assert chat(c).status_code == 200  # alice 1 次（全站 2 = 总量）
            r = chat(c)
            assert r.status_code == 503
            body = r.json()
            assert body["code"] == "unified_daily_exceeded"
            assert body["detail"] == quota.UNIFIED_PAUSED
            # 自填模式不受全站熔断影响
            pid = c.post(
                "/api/profiles",
                json={
                    "name": "DeepSeek",
                    "base_url": "http://upstream.test",
                    "model": "m",
                    "api_key": "sk-self-test",
                },
            ).json()["id"]
            c.post(f"/api/profiles/{pid}/activate")
            assert chat(c).status_code == 200
            assert len(seen) == 3  # 熔断拦截的请求未抵达上游

    def test_熔断次日恢复(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        with upstream_app(
            tmp_path, ok_handler, settings_extra={"quota_free_daily": 10, "unified_daily_total": 1}
        ) as (c, _):
            register(c, "alice")
            assert chat(c).status_code == 200
            assert chat(c).status_code == 503
            monkeypatch.setattr(quota, "today", lambda: "2099-01-02")
            assert chat(c).status_code == 200


class TestUsageRecording:
    def test_成功对话_请求数与token数落库(self, tmp_path: Path):
        with upstream_app(tmp_path, usage_handler) as (c, _):
            register(c, "alice")
            assert chat(c).status_code == 200
            conn = quota_db(c)
            try:
                row = conn.execute(
                    "SELECT requests, tokens FROM usage_daily WHERE mode = 'unified'"
                ).fetchone()
            finally:
                conn.close()
            assert row["requests"] == 1
            assert row["tokens"] == 18  # usage 帧 total_tokens（机器采集）

    def test_上游无usage帧_token记0(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            assert chat(c).status_code == 200
            conn = quota_db(c)
            try:
                row = conn.execute(
                    "SELECT requests, tokens FROM usage_daily WHERE mode = 'unified'"
                ).fetchone()
            finally:
                conn.close()
            assert row["requests"] == 1
            assert row["tokens"] == 0

    def test_自填模式用量按mode分账(self, tmp_path: Path):
        with upstream_app(tmp_path, usage_handler) as (c, _):
            register(c, "alice")
            assert chat(c).status_code == 200  # unified 1 次
            pid = c.post(
                "/api/profiles",
                json={
                    "name": "DeepSeek",
                    "base_url": "http://upstream.test",
                    "model": "m",
                    "api_key": "sk-self-test",
                },
            ).json()["id"]
            c.post(f"/api/profiles/{pid}/activate")
            assert chat(c).status_code == 200  # self 1 次
            conn = quota_db(c)
            try:
                rows = {
                    r["mode"]: (r["requests"], r["tokens"])
                    for r in conn.execute("SELECT mode, requests, tokens FROM usage_daily")
                }
            finally:
                conn.close()
            assert rows == {"unified": (1, 18), "self": (1, 18)}

    def test_跨零点流_token记到请求日而非today(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        # Code Review 观察项①：请求时落账 day=2099-01-01，流跨零点（today 已 2099-01-02）结束，
        # record_tokens 传入请求日，token 归该日而非此刻 today()。
        db_path = str(tmp_path / "cross.db")
        conn = connect(db_path)
        try:
            init_db(conn)
            with conn:
                cur = conn.execute(
                    "INSERT INTO users (username, username_key, password_hash) "
                    "VALUES ('alice', 'alice', 'x')"
                )
                user_id = cur.lastrowid
                conn.execute(
                    "INSERT INTO usage_daily (day, user_id, mode, requests) "
                    "VALUES ('2099-01-01', ?, 'unified', 1)",
                    (user_id,),
                )
        finally:
            conn.close()

        monkeypatch.setattr(quota, "today", lambda: "2099-01-02")
        quota.record_tokens(db_path, user_id, quota.MODE_UNIFIED, 18, "2099-01-01")

        conn = connect(db_path)
        try:
            row = conn.execute(
                "SELECT day, tokens FROM usage_daily WHERE user_id = ? AND mode = 'unified'",
                (user_id,),
            ).fetchone()
            tomorrow_n = conn.execute(
                "SELECT COUNT(*) AS n FROM usage_daily WHERE day = '2099-01-02'"
            ).fetchone()["n"]
        finally:
            conn.close()
        assert row["day"] == "2099-01-01"
        assert row["tokens"] == 18
        assert tomorrow_n == 0  # 未误记到 today() 的次日行


class TestQuotaEndpoint:
    def test_未登录_401(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            assert c.get("/api/quota").status_code == 401

    def test_统一模式_默认档口径(self, tmp_path: Path):
        with upstream_app(tmp_path, usage_handler) as (c, _):
            register(c, "alice")
            assert chat(c).status_code == 200
            body = c.get("/api/quota").json()
            assert body == {
                "mode": "unified",
                "daily_limit": 30,  # iter-8 计划定案默认值（CEO 拍板 2026-08-16）
                "used_today": 1,
                "reset_at": "明日 00:00",
            }

    def test_自填模式_档位切换口径(self, tmp_path: Path):
        with upstream_app(tmp_path, ok_handler) as (c, _):
            register(c, "alice")
            pid = c.post(
                "/api/profiles",
                json={
                    "name": "DeepSeek",
                    "base_url": "http://upstream.test",
                    "model": "m",
                    "api_key": "sk-self-test",
                },
            ).json()["id"]
            c.post(f"/api/profiles/{pid}/activate")
            body = c.get("/api/quota").json()
            assert body["mode"] == "self"
            assert body["daily_limit"] == 500
