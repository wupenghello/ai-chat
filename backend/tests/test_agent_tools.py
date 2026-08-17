"""REQ-031（iter-13 T1）：工具网关六项校验链 + 演示工具 + 注入防护 + 出网治理单元。"""

import asyncio

from app import tools as gw
from app.tools import ToolDef, ensure_egress_allowed, execute_tool

LIMIT = 64


def test_演示工具_echo_回显入参():
    defn = gw._REGISTRY["echo"]
    out = asyncio.run(execute_tool(defn, '{"text": "hello"}', limit=LIMIT))
    assert out.status == "ok"
    assert out.result == "hello"
    assert out.truncated is False


def test_演示工具_demo_weather_枚举城市():
    defn = gw._REGISTRY["demo_weather"]
    out = asyncio.run(execute_tool(defn, '{"city": "北京"}', limit=LIMIT))
    assert out.status == "ok"
    assert out.result == "北京：晴，最高 32°C"


def test_参数校验_缺必填():
    out = asyncio.run(execute_tool(gw._REGISTRY["echo"], "{}", limit=LIMIT))
    assert out.status == "error"
    assert "缺少必填参数" in out.result


def test_参数校验_类型错误():
    out = asyncio.run(execute_tool(gw._REGISTRY["echo"], '{"text": 123}', limit=LIMIT))
    assert out.status == "error"
    assert "类型" in out.result


def test_参数校验_枚举外取值():
    out = asyncio.run(execute_tool(gw._REGISTRY["demo_weather"], '{"city": "南京"}', limit=LIMIT))
    assert out.status == "error"
    assert "取值不在允许范围" in out.result


def test_参数校验_超长():
    out = asyncio.run(execute_tool(gw._REGISTRY["echo"], f'{{"text": "{"x" * 501}"}}', limit=LIMIT))
    assert out.status == "error"
    assert "最大长度" in out.result


def test_参数校验_未知参数():
    out = asyncio.run(execute_tool(gw._REGISTRY["echo"], '{"text": "a", "extra": 1}', limit=LIMIT))
    assert out.status == "error"
    assert "未知参数" in out.result


def test_参数校验_非合法_json():
    out = asyncio.run(execute_tool(gw._REGISTRY["echo"], "{not json", limit=LIMIT))
    assert out.status == "error"
    assert "非合法 JSON" in out.result


def test_超时_护栏_单工具超时():
    async def slow(_args):
        await asyncio.sleep(0.3)
        return "never"

    defn = ToolDef(name="t_slow", description="", parameters={"type": "object", "properties": {}},
                   handler=slow, timeout=0.05)
    out = asyncio.run(execute_tool(defn, "{}", limit=LIMIT))
    assert out.status == "timeout"
    assert out.result == "工具执行超时"


def test_截断_超限追加标注():
    async def big(_args):
        return "字" * 200

    defn = ToolDef(name="t_big", description="", parameters={"type": "object", "properties": {}},
                   handler=big, timeout=1.0)
    out = asyncio.run(execute_tool(defn, "{}", limit=32))
    assert out.status == "ok"
    assert out.truncated is True
    assert out.result.endswith(gw.TRUNCATION_NOTE)
    assert len(out.result.encode("utf-8")) <= 32 + len(gw.TRUNCATION_NOTE.encode("utf-8"))


def test_截断_限内不标注():
    async def small(_args):
        return "ok"

    defn = ToolDef(name="t_small", description="", parameters={"type": "object", "properties": {}},
                   handler=small, timeout=1.0)
    out = asyncio.run(execute_tool(defn, "{}", limit=32))
    assert out.truncated is False
    assert out.result == "ok"


def test_工具自身异常_网关兜底为_error_不外泄细节():
    async def boom(_args):
        raise RuntimeError("secret detail")

    defn = ToolDef(name="t_boom", description="", parameters={"type": "object", "properties": {}},
                   handler=boom, timeout=1.0)
    out = asyncio.run(execute_tool(defn, "{}", limit=LIMIT))
    assert out.status == "error"
    assert out.result == "工具执行异常：RuntimeError"
    assert "secret" not in out.result


def test_注入防护_控制字符转义与字面包裹():
    wrapped = gw.wrap_for_context("a\x00b\x1fc")
    assert wrapped.startswith("<tool_result>\n")
    assert wrapped.endswith("\n</tool_result>")
    assert "\\x00" in wrapped and "\\x1f" in wrapped
    assert "\x00" not in wrapped and "\x1f" not in wrapped


def test_可见性过滤_演示工具仅_admin():
    assert [d.name for d in gw.tools_for_user(is_admin=True)] == ["echo", "demo_weather"]
    assert gw.tools_for_user(is_admin=False) == []


def test_注册表转_openai_tools_payload():
    payload = gw.openai_tools_payload(gw.tools_for_user(is_admin=True))
    assert [t["function"]["name"] for t in payload] == ["echo", "demo_weather"]
    assert payload[0]["type"] == "function"
    assert payload[0]["function"]["parameters"]["required"] == ["text"]


def test_出网白名单_非白名单域拒绝():
    try:
        ensure_egress_allowed("https://evil.example.com/x", ("api.search.test",))
        raise AssertionError("should reject")
    except gw.ToolError as exc:
        assert "不在白名单" in str(exc)


def test_出网白名单_白名单域放行():
    ensure_egress_allowed("https://api.search.test/v1?q=x", ("api.search.test",))


def test_出网白名单_内网与环回地址拒绝():
    for host in ("10.0.0.5", "192.168.1.1", "127.0.0.1", "169.254.1.1", "::1"):
        url = f"http://[{host}]/x" if ":" in host else f"http://{host}/x"
        try:
            ensure_egress_allowed(url, (host,))
            raise AssertionError(f"should reject {host}")
        except gw.ToolError as exc:
            assert "内网/保留地址" in str(exc)


def test_出网白名单_缺主机名拒绝():
    try:
        ensure_egress_allowed("not-a-url", ())
        raise AssertionError("should reject")
    except gw.ToolError as exc:
        assert "主机名" in str(exc)


def test_出网拒绝发生在任何连接之前():
    fetched: list[str] = []

    async def fake_egress_tool(args):
        ensure_egress_allowed(args["url"], ("api.search.test",))
        fetched.append(args["url"])  # 白名单通过后才会走到这里（真实工具在此后才发起请求）
        return "fetched"

    defn = ToolDef(name="t_fetch", description="",
                   parameters={"type": "object",
                               "properties": {"url": {"type": "string"}},
                               "required": ["url"]},
                   handler=fake_egress_tool, timeout=1.0, egress_domains=("api.search.test",))
    out = asyncio.run(execute_tool(defn, '{"url": "http://10.0.0.1/admin"}', limit=LIMIT))
    assert out.status == "error"
    assert fetched == []  # 零连接：拒绝先于任何出网动作（REQ-031 验收 2-b 的网关层断言）
