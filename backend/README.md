# ai-chat 后端（backend/）

FastAPI + SQLite。CHG-004 决策：monorepo——本目录独立依赖与 lockfile（uv），与前端根目录互不污染。

## 结构

```
app/
  main.py       入口（应用工厂 + 生命周期建库迁移）
  config.py     环境变量配置（前缀 AI_CHAT_，含 REQ-024 配额默认值 30/500/2000）
  db.py         SQLite 访问层 + 带版本号迁移（PRAGMA user_version）
  security.py   bcrypt 哈希 / 会话 token
  quota.py      REQ-024：注册限频 / 每用户按日配额（档位联动）/ 统一 key 全站熔断 / 用量计数
  routers/
    auth.py       REQ-020：注册/登录/登出/me（HttpOnly Cookie, SameSite=Lax；注册限频）
    sessions.py   REQ-022：会话 CRUD（GET 列表 / PUT 整档 LWW / DELETE 幂等，复合主键归属隔离）
    profiles.py   REQ-014/018：供应商档案（受保护存储 + 掩码下发）
    proxy.py      REQ-023/024：流式代理 + 配额检查位 + GET /api/quota；/api/dev/sse-echo 为 SSE 形态验证
tests/          pytest（临时 SQLite，每测试独立库）
```

## 常用命令

```bash
uv sync                 # 安装依赖（生成 .venv，按 uv.lock 精确安装）
make check              # 一键检查：ruff lint + pytest（process/testing.md 服务端最低要求）
uv run uvicorn app.main:app --reload   # 本地起服务 :8000
```

## 与前端的联调（同源，无 CORS）

Vite dev server 配置 proxy 把 `/api` 转发到 `http://localhost:8000`（iter-6 T2 接入）。
HttpOnly Cookie 依赖同源——这正是选 Vite proxy 而非直连后端端口的原因（iter-6 计划风险 3）。

## Docker

仓库根：`docker compose up --build -d` 起后端容器（数据卷 ./data，健康检查 /api/health）。
上 HTTPS 后设 `AI_CHAT_COOKIE_SECURE=1`。
