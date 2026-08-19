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

SCHEMA_VERSION = 9

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
    # iter-14 T2（CHG-007 REQ-035 / design-iter-14 §6.1）：服务端运行时设置 KV——
    # 首个键 search_enabled（admin 联网搜索整体开关：落库运行时生效、默认开 REQ-025；
    # 行缺失 = 默认值，不回填存量库；B1 服务端配置面板可扩展复用本表）
    7: """
    CREATE TABLE app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    """,
    # iter-15 T2（CHG-009 REQ-037，迁移编号说明见 changes.md CHG-009 内容 4.4）：
    # telemetry 请求级明细表——每次上游 LLM 调用一行（kind=llm）/ 每次工具执行一行（kind=tool）；
    # 机器采集（铁律 5）：token 分项/缓存字段上游不返回记 NULL；明细保留 90 天惰性清理
    # （定夺⑤，app/telemetry.py）；既有 usage_daily 回合/token 落账零变化（并行新轨）。
    # schema 全文与 CHG-009 内容 4.2 拟稿逐字一致
    8: """
    CREATE TABLE telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day TEXT NOT NULL,                 -- 自然日（服务器本地时区，同 usage_daily 口径）
        ts TEXT NOT NULL DEFAULT (datetime('now')),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mode TEXT NOT NULL,                -- 'unified' | 'self'
        turn_id TEXT,                      -- 回合关联；旧透传端点（若保留期）为 NULL
        endpoint TEXT NOT NULL,            -- 'turn' | 'legacy'
        kind TEXT NOT NULL,                -- 'llm'（上游调用行）| 'tool'（工具执行行）
        step INTEGER,                      -- llm 行：回合内步序
        model TEXT,                        -- llm 行：上游模型名
        latency_ms INTEGER NOT NULL,
        status TEXT NOT NULL,              -- ok | error | timeout | cancelled
        tokens_prompt INTEGER,             -- 上游不返回 → NULL（不造数）
        tokens_completion INTEGER,
        tokens_total INTEGER,
        cache_hit_tokens INTEGER,          -- 上游不返回 → NULL（铁律 5：显示缺失）
        cache_miss_tokens INTEGER,
        tool_name TEXT,                    -- tool 行：工具名
        error_code TEXT                    -- status != ok 时机器可读码（沿 §3.1 映射码体系）
    );
    CREATE INDEX idx_telemetry_day ON telemetry(day, user_id);
    """,
    # iter-16 T2（CHG-010 REQ-039/041，迁移 v9）：
    # ① context_summary 压缩产物表——schema 与 CHG-010 内容 3.2 逐字一致（PK (user_id, session_id)，
    #    每会话至多一份当前摘要，重压缩 = 同主键覆盖更新；注销级联清理 ON DELETE CASCADE；
    #    不写回会话档，与 LWW/409 守卫/整档透传零交互）
    # ② telemetry 加法增列 tokens_before/tokens_after（compress 行专用：触发依据实测值 /
    #    压缩后首测值懒回填，存量行 NULL 不回填，REQ-041）
    # ③ telemetry 加法增列 session_id（TEXT）——实现级加法列（CHG-010 schema 拟稿之外，
    #    已拍板：v8 表无会话列，为满足 REQ-039「该会话上一回合」阈值判定语义而加；
    #    存量 NULL 不回填，turn 端点 llm/compress 行写入时携带；偏离与理由登记 verify T2 段）
    9: """
    CREATE TABLE context_summary (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        summary TEXT NOT NULL,               -- 摘要文本（注入组装前的原料）
        watermark_msg_id TEXT NOT NULL,      -- 摘要覆盖至的消息 id（失效判定依据）
        model TEXT NOT NULL,                 -- 生成摘要的模型（机器记录）
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, session_id)    -- 每会话至多一份当前摘要（重压缩 = 覆盖更新）
    );
    ALTER TABLE telemetry ADD COLUMN tokens_before INTEGER;  -- compress 行：触发依据实测值
    ALTER TABLE telemetry ADD COLUMN tokens_after INTEGER;   -- compress 行：压缩后首测值懒回填
    ALTER TABLE telemetry ADD COLUMN session_id TEXT;        -- 会话关联（阈值判定依据，见注释③）
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


# ---------- 服务端运行时设置 KV（迁移 v7，design-iter-14 §6.1） ----------

def kv_get(conn: sqlite3.Connection, key: str, default: str | None = None) -> str | None:
    row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    return default if row is None else row["value"]


def kv_set(conn: sqlite3.Connection, key: str, value: str) -> None:
    with conn:
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


_SEARCH_ENABLED = "search_enabled"  # 值 '0'/'1'；行缺失 = 默认开（REQ-025 口径）


def is_search_enabled(conn: sqlite3.Connection) -> bool:
    return kv_get(conn, _SEARCH_ENABLED, "1") != "0"


def set_search_enabled(conn: sqlite3.Connection, enabled: bool) -> None:
    kv_set(conn, _SEARCH_ENABLED, "1" if enabled else "0")


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
