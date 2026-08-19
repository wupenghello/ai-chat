"""iter-15 T3（CHG-009 REQ-038）：admin 遥测聚合端点——造数聚合数值精确断言 /
缺失与单价未配置语义 / days 参数边界 / 403 零泄露 / 时间语义。

实现依据：design-iter-15 §5 API 口径（随稿定案）+ CHG-009 4.3 聚合公式 + T0 取证 NULL 语义。
REQ-038 验收 1（既有六端点形状零变化 + 既有 admin pytest 零改动复跑全绿）为文件级取证：
tests/test_admin.py 逐字节零改动随 make check 复跑（本文件为纯新增，不触既有用例）。
"""

from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

from app.config import Settings, get_settings
from app.main import create_app
from fastapi.testclient import TestClient

from tests.conftest import login, register

PRICE = {"price_input": 2.0, "price_output": 8.0, "price_cache_hit": 0.5}

_TODAY = datetime.now().strftime("%Y-%m-%d")


def _day(back: int) -> str:
    return (datetime.now() - timedelta(days=back)).strftime("%Y-%m-%d")


@contextmanager
def tel_app(tmp_path: Path, *, price: bool = True):
    """遥测端点应用夹具：单价三变量显式注入/显式置 None（.env 不参与本夹具口径）。"""
    kwargs: dict = {"db_path": str(tmp_path / "t.db")}
    if price:
        kwargs.update(PRICE)
    else:
        kwargs.update(price_input=None, price_output=None, price_cache_hit=None)
    settings = Settings(**kwargs)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        register(c, "root")   # 首注册用户 = admin（REQ-025 引导口径）
        register(c, "mallory")  # 普通用户（403 断言用）
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


def _llm(day: str, mode: str, *, prompt=None, completion=None, total=None,
         hit=None, miss=None, user_id=1) -> dict:
    return {
        "day": day, "user_id": user_id, "mode": mode, "endpoint": "turn",
        "kind": "llm", "turn_id": "t-x", "step": 1, "model": "deepseek-test",
        "latency_ms": 100, "status": "ok",
        "tokens_prompt": prompt, "tokens_completion": completion,
        "tokens_total": total if total is not None else 0,
        "cache_hit_tokens": hit, "cache_miss_tokens": miss,
    }


def _tool(day: str, name: str, status: str, latency: int, user_id=1) -> dict:
    return {
        "day": day, "user_id": user_id, "mode": "unified", "endpoint": "turn",
        "kind": "tool", "turn_id": "t-x", "step": 2, "latency_ms": latency,
        "status": status, "tool_name": name,
    }


def _as_admin(c) -> None:
    assert login(c, "root", "password123").status_code == 200


def _as_mallory(c) -> None:
    assert login(c, "mallory", "password123").status_code == 200


# ---------- REQ-038 验收 2：造数聚合数值精确断言 ----------

def test_遥测_造数聚合_成本命中率工具精确值(tmp_path: Path):
    """成本 = Σtokens×单价÷1e6 三项分项（仅 unified 行）精确值；命中率数值；
    工具 tool_name×status 聚合与确定性排序；仅列有数据日；retention_days=90。"""
    with tel_app(tmp_path) as c:
        _seed(c, [
            # 今日 unified 两行（含 hit=0 合法真值行）+ self 一行（缓存 NULL）
            _llm(_day(0), "unified", prompt=100000, completion=20000, total=120000,
                 hit=50000, miss=50000),
            _llm(_day(0), "unified", prompt=50000, completion=10000, total=60000,
                 hit=0, miss=50000),
            _llm(_day(0), "self", total=12480),
            # 昨日 unified 一行
            _llm(_day(1), "unified", prompt=200000, completion=40000, total=240000,
                 hit=100000, miss=100000),
            # 前天无行（缺口日）；大前天仅 self 行 + echo 工具行
            _llm(_day(3), "self", total=5000),
            _tool(_day(3), "echo", "ok", 5),
            # 今日工具行：search ok×2 / error×1
            _tool(_day(0), "search", "ok", 2000),
            _tool(_day(0), "search", "ok", 2200),
            _tool(_day(0), "search", "error", 900),
        ])
        _as_admin(c)
        r = c.get("/api/admin/telemetry?days=7")
        assert r.status_code == 200
        body = r.json()

    # 顶层形状逐字（design-iter-15 §5；iter-16 T3 加法 compact 键——既有键零变化，
    # 改写映射登记 plans/iter-16-verify.md T3 段）
    assert set(body) == {"window", "price", "today_cost", "daily", "tools", "compact",
                         "retention_days"}
    assert body["window"] == {"days": 7, "date_from": _day(6), "date_to": _TODAY}
    assert body["price"] == {"configured": True, "input_per_mtok": 2.0,
                             "output_per_mtok": 8.0, "cache_hit_per_mtok": 0.5}
    assert body["retention_days"] == 90

    # today_cost：成本 = tokens×单价 精确值（三项分项 + 合计）
    tc = body["today_cost"]
    assert tc["day"] == _TODAY
    assert tc["tokens_prompt"] == 150000
    assert tc["tokens_completion"] == 30000
    assert tc["cache_hit_tokens"] == 50000
    assert tc["cost_input"] == round(150000 * 2.0 / 1_000_000, 6)      # 0.3
    assert tc["cost_output"] == round(30000 * 8.0 / 1_000_000, 6)     # 0.24
    assert tc["cost_cache_hit"] == round(50000 * 0.5 / 1_000_000, 6)  # 0.025
    assert tc["cost_total"] == round(
        round(150000 * 2.0 / 1e6, 6) + round(30000 * 8.0 / 1e6, 6)
        + round(50000 * 0.5 / 1e6, 6), 6)                              # 0.565
    assert tc["self_tokens_total"] == 12480

    # daily：仅列有数据日（3 天 < 7 天窗口 → 缺口由前端判定）；日期降序
    days = [d["day"] for d in body["daily"]]
    assert days == [_day(0), _day(1), _day(3)]
    d0, d1, d3 = body["daily"]
    assert d0["cache_rate"] == round(50000 / 150000, 6)   # 0.333333（hit=0 行如实计入分母）
    assert d0["cache_hit_tokens"] == 50000 and d0["cache_miss_tokens"] == 100000
    assert d1["cache_rate"] == 0.5
    assert d1["cost_total"] == round(
        round(200000 * 2.0 / 1e6, 6) + round(40000 * 8.0 / 1e6, 6)
        + round(100000 * 0.5 / 1e6, 6), 6)                # 0.77
    # 仅 self 行的日子：unified 列真值 0、self 列如实、缓存无带字段行 → null
    assert d3["tokens_prompt"] == 0 and d3["tokens_completion"] == 0
    assert d3["self_tokens_total"] == 5000
    assert d3["cache_hit_tokens"] is None and d3["cache_miss_tokens"] is None
    assert d3["cache_rate"] is None
    assert d3["cost_total"] == 0.0

    # tools：tool_name×status 聚合，排序固定 tool_name ASC, status ASC
    assert body["tools"] == [
        {"tool_name": "echo", "status": "ok", "count": 1, "avg_duration_ms": 5},
        {"tool_name": "search", "status": "error", "count": 1, "avg_duration_ms": 900},
        {"tool_name": "search", "status": "ok", "count": 2, "avg_duration_ms": 2100},
    ]


def test_遥测_缺失语义_缓存NULL与无数据日不列(tmp_path: Path):
    """缓存列 NULL → 响应 null（前端显缺失的数据层语义，永不显 0）；
    无数据日不出现在 daily（缺失时段由前端窗口比对判定）；今日无行 today_cost 真值 0。"""
    with tel_app(tmp_path) as c:
        _seed(c, [_llm(_day(2), "unified", prompt=1000, completion=500, total=1500)])
        _as_admin(c)
        body = c.get("/api/admin/telemetry?days=7").json()

    assert [d["day"] for d in body["daily"]] == [_day(2)]  # 今日/昨日等无行不列
    d = body["daily"][0]
    assert d["cache_hit_tokens"] is None and d["cache_miss_tokens"] is None
    assert d["cache_rate"] is None
    tc = body["today_cost"]
    assert tc["day"] == _TODAY
    assert tc["tokens_prompt"] == 0 and tc["tokens_completion"] == 0
    assert tc["cache_hit_tokens"] == 0  # 无调用 = 无命中，真值 0（非造数）
    assert tc["cost_total"] == 0.0 and tc["self_tokens_total"] == 0


def test_遥测_混合日_命中率仅计带字段行(tmp_path: Path):
    """定夺⑤部分缺失口径：同日带字段行（unified）与 NULL 行（self）并存 →
    命中率仅按带字段行聚合，NULL 行不污染分母（CHG-009 4.3 时段级判定）。"""
    with tel_app(tmp_path) as c:
        _seed(c, [
            _llm(_day(0), "unified", prompt=100, completion=50, total=150, hit=30, miss=70),
            _llm(_day(0), "self", total=999),  # 缓存列 NULL：不参与命中率分母
        ])
        _as_admin(c)
        body = c.get("/api/admin/telemetry?days=7").json()

    d0 = body["daily"][0]
    assert d0["cache_rate"] == 0.3          # 30/(30+70)，NULL 行不参与
    assert d0["cache_hit_tokens"] == 30 and d0["cache_miss_tokens"] == 70
    assert d0["self_tokens_total"] == 999


def test_遥测_单价未配置_configured_false_cost全null_tokens如实(tmp_path: Path):
    """铁律 5：单价未配置 → 不估算。cost_* 全 null；tokens 字段如实返回不隐藏。"""
    with tel_app(tmp_path, price=False) as c:
        _seed(c, [_llm(_day(0), "unified", prompt=100000, completion=20000,
                       total=120000, hit=50000, miss=50000)])
        _as_admin(c)
        body = c.get("/api/admin/telemetry?days=7").json()

    assert body["price"] == {"configured": False, "input_per_mtok": None,
                             "output_per_mtok": None, "cache_hit_per_mtok": None}
    tc = body["today_cost"]
    assert tc["tokens_prompt"] == 100000 and tc["tokens_completion"] == 20000  # tokens 如实
    assert tc["cache_hit_tokens"] == 50000
    for k in ("cost_input", "cost_output", "cost_cache_hit", "cost_total"):
        assert tc[k] is None
    assert body["daily"][0]["cost_total"] is None
    assert body["daily"][0]["cache_rate"] == 0.5  # 命中率不受单价影响


# ---------- days 参数边界（越界/非整数 422；1/90 通过；默认 7） ----------

def test_遥测_days参数边界(tmp_path: Path):
    with tel_app(tmp_path) as c:
        _as_admin(c)
        assert c.get("/api/admin/telemetry").json()["window"]["days"] == 7  # 默认 7
        assert c.get("/api/admin/telemetry?days=1").status_code == 200
        assert c.get("/api/admin/telemetry?days=90").status_code == 200
        for bad in ("0", "91", "abc", "7.5", "-3"):
            assert c.get(f"/api/admin/telemetry?days={bad}").status_code == 422, bad
        assert c.get("/api/admin/telemetry?days=1").json()["window"] == {
            "days": 1, "date_from": _TODAY, "date_to": _TODAY}


# ---------- REQ-038 验收 3：普通用户 403 零泄露 ----------

def test_遥测_普通用户_403_响应体零遥测字段(tmp_path: Path):
    with tel_app(tmp_path) as c:
        _seed(c, [_llm(_day(0), "unified", prompt=100, completion=50, total=150)])
        _as_mallory(c)  # 普通用户（非 admin）
        r = c.get("/api/admin/telemetry?days=7")
        assert r.status_code == 403
        assert set(r.json()) == {"detail"}  # 零遥测字段泄露
        c.cookies.clear()
        assert c.get("/api/admin/telemetry").status_code == 401  # 未登录


# ---------- 行为·时间语义（走查条 13 pytest 侧：窗口右端点 = 服务器本地今日） ----------

def test_遥测_时间语义_date_to为今日_今日有数据daily含今日行(tmp_path: Path):
    from app import quota

    with tel_app(tmp_path) as c:
        _seed(c, [_llm(_day(0), "unified", prompt=10, completion=5, total=15)])
        _as_admin(c)
        body = c.get("/api/admin/telemetry?days=7").json()

    assert body["window"]["date_to"] == quota.today()  # 与 usage_daily.day 同口径
    assert body["daily"][0]["day"] == quota.today()    # 今日有数据 → daily 含今日行


# ---------- 空窗口（零遥测行） ----------

def test_遥测_空窗口_daily与tools为空_today_cost真值零(tmp_path: Path):
    with tel_app(tmp_path) as c:
        _as_admin(c)
        body = c.get("/api/admin/telemetry?days=30").json()

    assert body["window"]["days"] == 30
    assert body["daily"] == [] and body["tools"] == []
    tc = body["today_cost"]
    assert tc["tokens_prompt"] == 0 and tc["cost_total"] == 0.0
