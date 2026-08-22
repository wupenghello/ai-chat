"""真实天气工具（iter-22 T2，CHG-016 REQ-053 / plans/iter-22-verify.md T0 段）：和风天气
客户端 + 城市定位（内置城市坐标表 + 坐标兜底）+ weather 工具注册（第二个生产出网工具）。

- 凭据与白名单（T0 §5）：key/Host 经 backend/.env 注入（AI_CHAT_WEATHER_KEY/HOST，与
  search 同法）；账户为专属 Host 制度——出网白名单 = 配置 Host 单元组（REQ-031 ③
  「配置注入域」新模式，CHG-016 注记），请求 URL 恒 https://{host}/v7/...，请求 Host 与
  配置不一致 → 白名单拒绝（REQ-053 验收 5）；DNS 解析地址核验复用 search 体例
- 定位（T0 §1/§2 + 实现级决策）：GeoAPI 未启用（复验 404，定夺⑥）→ 内置城市中心坐标表
  （scripts/gen_weather_cities.py 逐城真调用校验生成 2026-08-22；存坐标而非 LocationID——
  坐标端点已验证且免 ID 校验链，语义等价，登记 verify T2）+「经度,纬度」正则兜底直传；
  表未命中且非坐标 → ToolError（模型可改传坐标重试，T0 §3 文案逐字）
- 数据范围（定夺③）：/v7/weather/now + /v7/weather/3d 一次返回（两次子调用合计由网关
  wait_for(10s) 兜底）；纯文本组装（T0 §3 模板逐字）；无 sources（天气为数据非引用）
- 门控（定夺②）：gate="weather" = key∧Host 均配置（proxy 下发点判定）；不新增 admin
  开关——和风额度尽 API 自身返错 → 网关 error result → 模型降级直答，天然自愈
- 失败统一 ToolError 机器可读（T0 §3 逐字）→ 网关 error → 模型降级，回合不崩（REQ-053
  异常分支）
- key 卫生：key 仅进请求头（X-QW-Api-Key，全新构造）；结果/日志零 key 明文（REQ-014 同口径）

运行时绑定：httpx 客户端与 key/Host 由应用生命周期绑定（main.create_app lifespan 调
bind/unbind）——与 search.py 同体例，pytest 以假传输层 bind 承载全量用例。
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import re
import socket
from typing import Any

import httpx

from app.tools import (
    ToolDef,
    ToolError,
    ensure_egress_allowed,
    is_disallowed_ip,
    register_tool,
)

logger = logging.getLogger("ai-chat.weather")

# 微参数（T0 §5）：单工具总超时 10s（now + 3d 两次子调用合计）；截断沿网关 32 KiB；
# location 入参上限（网关 ② 参数校验承载）
WEATHER_TIMEOUT = 10.0
LOCATION_MAX_LENGTH = 50

# 定位（T0 §2）：坐标格式「经度,纬度」（与和风 location 参数口径一致）
COORD_RE = re.compile(r"^-?\d{1,3}\.\d+,-?\d{1,3}\.\d+$")

# 逐字文案（T0 §3，后端拥有；pytest 逐字断言面）
NOT_FOUND_TEXT = "未找到该城市（不在内置城市表；可改传「经度,纬度」坐标重试）"
UNREACHABLE_TEXT = "天气服务不可达"
BAD_RESPONSE_TEXT = "天气服务响应异常"
UNCONFIGURED_TEXT = "天气未配置（AI_CHAT_WEATHER_KEY/HOST 缺失）"

# 内置城市表：城市名 → 中心坐标（148 城，2026-08-22 scripts/gen_weather_cities.py
# 逐城真调用校验生成——now/3d 双端点 200 且 fxLink 站点属该城市；表外走坐标兜底）
CITY_TABLE: dict[str, str] = {
    "北京": "116.41,39.90",
    "上海": "121.47,31.23",
    "天津": "117.20,39.08",
    "重庆": "106.55,29.56",
    "哈尔滨": "126.53,45.80",
    "齐齐哈尔": "123.95,47.35",
    "大庆": "125.10,46.59",
    "长春": "125.32,43.82",
    "吉林市": "126.55,43.84",
    "延吉": "129.51,42.91",
    "沈阳": "123.43,41.80",
    "大连": "121.62,38.92",
    "鞍山": "123.00,41.11",
    "锦州": "121.14,41.10",
    "呼和浩特": "111.75,40.84",
    "包头": "109.84,40.66",
    "鄂尔多斯": "109.99,39.82",
    "石家庄": "114.51,38.04",
    "唐山": "118.18,39.63",
    "保定": "115.46,38.87",
    "廊坊": "116.70,39.52",
    "秦皇岛": "119.60,39.94",
    "张家口": "114.89,40.82",
    "承德": "117.96,40.95",
    "太原": "112.55,37.87",
    "大同": "113.30,40.08",
    "临汾": "111.52,36.09",
    "运城": "111.00,35.03",
    "西安": "108.94,34.34",
    "咸阳": "108.71,34.33",
    "宝鸡": "107.24,34.36",
    "汉中": "107.03,33.07",
    "延安": "109.49,36.60",
    "榆林": "109.73,38.29",
    "兰州": "103.84,36.06",
    "天水": "105.72,34.58",
    "酒泉": "98.51,39.74",
    "敦煌": "94.66,40.14",
    "银川": "106.28,38.47",
    "中卫": "105.18,37.51",
    "西宁": "101.78,36.62",
    "格尔木": "94.90,36.40",
    "乌鲁木齐": "87.62,43.83",
    "克拉玛依": "84.87,45.58",
    "喀什": "75.99,39.47",
    "伊宁": "81.32,43.92",
    "吐鲁番": "89.19,42.95",
    "阿勒泰": "88.14,47.85",
    "拉萨": "91.11,29.97",
    "林芝": "94.36,29.65",
    "日喀则": "88.88,29.27",
    "济南": "117.12,36.65",
    "青岛": "120.38,36.07",
    "烟台": "121.45,37.46",
    "威海": "122.12,37.51",
    "潍坊": "119.16,36.70",
    "临沂": "118.35,35.05",
    "淄博": "118.05,36.78",
    "济宁": "116.59,35.41",
    "泰安": "117.09,36.20",
    "郑州": "113.62,34.75",
    "洛阳": "112.45,34.62",
    "开封": "114.31,34.80",
    "南阳": "112.53,32.99",
    "新乡": "113.93,35.30",
    "安阳": "114.39,36.10",
    "南京": "118.78,32.06",
    "苏州": "120.58,31.30",
    "无锡": "120.31,31.49",
    "常州": "119.97,31.77",
    "南通": "120.86,32.01",
    "徐州": "117.28,34.20",
    "扬州": "119.42,32.39",
    "盐城": "120.16,33.35",
    "连云港": "119.22,34.60",
    "合肥": "117.28,31.86",
    "芜湖": "118.38,31.33",
    "安庆": "117.06,30.54",
    "黄山": "118.34,29.71",
    "阜阳": "115.82,32.90",
    "杭州": "120.16,30.29",
    "宁波": "121.55,29.87",
    "温州": "120.70,28.00",
    "嘉兴": "120.76,30.75",
    "绍兴": "120.58,30.03",
    "金华": "119.65,29.08",
    "台州": "121.42,28.66",
    "舟山": "122.21,29.99",
    "义乌": "120.08,29.31",
    "南昌": "115.89,28.68",
    "九江": "115.99,29.71",
    "赣州": "114.93,25.83",
    "景德镇": "117.18,29.27",
    "福州": "119.30,26.08",
    "厦门": "118.09,24.48",
    "泉州": "118.68,24.87",
    "漳州": "117.65,24.51",
    "莆田": "119.01,25.45",
    "武汉": "114.31,30.59",
    "宜昌": "111.29,30.69",
    "襄阳": "112.12,32.01",
    "荆州": "112.24,30.33",
    "十堰": "110.80,32.63",
    "长沙": "112.94,28.23",
    "岳阳": "113.13,29.36",
    "株洲": "113.13,27.83",
    "衡阳": "112.57,26.90",
    "常德": "111.69,29.04",
    "张家界": "110.48,29.13",
    "南宁": "108.37,22.82",
    "桂林": "110.29,25.27",
    "柳州": "109.42,24.33",
    "北海": "109.12,21.48",
    "海口": "110.32,20.03",
    "三亚": "109.51,18.25",
    "儋州": "109.58,19.52",
    "琼海": "110.48,19.26",
    "广州": "113.26,23.13",
    "深圳": "114.06,22.55",
    "珠海": "113.58,22.27",
    "佛山": "113.12,23.02",
    "东莞": "113.75,23.02",
    "中山": "113.39,22.52",
    "惠州": "114.42,23.11",
    "汕头": "117.28,23.29",
    "湛江": "110.36,21.27",
    "韶关": "113.60,24.81",
    "贵阳": "106.63,26.65",
    "遵义": "106.93,27.73",
    "六盘水": "104.83,26.60",
    "安顺": "105.93,26.25",
    "成都": "104.07,30.57",
    "绵阳": "104.68,31.47",
    "宜宾": "104.64,28.75",
    "南充": "106.11,30.84",
    "泸州": "105.44,28.87",
    "乐山": "103.77,29.55",
    "西昌": "102.26,27.89",
    "昆明": "102.83,24.88",
    "大理": "100.27,25.61",
    "丽江": "100.23,26.86",
    "曲靖": "103.80,25.50",
    "香格里拉": "99.70,27.82",
    "景洪": "100.80,22.00",
    "香港": "114.17,22.32",
    "澳门": "113.55,22.19",
    "台北": "121.56,25.03",
    "高雄": "120.31,22.62",
}

_client: httpx.AsyncClient | None = None
_api_key: str = ""
_host: str = ""


def bind(client: httpx.AsyncClient, api_key: str, host: str) -> None:
    global _client, _api_key, _host
    _client, _api_key, _host = client, api_key, host


def unbind() -> None:
    global _client, _api_key, _host
    _client, _api_key, _host = None, "", ""


def resolve_location(location: str) -> tuple[str, str]:
    """入参 → (上游 location 参数, 结果标签)：坐标直传；表内城市取中心坐标；
    其余 → ToolError（NOT_FOUND_TEXT 逐字——模型可改传坐标重试）。"""
    loc = location.strip()
    if COORD_RE.match(loc):
        return loc, loc
    if loc in CITY_TABLE:
        return CITY_TABLE[loc], loc
    raise ToolError(NOT_FOUND_TEXT)


async def _resolve_host_ips(host: str) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    return [info[4][0] for info in infos]


async def _assert_public_resolution(host: str) -> None:
    """CHG-007 4.5-③ 后半（与 search._assert_public_resolution 同体例）：域名解析为
    内网/保留地址 → 连接发起前拒绝（零连接）。"""
    for addr in await _resolve_host_ips(host):
        if is_disallowed_ip(ipaddress.ip_address(addr)):
            raise ToolError("出网目标解析为内网/保留地址，已拒绝")


async def _get(path_query: str) -> dict[str, Any]:
    """单次上游 GET：白名单 + DNS 核验 → 请求 → 失败归一 ToolError（T0 §3 逐字）。"""
    if _client is None or not _api_key or not _host:
        raise ToolError(UNCONFIGURED_TEXT)  # 防御性兜底（下发门控下理论不可达）
    url = f"https://{_host}{path_query}"
    ensure_egress_allowed(url, (_host,))  # 白名单/字面 IP：零连接拒绝（验收 5 承载面）
    await _assert_public_resolution(_host)
    try:
        resp = await _client.get(url, headers={"X-QW-Api-Key": _api_key})
    except httpx.HTTPError:
        raise ToolError(UNREACHABLE_TEXT) from None
    if resp.status_code >= 400:
        raise ToolError(f"天气服务返回 {resp.status_code}")
    try:
        data = resp.json()
    except ValueError:
        raise ToolError(BAD_RESPONSE_TEXT) from None
    if not isinstance(data, dict):
        raise ToolError(BAD_RESPONSE_TEXT)
    code = str(data.get("code", ""))
    if code != "200":
        raise ToolError(f"天气服务返回 {code}" if code else BAD_RESPONSE_TEXT)
    return data


def assemble_text(label: str, now: dict[str, Any], daily: list[dict[str, Any]]) -> str:
    """T0 §3 模板逐字：实时行 + 「三日预报（今起）」+ 逐日一行（缺 textNight 单段写法）。"""
    lines = [
        f"{label}实时天气（观测于 {now.get('obsTime', '')}）：{now.get('text', '')}，"
        f"气温 {now.get('temp', '')}°C（体感 {now.get('feelsLike', '')}°C），"
        f"{now.get('windDir', '')} {now.get('windScale', '')} 级，湿度 {now.get('humidity', '')}%",
        "三日预报（今起）：",
    ]
    for d in daily[:3]:
        date = d.get("fxDate", "")
        head = f"{date}：{d.get('textDay', '')}"
        if d.get("textNight"):
            head += f"转{d['textNight']}"
        lines.append(f"{head}，{d.get('tempMin', '')}~{d.get('tempMax', '')}°C")
    return "\n".join(lines)


async def fetch_weather(location: str) -> str:
    """定位 → now + 3d 两次子调用 → 组装文本（任何失败 ToolError 上抛，网关转 error）。"""
    loc, label = resolve_location(location)
    now_data = await _get(f"/v7/weather/now?location={loc}")
    d3_data = await _get(f"/v7/weather/3d?location={loc}")
    now = now_data.get("now")
    daily = d3_data.get("daily")
    if not isinstance(now, dict) or not isinstance(daily, list) or not daily:
        raise ToolError(BAD_RESPONSE_TEXT)
    return assemble_text(label, now, daily)


async def _weather_handler(args: dict[str, Any]) -> str:
    return await fetch_weather(args["location"])


register_tool(ToolDef(
    name="weather",
    description=(
        "查询中国城市实时天气与三日预报。location 填城市名（内置 148 个常用城市："
        "直辖市/省会/主要城市）或「经度,纬度」坐标（如 116.41,39.90；表外小城市/区县请用坐标）。"
    ),
    parameters={
        "type": "object",
        "properties": {"location": {"type": "string", "maxLength": LOCATION_MAX_LENGTH}},
        "required": ["location"],
    },
    handler=_weather_handler,
    timeout=WEATHER_TIMEOUT,
    # egress_domains 留空：出网域为 .env 配置的专属 Host（运行时白名单见 _get，
    # REQ-031 ③ 配置注入域新模式——静态字段承载不了动态域，实际执法在 handler 内）
    gate="weather",  # key∧Host 均配置（CHG-016 定夺②，proxy 下发点判定）；全员可见
))
