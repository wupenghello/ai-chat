"""deep-research 编排配置（CHG-012/REQ-046，iter-18 T2）。

薄模块（不建编排框架——定夺③受控 ReAct 变体）：research 指令文案（T0 R2 定稿逐字，
断言面登记 plans/iter-18-verify.md §1）+ 护栏参数组装（16 步 / 900s，T0 定死值）+
指令消息注入位（六层注入序：人设 → 动态尾区 → research 指令 → 记忆 → 摘要 → 历史）。
循环本体 = agent.run_turn 参数化承载（CHG-012 内容 3.1 单实现优先），本模块零循环逻辑。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.config import Settings

# research 指令 system 消息内容（REQ-046 / CHG-012 内容 3.2）：独立 system 消息、
# 跨请求字节恒定（不文本化进 system[0] 人设、不与 tools 字段说明重复——沿 REQ-036
# 定夺③哲学；system[0] 前缀缓存收益面不受影响）。文案 = T0 R2 定稿逐字
# （plans/iter-18-verify.md §1，一字不差——逐字断言面，沿 SUMMARY_PROMPT R2 先例；
# 物理行拼接仅为源码行宽合规，字节值与定稿逐字等价，测试有逐字断言锚定）。
RESEARCH_PROMPT = (
    "你现在处于「深度研究」模式：对用户给出的开放问题完成一次完整的多轮检索研究，"
    "并交付带引用来源标注的综合报告。\n"
    "\n"
    "工作方法：\n"
    "1. 先输出研究计划：把问题拆解为 3~6 个具体、可检索验证的子问题，逐条列出；\n"
    "2. 逐个子问题调用 search 工具收集证据：每个子问题至少检索一次；"
    "若某子问题你已确知无需检索即可回答，须明确说明理由；\n"
    "3. 全部子问题覆盖后，输出综合报告：结论先行、分点论证；"
    "报告中的事实性内容须以 [n] 标注对应来源（n = 该次搜索结果来源列表中的序号，"
    "如 [1][3]）；报告正文不超过 3000 字，宁可精炼、不可超限；\n"
    "4. 综合报告直接输出：不加「好的」「以下是报告」等前缀，不复述研究计划。\n"
    "\n"
    "计划与检索过程中的中间文字会流式展示给用户：保持简洁，一句话说明正在查什么即可；"
    "完整论述只在最后的综合报告展开。"
)


@dataclass(frozen=True)
class ResearchProfile:
    """research 回合编排参数（agent.run_turn research 配置，CHG-012 内容 3.1）。

    独立步数上限 + 回合总时长护栏（REQ-046 双护栏）；单步 120s / 工具超时 / 断连取消
    沿 REQ-030 既有护栏，不在本对象承载。
    """

    max_steps: int
    total_timeout: float


def research_profile(settings: Settings) -> ResearchProfile:
    """护栏参数从 config 读（T0 定死值 16 步 / 900s，.env 可覆盖）。"""
    return ResearchProfile(
        max_steps=settings.max_research_steps,
        total_timeout=settings.research_total_timeout,
    )


def inject_instruction(
    messages: list[dict[str, Any]], *, has_persona: bool
) -> list[dict[str, Any]]:
    """research 指令 system 消息挂载（REQ-046 / REQ-036 改写承载的注入位）。

    位置 = system[1] 动态尾区之后、记忆消息之前（六层注入序，research 回合时：
    人设 → 动态尾区 → research 指令 → 记忆 → 摘要 → 历史）。与 memory.inject_into_messages
    的协同：记忆注入先执行（其插入位同为 2/1），本函数后执行同位插入 → 指令落在记忆之前。
    普通回合不调用本函数（注入序零变化）。
    """
    insert_at = 2 if has_persona else 1
    return messages[:insert_at] + [{"role": "system", "content": RESEARCH_PROMPT}] \
        + messages[insert_at:]
