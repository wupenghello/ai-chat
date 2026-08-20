"""三级上下文压缩管道（CHG-010 REQ-039/041，iter-16 T2）。

三级口径（审核稿 §三要素 6）：
- 一级 snip（旧工具结果裁剪）：组装时确定性地把早于最近 K 条工具消息（K=2，定夺⑨）的
  tool 结果替换为裁剪占位（wire 层操作，不触库；每次组装无条件执行）。
- 二级 compact（中段历史摘要）：以一次非流式上游摘要调用把水位之前的中段历史压缩为摘要
  文本，作为**独立 system 消息**注入组装，挂载点 = 动态尾区之后、历史之前（REQ-036 预留区落地）。
- 三级 token 阈值自动触发：以该会话上一回合 step=1 上游调用的 telemetry tokens_prompt
  机器实测值判定（不引入 tokenizer、不估算，铁律 5），超阈值即在组装前执行 compact。

压缩只影响「发给上游的内容」：库内会话消息全文零删除，界面展示/导出/搜索/版本分支口径全部
不变（定夺⑥）。摘要产物存独立表 context_summary（迁移 v9，定夺⑤），不写回会话档，与
LWW/409 守卫/整档透传零交互。任何失败降级为不压缩组装（20 轮窗口 + snip），回合不阻塞。
"""

from __future__ import annotations

import logging
import sqlite3
import time
from typing import Any

import httpx

from app.agent import _now_line

logger = logging.getLogger("ai-chat.compress")

# ---- 定死参数（plans/iter-16-verify.md T0；config 提供同名字段，.env 可覆盖） ----
# 摘要 prompt R2 定稿（后端拥有、逐字断言面 = plans/iter-16-verify.md §5，逐字使用）
SUMMARY_PROMPT = (
    "请将以下对话历史压缩为一段摘要，供 AI 助手在后续对话中参考。要求：\n"
    "一、保留用户陈述的事实、要求与偏好，尤其是会话开头的关键信息（如用户身份、目标、约定）。\n"
    "二、保留工具调用的结论与来源要点（如搜索结果的关键事实），不保留调用过程细节。\n"
    "三、省略寒暄、重复与已被后续对话取代的旧信息。\n"
    "四、用陈述句客观转述，不加评论。\n"
    "五、知识性问答只保留主题清单（一句话列举聊过哪些主题），不展开各主题的定义与细节。\n"
    "六、总长度严格不超过 800 字；若内容过多，优先删减知识性主题与工具结果的次要细节。\n"
    "直接输出摘要正文，不要任何前缀说明。"
)

# 注入前字面包裹（CHG-010 3.3：防指令注入进 system 级消息，与 toolsgw.wrap_for_context 同哲学）
SUMMARY_TAG_OPEN = "<conversation_summary>"
SUMMARY_TAG_CLOSE = "</conversation_summary>"

# 单条工具结果进摘要输入时的字符上限（控制摘要调用自身体量；结论要点保留，超长按截断口径）
_SUMMARY_TOOL_RESULT_CHARS = 1000


def snip_placeholder(name: str, status: str) -> str:
    """一级 snip 裁剪占位文案（后端拥有、逐字断言面登记 verify 文档）。"""
    return f"[旧工具结果已裁剪：{name} · {status}]"


# ---------- 一级 snip：wire 层确定性裁剪 ----------

def _tool_meta_from_doc(doc: dict[str, Any]) -> dict[str, tuple[str, str]]:
    """tool_call_id → (工具名, 状态) 映射（自会话档 blocks 采集，供占位文案使用）。"""
    meta: dict[str, list[str]] = {}
    for m in doc.get("messages") or []:
        if not isinstance(m, dict):
            continue
        content = m.get("content")
        if not isinstance(content, list):
            continue
        for b in content:
            if not isinstance(b, dict):
                continue
            btype = b.get("type")
            if btype == "tool_call":
                tcid = str(b.get("tool_call_id", ""))
                meta.setdefault(tcid, ["", ""])[0] = str(b.get("name", ""))
            elif btype == "tool_result":
                tcid = str(b.get("tool_call_id", ""))
                meta.setdefault(tcid, ["", ""])[1] = str(b.get("status", ""))
    return {k: (v[0], v[1]) for k, v in meta.items()}


def snip_tool_results(
    doc: dict[str, Any], wire: list[dict[str, Any]], keep_recent: int
) -> list[dict[str, Any]]:
    """一级 snip：仅最近 keep_recent 条 tool 消息保留结果全文，更早替换为裁剪占位。

    wire 层确定性裁剪（不触库）：输入为 wire_messages_from_doc 的产物，库内 tool_result
    段全文零变化。确定性 = 同一会话档产物恒定（无随机/时间因子），每次组装无条件执行。
    """
    tool_idxs = [i for i, m in enumerate(wire) if m.get("role") == "tool"]
    if keep_recent >= 0 and len(tool_idxs) <= keep_recent:
        return wire
    meta = _tool_meta_from_doc(doc)
    snip_set = set(tool_idxs[:-keep_recent]) if keep_recent > 0 else set(tool_idxs)
    out: list[dict[str, Any]] = []
    for i, m in enumerate(wire):
        if i in snip_set:
            tcid = str(m.get("tool_call_id", ""))
            name, status = meta.get(tcid, ("", ""))
            out.append({
                "role": "tool",
                "tool_call_id": m.get("tool_call_id"),
                "content": snip_placeholder(name, status),
            })
        else:
            out.append(m)
    return out


# ---------- 三级阈值判定：读上一回合 step=1 telemetry tokens_prompt 机器实测值 ----------

def last_turn_prompt_tokens(
    conn: sqlite3.Connection, user_id: int, session_id: str
) -> int | None:
    """该会话上一回合 step=1 上游调用的 tokens_prompt 机器实测值。

    无记录（新会话/遥测缺失/90 天清理边界）返回 None；上游未返回 usage 时列为 NULL 亦返回
    None——调用方按未超阈值处理（保守方向 = 不差于现状，不造数，铁律 5）。
    依赖迁移 v9 的 telemetry.session_id 会话关联列（turn 端点 llm 行写入时携带）。
    """
    row = conn.execute(
        "SELECT tokens_prompt FROM telemetry"
        " WHERE user_id = ? AND session_id = ? AND kind = 'llm' AND step = 1"
        "   AND endpoint = 'turn'"
        " ORDER BY id DESC LIMIT 1",
        (user_id, session_id),
    ).fetchone()
    if row is None:
        return None
    value = row["tokens_prompt"]
    return int(value) if value is not None else None


# ---------- 二级 compact：中段规划 / 摘要产物读写 / 水位失效 ----------

def plan_compact(
    doc: dict[str, Any], message: str, recent_turns: int, *, incoming: bool = True
) -> tuple[list[dict[str, Any]], str] | None:
    """规划可压缩中段：返回 (中段消息列表, 水位消息 id)；无可压缩中段返回 None。

    中段 = 早于最近 recent_turns 轮的会话档消息（user 锚定轮界，与 assemble_compact 的
    窗口口径逐字对齐：保留窗 = 最近 R 轮含本条消息所在轮）。水位 watermark_msg_id =
    摘要覆盖到的最后一条消息 id（失效判定依据）。总轮数 ≤ R → 无可压缩中段
    （REQ-039 主流程 5「无需压缩」语义）。

    incoming=True（回合内自动路径）：本条消息是否已在库（前端先 PUT 再发回合）决定是否
    额外占一个保留轮位——在库则保留窗全部取自档内最近 R 轮；不在库则本条占一轮、档内
    只保留最近 R-1 轮。
    incoming=False（手动压缩，REQ-040/iter-16 T3）：无本条消息，总轮数 = 档内 user 轮数；
    保留窗 = 档内最近 R-1 轮——第 R 轮位留给下一回合的本条消息，与自动路径窗口口径衔接
    无轮间缝隙（下一回合组装 = 摘要 + 最近 R-1 档内轮 + 本条 = R 轮）。
    """
    messages = [m for m in doc.get("messages") or [] if isinstance(m, dict)]
    has_current = incoming and bool(messages) and messages[-1].get("role") == "user" \
        and messages[-1].get("content") == message
    user_idxs = [i for i, m in enumerate(messages) if m.get("role") == "user"]
    extra = 1 if incoming and not has_current else 0
    total_turns = len(user_idxs) + extra
    if total_turns <= recent_turns:
        return None
    keep_doc_turns = recent_turns - (0 if has_current else 1)
    if keep_doc_turns <= 0:
        recent_start = len(messages)  # 保留窗仅本条轮 → 全档皆为中段
    elif len(user_idxs) <= keep_doc_turns:
        return None  # 档内轮数不足以留出中段
    else:
        recent_start = user_idxs[-keep_doc_turns]
    mid = messages[:recent_start]
    if not mid:
        return None
    watermark = mid[-1].get("id")
    if not watermark:
        return None
    return mid, str(watermark)


def watermark_valid(doc: dict[str, Any], watermark_id: str) -> bool:
    """水位失效判定：watermark_msg_id 不在当前 messages → 视同失效。

    覆盖两分支（REQ-039 异常分支）：编辑重建（REQ-015）删除水位消息 → 行删除失效；
    版本切换（REQ-019）分支激活 → 水位 id 在当前 messages 不存在 → 视同失效。
    """
    ids = {
        str(m.get("id"))
        for m in doc.get("messages") or []
        if isinstance(m, dict) and m.get("id")
    }
    return watermark_id in ids


def load_summary(
    conn: sqlite3.Connection, user_id: int, session_id: str
) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT summary, watermark_msg_id, model FROM context_summary"
        " WHERE user_id = ? AND session_id = ?",
        (user_id, session_id),
    ).fetchone()


def save_summary(
    conn: sqlite3.Connection,
    user_id: int,
    session_id: str,
    summary: str,
    watermark_id: str,
    model: str,
) -> None:
    """重压缩 = 同主键覆盖更新（PK (user_id, session_id)，每会话至多一份当前摘要）。"""
    with conn:
        conn.execute(
            "INSERT INTO context_summary (user_id, session_id, summary, watermark_msg_id, model)"
            " VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT(user_id, session_id) DO UPDATE SET"
            "   summary = excluded.summary,"
            "   watermark_msg_id = excluded.watermark_msg_id,"
            "   model = excluded.model,"
            "   updated_at = datetime('now')",
            (user_id, session_id, summary, watermark_id, model),
        )


def render_transcript(mid: list[dict[str, Any]]) -> str:
    """中段历史 → 摘要输入文本（保留用户陈述与工具结论要点，工具结果按字符上限截断）。"""
    lines: list[str] = []
    for m in mid:
        role = m.get("role")
        content = m.get("content")
        if role == "user" and isinstance(content, str) and content:
            lines.append(f"用户：{content}")
        elif role == "assistant":
            if isinstance(content, str):
                if content:
                    lines.append(f"助手：{content}")
            elif isinstance(content, list):
                parts: list[str] = []
                for b in content:
                    if not isinstance(b, dict):
                        continue
                    btype = b.get("type")
                    if btype == "text" and b.get("text"):
                        parts.append(str(b["text"]))
                    elif btype == "tool_result":
                        result = str(b.get("result", ""))[:_SUMMARY_TOOL_RESULT_CHARS]
                        parts.append(f"[工具结论/{b.get('status', '')}] {result}")
                if parts:
                    lines.append("助手：" + "\n".join(parts))
    return "\n".join(lines)


def wrap_summary(summary: str) -> str:
    """注入前字面包裹（防指令注入）。"""
    return f"{SUMMARY_TAG_OPEN}\n{summary}\n{SUMMARY_TAG_CLOSE}"


# ---------- 摘要调用（非流式、独立超时护栏、跟随回合当前模式） ----------

class SummaryOutcome:
    """摘要调用终态：ok / error / timeout（空摘要与 4xx/5xx 归 error，降级方向恒为现状）。

    usage = 摘要调用自身 usage 原文（机器读数；compress 行 tokens_prompt 同列口径的采集源）；
    latency_ms = 摘要调用耗时（compress 行 latency_ms 列）；error_code = 机器可读码
    （summary_timeout / summary_empty / summary_error，status=ok 时为 None）。
    """

    def __init__(
        self,
        status: str,
        text: str = "",
        usage: dict[str, Any] | None = None,
        latency_ms: int = 0,
        error_code: str | None = None,
    ) -> None:
        self.status = status
        self.text = text
        self.usage = usage or {}
        self.latency_ms = latency_ms
        self.error_code = error_code

    @property
    def tokens_total(self) -> int:
        total = self.usage.get("total_tokens")
        return int(total) if isinstance(total, (int, float)) else 0


async def call_summary(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
    model: str,
    transcript: str,
    timeout: float,
    system_prompt: str = SUMMARY_PROMPT,
) -> SummaryOutcome:
    """一次非流式摘要调用（跟随回合当前模式：base_url/api_key/model 即回合解析结果）。

    独立超时护栏（不占 REQ-030 单步 120s 口径）；响应体直接含 usage，机器读数无歧义。
    失败形态（error/timeout/空摘要/4xx/5xx）由调用方降级为不压缩组装。
    system_prompt 参数化（CHG-011/iter-17 T2）：默认 SUMMARY_PROMPT（B2 口径零变化），
    C 期记忆抽取复用本调用器形态传入 EXTRACT_PROMPT（复用面 = 调用器/护栏/三终态，
    changes.md CHG-011 原因/依据段）。
    """
    payload = {
        "model": model,
        "stream": False,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": transcript},
        ],
    }
    started = time.monotonic()
    try:
        resp = await client.post(
            f"{base_url}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
        )
    except (httpx.TimeoutException, TimeoutError):
        return SummaryOutcome("timeout", latency_ms=_elapsed_ms(started),
                              error_code="summary_timeout")
    except httpx.HTTPError:
        return SummaryOutcome("error", latency_ms=_elapsed_ms(started),
                              error_code="summary_error")
    latency = _elapsed_ms(started)
    if resp.status_code >= 400:
        return SummaryOutcome("error", latency_ms=latency, error_code="summary_error")
    try:
        body = resp.json()
    except ValueError:
        return SummaryOutcome("error", latency_ms=latency, error_code="summary_error")
    choices = body.get("choices") or []
    text = ""
    if choices:
        message = choices[0].get("message") or {}
        text = (message.get("content") or "").strip()
    usage = body.get("usage") or {}
    if not text:  # 空摘要 → 降级（机器可读码区分于 4xx/5xx）
        return SummaryOutcome("error", usage=usage, latency_ms=latency,
                              error_code="summary_empty")
    return SummaryOutcome("ok", text, usage=usage, latency_ms=latency)


def _elapsed_ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


# ---------- 摘要注入组装（挂载点 = 动态尾区之后、历史之前） ----------

def assemble_compact(
    history: list[dict[str, Any]],
    message: str,
    system_prompt: str | None,
    wrapped_summary: str,
    *,
    max_turns: int,
    product_persona: str = "",
) -> list[dict[str, Any]]:
    """压缩注入组装：system[0] 人设（如有）+ system[1] 动态尾区 + 摘要 system 消息
    + 最近 max_turns 轮（snip 已执行）。窗口与 user 锚定截断规则照搬 assemble_context，
    仅窗口宽度改 R 并在动态尾区后挂载摘要消息。
    """
    msgs = [m for m in history if m.get("role") != "system"]
    if not (msgs and msgs[-1].get("role") == "user" and msgs[-1].get("content") == message):
        msgs = msgs + [{"role": "user", "content": message}]
    turn_starts = [i for i, m in enumerate(msgs) if m.get("role") == "user"]
    start = turn_starts[-max_turns] if len(turn_starts) > max_turns else 0
    selected = msgs[start:]
    dynamic_tail = f"{system_prompt}\n\n{_now_line()}" if system_prompt else _now_line()
    summary_msg = {"role": "system", "content": wrapped_summary}
    if product_persona:
        return ([{"role": "system", "content": product_persona},
                 {"role": "system", "content": dynamic_tail},
                 summary_msg] + selected)
    return [{"role": "system", "content": dynamic_tail}, summary_msg] + selected
