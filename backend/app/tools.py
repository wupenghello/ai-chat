"""工具网关（CHG-007 REQ-031，iter-13 T1）：静态注册 + 六项校验链。

- 注册：服务端代码静态注册（A1 无动态/插件机制）；模型只能调用注册表内工具
- 六项校验（CHG-007 内容 4.5，任一拒绝 → error result，回合不崩、模型可降级直答）：
  ① 注册检查 ② 参数校验（JSON Schema 精简子集）③ 出网白名单 + SSRF 防护
  ④ 单工具超时 ⑤ 结果大小截断 ⑥ 注入防护包裹（回填模型上下文前）
- 安全日志四字段：工具名 / 状态 / 耗时 / 是否截断（不含结果全文与密钥，REQ-025 可观测条款）
- 演示工具 echo / demo_weather：无出网、仅 admin 可见（design-iter-13 定夺④，2026-08-17）
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

logger = logging.getLogger("ai-chat.tools")

# 截断标注文案（design-iter-13 §3.3：后端拥有、前端原样渲染；逐字断言面登记 verify 文档）
TRUNCATION_NOTE = "\n[结果超长，已截断]"

# 注入防护：控制字符转义 + 字面分界包裹（结果回填模型上下文前；数据非指令）
_TOOL_RESULT_OPEN = "<tool_result>"
_TOOL_RESULT_CLOSE = "</tool_result>"
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# 演示工具口径（CHG-007 4.6）：单工具超时 2s；demo_weather 带模拟延迟
DEMO_TOOL_TIMEOUT = 2.0

_WEATHER: dict[str, str] = {
    "北京": "北京：晴，最高 32°C",
    "上海": "上海：多云，最高 30°C",
    "广州": "广州：阵雨，最高 29°C",
    "深圳": "深圳：晴转多云，最高 31°C",
    "杭州": "杭州：晴，最高 33°C",
}


class ToolError(Exception):
    """校验链拒绝（①②③）：网关转为 error result，不执行后续环节。"""


@dataclass
class ToolDef:
    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema 精简子集：type/properties/required
    handler: Callable[[dict[str, Any]], Awaitable[str | ToolOutput]]
    timeout: float
    egress_domains: tuple[str, ...] = field(default=())  # 空 = 无出网（A1 演示工具）
    admin_only: bool = False
    # 运行时能力门名（design-iter-14 §6.2，A2 起）：非 None = 该工具额外受运行时开关过滤
    # （如 search 受 admin 开关 ∧ key 已配置；gates 缺省视为关——A1 行为不变）
    gate: str | None = None


@dataclass
class ToolOutput:
    """iter-14 T2（design-iter-14 §6.4）：结构化工具输出——text 供模型消费（走截断/注入链），
    sources 为 tool.result 事件的可选来源数组（引用来源卡数据面，前端按结构化列表消费）。"""
    text: str
    sources: list[dict[str, Any]] | None = None


@dataclass
class ToolExecution:
    status: str  # 'ok' | 'error' | 'timeout'
    result: str  # 截断后的文本（error/timeout 时为机器可读原因）
    duration_ms: int
    truncated: bool = False
    sources: list[dict[str, Any]] | None = None  # 仅 ok 且有来源时非空（design §6.4）


_REGISTRY: dict[str, ToolDef] = {}


def register_tool(defn: ToolDef) -> None:
    _REGISTRY[defn.name] = defn


def tools_for_user(
    *, is_admin: bool, gates: dict[str, bool] | None = None
) -> list[ToolDef]:
    """按请求者过滤注册表（定夺④：演示工具仅 admin）。

    gates = 运行时能力门状态（design-iter-14 §6.2，回合受理时实时读后传入）：
    带 gate 声明的工具仅在 gates[gate] 为真时进入下发列表——admin 关闭或 key 缺失时
    search 不在注册表可见面（上游 tools 定义不含 search，模型不知其存在）。缺省 = 全关。
    """
    out: list[ToolDef] = []
    for d in _REGISTRY.values():
        if d.admin_only and not is_admin:
            continue
        if d.gate is not None and not (gates or {}).get(d.gate):
            continue
        out.append(d)
    return out


def openai_tools_payload(defns: list[ToolDef]) -> list[dict[str, Any]]:
    """注册表 → OpenAI 兼容 tools 定义（无工具时调用方不下发 tools 字段）。"""
    return [
        {
            "type": "function",
            "function": {
                "name": d.name,
                "description": d.description,
                "parameters": d.parameters,
            },
        }
        for d in defns
    ]


# ---------- ② 参数校验（JSON Schema 精简子集：type / enum / maxLength / required） ----------

_TYPES = {"string": str, "number": (int, float), "integer": int, "boolean": bool}


def validate_args(args: dict[str, Any], schema: dict[str, Any]) -> None:
    props = schema.get("properties", {})
    for key in schema.get("required", []):
        if key not in args:
            raise ToolError(f"缺少必填参数：{key}")
    for key, value in args.items():
        spec = props.get(key)
        if spec is None:
            raise ToolError(f"未知参数：{key}")
        expected = spec.get("type")
        if expected in _TYPES and not isinstance(value, _TYPES[expected]):
            raise ToolError(f"参数 {key} 类型应为 {expected}")
        if "enum" in spec and value not in spec["enum"]:
            raise ToolError(f"参数 {key} 取值不在允许范围")
        if "maxLength" in spec and isinstance(value, str) and len(value) > spec["maxLength"]:
            raise ToolError(f"参数 {key} 超过最大长度 {spec['maxLength']}")


# ---------- ③ 出网白名单 + SSRF 防护（A2 搜索工具起真实出网生效） ----------

def is_disallowed_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """内网/环回/链路本地/保留/组播地址判定（CHG-007 4.5-③ 地址集）。"""
    return (
        ip.is_private or ip.is_loopback or ip.is_link_local
        or ip.is_reserved or ip.is_multicast
    )


def ensure_egress_allowed(url: str, whitelist: tuple[str, ...]) -> None:
    host = urlparse(url).hostname or ""
    if not host:
        raise ToolError("出网目标缺少主机名")
    if host not in whitelist:
        raise ToolError(f"出网目标不在白名单：{host}")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return  # 域名：白名单已判过；解析期地址核验由调用方在连接前完成（app/search.py，A2 落地）
    if is_disallowed_ip(ip):
        raise ToolError("出网目标为内网/保留地址，已拒绝")


# ---------- ⑤ 截断 / ⑥ 注入防护 ----------

def truncate_result(text: str, limit: int) -> tuple[str, bool]:
    raw = text.encode("utf-8")
    if len(raw) <= limit:
        return text, False
    cut = raw[:limit].decode("utf-8", errors="ignore")
    return cut + TRUNCATION_NOTE, True


def wrap_for_context(text: str) -> str:
    """结果回填模型上下文前的注入防护：控制字符转义 + 字面分界（模型按数据处理）。"""
    escaped = _CONTROL_CHARS.sub(lambda m: f"\\x{ord(m.group()):02x}", text)
    return f"{_TOOL_RESULT_OPEN}\n{escaped}\n{_TOOL_RESULT_CLOSE}"


# ---------- 网关执行链 ----------

async def execute_tool(defn: ToolDef, arguments_json: str, *, limit: int) -> ToolExecution:
    """① 注册检查由调用方查表完成；本函数承载 ②~⑥ 与超时（④）。

    工具自身未捕获异常 → error result + error 级日志留痕（REQ-031 异常分支）。
    """
    start = time.monotonic()
    try:
        try:
            args = json.loads(arguments_json) if arguments_json.strip() else {}
        except json.JSONDecodeError as exc:
            raise ToolError(f"arguments 非合法 JSON：{exc}") from exc
        if not isinstance(args, dict):
            raise ToolError("arguments 应为 JSON 对象")
        validate_args(args, defn.parameters)
        try:
            output = await asyncio.wait_for(defn.handler(args), timeout=defn.timeout)
        except TimeoutError:  # asyncio.TimeoutError（3.11+ 与内建同型）= 护栏④
            duration = int((time.monotonic() - start) * 1000)
            _log(defn.name, "timeout", duration, False)
            return ToolExecution("timeout", "工具执行超时", duration)
        except ToolError:
            raise  # 工具主动报告的校验类错误（含出网拒绝），走下述统一 error 分支
        except Exception as exc:  # 网关兜底：工具自身未捕获异常不外泄细节（REQ-031 异常分支）
            duration = int((time.monotonic() - start) * 1000)
            logger.error("tool crashed name=%s error=%s", defn.name, type(exc).__name__)
            _log(defn.name, "error", duration, False)
            return ToolExecution("error", f"工具执行异常：{type(exc).__name__}", duration)
        # 结构化输出（design-iter-14 §6.4）：sources 与文本为同一结果两视角，仅 ok 时携带
        sources: list[dict[str, Any]] = []
        if isinstance(output, ToolOutput):
            output, sources = output.text, list(output.sources or [])
        text, truncated = truncate_result(output, limit)
        duration = int((time.monotonic() - start) * 1000)
        _log(defn.name, "ok", duration, truncated)
        return ToolExecution("ok", text, duration, truncated, sources or None)
    except ToolError as exc:
        duration = int((time.monotonic() - start) * 1000)
        _log(defn.name, "error", duration, False)
        return ToolExecution("error", str(exc), duration)


def _log(name: str, status: str, duration_ms: int, truncated: bool) -> None:
    # 安全日志四字段（REQ-031 验收 5）：不含结果全文与密钥
    logger.info(
        "tool executed name=%s status=%s duration_ms=%s truncated=%s",
        name, status, duration_ms, truncated,
    )


# ---------- 内置演示工具（CHG-007 4.6；无出网、仅 admin） ----------

async def _echo(args: dict[str, Any]) -> str:
    return args["text"]


async def _demo_weather(args: dict[str, Any]) -> str:
    await asyncio.sleep(0.2)  # 模拟延迟（200~500ms 下限取稳态，验收不抖动）
    return _WEATHER[args["city"]]


register_tool(ToolDef(
    name="echo",
    description="回显入参文本（内置演示工具：验证参数校验与调用往返）",
    parameters={
        "type": "object",
        "properties": {"text": {"type": "string", "maxLength": 500}},
        "required": ["text"],
    },
    handler=_echo,
    timeout=DEMO_TOOL_TIMEOUT,
    admin_only=True,
))
register_tool(ToolDef(
    name="demo_weather",
    description="查询指定城市天气（内置演示工具，固定假数据：验证工具步骤渲染）",
    parameters={
        "type": "object",
        "properties": {"city": {"type": "string", "enum": sorted(_WEATHER)}},
        "required": ["city"],
    },
    handler=_demo_weather,
    timeout=DEMO_TOOL_TIMEOUT,
    admin_only=True,
))
