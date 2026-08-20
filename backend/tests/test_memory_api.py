"""iter-17 T2（CHG-011 REQ-043 数据面）：记忆管理 API——GET/PUT/DELETE/settings 四端点
+ 归属隔离（REQ-043 验收 5）+ PUT 来源归零语义（design-iter-17 随稿定案）+ 422 长度校验。

无 POST 端点 = 不能手动新增记忆（CHG-011 有意边界，反向断言见本文件末用例）。
"""

import sqlite3

import pytest
from fastapi.testclient import TestClient

from tests.conftest import login, register

MEM_A = "用户偏好简洁的中文回复"
MEM_B = "与 AI 约定周报按三段式输出"


def _seed(client: TestClient, user_id: int, contents: list[str]) -> list[int]:
    conn = sqlite3.connect(client.app.state.db_path)
    try:
        ids = []
        for e in contents:
            cur = conn.execute(
                "INSERT INTO user_memories (user_id, content, source_session_id, model)"
                " VALUES (?, ?, 's0', 'm0')", (user_id, e))
            ids.append(cur.lastrowid)
        conn.commit()
        return ids
    finally:
        conn.close()


@pytest.fixture
def alice(client: TestClient) -> TestClient:
    assert register(client, "alice").status_code == 201
    return client


# ---------- GET /api/memory ----------

def test_GET_列表_停用状态_注入预览同源(alice: TestClient):
    _seed(alice, 1, [MEM_A, MEM_B])
    r = alice.get("/api/memory")
    assert r.status_code == 200
    body = r.json()
    assert body["memory_enabled"] is True
    assert [e["content"] for e in body["entries"]] == [MEM_A, MEM_B]
    assert body["entries"][0]["source_session_id"] == "s0"
    # 注入预览 = 组装时点同源取值（单一链路：与回合注入共用 render_memory_text）
    assert body["injection_preview"] == (
        "<user_memory>\n"
        "以下是关于用户的长期记忆（自动从历史对话抽取），回复时作为用户背景参考：\n"
        f"1. {MEM_A}\n2. {MEM_B}\n"
        "</user_memory>"
    )


def test_GET_无记忆预览为null(alice: TestClient):
    body = alice.get("/api/memory").json()
    assert body["entries"] == []
    assert body["injection_preview"] is None


def test_GET_停用后预览为null_存量保留(alice: TestClient):
    _seed(alice, 1, [MEM_A])
    assert alice.put("/api/memory/settings", json={"memory_enabled": False}).status_code == 200
    body = alice.get("/api/memory").json()
    assert body["memory_enabled"] is False
    assert body["injection_preview"] is None
    assert [e["content"] for e in body["entries"]] == [MEM_A]  # 存量保留


# ---------- PUT /api/memory/{id} ----------

def test_PUT_编辑生效_来源归零(alice: TestClient):
    (eid,) = _seed(alice, 1, [MEM_A])
    r = alice.put(f"/api/memory/{eid}", json={"content": "手工改写后的记忆"})
    assert r.status_code == 200
    row = sqlite3.connect(alice.app.state.db_path)
    row.row_factory = sqlite3.Row
    got = row.execute("SELECT * FROM user_memories WHERE id = ?", (eid,)).fetchone()
    row.close()
    assert got["content"] == "手工改写后的记忆"
    # 来源归零语义（design-iter-17 定案）：手工编辑后 source/model → NULL
    assert got["source_session_id"] is None and got["model"] is None


def test_PUT_超150字_422(alice: TestClient):
    (eid,) = _seed(alice, 1, [MEM_A])
    r = alice.put(f"/api/memory/{eid}", json={"content": "字" * 151})
    assert r.status_code == 422
    r2 = alice.put(f"/api/memory/{eid}", json={"content": ""})
    assert r2.status_code == 422


def test_PUT_他人条目_404(client_factory):
    a, b = client_factory(), client_factory()
    register(a, "alice")
    register(b, "bob")
    login(b, "bob", "password123")
    (eid,) = _seed(a, 1, [MEM_A])
    assert b.put(f"/api/memory/{eid}", json={"content": "恶意改写"}).status_code == 404
    # 原条目逐字不动
    got = a.get("/api/memory").json()
    assert got["entries"][0]["content"] == MEM_A


# ---------- DELETE /api/memory/{id} ----------

def test_DELETE_生效(alice: TestClient):
    eid1, eid2 = _seed(alice, 1, [MEM_A, MEM_B])
    assert alice.delete(f"/api/memory/{eid1}").status_code == 200
    assert [e["content"] for e in alice.get("/api/memory").json()["entries"]] == [MEM_B]
    # 重复删除 → 404
    assert alice.delete(f"/api/memory/{eid1}").status_code == 404
    assert alice.delete(f"/api/memory/{eid2}").status_code == 200


def test_DELETE_他人条目_404(client_factory):
    a, b = client_factory(), client_factory()
    register(a, "alice")
    register(b, "bob")
    login(b, "bob", "password123")
    (eid,) = _seed(a, 1, [MEM_A])
    assert b.delete(f"/api/memory/{eid}").status_code == 404
    assert len(a.get("/api/memory").json()["entries"]) == 1


# ---------- PUT /api/memory/settings ----------

def test_settings_开关幂等(alice: TestClient):
    assert alice.put("/api/memory/settings", json={"memory_enabled": False}).json() \
        == {"ok": True, "memory_enabled": False}
    assert alice.put("/api/memory/settings", json={"memory_enabled": False}).status_code == 200
    assert alice.get("/api/memory").json()["memory_enabled"] is False
    assert alice.put("/api/memory/settings", json={"memory_enabled": True}).json() \
        == {"ok": True, "memory_enabled": True}


# ---------- REQ-043 验收 5：归属隔离 ----------

def test_归属隔离_他人记忆不可见不可操作(client_factory):
    a, b = client_factory(), client_factory()
    register(a, "alice")
    _seed(a, 1, [MEM_A])
    register(b, "bob")
    login(b, "bob", "password123")
    # 不可见：列表只含本人（空）
    assert b.get("/api/memory").json()["entries"] == []
    # 不可操作：以他人条目 id 操作 → 404（不泄露存在性）
    assert b.put("/api/memory/1", json={"content": "x"}).status_code == 404
    assert b.delete("/api/memory/1").status_code == 404


def test_未登录_401(client: TestClient):
    assert client.get("/api/memory").status_code == 401
    assert client.put("/api/memory/1", json={"content": "x"}).status_code == 401
    assert client.put("/api/memory/settings", json={"memory_enabled": False}).status_code == 401


# ---------- 有意边界：无 POST 手动新增 ----------

def test_无POST端点_手动新增不存在(alice: TestClient):
    r = alice.post("/api/memory", json={"content": "手动新增"})
    assert r.status_code in (404, 405)  # 有意边界（CHG-011 内容 3.7 框架无 POST）
