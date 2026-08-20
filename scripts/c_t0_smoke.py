"""iter-17 T0 取证脚本（CHG-011 定夺②微参数论证 + 抽取 prompt 冒烟 + 体量复核 + 注入文案定稿）。

C 五层记忆体系的实施输入取证（沿 iter-14/15/16 T0 取证模式，手动运行留档，不入日常测试）：
1. 抽取 prompt 冒烟（真实 DeepSeek 统一 key，非流式直调）：
   - Run 1：空存量记忆 + 会话 A 增量转写（含身份事实/偏好/约定/知识问答/一次性任务素材）
   - Run 2：Run 1 产物为存量 + 会话 B 增量（含冲突信息「迁居」/ 新偏好 / 重复偏好 / 新事实）
   - 实测质量：记忆点准确度、一条一记忆点、冲突以最新为准、重复合并、知识问答不残留
   - 实测格式纪律：完整新列表输出稳定性、单条 ≤200 字、编号行格式
2. 体量复核（CHG-011 内容 3.1 授权口径：记忆满载注入对 B2 阈值 7000 的影响实测）：
   - 构造 50 条 × ≤200 字满载记忆 → 注入文案 → 组装 system[0] 人设 + system[1] 动态尾区
     + 记忆消息 + 5 轮历史 → 真实 DeepSeek 调用读 usage prompt_tokens 机器读数（铁律 5）
   - 对照组：同请求无记忆消息 → 差值 = 记忆满载注入体量实测
3. 微参数 N/X/扫描间隔：论证定死（无产品代码可实测，留档论证依据，占位值 4/10 分钟/60s）

用法（项目根目录）：
    backend/.venv/bin/python scripts/c_t0_smoke.py

卫生：输出与留档全程零 key 明文（key 仅从 backend/.env 进程内读取）。
"""

import re
import sys
import time
from pathlib import Path

import httpx

# ---- 统一 key 三变量（backend/.env，进程内读取，输出零 key）----
ENV_FILE = Path(__file__).resolve().parent.parent / "backend" / ".env"


def read_env(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    out: dict[str, str] = {}
    key = None
    buf: list[str] = []
    for line in text.splitlines():
        if key is not None:
            if line.rstrip().endswith('"'):
                buf.append(line.rstrip()[:-1])
                out[key] = "\n".join(buf)
                key = None
            else:
                buf.append(line)
            continue
        if line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if v.startswith('"') and not v.rstrip().endswith('"'):
            key, buf = k, [v[1:]]
        else:
            out[k] = v.strip('"')
    return out


ENV = read_env(ENV_FILE)
API_KEY = ENV["AI_CHAT_UNIFIED_KEY"]
BASE_URL = ENV["AI_CHAT_UNIFIED_BASE_URL"].rstrip("/")
MODEL = ENV["AI_CHAT_UNIFIED_MODEL"]
PERSONA = ENV["AI_CHAT_PRODUCT_PERSONA"]

# ---- 抽取 prompt R1 定稿（后端拥有、逐字断言面 = plans/iter-17-verify.md §2，逐字使用）----
# 定稿修订（2026-08-20 T0）：冒烟质量一次达标（R1 即定稿，无 R2）；条数上限随体量复核
# 收紧 50→30、单条 ≤200 字→≤150 字（CHG-011 内容 3.1 授权口径：实测体量异常收紧上限参数，
# 实测依据见 plans/iter-17-verify.md §3：50×200 字满载 = 6079 tokens，占阈值 7000 的 86.8%）。
EXTRACT_PROMPT_R1 = (
    "请根据「现有记忆」与「新增对话内容」，产出该用户更新后的完整记忆列表。要求：\n"
    "一、记忆只收录关于用户的长期信息：身份与处境、偏好与习惯、对 AI 的要求、与 AI 达成的约定；"
    "一次性任务与知识问答的细节不收录。\n"
    "二、合并规则：现有记忆中仍然成立的条目保留；新增对话中出现的新记忆点补充；"
    "新旧冲突时以最新信息为准并移除过时条目；含义重复的条目合并为一条。\n"
    "三、每条是一个独立记忆点，单条不超过 150 字，用陈述句客观转述，不加评论。\n"
    "四、总条数不超过 30 条；若超出，优先保留身份、约定与偏好类条目。\n"
    "五、输出格式：按序号每行一条，形如「1. 记忆内容」；直接输出列表本身，"
    "不要任何前缀、解释或代码块标记。\n"
    "若没有任何值得记录的记忆，输出空内容。"
)

# ---- 冒烟素材：会话 A 转写（render_transcript 同模式的「角色: 文本」行）----
TRANSCRIPT_A = """用户: 你好，先介绍一下我自己：我叫小明，是一名后端工程师，在杭州工作，主要用 Python。
助手: 好的小明，已了解你的背景。有什么我可以帮你做的？
用户: 以后回复我都用中文，尽量简洁一点，我喜欢列表形式的回答。
助手: 明白，之后会用简洁的中文和列表形式回复你。
用户: 还有一个约定：以后我让你写周报的时候，按「本周完成 / 下周计划 / 风险」三段式来写。
助手: 好的，周报将按「本周完成 / 下周计划 / 风险」三段式输出。
用户: 顺便问下，Python 的 GIL 是什么？
助手: GIL（全局解释器锁）是 CPython 中的互斥锁，同一时刻只允许一个线程执行 Python 字节码……
用户: 帮我把「部署窗口改为凌晨两点」这句话翻译成英文。
助手: "The deployment window has been changed to 2 AM."
用户: 好的谢谢。另外我最近在带一个三人小组做数据管道的重构。
助手: 收到，祝你带队顺利。"""

# ---- 冒烟素材：会话 B 增量（冲突：杭州→上海；新偏好：不用表情符号；重复偏好：简洁；新事实：远程办公）----
TRANSCRIPT_B = """用户: 跟你说个变化：我上个月从杭州搬到上海了，换了一家新公司。
助手: 好的，已更新：你现在在上海工作。新环境还适应吗？
用户: 还不错。对了，新公司是全远程办公，我们组五个人分布在不同城市。
助手: 了解，远程协作有什么需要帮忙的随时说。
用户: 还有个要求：回复里不要用表情符号，我嫌乱。还是老规矩，简洁一点。
助手: 明白，不使用表情符号，保持简洁。
用户: 帮我查一下 FastAPI 的最新稳定版本号。
助手: FastAPI 当前稳定版本为 0.115.x（以官方发布页为准）。"""


def call_chat(messages: list[dict], timeout: float = 60.0) -> dict:
    """非流式 chat completion（B2 call_summary 同形态：stream=false，响应体直接含 usage）。"""
    resp = httpx.post(
        f"{BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {API_KEY}"},
        json={"model": MODEL, "messages": messages, "stream": False},
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()


def now_line() -> str:
    return f"当前时间：{time.strftime('%Y-%m-%d %H:%M')}（服务器本地时间）"


def main() -> None:
    print("=" * 72)
    print("iter-17 T0 取证：C 五层记忆体系（真实 DeepSeek，统一 key）")
    print(f"模型：{MODEL} @ {BASE_URL}")
    print("=" * 72)

    # ---------- Run 1：空存量 + 会话 A 增量 ----------
    print("\n【Run 1】空存量记忆 + 会话 A 增量转写")
    user_block_1 = (
        "现有记忆：\n（空）\n\n新增对话内容：\n" + TRANSCRIPT_A
    )
    body1 = call_chat(
        [
            {"role": "system", "content": EXTRACT_PROMPT_R1},
            {"role": "user", "content": user_block_1},
        ]
    )
    out1 = body1["choices"][0]["message"]["content"].strip()
    usage1 = body1.get("usage", {})
    print("--- 输出（逐字）---")
    print(out1)
    print(f"--- usage：prompt_tokens={usage1.get('prompt_tokens')} "
          f"completion_tokens={usage1.get('completion_tokens')}")

    # ---------- Run 2：Run 1 产物为存量 + 会话 B 增量（冲突/新增/重复合并） ----------
    print("\n【Run 2】存量 = Run 1 产物 + 会话 B 增量（迁居冲突/新偏好/重复偏好）")
    user_block_2 = (
        "现有记忆：\n" + out1 + "\n\n新增对话内容：\n" + TRANSCRIPT_B
    )
    body2 = call_chat(
        [
            {"role": "system", "content": EXTRACT_PROMPT_R1},
            {"role": "user", "content": user_block_2},
        ]
    )
    out2 = body2["choices"][0]["message"]["content"].strip()
    usage2 = body2.get("usage", {})
    print("--- 输出（逐字）---")
    print(out2)
    print(f"--- usage：prompt_tokens={usage2.get('prompt_tokens')} "
          f"completion_tokens={usage2.get('completion_tokens')}")

    # ---------- Run 3/4：满载体量复核（50 条 × ≤200 字） ----------
    # 构造满载记忆：50 条真实风格条目（单条 ≤200 字），覆盖身份/偏好/约定三类
    entries: list[str] = []
    for i in range(50):
        if i < 10:
            entries.append(
                f"用户身份事实{i}：用户在第{i}项目组承担后端开发职责，主要负责数据管道、接口服务与部署自动化的设计与实现，"
                "技术栈以 Python 与 FastAPI 为主，团队采用全远程协作模式，日常通过文档与异步沟通推进工作"
            )
        elif i < 25:
            entries.append(
                f"用户偏好{i}：回复使用简体中文、语气直接、不使用表情符号；回答优先用列表形式呈现、避免大段文字；"
                "代码示例只给关键部分；涉及技术选型时先给结论再给理由；该偏好在多次会话中被反复确认，属于长期约定"
            )
        else:
            entries.append(
                f"用户约定{i}：与 AI 达成长期约定——所有产出物按既定模板组织、重要结论置顶、过程细节折叠或省略；"
                "周报按「本周完成 / 下周计划 / 风险」三段式输出；涉及部署与发布的事项一律先给检查清单再执行"
            )
    memory_body = "以下是关于用户的长期记忆（自动从历史对话抽取），回复时作为用户背景参考：\n" + "\n".join(
        f"{i}. {e}" for i, e in enumerate(entries, 1)
    )
    memory_text = f"<user_memory>\n{memory_body}\n</user_memory>"
    print("\n【Run 3】满载体量复核：50 条记忆注入文案规模")
    print(f"注入文案字符数（含包裹与说明行）：{len(memory_text)}")

    history = []
    for i in range(5):
        history.append({"role": "user", "content": f"第{i + 1}轮用户消息：请介绍一下数据管道重构的进展要点。"})
        history.append({"role": "assistant", "content": f"第{i + 1}轮助手回复：好的，这是关于数据管道重构进展的要点列表（示例回复文本，用于体量取证的对照组历史）。"})

    def assemble(with_memory: bool) -> list[dict]:
        msgs = [{"role": "system", "content": PERSONA}]
        tail = f"{now_line()}"
        msgs.append({"role": "system", "content": tail})
        if with_memory:
            msgs.append({"role": "system", "content": memory_text})
        return msgs + history

    body3 = call_chat(assemble(with_memory=True) + [{"role": "user", "content": "继续"}])
    usage3 = body3.get("usage", {})
    body4 = call_chat(assemble(with_memory=False) + [{"role": "user", "content": "继续"}])
    usage4 = body4.get("usage", {})
    t_with = usage3.get("prompt_tokens")
    t_without = usage4.get("prompt_tokens")
    print(f"Run 3（含 50 条满载记忆）prompt_tokens = {t_with}")
    print(f"Run 4（无记忆对照组）prompt_tokens = {t_without}")
    if isinstance(t_with, int) and isinstance(t_without, int):
        print(f"记忆满载注入体量差值 = {t_with - t_without} tokens")
        print(f"B2 阈值 = 7000；满载记忆体量占阈值比例 = {(t_with - t_without) / 7000:.1%}")

    print("\n【完成】逐字输出与机器读数如上，留档 plans/iter-17-verify.md T0 段。")


if __name__ == "__main__":
    sys.exit(main())
