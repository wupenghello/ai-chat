"""iter-7 T1 验收取证脚本（REQ-023）——不入日常测试，手动运行留档。

用法（在 backend/ 目录）：
    set -a; source .env; set +a; uv run python ../scripts/proxy_smoke.py

验证项：
1. 统一 key 模式端到端：注册全新用户（零配置）→ 经代理完成一次真实 DeepSeek 流式对话
2. 首块额外延迟：同环境「直连上游」vs「经代理」各采样 3 次取中位，差值即代理开销（验收 ≤500ms）
3. 密钥卫生：代理响应全文与响应体检索不到 key
"""

import os
import statistics
import sys
import time

import httpx

BASE = os.environ.get("AI_CHAT_UNIFIED_BASE_URL", "https://api.deepseek.com")
MODEL = os.environ.get("AI_CHAT_UNIFIED_MODEL", "deepseek-chat")
KEY = os.environ["AI_CHAT_UNIFIED_KEY"]
BACKEND = "http://localhost:8000"
MSG = [{"role": "user", "content": "只回复两个字：收到"}]

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'✅' if ok else '❌'} {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def first_chunk_seconds(req: dict) -> tuple[float, str]:
    """计时到首个含 SSE data 的块；返回 (秒数, 完整响应文本)。"""
    start = time.perf_counter()
    text = ""
    with httpx.stream(**req, timeout=60) as r:
        r.raise_for_status()
        got_first = False
        for chunk in r.iter_text():
            if not got_first and "data:" in chunk:
                got_first = True
                elapsed = time.perf_counter() - start
            text += chunk
    assert got_first
    return elapsed, text


def main() -> None:
    direct_req = {
        "method": "POST",
        "url": f"{BASE}/chat/completions",
        "headers": {"Authorization": f"Bearer {KEY}"},
        "json": {"model": MODEL, "messages": MSG, "stream": True},
    }
    with httpx.Client(base_url=BACKEND, timeout=30) as c:
        # 1. 新用户注册即登录（拿 HttpOnly Cookie）
        suffix = str(int(time.time()))
        r = c.post("/api/auth/register", json={"username": f"smoke-t1-{suffix}", "password": "password123"})
        check("新用户注册成功（统一 key 模式零配置）", r.status_code == 201)

        proxy_req = {
            "method": "POST",
            "url": f"{BACKEND}/api/chat/completions",
            "cookies": dict(c.cookies),
            "json": {"messages": MSG},
        }

        # 2. 端到端流式对话（经代理）
        elapsed, text = first_chunk_seconds(proxy_req)
        content_ok = '"delta"' in text and "[DONE]" in text
        check("经代理真实流式对话（DeepSeek 统一 key）", content_ok, f"首块 {elapsed * 1000:.0f}ms")

        # 3. 密钥卫生
        check("代理响应体检索不到 key", KEY not in text)

        # 4. 首块延迟对比：直连 vs 代理，各 3 次取中位
        direct = [first_chunk_seconds(direct_req)[0] for _ in range(3)]
        proxied = [first_chunk_seconds(proxy_req)[0] for _ in range(3)]
        d, p = statistics.median(direct), statistics.median(proxied)
        overhead = (p - d) * 1000
        print(f"   直连首块中位 {d * 1000:.0f}ms | 经代理 {p * 1000:.0f}ms | 额外延迟 {overhead:.0f}ms")
        check("代理首块额外延迟 ≤500ms", overhead <= 500, f"{overhead:.0f}ms")

        # 5. 未登录 401（鉴权门禁）——独立无 Cookie 客户端
        with httpx.Client(base_url=BACKEND, timeout=30) as anon:
            r = anon.post("/api/chat/completions", json={"messages": MSG})
        check("未登录请求被拒（401）", r.status_code == 401)

    print("\n" + ("全部通过 ✅" if not failures else f"失败 {len(failures)} 项：{failures}"))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
