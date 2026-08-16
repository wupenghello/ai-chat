# 自部署手册（iter-9 T3）

> ai-chat 全链路一键起：前端静态站（nginx）+ 后端（FastAPI）+ SQLite 数据卷。
> 目标读者：在任意机器本地跑起完整服务的部署者。云部署（VPS/域名/HTTPS）见 `charter.md`，本迭代不做。

## 架构一览

```
浏览器 ──http://localhost:8080──> nginx(frontend)
                                   ├─ /            → 静态托管 dist/（SPA，createWebHistory）
                                   └─ /api/*       → 反代 backend:8000（同源，HttpOnly Cookie 无 CORS）
backend:8000 ──SQLite──> ./data/ai-chat.db（数据卷，容器内路径 /data）
```

与本地开发（Vite dev proxy 把 `/api` 转 `localhost:8000`）同构，nginx 反代是同源的部署形态等价物。

## 前置条件

- Docker 24+（含 Compose 插件，`docker compose version` 可用）
- 前端构建产物 `dist/` 必须存在（`Dockerfile.frontend` 直接 `COPY dist/`，不实时构建）

## 一键起步骤

```bash
# 1) 产出前端构建产物（首次或前端改版后执行）
npm install
npm run build

# 2) 准备后端环境变量（.env 不入 git，从占位示例复制）
cp backend/.env.example backend/.env
#    按需编辑 backend/.env：至少填统一 key 三变量（见下），否则对话返回 503 引导文案

# 3) 一键起全链路（--build 首次或改 Dockerfile 后加；后台常驻 -d）
docker compose up --build -d

# 4) 看 healthcheck 是否全绿（backend + frontend 都 healthy）
docker compose ps

# 5) 浏览器打开
open http://localhost:8080
```

> 首次启动 backend 会跑建库迁移并创建 `./data/ai-chat.db`。首个注册账号即管理员（管理后台入口 `http://localhost:8080/admin`）。

## 环境变量说明

后端配置前缀为 `AI_CHAT_`，字段名小写转大写、下划线保持（`app/config.py`）。

### 统一 key 三变量（`backend/.env`，design-iter-7 定夺①）

| 变量 | 默认 | 说明 |
|------|------|------|
| `AI_CHAT_UNIFIED_KEY` | 空 | 统一上游密钥。**空 = 未配置**，服务可起但对话返回「服务端未配置统一密钥，请联系管理员」 |
| `AI_CHAT_UNIFIED_BASE_URL` | `https://api.deepseek.com` | 上游 OpenAI 兼容网关地址，自建兼容网关时改这里 |
| `AI_CHAT_UNIFIED_MODEL` | `deepseek-chat` | 上游模型名 |

### 配额四变量（REQ-024，iter-8 T1；默认值即 config.py 定案，0 = 该项不限）

| 变量 | 默认 | 说明 |
|------|------|------|
| `AI_CHAT_REGISTER_IP_DAILY_LIMIT` | `3` | 每 IP 每自然日注册数上限 |
| `AI_CHAT_QUOTA_FREE_DAILY` | `30` | 免费档（统一 key 模式）每用户每日对话请求数 |
| `AI_CHAT_QUOTA_SELF_DAILY` | `500` | 自填 key 档每用户每日对话请求数 |
| `AI_CHAT_UNIFIED_DAILY_TOTAL` | `2000` | 统一 key 全站每日总量（熔断，次日 00:00 恢复） |

配额以自然日（服务器本地时区）为重置周期。上 HTTPS 后另设 `AI_CHAT_COOKIE_SECURE=1`。

## 数据卷位置

| 宿主机路径 | 容器路径 | 内容 |
|-----------|---------|------|
| `./data/` | `/data` | SQLite 库 `ai-chat.db`（含用户/会话/供应商档案/用量计数） |

`./data/` 已被 `.gitignore` 排除。备份 = 停服务后整目录拷贝 `./data`。

## 端口

| 服务 | 宿主机端口 | 容器端口 |
|------|-----------|---------|
| frontend（nginx） | `8080` | `80` |
| backend（FastAPI） | `8000` | `8000` |

## 验证（按实际跑通步骤）

```bash
# backend 直连 healthcheck
curl -s http://localhost:8000/api/health        # → {"status":"ok","db_version":...}

# 经 nginx 反代的全链路 healthcheck（静态托管 + /api 代理一次验齐）
curl -s http://localhost:8080/api/health

# 前端首页可访问（SPA 深层路由刷新回退正常）
curl -s http://localhost:8080/admin              # → 返回 index.html（非 404）

docker compose ps                                 # backend + frontend 均 healthy
```

## 常见问题

- **前端页面 502 / 对话转圈**：`backend` 未健康，`docker compose logs backend` 看建库或上游连通日志。
- **对话返回「服务端未配置统一密钥」**：`backend/.env` 未填 `AI_CHAT_UNIFIED_KEY`（或 compose 未读到，检查 `docker compose config`）。
- **改 `backend/.env` 不生效**：环境变量经 `env_file` 注入，需 `docker compose up -d --force-recreate backend`。
