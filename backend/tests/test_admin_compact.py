"""iter-16 T3（CHG-010 REQ-041 验收 3~4）：GET /api/admin/telemetry 加法扩展 compact 键
——造数聚合数值精确断言（次数/降幅/缺失）+ 成本聚合计入 unified compress 行 tokens_prompt
（按输入计价，CHG-010 3.3）+ 普通用户 403 零泄露 + 既有形状零变化。

实现依据：design-iter-16 §5.2 定案形状逐字（count/count_ok/count_failed/measured/
Σbefore/Σafter/reduction_rate；measured=0 → null 显缺失，永不显 0）。
夹具沿 test_admin_telemetry（tel_app/_seed，纯加法新文件，既有用例零触达）。
"""

from pathlib import Path

from tests.test_admin_telemetry import _as_admin, _as_mallory, _day, _llm, _seed, tel_app


def _crow(day: str, status: str, *, before=None, after=None, mode="unified",
          prompt=None, completion=None, user_id=1) -> dict:
    """compress 行造数（虚构样件仅用于聚合断言，铁律 5；tokens_prompt = 摘要调用自身消耗）。"""
    total = (prompt or 0) + (completion or 0)
    return {
        "day": day, "user_id": user_id, "mode": mode, "endpoint": "compact",
        "kind": "compress", "turn_id": None, "step": None, "model": "deepseek-test",
        "latency_ms": 1900, "status": status,
        "tokens_prompt": prompt, "tokens_completion": completion, "tokens_total": total,
        "tokens_before": before, "tokens_after": after, "session_id": "s-x",
    }


# ---------- REQ-041 验收 3：造数聚合数值精确断言 ----------

def test_compact聚合_造数精确值_失败行只计次数(tmp_path: Path):
    """count 含失败行；降幅仅计 ok 且双侧非 NULL 的测得行；后端 6 位小数。"""
    with tel_app(tmp_path) as c:
        _seed(c, [
            # 测得行 ×2（降幅分母分子来源）+ 未测得 ok 行 ×1（tokens_after NULL）
            _crow(_day(0), "ok", before=10000, after=3000, prompt=500, completion=100),
            _crow(_day(0), "ok", before=20000, after=8000, prompt=600, completion=120),
            _crow(_day(1), "ok", before=5000, after=None, prompt=400, completion=90),
            # 失败行 ×2（只计次数、不计降幅）
            _crow(_day(1), "error", before=9000, after=None, prompt=None),
            _crow(_day(2), "timeout", before=8000, after=None, prompt=None),
        ])
        _as_admin(c)
        body = c.get("/api/admin/telemetry?days=7").json()

    assert body["compact"] == {
        "count": 5,                     # 窗口 compress 行总数（含失败行）
        "count_ok": 3,
        "count_failed": 2,              # error + timeout 合计
        "measured": 2,                  # status=ok 且 before/after 均非 NULL
        "tokens_before_total": 30000,   # Σbefore 仅计测得行
        "tokens_after_total": 11000,    # Σafter 仅计测得行
        "reduction_rate": round(1 - 11000 / 30000, 6),  # 0.633333
    }


def test_compact聚合_缺失态_零测得行_rate为null(tmp_path: Path):
    """有 compress 行但零测得行（懒回填未测得）→ measured=0、reduction_rate=null
    （前端显「缺失」徽标的数据层语义；永不显 0，铁律 5）。"""
    with tel_app(tmp_path) as c:
        _seed(c, [
            _crow(_day(0), "ok", before=10000, after=None, prompt=500, completion=100),
            _crow(_day(0), "ok", before=12000, after=None, prompt=500, completion=100),
            _crow(_day(0), "error", before=9000, after=None),
        ])
        _as_admin(c)
        body = c.get("/api/admin/telemetry?days=7").json()

    cp = body["compact"]
    assert cp["count"] == 3 and cp["count_ok"] == 2 and cp["count_failed"] == 1
    assert cp["measured"] == 0
    assert cp["tokens_before_total"] == 0 and cp["tokens_after_total"] == 0
    assert cp["reduction_rate"] is None


def test_compact聚合_空窗口_全零_rate为null(tmp_path: Path):
    with tel_app(tmp_path) as c:
        _seed(c, [_llm(_day(0), "unified", prompt=100, completion=50, total=150)])
        _as_admin(c)
        body = c.get("/api/admin/telemetry?days=7").json()

    assert body["compact"] == {
        "count": 0, "count_ok": 0, "count_failed": 0, "measured": 0,
        "tokens_before_total": 0, "tokens_after_total": 0, "reduction_rate": None,
    }


def test_compact聚合_合法0降幅如实_与缺失区分(tmp_path: Path):
    """压缩前后同规模 → reduction_rate=0.0 如实（与 null 缺失视觉语言不同的数据面）。"""
    with tel_app(tmp_path) as c:
        _seed(c, [_crow(_day(0), "ok", before=8000, after=8000, prompt=500, completion=100)])
        _as_admin(c)
        body = c.get("/api/admin/telemetry?days=7").json()

    assert body["compact"]["measured"] == 1
    assert body["compact"]["reduction_rate"] == 0.0


# ---------- REQ-041 验收 3（成本面）：成本聚合计入 compress 行 tokens ----------

def test_成本聚合计入_unified_compress行_tokens_prompt按输入计价(tmp_path: Path):
    """today_cost 与 daily[].cost_total 计入 unified compress 行 tokens_prompt×input 单价
    （CHG-010 3.3 按输入计价；completion 不计——摘要产出为内部产物）；
    self 行 tokens 不计成本（定夺⑥口径自然延伸）。"""
    with tel_app(tmp_path) as c:  # price_input=2.0 / output=8.0 / cache_hit=0.5
        _seed(c, [
            _llm(_day(0), "unified", prompt=100000, completion=20000, total=120000,
                 hit=50000, miss=50000),
            # unified compress 行：prompt 5474 / completion 168（T0 冒烟同量级虚构样件）
            _crow(_day(0), "ok", before=9909, after=4000, prompt=5474, completion=168),
            # self compress 行：tokens 不计成本
            _crow(_day(0), "ok", before=8000, after=3000, mode="self",
                  prompt=4000, completion=120),
        ])
        _as_admin(c)
        body = c.get("/api/admin/telemetry?days=7").json()

    tc = body["today_cost"]
    # 输入分项 = (100000 + 5474) × 2.0 ÷ 1e6（unified compress prompt 并入输入成本）
    assert tc["cost_input"] == round((100000 + 5474) * 2.0 / 1_000_000, 6)
    assert tc["cost_output"] == round(20000 * 8.0 / 1_000_000, 6)       # completion 口径零变化
    assert tc["cost_cache_hit"] == round(50000 * 0.5 / 1_000_000, 6)
    assert tc["cost_total"] == round(
        round((100000 + 5474) * 2.0 / 1e6, 6) + round(20000 * 8.0 / 1e6, 6)
        + round(50000 * 0.5 / 1e6, 6), 6)
    # tokens 显示列口径零变化（llm 行 only；compress tokens 只入成本不入显示计数）
    assert tc["tokens_prompt"] == 100000 and tc["tokens_completion"] == 20000
    # daily 同源口径
    d0 = body["daily"][0]
    assert d0["cost_total"] == tc["cost_total"]
    assert d0["tokens_prompt"] == 100000


def test_成本聚合_仅compress行的日子_daily列出且成本如实(tmp_path: Path):
    """零 llm 行仅 compress 行的日子 = 有数据日（daily 列出；成本 = 摘要输入成本）。"""
    with tel_app(tmp_path) as c:
        _seed(c, [_crow(_day(1), "ok", before=9000, after=3500, prompt=5000, completion=200)])
        _as_admin(c)
        body = c.get("/api/admin/telemetry?days=7").json()

    assert [d["day"] for d in body["daily"]] == [_day(1)]
    d = body["daily"][0]
    assert d["tokens_prompt"] == 0 and d["tokens_completion"] == 0  # llm 显示列零行真值 0
    assert d["cost_total"] == round(5000 * 2.0 / 1_000_000, 6)      # 摘要输入成本如实
    assert body["compact"]["count"] == 1


def test_成本聚合_单价未配置_compress行成本同显null(tmp_path: Path):
    with tel_app(tmp_path, price=False) as c:
        _seed(c, [_crow(_day(0), "ok", before=9000, after=3500, prompt=5000, completion=200)])
        _as_admin(c)
        body = c.get("/api/admin/telemetry?days=7").json()

    assert body["today_cost"]["cost_total"] is None       # 不估算（铁律 5）
    assert body["daily"][0]["cost_total"] is None
    assert body["compact"]["count"] == 1                   # 次数如实不受单价影响


# ---------- REQ-041 验收 4：普通用户 403 零泄露（扩展后复验） ----------

def test_扩展聚合端点_普通用户403_零compact泄露(tmp_path: Path):
    with tel_app(tmp_path) as c:
        _seed(c, [_crow(_day(0), "ok", before=9000, after=3500, prompt=500, completion=100)])
        _as_mallory(c)
        r = c.get("/api/admin/telemetry?days=7")
        assert r.status_code == 403
        assert set(r.json()) == {"detail"}  # 零遥测字段（含 compact 键）泄露


# ---------- 既有形状零变化（加法纪律反向断言） ----------

def test_加法扩展_既有键形状零变化(tmp_path: Path):
    """顶层加 compact 键外，iter-15 六键逐字节口径零回退（造数含 compress 行亦不污染
    llm 显示列：cache_rate/tokens 列仅 llm 行供数）。"""
    with tel_app(tmp_path) as c:
        _seed(c, [
            _llm(_day(0), "unified", prompt=100, completion=50, total=150, hit=30, miss=70),
            _crow(_day(0), "ok", before=9000, after=3500, prompt=500, completion=100),
        ])
        _as_admin(c)
        body = c.get("/api/admin/telemetry?days=7").json()

    assert set(body) == {"window", "price", "today_cost", "daily", "tools", "compact",
                         "retention_days"}
    d0 = body["daily"][0]
    assert d0["tokens_prompt"] == 100 and d0["tokens_completion"] == 50  # llm 显示列零污染
    assert d0["cache_rate"] == 0.3                                        # 命中率口径零变化
    assert body["tools"] == []
    assert body["retention_days"] == 90
