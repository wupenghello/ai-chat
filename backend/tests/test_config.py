"""Settings 环境变量解析契约（DEF-040 回归：.env 留空可选数值字段 = 未配置）。"""

from app.config import Settings


def test_单价三变量留空按未配置(monkeypatch):
    monkeypatch.setenv("AI_CHAT_PRICE_INPUT", "")
    monkeypatch.setenv("AI_CHAT_PRICE_OUTPUT", "")
    monkeypatch.setenv("AI_CHAT_PRICE_CACHE_HIT", "")
    s = Settings()
    assert (s.price_input, s.price_output, s.price_cache_hit) == (None, None, None)


def test_单价三变量合法值正常解析(monkeypatch):
    monkeypatch.setenv("AI_CHAT_PRICE_INPUT", "2.0")
    monkeypatch.setenv("AI_CHAT_PRICE_OUTPUT", "8.0")
    monkeypatch.setenv("AI_CHAT_PRICE_CACHE_HIT", "0.5")
    s = Settings()
    assert (s.price_input, s.price_output, s.price_cache_hit) == (2.0, 8.0, 0.5)
