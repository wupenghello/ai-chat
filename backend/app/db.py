"""SQLite 访问层：连接工厂 + 带版本号的迁移（PRAGMA user_version，非功能「数据」条款）。

迁移规则：MIGRATIONS 按版本号升序逐个应用，只应用大于当前库版本的迁移；
每个迁移在事务内执行并更新 user_version，保证可断点续跑。
"""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

from fastapi import Depends, Request

SCHEMA_VERSION = 2

MIGRATIONS: dict[int, str] = {
    1: """
    CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT    NOT NULL,             -- 展示用原名
        username_key  TEXT    NOT NULL UNIQUE,      -- 小写归一，大小写不敏感唯一（REQ-020）
        password_hash TEXT    NOT NULL,             -- bcrypt 哈希，绝无明文
        is_admin      INTEGER NOT NULL DEFAULT 0,   -- 治理角色（REQ-025，iter-8 启用逻辑）
        banned        INTEGER NOT NULL DEFAULT 0,   -- 封禁标记（REQ-025，iter-8 启用）
        created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE auth_sessions (
        token_hash TEXT    PRIMARY KEY,             -- SHA-256(token)，Cookie 只存原始 token
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT    NOT NULL
    );
    CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
    """,
    # iter-6 T3（REQ-022 核心）：会话整档 JSON 存储，PUT 即 LWW 覆盖；
    # 复合主键 (user_id, id)——客户端生成的 id 只在用户内唯一，跨用户天然隔离
    2: """
    CREATE TABLE chat_sessions (
        id         TEXT    NOT NULL,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        data       TEXT    NOT NULL,                -- PersistedSession JSON 原样存取（逐字恢复）
        updated_at REAL    NOT NULL,                -- 取自会话数据，列表排序依据
        PRIMARY KEY (user_id, id)
    );
    CREATE INDEX idx_chat_sessions_user ON chat_sessions(user_id, updated_at);
    """,
}


def connect(db_path: str) -> sqlite3.Connection:
    # check_same_thread=False（DEF-015）：FastAPI 把 sync 依赖（get_db 建连接）与 sync 路由
    # 交给线程池时可能落在不同线程，默认的线程绑定会偶发 ProgrammingError（真实 uvicorn 下
    # PUT /api/sessions 500）；连接本身每请求独立、WAL 串行安全，解除线程绑定无共享风险
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    for version in sorted(MIGRATIONS):
        if version <= current:
            continue
        with conn:  # 事务：DDL + 版本号一起提交
            conn.executescript(MIGRATIONS[version])
            conn.execute(f"PRAGMA user_version = {version}")


def db_version(conn: sqlite3.Connection) -> int:
    return conn.execute("PRAGMA user_version").fetchone()[0]


@contextmanager
def session_scope(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """每请求一个事务：正常提交，异常回滚。"""
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def get_db(request: Request) -> Iterator[sqlite3.Connection]:
    """每请求一个连接（SQLite 连接廉价；WAL 模式下读写并发安全）。"""
    conn = connect(request.app.state.db_path)
    try:
        yield conn
    finally:
        conn.close()


DatabaseDep = Annotated[sqlite3.Connection, Depends(get_db)]
