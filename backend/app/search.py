"""联网搜索（iter-14 T2，CHG-007 REQ-035 / design-iter-14 §2 §6 §7）：Tavily 客户端
+ 结果归一化 + search 工具注册（首个生产出网工具）。

- 选型与 key 归属（plans/iter-14 定夺 1/2，CEO 2026-08-18）：Tavily 起步；key 经
  backend/.env 注入（AI_CHAT_SEARCH_KEY，config.Settings.search_key），admin 可见开关
  状态、不可见 key；与开关分离（key 缺失时开关状态可存但工具不注册，design §6.1）
- 微参数（design-iter-14 §7 随基线定案）：单工具超时 10s / 结果 5 条（max_results=5）
- 出网治理（REQ-031 ③ A2 面实例化）：固定域白名单 = api.tavily.com；请求前白名单判定
  （零连接拒绝）+ DNS 解析地址核验（解析为内网/保留地址 → 拒绝，CHG-007 4.5-③ 全口径）
- 结果组装（REQ-035 主流程 3）：「结果摘要 + 来源列表」文本给模型（走网关截断/注入链），
  归一化来源数组（design §2.1 五字段形态）随 tool.result 事件可选下发（§6.4）
- 空结果文案「未搜到相关内容」为 design §3 D2 逐字定稿（后端拥有、前端零处理）
- key 卫生：key 仅进请求头（全新构造）；结果/来源/日志零 key 明文（REQ-014 同口径）

CHG-018/REQ-054（直派批次）read 工具：Tavily /extract 同域端点（白名单零扩大），
单 url 入参，内部截断 10000 字符（防上下文溢出，T0 定死 plans/chg-018-verify.md §5），
gate 沿 "search" 三与门、research_only = 仅 research 回合下发（定夺④）。

运行时绑定：httpx 客户端与 key 由应用生命周期绑定（main.create_app lifespan 调
bind/unbind）——注册表静态注册与运行时配置解耦，pytest 以假传输层 bind 承载全量用例。
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
from typing import Any
from urllib.parse import urlparse

import httpx

from app.tools import (
    ToolDef,
    ToolError,
    ToolOutput,
    ensure_egress_allowed,
    is_disallowed_ip,
    register_tool,
)

logger = logging.getLogger("ai-chat.search")

# 微参数（design-iter-14 §7 定案：超时 10s / 结果 5 条；网关默认 32 KiB 截断沿用）
SEARCH_TIMEOUT = 10.0
SEARCH_MAX_RESULTS = 5
# 入参 query 长度上限（网关 ② 参数校验承载；Tavily 无短限，400 字符为防滥用工程值，
# 随 verify 登记——远超自然语言查询长度，不影响正常使用）
QUERY_MAX_LENGTH = 400

# 固定域白名单（REQ-035/031：出网仅 api.tavily.com；切换博查 = 改本模块常量，S 级）
TAVILY_HOST = "api.tavily.com"
TAVILY_URL = f"https://{TAVILY_HOST}/search"
EXTRACT_URL = f"https://{TAVILY_HOST}/extract"  # CHG-018/REQ-054：同域 extract 端点

# read 工具微参数（CHG-018 T0 定死，plans/chg-018-verify.md §5）：超时 15s（extract 慢于
# search 留余量）；内部截断 10000 字符（防上下文溢出——read 全量 32KiB × 6 次可逼近
# DeepSeek 128k 窗口；网关 32 KiB 外限沿用、超限截断标注沿用）
READ_TIMEOUT = 15.0
READ_CHAR_LIMIT = 10000
READ_TRUNCATION_NOTE = "\n[原文超长，已截断]"
URL_MAX_LENGTH = 2000  # read 入参 url 长度上限（网关 ② 参数校验承载）

# design-iter-14 §3 D2 逐字（空结果：模型据空结果如实回答，不编造来源）
EMPTY_RESULT_TEXT = "未搜到相关内容"

# 运行时绑定（bind/unbind 见模块 docstring；未绑定时调用 = 配置缺失，理论不可达——
# proxy 已按 key 配置门控，此为防御性兜底）
_client: httpx.AsyncClient | None = None
_api_key: str = ""


def bind(client: httpx.AsyncClient, api_key: str) -> None:
    global _client, _api_key
    _client, _api_key = client, api_key


def unbind() -> None:
    global _client, _api_key
    _client, _api_key = None, ""


async def _resolve_host(host: str) -> list[str]:
    """解析期地址核验数据源（连接前独立解析；httpx 连接期自解析，本层为零连接保证）。"""
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    return [info[4][0] for info in infos]


async def _assert_public_resolution(host: str) -> None:
    """CHG-007 4.5-③ 后半：域名解析为内网/保留地址 → 拒绝（连接发起前，零连接）。"""
    for addr in await _resolve_host(host):
        if is_disallowed_ip(ipaddress.ip_address(addr)):
            raise ToolError("出网目标解析为内网/保留地址，已拒绝")


# ---------- 结果归一化（design-iter-14 §2.1/§2.3 五字段形态，缺字段不塌） ----------

def normalize_results(raw_results: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Tavily results[] → SourceItem 形态：title/url 必有；snippet/date_published 可选。

    Tavily 给 title/url/content（长摘要）/published_date（部分结果）；
    site_name 不提供（前端 hostname 兜底，design §2.3）。字段为空串/缺失一律不携带。
    """
    sources: list[dict[str, str]] = []
    for r in raw_results[:SEARCH_MAX_RESULTS]:  # 条数防御：恒 ≤ 5（前端另 slice 兜底）
        if not isinstance(r, dict):
            continue
        url = str(r.get("url") or "").strip()
        if not url:
            continue  # 无 URL 的结果不可核验，丢弃
        item: dict[str, str] = {"url": url}
        title = str(r.get("title") or "").strip()
        item["title"] = title or urlparse(url).hostname or url
        snippet = str(r.get("content") or "").strip()
        if snippet:
            item["snippet"] = snippet
        published = str(r.get("published_date") or "").strip()
        if published:
            item["date_published"] = published  # 原样透传不重排格式（design §2.3）
        sources.append(item)
    return sources


def assemble_text(query: str, sources: list[dict[str, str]]) -> str:
    """「结果摘要 + 来源列表（标题/URL/片段）」文本（REQ-035 主流程 3，模型消费视角）。"""
    lines = [f"搜索「{query}」共 {len(sources)} 条结果："]
    for i, s in enumerate(sources, 1):
        lines.append(f"{i}. {s['title']}\n   {s['url']}")
        if s.get("snippet"):
            lines.append(f"   {s['snippet']}")
    return "\n".join(lines)


# ---------- Tavily 客户端（POST /search，Bearer key；全 mock 假端点承载测试） ----------

async def tavily_search(query: str, days: int | None = None) -> ToolOutput:
    """出网调用 Tavily 并组装双视角结果（文本给模型 / sources 给前端引用卡）。

    days（CHG-008，1~30 可选）：时效性查询由模型自行限定「最近 N 天」，透传为
    Tavily topic=news + days（新闻源 + 时间窗）；不传 = 综合搜索不限时。
    任何失败以 ToolError 机器可读原因上抛 → 网关转 error result → 模型降级直答
    （回合不崩，REQ-035 异常分支）；超时由网关 wait_for(10s) 兜底。
    """
    if _client is None or not _api_key:
        raise ToolError("搜索未配置（AI_CHAT_SEARCH_KEY 缺失）")
    ensure_egress_allowed(TAVILY_URL, (TAVILY_HOST,))  # 白名单/字面 IP：零连接拒绝
    await _assert_public_resolution(TAVILY_HOST)  # DNS 解析地址：连接前拒绝
    payload: dict[str, Any] = {"query": query, "max_results": SEARCH_MAX_RESULTS}
    if days:
        payload["topic"] = "news"
        payload["days"] = days
    try:
        resp = await _client.post(
            TAVILY_URL,
            json=payload,
            headers={"Authorization": f"Bearer {_api_key}"},
        )
    except httpx.HTTPError:
        raise ToolError("搜索服务不可达") from None
    if resp.status_code >= 400:
        # 429/额度尽等一律走网关 error 降级路径（plans iter-14 风险①应对）
        raise ToolError(f"搜索服务返回 {resp.status_code}")
    try:
        data = resp.json()
        raw = data.get("results")
    except ValueError:
        raise ToolError("搜索服务响应异常") from None
    if not isinstance(raw, list):
        raise ToolError("搜索服务响应异常")
    sources = normalize_results(raw)
    if not sources:
        return ToolOutput(EMPTY_RESULT_TEXT)  # D2 逐字；空结果无 sources（无引用卡）
    return ToolOutput(assemble_text(query, sources), sources)


async def _search_handler(args: dict[str, Any]) -> ToolOutput:
    return await tavily_search(args["query"], args.get("days"))


register_tool(ToolDef(
    name="search",
    description=(
        "联网搜索最新信息（时效性问题、最新动态、版本号、今日热点等）。"
        "新闻/热点等强时效查询建议带 days 限定最近 N 天（1~30，启用新闻源与时间窗过滤）；"
        "一般性查询不必带。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "maxLength": QUERY_MAX_LENGTH},
            "days": {"type": "integer", "minimum": 1, "maximum": 30},
        },
        "required": ["query"],
    },
    handler=_search_handler,
    timeout=SEARCH_TIMEOUT,
    egress_domains=(TAVILY_HOST,),
    gate="search",  # admin 开关 ∧ key 已配置（design §6.1/§6.2）；非 admin_only 全员可见
))


# ---------- read 工具（CHG-018/REQ-054，Tavily /extract 同域端点） ----------

async def tavily_extract(url: str) -> ToolOutput:
    """读取网页原文（/extract，Bearer key；全 mock 假端点承载测试）。

    单 URL 单次调用；raw_content 内部截断至 READ_CHAR_LIMIT（防上下文溢出，T0 定死）；
    提取失败（failed_results / 空正文 / API 错误）以 ToolError 机器可读原因上抛 →
    网关转 error result → 模型降级（换来源重试或跳过，回合不崩）。
    """
    if _client is None or not _api_key:
        raise ToolError("搜索未配置（AI_CHAT_SEARCH_KEY 缺失）")
    ensure_egress_allowed(EXTRACT_URL, (TAVILY_HOST,))  # 与 /search 同域：白名单零扩大
    await _assert_public_resolution(TAVILY_HOST)
    try:
        resp = await _client.post(
            EXTRACT_URL,
            json={"urls": [url]},
            headers={"Authorization": f"Bearer {_api_key}"},
        )
    except httpx.HTTPError:
        raise ToolError("读取服务不可达") from None
    if resp.status_code >= 400:
        raise ToolError(f"读取服务返回 {resp.status_code}")
    try:
        data = resp.json()
        results = data.get("results")
    except ValueError:
        raise ToolError("读取服务响应异常") from None
    if not isinstance(results, list) or not results:
        raise ToolError("未能提取该网页内容")
    r0 = results[0]
    if not isinstance(r0, dict):
        raise ToolError("读取服务响应异常")
    raw = str(r0.get("raw_content") or "").strip()
    if not raw:
        raise ToolError("该网页无可提取正文")
    if len(raw) > READ_CHAR_LIMIT:
        raw = raw[: READ_CHAR_LIMIT - len(READ_TRUNCATION_NOTE)] + READ_TRUNCATION_NOTE
    source_url = str(r0.get("url") or "").strip() or url
    title = str(r0.get("title") or "").strip() or source_url
    text = f"读取「{title}」原文：\n{source_url}\n{raw}"
    return ToolOutput(text, [{"url": source_url, "title": title}])


async def _read_handler(args: dict[str, Any]) -> ToolOutput:
    return await tavily_extract(args["url"])


register_tool(ToolDef(
    name="read",
    description=(
        "读取指定 URL 网页的原文全文。用于深入阅读搜索结果中权威或信息密度高的来源，"
        "核对其完整上下文与数字、日期等细节。"
    ),
    parameters={
        "type": "object",
        "properties": {"url": {"type": "string", "maxLength": URL_MAX_LENGTH}},
        "required": ["url"],
    },
    handler=_read_handler,
    timeout=READ_TIMEOUT,
    egress_domains=(TAVILY_HOST,),
    gate="search",  # 与 search 共用三与门（同域同 key，CHG-018 不新增开关）
    research_only=True,  # CHG-018 定夺④：仅 research 回合下发（普通回合 tools 零变化）
))
