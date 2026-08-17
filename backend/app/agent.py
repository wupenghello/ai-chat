"""agent 运行时（CHG-007 REQ-030/033，iter-13 T1）：回合编排 + 消息归一化 + 服务端组装。

回合（turn）= 一次用户发送触发的完整 agent 过程：上下文准备 → 流式调用（携工具定义）→
工具执行（经 tools 网关）→ 结果回填 → 继续或终止。三护栏（design-iter-13 定夺①②）：
最大步数（默认 10）/ 上游单步超时（120s）/ 断连取消（客户端断开 → 取消上游与工具，无孤儿任务）。

SSE v2 事件 = CHG-007 内容 4.1（单行 JSON 帧；未知 type 前端静默跳过，为 B/C/D 期留扩展位）。
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx

from app import tools as toolsgw
from app.tools import ToolDef

logger = logging.getLogger("ai-chat.agent")

# REQ-002/033：上下文窗口 = 系统提示词 + 最近 20 轮（规则照搬前端 buildContext）
MAX_CONTEXT_TURNS = 20


class UpstreamStatusError(Exception):
    """上游返回 >= 400（错误映射复用 design-iter-7 §3.1，REQ-030 异常分支）。"""

    def __init__(self, status: int) -> None:
        super().__init__(f"upstream status {status}")
        self.status = status


class StepTimeout(Exception):
    """上游单步超时（护栏②）。"""


def _upstream_error_event(status: int) -> dict[str, str]:
    """design-iter-7 §3.1 定稿文案（与 proxy._error 同源；SSE error 事件无 HTTP 状态层）。"""
    if status in (401, 403):
        return {"type": "error", "code": "upstream_auth",
                "message": "请求失败：API 密钥无效，请检查高级设置中的供应商配置"}
    if status == 429:
        return {"type": "error", "code": "upstream_rate_limited",
                "message": "请求过于频繁，已被限流。请稍后重试"}
    return {"type": "error", "code": "upstream_error",
            "message": "上游服务暂时不可用，请稍后重试"}


_UPSTREAM_TIMEOUT_EVENT = {"type": "error", "code": "upstream_timeout",
                           "message": "请求超时，请稍后重试"}
_UPSTREAM_UNREACHABLE_EVENT = {"type": "error", "code": "upstream_unreachable",
                               "message": "上游服务暂时不可用，请稍后重试"}


# ---------- 消息归一化（REQ-032：v1 string / v2 blocks → OpenAI wire 格式） ----------

def wire_messages_from_doc(doc: dict[str, Any]) -> list[dict[str, Any]]:
    """会话档 messages → wire 消息（active 数组；branches 为替代分支不参与组装）。

    v1：content string 直转；v2：text 段并入 assistant 文本、tool_call 段展开为带
    tool_calls 的 assistant 消息、tool_result 段展开为 tool 消息（服务端组装的归一化基座，
    老会话零迁移——读时归一化的服务端对偶，CHG-007 内容 4.2）。
    """
    out: list[dict[str, Any]] = []
    for m in doc.get("messages") or []:
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        content = m.get("content")
        # 旧前端 toContext 语义延续：错误/空回复的 assistant 消息不进上下文
        # （error 状态与空内容在存量档中真实存在；generating 为刷新残留态，同排除）
        if role == "assistant" and m.get("status") in ("error", "generating"):
            continue
        if role == "user" and isinstance(content, str) and content:
            out.append({"role": "user", "content": content})
        elif role == "assistant":
            if isinstance(content, str):
                if content:  # 空回复不进上下文（toContext 语义延续）
                    out.append({"role": "assistant", "content": content})
            elif isinstance(content, list):
                if not any(  # 无文本且无工具段的空 v2 消息不进上下文
                    isinstance(b, dict) and b.get("type") in ("text", "tool_call", "tool_result")
                    and (b.get("type") != "text" or b.get("text"))
                    for b in content
                ):
                    continue
                pending_text: list[str] = []
                for b in content:
                    if not isinstance(b, dict):
                        continue
                    btype = b.get("type")
                    if btype == "text" and isinstance(b.get("text"), str):
                        pending_text.append(b["text"])
                    elif btype == "tool_call":
                        if pending_text:
                            out.append({"role": "assistant", "content": "\n\n".join(pending_text)})
                            pending_text = []
                        out.append({
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [{
                                "id": str(b.get("tool_call_id", "")),
                                "type": "function",
                                "function": {
                                    "name": str(b.get("name", "")),
                                    "arguments": str(b.get("arguments", "{}")),
                                },
                            }],
                        })
                    elif btype == "tool_result":
                        # 存量 tool_result 回填上下文同样做注入包裹（与回合内实时回填同口径）
                        out.append({
                            "role": "tool",
                            "tool_call_id": str(b.get("tool_call_id", "")),
                            "content": toolsgw.wrap_for_context(str(b.get("result", ""))),
                        })
                if pending_text:
                    out.append({"role": "assistant", "content": "\n\n".join(pending_text)})
    return out


def assemble_context(
    history: list[dict[str, Any]],
    message: str,
    system_prompt: str | None,
    *,
    max_turns: int = MAX_CONTEXT_TURNS,
) -> list[dict[str, Any]]:
    """服务端上下文组装（REQ-033，规则照搬前端 buildContext）：系统提示词 + 最近 20 轮。

    轮 = user 起、至下一 user 前（回合内 tool 消息属助手侧不占轮）。user 锚定截断天然
    不留悬空 assistant（对齐旧「丢弃截断后悬空的 assistant」）。去重护栏：前端
    「先 PUT 再发回合」流向下库内已含本条用户消息，不重复追加。
    """
    msgs = [m for m in history if m.get("role") != "system"]
    if not (msgs and msgs[-1].get("role") == "user" and msgs[-1].get("content") == message):
        msgs = msgs + [{"role": "user", "content": message}]
    turn_starts = [i for i, m in enumerate(msgs) if m.get("role") == "user"]
    start = turn_starts[-max_turns] if len(turn_starts) > max_turns else 0
    selected = msgs[start:]
    prefix = [{"role": "system", "content": system_prompt}] if system_prompt else []
    return prefix + selected


# ---------- 上游流式调用（SSE 解析重组：文本增量 + tool_calls 分片重组 + usage） ----------

class UpstreamCall:
    """单次上游调用：stream() 逐段 yield 文本增量（打字机实时性），内部累积重组。

    tool_calls 流式分片重组（REQ-030 风险①）：id/name 通常在首片、arguments 逐片追加、
    按 index 对齐；不完整 JSON 由模型侧重试/降级兜底，本层只做忠实拼接。
    """

    def __init__(self, client: httpx.AsyncClient, base_url: str, api_key: str) -> None:
        self._client = client
        self._base_url = base_url
        self._api_key = api_key
        self._resp: httpx.Response | None = None
        self.usage = 0
        self.texts: list[str] = []
        self.tool_calls: list[dict[str, str]] = []

    async def aclose(self) -> None:
        if self._resp is not None:
            await self._resp.aclose()
            self._resp = None

    async def stream(self, payload: dict[str, Any]) -> AsyncIterator[str]:
        resp = await self._client.send(
            self._client.build_request(
                "POST",
                f"{self._base_url}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {self._api_key}",
                         "Accept": "text/event-stream"},
            ),
            stream=True,
        )
        self._resp = resp
        try:
            if resp.status_code >= 400:
                raise UpstreamStatusError(resp.status_code)
            buffer = b""
            acc: dict[int, dict[str, Any]] = {}
            async for chunk in resp.aiter_raw():
                buffer += chunk.replace(b"\r\n", b"\n")
                while b"\n\n" in buffer:
                    raw_frame, _, buffer = buffer.partition(b"\n\n")
                    for line in raw_frame.split(b"\n"):
                        if not line.startswith(b"data:"):
                            continue
                        data = line[5:].strip()
                        if not data or data == b"[DONE]":
                            continue
                        try:
                            obj = json.loads(data)
                        except json.JSONDecodeError:
                            continue  # 容错：坏帧丢弃不崩（REQ-030 风险①应对）
                        usage = obj.get("usage")
                        if isinstance(usage, dict):
                            self.usage = int(usage.get("total_tokens") or 0)
                        choices = obj.get("choices") or []
                        if not choices:
                            continue
                        delta = choices[0].get("delta") or {}
                        text = delta.get("content")
                        if text:
                            self.texts.append(text)
                            yield text
                        for tc in delta.get("tool_calls") or []:
                            entry = acc.setdefault(int(tc.get("index", 0)),
                                                   {"id": "", "name": "", "args": []})
                            if tc.get("id"):
                                entry["id"] = tc["id"]
                            fn = tc.get("function") or {}
                            if fn.get("name"):
                                entry["name"] = fn["name"]
                            if fn.get("arguments"):
                                entry["args"].append(fn["arguments"])
            self.tool_calls = [
                {"id": e["id"] or f"call_{i}", "name": e["name"],
                 "arguments": "".join(e["args"])}
                for i, e in sorted(acc.items())
            ]
        finally:
            await resp.aclose()
            self._resp = None


# ---------- 回合循环（ReAct：准备 → 流式调用 → 工具执行 → 回填 → 终止/继续） ----------

async def run_turn(
    *,
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
    model: str,
    session_id: str,
    messages: list[dict[str, Any]],
    tool_defs: list[ToolDef],
    max_steps: int,
    step_timeout: float,
    tool_result_limit: int,
    on_finish: Callable[[int, int], None] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """回合事件生成器（SSE v2，CHG-007 4.1 事件表）。

    断连取消：Starlette 取消本生成器 → CancelledError 在 yield 点抛入 → finally 取消
    进行中的上游调用（工具协程受 wait_for 约束随步超时/取消终止，无孤儿任务）；
    on_finish(calls, tokens) 以已发生部分落账（定夺⑧：回合受理即计、tokens 如实累计）。
    """
    turn_id = uuid.uuid4().hex[:12]
    yield {"type": "turn.start", "session_id": session_id, "turn_id": turn_id}

    registry = {d.name: d for d in tool_defs}
    context = list(messages)
    calls = 0
    tokens = 0
    reason = "done"
    active: UpstreamCall | None = None
    finished = False

    def _finish() -> None:
        nonlocal finished
        if not finished:
            finished = True
            if on_finish is not None:
                on_finish(calls, tokens)

    try:
        for step in range(1, max_steps + 1):
            yield {"type": "turn.step", "step": step, "max_steps": max_steps}
            payload: dict[str, Any] = {
                "model": model,
                "messages": context,
                "stream": True,
                "stream_options": {"include_usage": True},
            }
            if tool_defs:
                payload["tools"] = toolsgw.openai_tools_payload(tool_defs)

            call = UpstreamCall(client, base_url, api_key)
            active = call
            deadline = time.monotonic() + step_timeout
            try:
                it = call.stream(payload)
                try:
                    while True:
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            raise StepTimeout()
                        try:
                            delta = await asyncio.wait_for(anext(it), timeout=remaining)
                        except StopAsyncIteration:
                            break
                        yield {"type": "text.delta", "text": delta}
                finally:
                    await it.aclose()
            except UpstreamStatusError as exc:
                yield _upstream_error_event(exc.status)
                reason = "error"
                break
            except httpx.TimeoutException:
                yield _UPSTREAM_TIMEOUT_EVENT  # 连接期超时（§3.1：504 upstream_timeout 同文案）
                reason = "error"
                break
            except (StepTimeout, TimeoutError):
                yield _UPSTREAM_TIMEOUT_EVENT  # 护栏②：上游单步超时（wait_for 到期）
                reason = "error"
                break
            except httpx.HTTPError:
                yield _UPSTREAM_UNREACHABLE_EVENT
                reason = "error"
                break
            finally:
                await call.aclose()
                active = None

            calls += 1
            tokens += call.usage
            requested = call.tool_calls if tool_defs else []
            if not requested:
                break  # 模型给出最终回答
            if step >= max_steps:
                reason = "max_steps"  # 模型仍要调工具但步数用尽（验收 2：第 2 步后截停）
                break

            assistant_msg: dict[str, Any] = {
                "role": "assistant",
                "content": "".join(call.texts),
                "tool_calls": [
                    {"id": tc["id"], "type": "function",
                     "function": {"name": tc["name"], "arguments": tc["arguments"]}}
                    for tc in requested
                ],
            }
            context.append(assistant_msg)
            for tc in requested:
                yield {"type": "tool.call", "tool_call_id": tc["id"],
                       "name": tc["name"], "arguments": tc["arguments"]}
                defn = registry.get(tc["name"])
                if defn is None:
                    execution = toolsgw.ToolExecution("error", f"未注册工具：{tc['name']}", 0)
                else:
                    execution = await toolsgw.execute_tool(
                        defn, tc["arguments"], limit=tool_result_limit
                    )
                yield {"type": "tool.result", "tool_call_id": tc["id"],
                       "status": execution.status, "result": execution.result,
                       "duration_ms": execution.duration_ms}
                # 注入防护包裹后回填（数据非指令，CHG-007 4.5-⑥）；错误结果同样回填，
                # 模型可降级直答（回合继续，REQ-030 异常分支）
                context.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": toolsgw.wrap_for_context(execution.result),
                })
        yield {"type": "usage", "requests": calls, "tokens": tokens}
        yield {"type": "turn.end", "reason": reason}
    finally:
        if active is not None:
            await active.aclose()
        _finish()
