"""iter-22 T2（CHG-016 REQ-053 / plans/iter-22-verify.md T0 §3）：真实天气工具——
城市定位（表 + 坐标兜底）+ 逐字文案 + 出网治理（白名单动态化新模式）+ 门控注册 + 降级体例。

全量用例以假传输层承载（httpx.MockTransport，不依赖真实 key/额度）；真实和风凭据仅
e2e 走查取证（scripts/e2e-walkthrough-22.mjs，验收 1 留档——不作阻塞门，沿 test_search 体例）。
本地 backend/.env 不含凭据（沿 iter-18 key 卫生体例：走查进程环境注入，跑后移除）。
"""

import asyncio

import httpx
import pytest
from app import tools as gw
from app import weather
from app.tools import ToolError, ensure_egress_allowed, execute_tool, tools_for_user
from app.weather import (
    BAD_RESPONSE_TEXT,
    NOT_FOUND_TEXT,
    UNCONFIGURED_TEXT,
    UNREACHABLE_TEXT,
)

WEATHER_KEY = "qw-test-0000"
WEATHER_HOST = "api.weather.test"
LIMIT = 32 * 1024

_NOW = {
    "code": "200", "updateTime": "2026-08-22T23:19+08:00",
    "fxLink": "https://www.qweather.com/weather/beijing-101010100.html",
    "now": {"obsTime": "2026-08-22T23:08+08:00", "temp": "27", "feelsLike": "31",
            "text": "雾", "windDir": "东南风", "windScale": "1", "humidity": "87"},
}
_D3 = {
    "code": "200",
    "daily": [
        {"fxDate": "2026-08-22", "textDay": "多云", "textNight": "雷阵雨",
         "tempMax": "31", "tempMin": "24"},
        {"fxDate": "2026-08-23", "textDay": "晴", "textNight": "",
         "tempMax": "32", "tempMin": "25"},
        {"fxDate": "2026-08-24", "textDay": "晴", "textNight": "多云",
         "tempMax": "33", "tempMin": "26"},
    ],
}
# T0 §3 模板逐字断言面（textNight 缺失日的单段写法 = 08-23 行）
_ASSEMBLED = (
    "北京实时天气（观测于 2026-08-22T23:08+08:00）：雾，气温 27°C（体感 31°C），"
    "东南风 1 级，湿度 87%\n"
    "三日预报（今起）：\n"
    "2026-08-22：多云转雷阵雨，24~31°C\n"
    "2026-08-23：晴，25~32°C\n"
    "2026-08-24：晴转多云，26~33°C"
)


def _ok_handler(req: httpx.Request) -> httpx.Response:
    if req.url.path == "/v7/weather/now":
        return httpx.Response(200, json=_NOW)
    return httpx.Response(200, json=_D3)


async def _fake_public_resolve(_host: str) -> None:
    return None  # 测试不触真实解析器（离线确定性；真实解析随 e2e 冒烟取证）


# autouse 离线补丁会替换 _assert_public_resolution——真函数留档供 DNS 拒绝用例直调
_REAL_ASSERT_PUBLIC_RESOLUTION = weather._assert_public_resolution


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    monkeypatch.setattr(weather, "_assert_public_resolution", _fake_public_resolve)
    yield
    weather.unbind()


def _bind(handler=_ok_handler) -> None:
    weather.bind(httpx.AsyncClient(transport=httpx.MockTransport(handler)),
                 WEATHER_KEY, WEATHER_HOST)


# ---------- 定位（T0 §1/§2：表 + 坐标兜底） ----------

def test_定位_表内城市取中心坐标():
    loc, label = weather.resolve_location("北京")
    assert loc == weather.CITY_TABLE["北京"]
    assert label == "北京"


def test_定位_入参两端空白容差():
    loc, label = weather.resolve_location("  丽江 ")
    assert (loc, label) == (weather.CITY_TABLE["丽江"], "丽江")


def test_定位_坐标格式直传():
    assert weather.resolve_location("116.41,39.90") == ("116.41,39.90", "116.41,39.90")
    assert weather.resolve_location("100.23,26.86") == ("100.23,26.86", "100.23,26.86")


def test_定位_表未命中且非坐标_error文案逐字():
    with pytest.raises(ToolError) as exc:
        weather.resolve_location("亚特兰蒂斯")
    assert str(exc.value) == NOT_FOUND_TEXT


def test_定位_非法坐标串不按坐标处理():
    # 「116.41, 39.90」（含空格）与「39.90」均不匹配坐标正则 → 走表 → 未命中
    with pytest.raises(ToolError):
        weather.resolve_location("116.41, 39.90")


# ---------- 端到端组装与网关集成（T0 §3 模板逐字） ----------

def test_端到端_表内城市_文本模板逐字():
    _bind()
    assert asyncio.run(weather.fetch_weather("北京")) == _ASSEMBLED


def test_端到端_坐标路径_标签为坐标原串():
    _bind()
    out = asyncio.run(weather.fetch_weather("100.23,26.86"))
    assert out.startswith("100.23,26.86实时天气（观测于 ")
    assert "三日预报（今起）：" in out


def test_网关集成_execute_tool_ok():
    _bind()
    defn = gw._REGISTRY["weather"]
    assert defn.timeout == 10.0 and defn.gate == "weather" and defn.admin_only is False
    out = asyncio.run(execute_tool(defn, '{"location": "北京"}', limit=LIMIT))
    assert out.status == "ok"
    assert out.result == _ASSEMBLED
    assert out.truncated is False
    assert out.sources is None  # 天气为数据非引用（CHG-016 内容定案）


def test_网关集成_参数校验_缺必填与超长():
    _bind()
    defn = gw._REGISTRY["weather"]
    out = asyncio.run(execute_tool(defn, "{}", limit=LIMIT))
    assert out.status == "error" and "缺少必填参数" in out.result
    out = asyncio.run(execute_tool(
        defn, '{"location": "%s"}' % ("长" * 51), limit=LIMIT))
    assert out.status == "error" and "最大长度" in out.result


# ---------- 降级体例（T0 §3 error 文案逐字；REQ-053 验收 2） ----------

def test_降级_HTTP错误_文案逐字():
    _bind(lambda _r: httpx.Response(429, json={"code": "429"}))
    with pytest.raises(ToolError) as exc:
        asyncio.run(weather.fetch_weather("北京"))
    assert str(exc.value) == "天气服务返回 429"


def test_降级_网络不可达_文案逐字():
    def boom(_r):
        raise httpx.ConnectError("no route")
    _bind(boom)
    with pytest.raises(ToolError) as exc:
        asyncio.run(weather.fetch_weather("北京"))
    assert str(exc.value) == UNREACHABLE_TEXT


def test_降级_响应非JSON_文案逐字():
    _bind(lambda _r: httpx.Response(200, text="not json"))
    with pytest.raises(ToolError) as exc:
        asyncio.run(weather.fetch_weather("北京"))
    assert str(exc.value) == BAD_RESPONSE_TEXT


def test_降级_body_code非200_按状态文案():
    _bind(lambda _r: httpx.Response(200, json={"code": "402"}))
    with pytest.raises(ToolError) as exc:
        asyncio.run(weather.fetch_weather("北京"))
    assert str(exc.value) == "天气服务返回 402"


def test_降级_3d缺daily_响应异常():
    def half(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/v7/weather/now":
            return httpx.Response(200, json=_NOW)
        return httpx.Response(200, json={"code": "200"})
    _bind(half)
    with pytest.raises(ToolError) as exc:
        asyncio.run(weather.fetch_weather("北京"))
    assert str(exc.value) == BAD_RESPONSE_TEXT


def test_降级_未配置_防御性兜底():
    # 下发门控（gate="weather"）关闭时工具不可见，此为理论不可达分支的兜底
    weather.unbind()
    with pytest.raises(ToolError) as exc:
        asyncio.run(weather.fetch_weather("北京"))
    assert str(exc.value) == UNCONFIGURED_TEXT


# ---------- 出网治理（REQ-053 验收 4/5：白名单动态化新模式） ----------

def test_白名单_配置域放行():
    ensure_egress_allowed(
        f"https://{WEATHER_HOST}/v7/weather/now?location=116.41,39.90", (WEATHER_HOST,))


def test_白名单_请求Host与配置Host不一致_拒绝():
    # 验收 5 专项：白名单取自配置注入 Host——他域/内网一律零连接拒绝
    with pytest.raises(ToolError) as exc:
        ensure_egress_allowed("https://evil.example.com/v7/weather/now", (WEATHER_HOST,))
    assert "不在白名单" in str(exc.value)
    for ip in ("10.0.0.5", "192.168.1.1", "127.0.0.1"):
        url = f"https://{ip}/v7/weather/now"
        with pytest.raises(ToolError) as exc:
            ensure_egress_allowed(url, (WEATHER_HOST,))
        assert "不在白名单" in str(exc.value)


def test_DNS解析为内网保留地址_连接前拒绝(monkeypatch):
    async def fake_ips(_host):
        return ["10.0.0.5"]
    monkeypatch.setattr(weather, "_resolve_host_ips", fake_ips)
    with pytest.raises(ToolError) as exc:
        asyncio.run(_REAL_ASSERT_PUBLIC_RESOLUTION(WEATHER_HOST))
    assert "解析为内网/保留地址" in str(exc.value)


# ---------- 门控与注册面（REQ-053 验收 3 体例，全员工具） ----------

def test_门控_weather键关_注册面不可见():
    names = [d.name for d in tools_for_user(
        is_admin=False, gates={"search": True, "weather": False})]
    assert "weather" not in names  # key/Host 任一缺失 → 不下发（模型不知其存在）


def test_门控_weather键开_全员可见():
    for is_admin in (False, True):
        names = [d.name for d in tools_for_user(
            is_admin=is_admin, gates={"search": False, "weather": True})]
        assert "weather" in names  # 非 admin_only（定夺②：全员）
