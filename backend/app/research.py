"""deep-research 编排配置（CHG-012/REQ-046，iter-18 T2；CHG-018 深度升级改写，直派批次）。

薄模块（不建编排框架——定夺③受控 ReAct 变体）：三档研究指令文案（CHG-018 R2 定稿
逐字，断言面登记 plans/chg-018-verify.md §9）+ 档位化护栏参数组装（light 8 步/300s、
standard 16 步/900s、deep 32 步/900s + 回合载荷 max_tokens=8192，T0 定死 verify §6）+
指令消息注入位（六层注入序：人设 → 动态尾区 → research 指令 → 记忆 → 摘要 → 历史）。
循环本体 = agent.run_turn 参数化承载（CHG-012 内容 3.1 单实现优先），本模块零循环逻辑。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.config import Settings

# 深度档位枚举（CHG-018/REQ-055：请求体 depth 字段 Literal 三值，缺省 standard）
DEPTHS = ("light", "standard", "deep")

# research 指令 system 消息内容（REQ-046 / CHG-012 内容 3.2 → CHG-018 三档文案）：
# 独立 system 消息、跨请求字节恒定（不文本化进 system[0] 人设、不与 tools 字段说明重复——
# 沿 REQ-036 定夺③哲学；system[0] 前缀缓存收益面不受影响）。文案 = CHG-018 T0 R2 定稿
# 逐字（plans/chg-018-verify.md §9，一字不差——逐字断言面，沿 SUMMARY_PROMPT R2 先例；
# 物理行拼接仅为源码行宽合规，字节值与定稿逐字等价，测试有逐字断言锚定）。
RESEARCH_PROMPT_LIGHT = (
    "你现在处于「深度研究」模式（轻量档）：对用户给出的问题完成一次快速的多轮检索核实，"
    "并交付带引用来源标注的简要报告。\n"
    "\n"
    "工作方法：\n"
    "1. 先输出研究计划：把问题拆解为 2~4 个具体、可检索验证的子问题，逐条列出；\n"
    "2. 逐个子问题调用 search 检索（每个至少一次）；关键结论尽量由两个独立来源支撑，"
    "做不到的在报告中如实标注「单一来源」；\n"
    "3. 覆盖后直接输出简要报告（不加前缀、不写过渡小结、不复述计划）："
    "结论先行 + 分点论证；如有关键遗留问题，文末一句话列出。\n"
    "引用标注：事实性内容以 [m-n] 标注——m = 第 m 次调用 search，"
    "n = 该次结果来源列表中的第 n 条，如 [2-1]；引用须与来源真实对应，不得虚构。\n"
    "报告正文不超过 1600 字，宁可精炼、不可超限。\n"
    "\n"
    "中间文字保持简洁，一句话说明正在查什么即可；完整论述只在报告展开。"
)

RESEARCH_PROMPT_STANDARD = (
    "你现在处于「深度研究」模式：对用户给出的开放问题完成一次完整的多轮检索研究，"
    "并交付带引用来源标注的综合报告。\n"
    "\n"
    "研究方法（两轮推进）：\n"
    "1. 广度轮：先输出研究计划——把问题拆解为 3~6 个具体、可检索验证的子问题，"
    "逐条列出；随即逐个子问题调用 search 检索。拟词要多角度：同义改写、中英文交替，"
    "不要一个角度只搜一次。\n"
    "2. 深度轮：审视已有证据，找出三类点——论证最薄弱的关键点、来源单一的关键结论、"
    "来源之间相互矛盾之处——对它们换角度重新拟词检索、交叉验证。"
    "关键结论须有至少两个相互独立的来源支撑；矛盾未能裁决时，如实呈现分歧。\n"
    "3. 检索纪律：某次检索结果泛化、跑题或单薄，必须换查询词重检，不得将就使用；"
    "仍无所得的，在报告中如实说明，不得以猜测充当结论。"
    "子问题确无需检索即可回答的，须明确说明理由。\n"
    "\n"
    "综合报告（进入条件：关键结论均已多来源支撑，或分歧已查证并如实标注）：\n"
    "结构四段：①结论：先行给出，并标注整体置信度（高/中/低）与理由；②分点论证；"
    "③矛盾与分歧：如有，列出各方说法与你的裁断；④未能验证的遗留问题。\n"
    "引用标注：事实性内容以 [m-n] 标注——m = 第 m 次调用 search，"
    "n = 该次结果来源列表中的第 n 条，如 [2-1][3-4]；引用须与来源真实对应，不得虚构。\n"
    "报告正文不超过 3500 字，宁可精炼、不可超限；最后一步直接输出报告正文："
    "不加「好的」「以下是报告」等前缀、不写过渡性小结、不复述研究计划。\n"
    "\n"
    "计划与检索过程中的中间文字会流式展示给用户：保持简洁，"
    "一句话说明正在查什么、为什么；完整论述只在最后的综合报告展开。"
)

RESEARCH_PROMPT_DEEP = (
    "你现在处于「深度研究」模式（深度档）：对用户给出的开放问题完成一次深入、"
    "多轮、可核验的检索研究，并交付带引用来源标注的综合报告。\n"
    "\n"
    "研究方法（三轮推进）：\n"
    "1. 广度轮：先输出研究计划——把问题拆解为 4~8 个具体、可检索验证的子问题，"
    "逐条列出；随即逐个子问题调用 search 检索。拟词要多角度：同义改写、中英文交替。\n"
    "2. 深读轮：从广度轮来源中挑出最权威、信息密度最高的 2~6 个来源调用 read "
    "读取原文；证据以原文为准——搜索摘要与原文冲突时，以原文为准并标注；"
    "数字、日期、版本号类事实从原文核对。\n"
    "3. 验证轮：审视全部证据，找出论证最薄弱的关键点、来源单一的关键结论、"
    "来源矛盾之处——换角度重检、交叉验证。每个关键结论须有至少两个相互独立的来源支撑；"
    "矛盾未能裁决的，如实呈现分歧。\n"
    "4. 检索纪律：结果泛化、跑题或单薄，必须换查询词重检；"
    "仍无所得的如实说明，不得以猜测充当结论。\n"
    "\n"
    "综合报告（进入条件：关键结论均已多来源支撑或原文核验，分歧已查证并如实标注）：\n"
    "结构四段：①结论：先行给出，并标注整体置信度（高/中/低）与理由；②分点论证；"
    "③矛盾与分歧：各方说法与你的裁断；④未能验证的遗留问题。\n"
    "引用标注：事实性内容以 [m-n] 标注——m = 第 m 次工具调用（search 或 read 均计入），"
    "n = 该次结果来源列表中的第 n 条，如 [2-1][5-3]（read 只有一个来源，如 [4-1]）；"
    "引用须与来源真实对应，不得虚构。\n"
    "报告正文不超过 7000 字，宁可精炼、不可超限；最后一步直接输出报告正文："
    "不加前缀、不写过渡性小结、不复述研究计划。\n"
    "\n"
    "计划与检索过程中的中间文字会流式展示给用户：保持简洁，"
    "一句话说明正在查什么、为什么；完整论述只在最后的综合报告展开。"
)

_PROMPTS = {
    "light": RESEARCH_PROMPT_LIGHT,
    "standard": RESEARCH_PROMPT_STANDARD,
    "deep": RESEARCH_PROMPT_DEEP,
}


def research_prompt(depth: str = "standard") -> str:
    """按档取指令文案（CHG-018：三档常量，跨请求字节恒定）。"""
    try:
        return _PROMPTS[depth]
    except KeyError:
        raise ValueError(f"未知深度档位：{depth}") from None


@dataclass(frozen=True)
class ResearchProfile:
    """research 回合编排参数（agent.run_turn research 配置，CHG-012 内容 3.1；
    CHG-018 档位化：max_tokens 为 research 回合上游载荷输出上限——现网不带
    max_tokens 时 DeepSeek 默认 4096 tokens，深度档 7000 字报告必然截断，
    T0 发现的生产隐患修复，plans/chg-018-verify.md §3 发现 4）。

    独立步数上限 + 回合总时长护栏（REQ-046 双护栏，CHG-018 按档取值）；单步 120s /
    工具超时 / 断连取消沿 REQ-030 既有护栏，不在本对象承载。
    """

    max_steps: int
    total_timeout: float
    max_tokens: int = 8192  # config 默认值同源（T0 定死，plans/chg-018-verify.md §3 发现 4）


def research_profile(settings: Settings, depth: str = "standard") -> ResearchProfile:
    """护栏参数从 config 按档读（CHG-018 T0 定死值 verify §6，.env 可覆盖）。

    standard 档 = 既有 max_research_steps/research_total_timeout 两参数
    （语义收窄为标准档，默认部署零变化）；light/deep 档 = 新增四参数。
    """
    if depth == "light":
        steps, timeout = settings.research_steps_light, settings.research_timeout_light
    elif depth == "deep":
        steps, timeout = settings.research_steps_deep, settings.research_timeout_deep
    else:
        steps, timeout = settings.max_research_steps, settings.research_total_timeout
    return ResearchProfile(
        max_steps=steps,
        total_timeout=timeout,
        max_tokens=settings.research_max_tokens,
    )


def inject_instruction(
    messages: list[dict[str, Any]], *, has_persona: bool, depth: str = "standard"
) -> list[dict[str, Any]]:
    """research 指令 system 消息挂载（REQ-046 / REQ-036 改写承载的注入位；
    CHG-018：文案按档三份，缺省 standard）。

    位置 = system[1] 动态尾区之后、记忆消息之前（六层注入序，research 回合时：
    人设 → 动态尾区 → research 指令 → 记忆 → 摘要 → 历史）。与 memory.inject_into_messages
    的协同：记忆注入先执行（其插入位同为 2/1），本函数后执行同位插入 → 指令落在记忆之前。
    普通回合不调用本函数（注入序零变化）。
    """
    insert_at = 2 if has_persona else 1
    return messages[:insert_at] + [
        {"role": "system", "content": research_prompt(depth)}
    ] + messages[insert_at:]
