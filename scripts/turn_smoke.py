"""iter-15 T2 取证脚本（定夺④：proxy_smoke 迁 turn）——不入日常测试，手动运行留档。

前身 scripts/proxy_smoke.py（iter-7 T1，REQ-023 旧透传端点验收）；旧透传端点随 B1 下线
（CHG-009 定夺④方案 A），冒烟对象迁唯一对话入口 POST /api/chat/turn，验证项同口径承继：

1. 统一 key 模式端到端：注册全新用户（零配置）→ 回合端点完成一次真实 DeepSeek 流式对话
   （SSE v2 事件序：turn.start → turn.step → text.delta… → usage → turn.end）
2. 首块额外延迟：同环境「直连上游」vs「经回合端点」各采样 3 次取中位，差值即服务端开销
   （REQ-023 ≤500ms 验收口径随迁）
3. 密钥卫生：回合响应全文检索不到 key
4. 未登录 401（鉴权门禁）

用法（在 backend/ 目录）：
    set -a; source .env; set +a; uv run python ../scripts/turn_smoke.py
"""

import json
import os
import statistics
import sys
import time
import uuid

import httpx

BASE = os.environ.get("AI_CHAT_UNIFIED_BASE_URL", "https://api.deepseek.com")
MODEL = os.environ.get("AI_CHAT_UNIFIED_MODEL", "deepseek-chat")
KEY = os.environ["AI_CHAT_UNIFIED_KEY"]
BACKEND = "http://localhost:8000"
MSG = "只回复两个字：收到"

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'✅' if ok else '❌'} {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def direct_first_chunk_seconds() -> float:
    """直连上游首块计时（对照基线）。"""
    start = time.perf_counter()
    with httpx.stream(
        "POST", f"{BASE}/chat/completions",
        headers={"Authorization": f"Bearer {KEY}"},
        json={"model": MODEL, "messages": [{"role": "user", "content": MSG}], "stream": True},
        timeout=60,
    ) as r:
        r.raise_for_status()
        for chunk in r.iter_text():
            if "data:" in chunk:
                return time.perf_counter() - start
    raise AssertionError("直连未见 SSE 数据帧")


def turn_first_chunk_seconds(c: httpx.Client, sid: str) -> tuple[float, str]:
    """回合端点首块计时 + 全文收集（SSE v2 事件流）。"""
    start = time.perf_counter()
    text = ""
    got_first = False
    with c.stream("POST", f"{BACKEND}/api/chat/turn",
                  json={"session_id": sid, "message": MSG}) as r:
        r.raise_for_status()
        for chunk in r.iter_text():
            if not got_first and "data:" in chunk:
                got_first = True
                elapsed = time.perf_counter() - start
            text += chunk
    assert got_first
    return elapsed, text


def main() -> None:
    with httpx.Client(base_url=BACKEND, timeout=60) as c:
        # 1. 新用户注册即登录（拿 HttpOnly Cookie）
        suffix = str(int(time.time()))
        r = c.post("/api/auth/register",
                   json={"username": f"smoke-t2-{suffix}", "password": "password123"})
        check("新用户注册成功（统一 key 模式零配置）", r.status_code == 201)

        sid = uuid.uuid4().hex[:12]
        r = c.put(f"/api/sessions/{sid}",
                  json={"id": sid, "title": "smoke", "updatedAt": 1, "messages": []})
        check("回合会话建立", r.status_code == 200)

        # 2. 端到端流式对话（回合端点，SSE v2 事件序）
        elapsed, text = turn_first_chunk_seconds(c, sid)
        events = [json.loads(ln[6:]) for ln in text.splitlines() if ln.startswith("data: ")]
        types = [e.get("type") for e in events]
        ok_seq = (types[:3] == ["turn.start", "turn.step", "text.delta"]
                  and types[-2:] == ["usage", "turn.end"]
                  and events[-1].get("reason") == "done")
        check("回合端点真实流式对话（SSE v2 事件序完整）", ok_seq,
              f"首块 {elapsed * 1000:.0f}ms / {len(events)} 帧")

        # 3. 密钥卫生
        check("回合响应体检索不到 key", KEY not in text)

        # 4. 首块延迟对比：直连 vs 回合端点，各 3 次取中位
        direct = [direct_first_chunk_seconds() for _ in range(3)]
        turn_side = [turn_first_chunk_seconds(c, sid)[0] for _ in range(3)]
        d, t = statistics.median(direct), statistics.median(turn_side)
        overhead = (t - d) * 1000
        print(f"   直连首块中位 {d * 1000:.0f}ms | 经回合端点 {t * 1000:.0f}ms"
              f" | 额外延迟 {overhead:.0f}ms")
        check("回合端点首块额外延迟 ≤500ms", overhead <= 500, f"{overhead:.0f}ms")

        # 5. 未登录 401（鉴权门禁）——独立无 Cookie 客户端
        with httpx.Client(base_url=BACKEND, timeout=30) as anon:
            r = anon.post("/api/chat/turn", json={"session_id": sid, "message": MSG})
        check("未登录请求被拒（401）", r.status_code == 401)

        # 6. 旧透传端点已下线取证（定夺④）
        r = c.post("/api/chat/completions",
                   json={"messages": [{"role": "user", "content": MSG}]})
        check("旧透传端点已下线（404）", r.status_code == 404)

    print("\n" + ("全部通过 ✅" if not failures else f"失败 {len(failures)} 项：{failures}"))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
