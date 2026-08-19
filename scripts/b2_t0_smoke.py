"""iter-16 T0 取证脚本（CHG-010 定夺③⑦精确值 + REQ-039 验收 5 的 T0 取证段 + 摘要 prompt 冒烟）。

B2 三级上下文压缩的实施输入取证（沿 iter-14/15 T0 取证模式，手动运行留档，不入日常测试）：
1. 30 轮混合会话（穿插搜索工具回合）→ 第 31 回合 step=1 telemetry tokens_prompt
   机器实测基线 Y（铁律 5：机器读数，不手数 token）→ 阈值定死 0.75Y（取整千位）；
   30 轮验收 X 值同源定死（CHG-010 内容 3.4 / 定夺③⑦）
2. 增长曲线取证：逐回合 step=1 tokens_prompt 留档（20 轮窗口 + 工具结果膨胀的实证）
3. 第 31 回合关键信息回忆实测：基线 v6 组装下第 1 轮关键事实是否仍可答对
   （预期窗口外失忆——B2 要解决的问题，如实记录不造数）
4. 摘要 prompt 冒烟：真实中段历史 → 非流式摘要调用，质量（关键事实/工具结论保留度）
   与字数（≤800 字达成度）实测；定稿文案逐字登记 plans/iter-16-verify.md T0 段

用法（项目根目录；统一 key 三变量经 backend/.env，搜索 key 经项目根 .env 进程环境注入，
真实 key 仅进程环境传递、不入任何文件——iter-14 T2 边界）：
    set -a; source backend/.env; set +a
    export AI_CHAT_SEARCH_KEY="$(grep '^AI_CHAT_SEARCH_KEY=' .env | cut -d= -f2-)"
    backend/.venv/bin/python scripts/b2_t0_smoke.py

卫生：输出与留档全程零 key 明文；临时库用后自删。
"""

import json
import os
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import httpx

HOST = "127.0.0.1:8816"
API = f"http://{HOST}/api"
DB_PATH = "/tmp/ai-chat-b2-t0.db"
SESSION_ID = "s_b2t0"
USERNAME = "t0-b2"
PASSWORD = "T0b2-Smoke-2026"  # 满足 8~128 含字母+数字（REQ-020 复杂度口径）

# 摘要 prompt 定稿候选（后端拥有、逐字断言面——CHG-010 3.3；冒烟结论为 T2 实现输入）
# R2 修订（2026-08-19）：R1 冒烟产物 1344 字超 800 字上限——根因为知识性问答被逐条展开；
# 增第五条「知识性主题只留清单不展开」并强化字数约束优先级
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

# 31 回合脚本：第 1 轮种关键事实；第 8/16/24 轮为时效性问题（预期触发 search 工具）；
# 第 31 轮为关键事实回忆（基线 v6 窗口外失忆的实证锚点）。常规回合限长以保持 completion 精简。
TURNS: list[str] = [
    "我叫小明，我正在开发一款叫「喵喵」的 AI 聊天产品，请记住我的名字和产品名。只回复「记住了」。",  # 1
    "用一句话介绍 FastAPI 框架。",
    "用一句话介绍 SQLite 数据库。",
    "Python 的 asyncio 适合什么场景？一句话。",
    "什么是 SSE 协议？一句话。",
    "什么是 ReAct 循环？一句话。",
    "解释一下大模型的前缀缓存机制，两句话以内。",
    "帮我联网搜索一下今天的最新科技新闻，列出三条，每条一句话。",  # 8（search）
    "刚才的新闻里哪条和 AI 最相关？一句话点评。",
    "用一句话解释 token 在大模型里的含义。",
    "流式输出相比一次性返回有什么好处？两句话。",
    "什么是工具调用（function calling）？一句话。",
    "多轮对话为什么需要上下文窗口？一句话。",
    "解释 LWW（最后写入覆盖）冲突策略，一句话。",
    "自部署 Web 服务为什么要做用量配额？一句话。",
    "搜索一下最近关于 DeepSeek 的最新消息，简要告诉我。",  # 16（search）
    "刚才搜到的消息里最重要的进展是什么？一句话。",
    "什么是提示词注入攻击？一句话。",
    "为什么工具结果要做大小截断？一句话。",
    "管理员后台通常需要哪些治理能力？列举三点。",
    "解释一下 HttpOnly Cookie 的安全意义，一句话。",
    "什么是遥测（telemetry）？一句话。",
    "成本估算为什么要求机器采集而不是手工填写？一句话。",
    "今天有什么 AI 行业新闻？搜索后简要总结三条。",  # 24（search）
    "这些新闻里哪条对小团队开发者最有参考价值？一句话。",
    "什么是上下文压缩？一句话。",
    "摘要式压缩与截断式压缩的区别？一句话。",
    "为什么摘要要保留会话开头信息？一句话。",
    "给我一句鼓励产品上线的话。",
    "回顾我们前面的对话，用一句话总结我们聊了哪些主题。",
    "我叫什么名字？我在开发什么产品？",  # 31（关键事实回忆）
]

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'✅' if ok else '❌'} {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def wait_ready(proc: subprocess.Popen) -> None:
    for _ in range(60):
        if proc.poll() is not None:
            print("❌ 后端进程提前退出")
            sys.exit(1)
        try:
            if httpx.get(f"http://{HOST}/docs", timeout=2).status_code == 200:
                return
        except httpx.HTTPError:
            time.sleep(0.5)
    print("❌ 后端 30s 内未就绪")
    sys.exit(1)


def run_turn(client: httpx.Client, doc: dict, message: str, turn_no: int) -> dict:
    """单回合：前端同构——先 PUT 整档（含本条 user 消息）再 POST turn；回收 SSE v2 事件流，
    重建 assistant blocks 并再次 PUT 定型（REQ-032 口径）。返回 {turn_id, reason, text}。"""
    doc["messages"].append({"id": f"u{turn_no}", "role": "user", "content": message, "status": "done"})
    doc["updatedAt"] = time.time()
    r = client.put(f"{API}/sessions/{SESSION_ID}", json=doc)
    assert r.status_code == 200, f"回合 {turn_no} PUT 失败 {r.status_code} {r.text[:200]}"

    turn_id, reason = None, None
    text_parts: list[str] = []
    blocks: list[dict] = []
    t0 = time.time()
    with client.stream(
        "POST", f"{API}/chat/turn",
        json={"session_id": SESSION_ID, "message": message},
        timeout=300,
    ) as resp:
        assert resp.status_code == 200, f"回合 {turn_no} turn 端点 {resp.status_code}"
        for line in resp.iter_lines():
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data or data == "[DONE]":
                continue
            ev = json.loads(data)
            et = ev.get("type")
            if et == "turn.start":
                turn_id = ev["turn_id"]
            elif et == "text.delta":
                text_parts.append(ev["text"])
            elif et == "tool.call":
                if text_parts:
                    blocks.append({"type": "text", "text": "".join(text_parts)})
                    text_parts = []
                blocks.append({
                    "type": "tool_call", "tool_call_id": ev["tool_call_id"],
                    "name": ev["name"], "arguments": ev["arguments"],
                })
            elif et == "tool.result":
                blocks.append({
                    "type": "tool_result", "tool_call_id": ev["tool_call_id"],
                    "status": ev["status"], "result": ev["result"],
                })
            elif et == "turn.end":
                reason = ev["reason"]
            elif et == "error":
                print(f"回合 {turn_no} 错误帧：{ev}")
    if text_parts:
        blocks.append({"type": "text", "text": "".join(text_parts)})
    full_text = "".join(b.get("text", "") for b in blocks if b["type"] == "text")
    doc["messages"].append({
        "id": f"a{turn_no}", "role": "assistant",
        "content": blocks if blocks else full_text, "status": "done",
    })
    doc["schema"] = 2
    doc["updatedAt"] = time.time()
    r = client.put(f"{API}/sessions/{SESSION_ID}", json=doc)
    assert r.status_code == 200, f"回合 {turn_no} 定型 PUT 失败 {r.status_code}"
    n_tools = sum(1 for b in blocks if b["type"] == "tool_call")
    print(f"回合 {turn_no:>2}/31 完成（{time.time() - t0:5.1f}s，reason={reason}，"
          f"工具调用 {n_tools} 次）：{full_text[:48].replace(chr(10), ' ')}")
    return {"turn_id": turn_id, "reason": reason, "text": full_text, "tools": n_tools}


def main() -> None:
    if not os.environ.get("AI_CHAT_UNIFIED_KEY"):
        print("❌ 缺 AI_CHAT_UNIFIED_KEY（set -a; source backend/.env; set +a）")
        sys.exit(1)
    search_key_note = "已配置" if os.environ.get("AI_CHAT_SEARCH_KEY") else "缺失（搜索工具不注册）"
    Path(DB_PATH).unlink(missing_ok=True)

    env = dict(os.environ)
    env["AI_CHAT_DB_PATH"] = DB_PATH
    env["AI_CHAT_QUOTA_FREE_DAILY"] = "100"  # 冒烟配额豁免（进程环境，不写 .env）
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app",
         "--app-dir", str(Path(__file__).resolve().parent.parent / "backend"),
         "--host", "127.0.0.1", "--port", "8816"],
        env=env, cwd=str(Path(__file__).resolve().parent.parent / "backend"),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        wait_ready(proc)
        print(f"临时后端就绪（{HOST}，独立库 {DB_PATH}，搜索 key：{search_key_note}，"
              f"人设：{'已配置' if os.environ.get('AI_CHAT_PRODUCT_PERSONA') else '空'}）\n")

        client = httpx.Client()
        r = client.post(f"{API}/auth/register", json={"username": USERNAME, "password": PASSWORD})
        assert r.status_code in (201, 409), f"注册 {r.status_code} {r.text[:200]}"
        r = client.post(f"{API}/auth/login", json={"username": USERNAME, "password": PASSWORD})
        assert r.status_code == 200, f"登录 {r.status_code}"

        doc: dict = {"id": SESSION_ID, "title": "B2 T0 取证会话", "messages": [], "schema": 2,
                     "updatedAt": time.time()}
        turn_ids: list[str] = []
        results = []
        for i, msg in enumerate(TURNS, start=1):
            res = run_turn(client, doc, msg, i)
            turn_ids.append(res["turn_id"])
            results.append(res)

        # ---- telemetry 机器读数（铁律 5）：step=1 llm 行 tokens_prompt 增长曲线 ----
        conn = sqlite3.connect(DB_PATH)
        rows = conn.execute(
            "SELECT turn_id, step, tokens_prompt, tokens_total FROM telemetry"
            " WHERE kind='llm' AND step = 1 ORDER BY id"
        ).fetchall()
        conn.close()
        by_turn = {t: p for t, _, p, _ in rows}
        print("\n--- step=1 tokens_prompt 增长曲线（telemetry 机器读数）---")
        curve = []
        for i, tid in enumerate(turn_ids, start=1):
            v = by_turn.get(tid)
            curve.append(v)
            if i in (1, 5, 8, 10, 16, 20, 24, 28, 30, 31) or i % 10 == 0:
                print(f"  回合 {i:>2}: {v}")
        y = curve[-1]
        check("第 31 回合 step=1 tokens_prompt 机器读数取得", y is not None, f"Y = {y}")
        if y is None:
            print("曲线原始行：", rows)
            sys.exit(1)
        threshold = round(0.75 * y / 1000) * 1000
        x = threshold
        print(f"\n=== T0 定死参数（CHG-010 定夺③⑦精确值，待回填 changes.md）===")
        print(f"Y（30 轮混合会话第 31 回合 step=1 prompt_tokens）= {y}")
        print(f"自动压缩阈值 = 0.75Y 取整千位 = {threshold}")
        print(f"30 轮验收 X 值（压缩后第 31 次请求体上限）= {x}")

        # ---- 第 31 回合关键信息回忆实测（基线 v6 窗口外失忆的实证）----
        last = results[-1]["text"]
        recall_ok = "小明" in last and ("喵喵" in last)
        print(f"\n--- 第 31 回合回忆实测（基线 v6 组装，无压缩）---")
        print(f"回答片段：{last[:120].replace(chr(10), ' ')}")
        check("第 1 轮关键事实在第 31 轮可答对（基线 v6）", recall_ok,
              "窗口外失忆 = B2 要解决的问题，实测结果如实登记（不满足非缺陷）")

        # ---- 摘要 prompt 冒烟：真实中段历史 → 非流式摘要调用 ----
        msgs = doc["messages"]
        mid = msgs[:-10]  # 模拟水位：最近 5 轮（10 条）之前为待压缩中段
        lines: list[str] = []
        for m in mid:
            c = m["content"]
            if m["role"] == "user":
                lines.append(f"用户：{c}")
            else:
                parts = c if isinstance(c, list) else [{"type": "text", "text": c}]
                for b in parts:
                    if b["type"] == "text":
                        lines.append(f"助手：{b['text']}")
                    elif b["type"] == "tool_result":
                        lines.append(f"工具结果（{b.get('status')}）：{b.get('result', '')[:2000]}")
        history_text = "\n".join(lines)
        base = os.environ.get("AI_CHAT_UNIFIED_BASE_URL", "https://api.deepseek.com")
        model = os.environ.get("AI_CHAT_UNIFIED_MODEL", "deepseek-chat")
        t0 = time.time()
        r = httpx.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {os.environ['AI_CHAT_UNIFIED_KEY']}"},
            json={"model": model, "stream": False, "messages": [
                {"role": "system", "content": SUMMARY_PROMPT},
                {"role": "user", "content": history_text},
            ]},
            timeout=120,
        )
        assert r.status_code == 200, f"摘要调用 {r.status_code} {r.text[:300]}"
        body = r.json()
        summary = body["choices"][0]["message"]["content"] or ""
        usage = body.get("usage") or {}
        print(f"\n--- 摘要 prompt 冒烟（真实中段历史 {len(history_text)} 字符，"
              f"摘要调用耗时 {time.time() - t0:.1f}s）---")
        print(f"摘要产物（{len(summary)} 字）：\n{summary}")
        print(f"摘要调用 usage：{json.dumps(usage, ensure_ascii=False)}")
        check("摘要字数 ≤ 800 字（定夺⑨）", len(summary) <= 800, f"{len(summary)} 字")
        check("摘要保留关键事实「小明」", "小明" in summary)
        check("摘要保留关键事实「喵喵」", "喵喵" in summary)
        check("摘要保留工具结论要点（新闻/搜索相关字样）",
              any(k in summary for k in ("新闻", "搜索", "DeepSeek", "AI")), "关键词命中以实测为准")

        print("\n" + ("全部通过 ✅" if not failures else f"失败/缺失 {len(failures)} 项：{failures}"))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        Path(DB_PATH).unlink(missing_ok=True)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
