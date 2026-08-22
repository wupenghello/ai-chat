"""生命周期事件 hooks（CHG-013 REQ-048，iter-19 T2）：进程内旁路回调。

闭合 5 事件枚举（turn.accepted / tool.before / tool.after / turn.end / turn.cancelled）；
载荷元数据-only（不含消息正文、工具结果全文、任何 key——卫生口径，CHG-013 定夺⑤）。
分发 = fire-and-forget（只观察不决策，定夺③）：hooks_enabled 关或注册表空 → 短路零
任务；否则逐命中 hook 独立任务 + 强引用集合终态自移除（T0-1 组 1/5：官方文档口径
必持强引用，方案实测零累积），任务内 wait_for(hook, hook_timeout)——异常/超时吞掉记
warning，超时护栏对吞取消的坏公民 hook 亦有界（T0-1 组 3）。不排队、不落库、不重试、
无序（防第二套循环）。注册面 = 部署侧代码静态注册（定夺④，沿 tools.register_tool
先例；main.py 留注册示例注释，admin 运行时零配置面）。

埋点位与实现输入：plans/iter-19-verify.md T0-2 点位核对表（T0→T2 串行口径，
CHG-013 定夺⑧）。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app.config import get_settings

logger = logging.getLogger("ai-chat.hooks")

# 事件枚举（闭合 5 项，定夺②；子系统事件留池）
TURN_ACCEPTED = "turn.accepted"    # 受理成立（proxy 受理点；被拒回合 404/503/422/429 零事件）
TOOL_BEFORE = "tool.before"        # 模型发起工具调用、执行前（含未注册 → error result 路径）
TOOL_AFTER = "tool.after"          # 工具执行终态已知（ok/error/timeout + duration_ms）
TURN_END = "turn.end"              # 回合终态（reason 四值 + 累计 requests/tokens）
TURN_CANCELLED = "turn.cancelled"  # 断连/中止终态（现行口径该路径不产 turn.end）


@dataclass(frozen=True, slots=True)
class HookEvent:
    """事件载荷（元数据-only，CHG-013 内容 3.2）：不适用字段保持 None。

    公共字段：event / turn_id / session_id / user_id / mode（回合模式 chat|research）/
    timestamp（UTC ISO8601）；专有字段按事件携带——工具事件加 step / tool_name，
    tool.after 加 status / duration_ms，turn.end 加 reason / requests / tokens。
    排除项（卫生口径）：消息正文、工具入参与结果全文、任何 key、上游 base_url。
    """

    event: str
    turn_id: str
    session_id: str
    user_id: int | str | None  # 服务端用户主键（直驱 run_turn 的测试场景可 None）
    mode: str
    timestamp: str
    step: int | None = None
    tool_name: str | None = None
    status: str | None = None      # tool.after：ok | error | timeout
    duration_ms: int | None = None  # tool.after
    reason: str | None = None      # turn.end：done | max_steps | time_limit | error
    requests: int | None = None    # turn.end：回合内上游调用累计
    tokens: int | None = None      # turn.end：回合内 token 累计


@dataclass(frozen=True)
class Hook:
    name: str
    callback: Callable[[HookEvent], Awaitable[None]]
    events: frozenset[str] | None = field(default=None)  # None = 订阅全部


_REGISTRY: list[Hook] = []
# 分发任务强引用集合（终态自移除——asyncio 官方口径：create_task 结果必须持引用，
# 防事件循环弱引用中途回收；实测零累积见 verify T0-1 组 5）
_TASKS: set[asyncio.Task] = set()


def register_hook(name: str, callback: Callable[[HookEvent], Awaitable[None]],
                  events: set[str] | frozenset[str] | None = None) -> None:
    """部署侧静态注册（import 即注册，沿 search 工具先例；同事件多 hook 各自分发）。"""
    _REGISTRY.append(Hook(name=name, callback=callback,
                          events=frozenset(events) if events is not None else None))


def _drain(task: asyncio.Task) -> None:
    """终态自移除 + 异常消费（unretrieved 告警实测复现，verify T0-1 组 4）。"""
    _TASKS.discard(task)
    if not task.cancelled():
        _ = task.exception()  # 已消费即不留 unretrieved 告警


async def _run(hook: Hook, event: HookEvent, timeout: float) -> None:
    try:
        await asyncio.wait_for(hook.callback(event), timeout=timeout)
    except TimeoutError:
        logger.warning("hook %s timed out on %s (%.1fs)", hook.name, event.event, timeout)
    except asyncio.CancelledError:
        raise  # 关停取消照常传播（任务 cancelled 态，无 unretrieved）
    except Exception:  # noqa: BLE001 —— hook 故障不阻塞回合主路径（旁路彻底性）
        logger.warning("hook %s failed on %s", hook.name, event.event, exc_info=True)


def dispatch(event: HookEvent) -> None:
    """同步入口（create_task 非 await——turn.cancelled 埋点不引入新 await 点）。

    注册表空 / hooks_enabled 关 → 短路零任务（零开销路径）。
    """
    if not _REGISTRY:
        return
    settings = get_settings()
    if not settings.hooks_enabled:
        return
    for hook in _REGISTRY:
        if hook.events is not None and event.event not in hook.events:
            continue
        task = asyncio.create_task(_run(hook, event, settings.hook_timeout))
        _TASKS.add(task)
        task.add_done_callback(_drain)


def emit(event: str, *, turn_id: str, session_id: str, user_id: str | None,
         mode: str, **extra: object) -> None:
    """埋点便捷入口：公共字段 + 专有字段（extra），timestamp 内部填充。

    未知 extra 字段名在 HookEvent 构造处 TypeError（开发期暴露埋点笔误）。
    """
    dispatch(HookEvent(
        event=event, turn_id=turn_id, session_id=session_id, user_id=user_id,
        mode=mode, timestamp=datetime.now(UTC).isoformat(timespec="milliseconds"),
        **extra,  # type: ignore[arg-type]
    ))
