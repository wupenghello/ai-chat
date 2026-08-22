"""iter-21 T2（CHG-015 REQ-052）：普通用户个人用量端点 GET /api/usage/summary——
造数聚合数值精确断言 / 跨用户隔离 / days 枚举边界 / 单价未配置语义 / 空窗口 /
today 快照与 /api/quota 同源 / 成本体例与 admin 同构。

实现依据：design-iter-21 §5 API 形状定案（随稿定案）+ CHG-015 六定夺（定夺③成本口径）。
REQ-052 验收 5 红线：tests/test_quota.py 逐字节零改动随 make check 复跑
（本文件为纯新增，不触既有用例）。
"""

from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

from app.config import Settings, get_settings
from app.main import create_app
from fastapi.testclient import TestClient

from tests.conftest import login, register


def _login(c, username: str):
    return login(c, username, "password123")

PRICE = {"price_input": 2.0, "price_output": 8.0, "price_cache_hit": 0.5}


def _day(back: int) -> str:
    return (datetime.now() - timedelta(days=back)).strftime("%Y-%m-%d")


_TODAY = _day(0)


@contextmanager
def usage_app(tmp_path: Path, *, price: bool = True):
    """个人用量端点应用夹具：单价三变量显式注入/显式置 None（.env 不参与本夹具口径）。"""
    kwargs: dict = {"db_path": str(tmp_path / "t.db")}
    if price:
        kwargs.update(PRICE)
    else:
        kwargs.update(price_input=None, price_output=None, price_cache_hit=None)
    settings = Settings(**kwargs)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        register(c, "alice")    # user_id = 1（面板主体）
        register(c, "bob")      # user_id = 2（跨用户隔离断言用）
        yield c


def _seed(c, rows: list[dict]) -> None:
    """直插 telemetry 行（造数仅用于测试断言，铁律 5；列白名单与 schema 一致）。"""
    import sqlite3

    conn = sqlite3.connect(c.app.state.db_path)
    try:
        with conn:
            for r in rows:
                keys = list(r)
                conn.execute(
                    f"INSERT INTO telemetry ({', '.join(keys)}) "
                    f"VALUES ({', '.join('?' for _ in keys)})",
                    tuple(r[k] for k in keys),
                )
    finally:
        conn.close()


def _llm(day: str, mode: str, *, turn="t-1", prompt=None, completion=None,
         total=None, hit=None, miss=None, user_id=1, endpoint="turn") -> dict:
    return {
        "day": day, "user_id": user_id, "mode": mode, "endpoint": endpoint,
        "kind": "llm", "turn_id": turn, "step": 1, "model": "deepseek-test",
        "latency_ms": 100, "status": "ok",
        "tokens_prompt": prompt, "tokens_completion": completion,
        "tokens_total": total if total is not None else 0,
        "cache_hit_tokens": hit, "cache_miss_tokens": miss,
    }


def _compact(day: str, mode: str, *, prompt=0, user_id=1) -> dict:
    """手动压缩行（endpoint='compact'、turn_id=NULL）。"""
    return {
        "day": day, "user_id": user_id, "mode": mode, "endpoint": "compact",
        "kind": "compress", "turn_id": None, "step": None, "model": "deepseek-test",
        "latency_ms": 500, "status": "ok",
        "tokens_prompt": prompt, "tokens_completion": 0, "tokens_total": prompt,
        "cache_hit_tokens": None, "cache_miss_tokens": None,
    }


def _get(c, days: int | None = None):
    return c.get("/api/usage/summary" + (f"?days={days}" if days is not None else ""))


# ---------- 门禁与参数 ----------

def test_未登录_401(tmp_path):
    # 独立应用（不经夹具注册——register 返回即附带会话凭证）：无凭证访问 = 401
    settings = Settings(db_path=str(tmp_path / "t.db"))
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        assert _get(c).status_code == 401


def test_days_缺省7_且30合法(tmp_path):
    with usage_app(tmp_path) as c:
        _login(c, "alice")
        assert _get(c).json()["window"]["days"] == 7
        assert _get(c, 30).json()["window"]["days"] == 30


def test_days_越界或非档位_422(tmp_path):
    with usage_app(tmp_path) as c:
        _login(c, "alice")
        for bad in (0, 14, 90, -1):
            assert _get(c, bad).status_code == 422, bad


# ---------- 聚合一致性（REQ-052 验收 1：与 telemetry 表抽样比对） ----------

def test_聚合数值_回合与token与费用_精确断言(tmp_path):
    with usage_app(tmp_path) as c:
        _login(c, "alice")
        # 今日：t-1 两步（1 回合）unified 带/不带缓存各一行；t-2 一回合 self 模式
        _seed(c, [
            _llm(_TODAY, "unified", turn="t-1", prompt=1_000_000, completion=100_000,
                 total=1_100_000, hit=200_000, miss=800_000),
            _llm(_TODAY, "unified", turn="t-1", prompt=500_000, completion=50_000,
                 total=550_000),
            _llm(_TODAY, "self", turn="t-2", prompt=300_000, completion=30_000,
                 total=330_000),
        ])
        d = _get(c).json()["daily"][0]
        assert d["day"] == _TODAY
        assert d["turns"] == 2                     # DISTINCT turn_id（t-1 两步计 1 回合）
        assert d["tokens_prompt"] == 1_800_000     # 两模式合计
        assert d["tokens_completion"] == 180_000
        assert d["cache_hit_tokens"] == 200_000
        # 成本仅 unified：prompt 1.5M×2 + completion 150k×8 + hit 200k×0.5（各 /1e6）
        assert d["cost_total"] == round(3.0 + 1.2 + 0.1, 6)


def test_手动压缩行_不计回合_摘要tokens入列并入成本(tmp_path):
    with usage_app(tmp_path) as c:
        _login(c, "alice")
        _seed(c, [
            _llm(_TODAY, "unified", turn="t-1", prompt=100_000, completion=10_000,
                 total=110_000),
            _compact(_TODAY, "unified", prompt=20_000),
        ])
        d = _get(c).json()["daily"][0]
        assert d["turns"] == 1                     # 压缩 turn_id=NULL 不计回合
        assert d["tokens_prompt"] == 120_000       # 摘要调用 tokens 如实入列
        # 成本：llm 100k×2 + 10k×8 + 压缩 20k×2（按输入计价）
        assert d["cost_total"] == round(0.2 + 0.08 + 0.04, 6)


def test_self压缩行_tokens入列_不计成本(tmp_path):
    with usage_app(tmp_path) as c:
        _login(c, "alice")
        _seed(c, [_compact(_TODAY, "self", prompt=20_000)])
        d = _get(c).json()["daily"][0]
        assert d["tokens_prompt"] == 20_000
        assert d["cost_total"] == 0.0              # 无 unified 计费行 → 真值 0（非造数）


def test_缓存全缺失_null不显0(tmp_path):
    with usage_app(tmp_path) as c:
        _login(c, "alice")
        _seed(c, [_llm(_TODAY, "unified", prompt=1_000, completion=100,
                       total=1_100, hit=None, miss=None)])
        assert _get(c).json()["daily"][0]["cache_hit_tokens"] is None


def test_仅列有数据日_按日倒序_窗口外不取(tmp_path):
    with usage_app(tmp_path) as c:
        _login(c, "alice")
        _seed(c, [
            _llm(_day(0), "unified", turn="a", prompt=1, completion=1, total=2),
            _llm(_day(2), "unified", turn="b", prompt=1, completion=1, total=2),
            _llm(_day(8), "unified", turn="c", prompt=1, completion=1, total=2),  # 7 天窗内不含
        ])
        r = _get(c).json()
        assert [d["day"] for d in r["daily"]] == [_day(0), _day(2)]
        assert len(_get(c, 30).json()["daily"]) == 3   # 30 天窗含第 8 天前的行


# ---------- 跨用户隔离（REQ-052 验收 3） ----------

def test_跨用户隔离_bob数据不出现在alice面板(tmp_path):
    with usage_app(tmp_path) as c:
        _login(c, "alice")
        _seed(c, [
            _llm(_TODAY, "unified", turn="a", prompt=1_000, completion=100,
                 total=1_100, user_id=1),
            _llm(_TODAY, "unified", turn="b", prompt=9_000_000, completion=9_000_000,
                 total=18_000_000, user_id=2),
        ])
        d = _get(c).json()["daily"][0]
        assert d["tokens_prompt"] == 1_000
        assert d["cost_total"] == round(1_000 * 2 / 1e6 + 100 * 8 / 1e6, 6)
        # bob 查自己 = 只见自己的行
        _login(c, "bob")
        d2 = _get(c).json()["daily"][0]
        assert d2["tokens_prompt"] == 9_000_000


# ---------- 未配置单价与空窗口（REQ-052 验收 4） ----------

def test_单价未配置_cost_null_tokens照常(tmp_path):
    with usage_app(tmp_path, price=False) as c:
        _login(c, "alice")
        _seed(c, [_llm(_TODAY, "unified", turn="a", prompt=5_000, completion=500,
                       total=5_500, hit=100, miss=200)])
        r = _get(c).json()
        assert r["price"]["configured"] is False
        assert r["daily"][0]["cost_total"] is None
        assert r["daily"][0]["tokens_prompt"] == 5_000
        assert r["today"]["cost_total"] is None


def test_空窗口_daily空数组非404(tmp_path):
    with usage_app(tmp_path) as c:
        _login(c, "alice")
        r = _get(c).json()
        assert r["daily"] == []
        assert r["window"]["days"] == 7


# ---------- today 快照（定夺④：与 /api/quota 同源） ----------

def test_today快照与quota端点同源(tmp_path):
    with usage_app(tmp_path) as c:
        _login(c, "alice")
        _seed(c, [_llm(_TODAY, "unified", turn="a", prompt=1_000_000,
                       completion=0, total=1_000_000)])
        t = _get(c).json()["today"]
        q = c.get("/api/quota").json()
        assert t["mode"] == q["mode"] == "unified"
        assert t["daily_limit"] == q["daily_limit"]
        assert t["used_today"] == q["used_today"] == 0   # 造数直插不落 usage_daily，双源同刻一致
        assert t["cost_total"] == 2.0                    # 1M×2/1e6


# ---------- 成本体例与 admin 同构（REQ-052 验收 2） ----------

def test_成本体例与admin端点同构_同单价同算法(tmp_path):
    with usage_app(tmp_path) as c:
        _login(c, "alice")
        rows = [
            _llm(_TODAY, "unified", turn="a", prompt=2_000_000, completion=300_000,
                 total=2_300_000, hit=500_000, miss=1_500_000),
            _compact(_TODAY, "unified", prompt=100_000),
        ]
        _seed(c, rows)
        personal = _get(c).json()["daily"][0]["cost_total"]
        # admin 视角（首注册用户 alice 即 admin）：全站同日成本 = 同一批行同一算法
        admin_daily = c.get("/api/admin/telemetry?days=7").json()["daily"]
        admin_today = next(d for d in admin_daily if d["day"] == _TODAY)
        assert personal == admin_today["cost_total"]
