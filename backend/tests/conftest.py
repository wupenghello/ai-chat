"""测试夹具：临时 SQLite + 每测试独立应用实例。"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from app.config import Settings
from app.db import connect
from app.main import create_app
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(db_path=str(tmp_path / "test.db"))
    with TestClient(create_app(settings)) as c:
        yield c


@pytest.fixture
def db_conn(client: TestClient) -> Iterator[object]:
    """直连测试库，供「库内无密码明文」等验收断言使用。"""
    conn = connect(client.app.state.db_path)  # type: ignore[attr-defined]
    try:
        yield conn
    finally:
        conn.close()


def register(client: TestClient, username: str, password: str = "password123"):
    return client.post("/api/auth/register", json={"username": username, "password": password})


def login(client: TestClient, username: str, password: str):
    return client.post("/api/auth/login", json={"username": username, "password": password})
