"""SQLite 访问层：连接工厂 + 带版本号的迁移（PRAGMA user_version，非功能「数据」条款）。

迁移规则：MIGRATIONS 按版本号升序逐个应用，只应用大于当前库版本的迁移；
每个迁移在事务内执行并更新 user_version，保证可断点续跑。
"""

import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

from fastapi import Depends, Request

SCHEMA_VERSION = 6

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
    # iter-7 T2（REQ-018）：供应商档案迁服务端。key 明文存储——「受保护」由可验收条款承载
    # （不进 git/日志/响应、编辑不回显、文件 0600，design-iter-7 定夺②）；每用户至多一个
    # 生效档案（部分唯一索引）——存在生效档案 = 自填模式，无 = 统一 key 模式（模式判定规则）
    3: """
    CREATE TABLE profiles (
        id         TEXT    PRIMARY KEY,             -- 服务端生成 uuid
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT    NOT NULL,
        base_url   TEXT    NOT NULL,
        model      TEXT    NOT NULL,
        api_key    TEXT    NOT NULL,
        is_active  INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_profiles_user ON profiles(user_id);
    CREATE UNIQUE INDEX idx_profiles_one_active ON profiles(user_id) WHERE is_active = 1;
    """,
    # iter-8 T1（REQ-024）：用量与限频计数。粒度 (day, user_id, mode)——档位随密钥模式联动，
    # 同日切换模式不重复给量（按当日总消耗对当前档位限额判定）；全站统一 key 消耗
    # = SUM(requests WHERE mode='unified')，不设独立熔断表。token 数来自上游 usage 帧
    # （quota.record_tokens 流结束后补记，解析不到记 0——不估算不编造）
    4: """
    CREATE TABLE usage_daily (
        day      TEXT    NOT NULL,             -- 自然日 YYYY-MM-DD（服务器本地时区，重置周期）
        user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mode     TEXT    NOT NULL,             -- 'unified' | 'self'（请求时密钥模式，档位判定依据）
        requests INTEGER NOT NULL DEFAULT 0,
        tokens   INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, user_id, mode)
    );
    CREATE INDEX idx_usage_daily_user ON usage_daily(user_id, day);
    CREATE TABLE register_log (
        day   TEXT    NOT NULL,
        ip    TEXT    NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, ip)
    );
    """,
    # iter-8 T2（REQ-025）：管理后台——用户级配额覆盖（NULL=默认档随密钥模式联动，
    # 正整数=固定日限双模式统一，设计定夺①「自定义 N」）；存量库最早注册用户补标记管理员
    # （新库首管理员由 register 引导，此 UPDATE 对空表无操作）
    5: """
    ALTER TABLE users ADD COLUMN quota_override INTEGER;
    UPDATE users SET is_admin = 1
    WHERE NOT EXISTS (SELECT 1 FROM users WHERE is_admin = 1)
      AND id = (SELECT MIN(id) FROM users);
    """,
    # iter-13 T1（CHG-007）：usage_daily 新增 turns 列——配额语义改「按回合」（REQ-034，
    # design-iter-13 定夺⑥：历史数据不回填；历史 1 请求 = 1 回合，requests 列继续同计数，
    # 两列同步递增故 SUM(requests) 口径对新旧数据恒等）；profiles 新增 tools_enabled——
    # 自填档案「支持工具」能力开关（定夺①：默认开；UI 随 A2，后端机制本迭代落地）
    6: """
    ALTER TABLE usage_daily ADD COLUMN turns INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE profiles ADD COLUMN tools_enabled INTEGER NOT NULL DEFAULT 1;
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
    # REQ-014 受保护条款⑤：数据库文件 0600（自填 key 明文在库，收敛为属主读写；
    # WAL 伴生文件由 SQLite 按主文件权限创建策略处理，主文件为本条款验收对象）
    db_file = conn.execute("PRAGMA database_list").fetchone()["file"]
    if db_file:
        try:
            os.chmod(db_file, 0o600)
        except OSError:
            pass  # 容器内非属主等场景不阻断启动，验收以部署机实测为准


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
