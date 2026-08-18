"""iter-15 T0 取证脚本①（REQ-037 验收 2 取证条款）——真实上游冒烟，不入日常测试，手动运行留档。

DeepSeek（统一 key）usage 字段形状与前缀缓存语义取证（非流式，便于取完整 usage）：
1. 基线调用：捕获完整 usage 原始对象，逐字段留档（字段名/类型/数值语义）
2. 短前缀探针：system[0] 仅人设稿体量（约 300 tokens），同前缀两次调用——第二次命中取证
3. 长前缀探针：system[0] > 1024 tokens 字节恒定、system[1] 与 user 尾部变化，同前缀两次调用
   ——hit/miss 数值变化语义（「前缀缓存受益」断言的实现输入）；注意探针间共享 PERSONA 前缀，
   后行探针的首次调用可能复用前行已缓存的前缀块（增量命中亦属前缀缓存语义，如实取证）
4. 流式形态探针：生产路径为 stream=true + stream_options.include_usage，核对末帧 usage
   与非流式字段集是否一致（T2 字段映射以流式形态为落库采集面）

用法（项目根目录；key 经 backend/.env 注入，脚本输出零明文）：
    set -a; source backend/.env; set +a
    backend/.venv/bin/python scripts/usage_cache_smoke.py

卫生：key 仅存在于请求头 Authorization；输出与留档全程零 key 明文。
"""

import json
import os
import sys

import httpx

BASE = os.environ.get("AI_CHAT_UNIFIED_BASE_URL", "https://api.deepseek.com")
MODEL = os.environ.get("AI_CHAT_UNIFIED_MODEL", "deepseek-chat")
KEY = os.environ["AI_CHAT_UNIFIED_KEY"]  # 缺失即 KeyError，缺配置不跑

# 人设中性默认稿（T0 ③ 产出物，待 CEO 审签）——作为 system[0] 静态前缀的真实内容物
PERSONA = (
    "你是一个 AI 对话助手，在本服务中为用户提供对话与问答协助。\n\n"
    "行为准则：\n"
    "一、准确：基于上下文与工具返回的实际内容作答；引用联网搜索等工具结果时忠于原文并注明来源。\n"
    "二、诚实：不确定时明确说明不确定；不知道时直接说不知道，不编造事实、数据、链接或来源。\n"
    "三、如实转述工具结果：工具成功则按其结果作答；失败、超时或无结果时如实说明，不用虚构内容代替。\n"
    "四、时效意识：涉及时效的问题优先使用可用工具查证；无法查证时提示信息可能过时。\n"
    "五、表达克制：使用与用户一致的语言直接作答，不堆砌套话；结构与详略随问题调整。"
)

# 长前缀填充（中性测试文本，字节恒定）：使 system[0] 超过缓存最小门槛（文档值 1024 tokens，实测为准）
_FILLER_UNIT = (
    "缓存前缀取证填充段落：本段为字节恒定的中性测试文本，仅用于拉长静态前缀长度，"
    "不含任何业务语义。前缀缓存按请求前缀逐 token 精确匹配，静态段在前的分区组装"
    "使跨请求共享前缀最大化，命中部分的输入 token 按上游缓存口径计费。"
)
FILLER = _FILLER_UNIT * 24

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'✅' if ok else '❌'} {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def complete(messages: list[dict], tag: str) -> dict:
    """非流式调用，返回完整响应 JSON；失败打印状态与错误体后退出。"""
    r = httpx.post(
        f"{BASE}/chat/completions",
        headers={"Authorization": f"Bearer {KEY}"},
        json={"model": MODEL, "messages": messages, "stream": False},
        timeout=120,
    )
    if r.status_code != 200:
        print(f"❌ {tag} 上游返回 {r.status_code}：{r.text[:500]}")
        sys.exit(1)
    body = r.json()
    usage = body.get("usage") or {}
    print(f"--- {tag} ---")
    print("usage 原文：" + json.dumps(usage, ensure_ascii=False))
    print("回复片段：" + (body["choices"][0]["message"]["content"] or "")[:60].replace("\n", " "))
    return body


def walk(obj, prefix=""):
    """usage 对象逐字段展平：路径 → (类型, 值)，供字段形状留档。"""
    out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.update(walk(v, f"{prefix}.{k}" if prefix else k))
    else:
        out[prefix] = (type(obj).__name__, obj)
    return out


def main() -> None:
    print(f"上游：{BASE} | 模型：{MODEL} | key：AI_CHAT_UNIFIED_KEY（已配置，零明文）\n")
    # ---- A. 基线调用：usage 字段形状（最简请求） ----
    body = complete([{"role": "user", "content": "只回复两个字：收到"}], "A 基线（单条 user）")
    print("A usage 逐字段展平（路径 → 类型/值）：")
    for path, (tp, val) in walk(body["usage"]).items():
        print(f"    {path} : {tp} = {val}")

    # ---- B. 短前缀探针：system[0] 仅人设稿体量，两次同前缀 ----
    short_prefix = [{"role": "system", "content": PERSONA}]
    b1 = complete(short_prefix + [
        {"role": "system", "content": "当前时间：2026-08-19（周三）09:00（北京时间）"},
        {"role": "user", "content": "只回复两个字：甲子"},
    ], "B1 短前缀·第一次")
    b2 = complete(short_prefix + [
        {"role": "system", "content": "当前时间：2026-08-19（周三）09:01（北京时间）"},
        {"role": "user", "content": "只回复两个字：乙丑"},
    ], "B2 短前缀·第二次（同 system[0]，尾部变化）")
    b1u, b2u = b1["usage"], b2["usage"]
    print(f"B 探针：system[0] 体量 = {len(PERSONA)} 字符；"
          f"B1 prompt_tokens={b1u.get('prompt_tokens')}，B2 prompt_tokens={b2u.get('prompt_tokens')}")

    # ---- C. 长前缀探针：system[0] > 1024 tokens 字节恒定，两次同前缀 ----
    long_prefix = [{"role": "system", "content": PERSONA + "\n\n" + FILLER}]
    assert long_prefix[0]["content"].startswith(PERSONA)  # 前缀逐字节同源的自检
    c1 = complete(long_prefix + [
        {"role": "system", "content": "当前时间：2026-08-19（周三）09:02（北京时间）"},
        {"role": "user", "content": "只回复两个字：丙寅"},
    ], "C1 长前缀·第一次")
    c2 = complete(long_prefix + [
        {"role": "system", "content": "当前时间：2026-08-19（周三）09:03（北京时间）"},
        {"role": "user", "content": "只回复两个字：丁卯"},
    ], "C2 长前缀·第二次（同 system[0]，尾部变化）")
    c1u, c2u = c1["usage"], c2["usage"]
    print(f"C 探针：system[0] 体量 = {len(long_prefix[0]['content'])} 字符；"
          f"C1 prompt_tokens={c1u.get('prompt_tokens')}，C2 prompt_tokens={c2u.get('prompt_tokens')}")

    # ---- D. 流式形态探针：生产路径为 stream=true + include_usage，核对末帧 usage 是否同形状 ----
    stream_usage: dict | None = None
    with httpx.stream(
        "POST", f"{BASE}/chat/completions",
        headers={"Authorization": f"Bearer {KEY}"},
        json={"model": MODEL, "stream": True, "stream_options": {"include_usage": True},
              "messages": long_prefix + [
                  {"role": "system", "content": "当前时间：2026-08-19（周三）09:04（北京时间）"},
                  {"role": "user", "content": "只回复两个字：戊辰"}]},
        timeout=120,
    ) as r:
        assert r.status_code == 200, f"D 流式探针上游返回 {r.status_code}"
        for line in r.iter_lines():
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data or data == "[DONE]":
                continue
            obj = json.loads(data)
            if isinstance(obj.get("usage"), dict):
                stream_usage = obj["usage"]
    print("--- D 流式探针（stream=true + stream_options.include_usage，与生产路径同形态）---")
    if stream_usage is None:
        print("❌ D 流式末帧无 usage（include_usage 未生效）")
        failures.append("D 流式末帧无 usage")
    else:
        print("usage 原文：" + json.dumps(stream_usage, ensure_ascii=False))
        check("流式 usage 与非流式字段集一致（含缓存字段）",
              sorted(stream_usage.keys()) == sorted(c2u.keys()),
              f"流式字段：{sorted(stream_usage.keys())}")

    # ---- 结论断言（观测值如实打印，判定缺失不造数） ----
    hit_field = "prompt_cache_hit_tokens"
    miss_field = "prompt_cache_miss_tokens"
    check("usage 含分项字段（prompt/completion/total）",
          all(k in body["usage"] for k in ("prompt_tokens", "completion_tokens", "total_tokens")))
    check(f"usage 含缓存字段 {hit_field}/{miss_field}",
          hit_field in body["usage"] and miss_field in body["usage"],
          "缺失则 T2 字段映射记 NULL（铁律 5）")
    if hit_field in c1u and hit_field in c2u:
        # C1 可能复用 B 阶段/前次运行已缓存的前缀块（增量命中属前缀缓存语义，非缺陷）；
        # 「前缀缓存受益」的稳健断言 = 同前缀第二次调用命中量为正且不小于第一次
        check("长前缀第二次命中（hit>0）", (c2u.get(hit_field) or 0) > 0,
              f"hit={c2u.get(hit_field)} miss={c2u.get(miss_field)}")
        check("长前缀第二次命中量 ≥ 第一次（前缀缓存受益）",
              (c2u.get(hit_field) or 0) >= (c1u.get(hit_field) or 0),
              f"C1 hit={c1u.get(hit_field)} → C2 hit={c2u.get(hit_field)}")
        check("命中量不大于本次 prompt 总量（语义自洽）",
              (c2u.get(hit_field) or 0) <= (c2u.get("prompt_tokens") or 0))
        print(f"B 短前缀两次 hit/miss：B1=({b1u.get(hit_field)},{b1u.get(miss_field)}) "
              f"B2=({b2u.get(hit_field)},{b2u.get(miss_field)})——短前缀是否命中以实测为准")

    print("\n" + ("全部通过 ✅" if not failures else f"失败/缺失 {len(failures)} 项：{failures}"))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
