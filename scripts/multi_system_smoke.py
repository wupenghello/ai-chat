"""iter-15 T0 取证脚本②（REQ-036 异常分支：自填端点多 system 消息兼容性冒烟）——真实上游，手动运行留档。

对 .env 备存的各家自填端点 key 逐个发送「两条 system 消息」请求（模拟 B1 两段式分区形态：
system[0]=静态前缀人设稿 / system[1]=动态尾区时间行），取证接受/拒绝形态（HTTP 状态、错误体原文），
并同取各家 usage 字段矩阵（与 DeepSeek 字段形状对照：哪些字段各家无对应——缺失即 NULL 口径依据）。

端点清单（只含 chat/completions 上游 LLM 端点；Tavily/博查/和风为工具 API 不在本冒烟范围）：
1. DeepSeek（base/模型/key 取 backend/.env 统一 key 三变量——按自填档案同形态请求）
2. GLM（open.bigmodel.cn/api/paas/v4，key 取根 .env VITE_GLM_API_KEY，模型 GLM_MODEL 可覆盖默认 glm-5）

用法（项目根目录；key 分别经 backend/.env 与根 .env 注入，脚本输出零明文）：
    set -a; source backend/.env; source .env; set +a
    backend/.venv/bin/python scripts/multi_system_smoke.py

卫生：key 仅存在于请求头 Authorization；输出与留档全程零 key 明文（引用以变量名/掩码指代）。
"""

import json
import os
import sys

import httpx

# 人设中性默认稿（T0 ③ 产出物，待 CEO 审签）——system[0] 静态前缀，两次取证逐字节同源
PERSONA = (
    "你是一个 AI 对话助手，在本服务中为用户提供对话与问答协助。\n\n"
    "行为准则：\n"
    "一、准确：基于上下文与工具返回的实际内容作答；引用联网搜索等工具结果时忠于原文并注明来源。\n"
    "二、诚实：不确定时明确说明不确定；不知道时直接说不知道，不编造事实、数据、链接或来源。\n"
    "三、如实转述工具结果：工具成功则按其结果作答；失败、超时或无结果时如实说明，不用虚构内容代替。\n"
    "四、时效意识：涉及时效的问题优先使用可用工具查证；无法查证时提示信息可能过时。\n"
    "五、表达克制：使用与用户一致的语言直接作答，不堆砌套话；结构与详略随问题调整。"
)

# 两条 system + 一条 user（B1 两段式分区形态的冒烟载荷；内容为测试占位句）
TWO_SYSTEM_MESSAGES = [
    {"role": "system", "content": PERSONA},
    {"role": "system", "content": "当前时间：2026-08-19（周三）09:00（北京时间）"},
    {"role": "user", "content": "冒烟占位提问：请只回复两个字：收到"},
]


def mask(key: str) -> str:
    return f"{key[:3]}****{key[-4:]}" if len(key) >= 8 else "****"


def providers() -> list[tuple[str, str, str, str | None, str]]:
    """(名称, base_url, 模型, key|None, key 变量名)——key 缺失记 None（缺配置如实报告，不跳过静默）。"""
    out = [
        ("DeepSeek",
         os.environ.get("AI_CHAT_UNIFIED_BASE_URL", "https://api.deepseek.com"),
         os.environ.get("AI_CHAT_UNIFIED_MODEL", "deepseek-chat"),
         os.environ.get("AI_CHAT_UNIFIED_KEY"), "AI_CHAT_UNIFIED_KEY"),
        ("GLM",
         "https://open.bigmodel.cn/api/paas/v4",
         os.environ.get("GLM_MODEL", "glm-5"),
         os.environ.get("VITE_GLM_API_KEY"), "VITE_GLM_API_KEY"),
    ]
    return out


def probe(name: str, base: str, model: str, key: str, key_var: str) -> None:
    print(f"\n=== {name} | {base} | 模型 {model} | key 变量 {key_var}（{mask(key)}）===")
    try:
        r = httpx.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": model, "messages": TWO_SYSTEM_MESSAGES, "stream": False},
            timeout=120,
        )
    except httpx.HTTPError as exc:
        print(f"网络层异常（未达上游）：{type(exc).__name__}: {exc}")
        return
    print(f"HTTP {r.status_code}")
    if r.status_code != 200:
        # 拒绝形态：错误体原文逐字留档（上游错误体不含我方 key，httpx 亦不回显请求头）
        print("错误体原文：" + r.text[:1000])
        return
    body = r.json()
    content = ((body.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    print("接受多 system：回复片段：" + content[:80].replace("\n", " "))
    usage = body.get("usage")
    if not isinstance(usage, dict):
        print("usage：缺失（响应无 usage 对象）")
        return
    print("usage 原文：" + json.dumps(usage, ensure_ascii=False))
    print("usage 字段清单：" + ", ".join(sorted(usage.keys())))
    # 顶层值形态（含嵌套对象键名）——字段矩阵留档输入
    for k in sorted(usage.keys()):
        v = usage[k]
        if isinstance(v, dict):
            print(f"    {k} : object，子字段 {sorted(v.keys())}")
        else:
            print(f"    {k} : {type(v).__name__} = {v}")


def main() -> None:
    for name, base, model, key, key_var in providers():
        if not key:
            print(f"\n=== {name}：{key_var} 未配置，跳过并如实记录缺失 ===")
            continue
        probe(name, base, model, key, key_var)
    print("\n取证结束（结论与判定写入 plans/iter-15-verify.md T0 段）。")
    sys.exit(0)


if __name__ == "__main__":
    main()
