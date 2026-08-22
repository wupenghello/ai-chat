# VPS 线上部署手册（v1.0.0 上线实录沉淀，2026-08-22）

> 从裸机 Ubuntu 24.04 到 https://www.maomaoxia.online 的完整实战记录：步骤、踩坑与注意事项。
> 本地自部署见 `deploy.md`；发布管理制度（checklist/CEO 批准/tag/metrics）见 company-os `process/release.md`；本次发布全档见 `releases/v1.0.0.md`。

## 0. 本次上线信息存档

| 项 | 值 |
|----|----|
| 服务器 | 47.79.228.253（Ubuntu 24.04.2 LTS，x86_64，3.4G 内存 / 49G 盘） |
| 域名 | www.maomaoxia.online（A 记录 → 服务器 IP，提前配好） |
| 版本 | v1.0.0（tag = a7c6c88，含 DEF-040 修复） |
| 日期 | 2026-08-22 |

## 1. 线上架构

```
浏览器 ──HTTPS:443──> 宿主 nginx（certbot TLS 终结 + HTTP:80 → 301 强跳）
                        └─ http → 127.0.0.1:8080 容器 nginx(frontend)
                                     ├─ /       → 静态托管 dist/（SPA）
                                     └─ /api/*  → 反代 backend:8000（容器网络内）
backend:8000 ── SQLite ──> /opt/ai-chat/data/ai-chat.db（宿主卷）
```

关键决策：

- **宿主 nginx 独占公网入口**：compose 两端口改绑 `127.0.0.1`（8080/8000 不外露）。不能只靠 ufw——Docker 发布端口直接写 iptables，**会绕过 ufw**（经典坑）；回环绑定从根上不暴露。
- **SSE 两层 nginx 同口径**：宿主层与容器层都 `proxy_buffering off + proxy_read_timeout 300s + HTTP/1.1 + Connection ""`。心跳 20s 保活下 300s 不会断流，deep-research 900s 长回合无碍。
- `AI_CHAT_COOKIE_SECURE=1`（HTTPS 必设，`.env.example` 未列需手动加）。
- 时区 `Asia/Shanghai`：配额按服务器自然日重置，必须对齐。

## 2. 完整步骤（六阶段，按序）

### 阶段 0 · 前置检查

```bash
dig +short www.maomaoxia.online   # 必须已解析到服务器 IP（certbot 依赖）
```

### 阶段 1 · 服务器基线（root，约 10 分钟）

```bash
export DEBIAN_FRONTEND=noninteractive
apt-get update -q && apt-get upgrade -y -q \
  -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold   # 两个 -o 必须分开写！
timedatectl set-timezone Asia/Shanghai
apt-get install -y ufw
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
curl -fsSL https://get.docker.com | sh
docker compose version            # 验证 v2+
```

### 阶段 2 · HTTPS 反代（宿主 nginx + certbot）

```bash
apt-get install -y nginx certbot python3-certbot-nginx
cat > /etc/nginx/sites-available/ai-chat <<'EOF'
server {
    listen 80;
    server_name www.maomaoxia.online;
    client_max_body_size 10m;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # SSE 流式口径（与容器内 nginx 同构）
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        proxy_set_header Connection "";
    }
}
EOF
ln -sf /etc/nginx/sites-available/ai-chat /etc/nginx/sites-enabled/ai-chat
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx -d www.maomaoxia.online --redirect --register-unsafely-without-email --agree-tos -n
certbot renew --dry-run           # 验证自动续期（systemd timer 自带）
```

> certbot `--nginx` 会自动改写该站点加 443 监听与 301（location 块原样继承）。要收到期提醒可事后 `certbot update_account -m 邮箱`。

### 阶段 3 · 代码与配置

```bash
git clone https://github.com/wupenghello/ai-chat.git /opt/ai-chat
cd /opt/ai-chat
# 端口回环绑定（不外露，宿主 nginx 独占入口）
sed -i 's/- "8000:8000"/- "127.0.0.1:8000:8000"/; s/- "8080:80"/- "127.0.0.1:8080:80"/' docker-compose.yml
cp backend/.env.example backend/.env
```

`.env` 必改/必加项（其余保持默认；单价三变量留空合法，DEF-040 修复后按"未配置"处理）：

```ini
AI_CHAT_UNIFIED_KEY=sk-...         # DeepSeek 统一 key（不填则对话返回引导文案）
AI_CHAT_COOKIE_SECURE=1            # HTTPS 必设（.env.example 没列，手动加这行）
AI_CHAT_SEARCH_KEY=tvly-...        # 可选：Tavily key，启用联网搜索与 deep-research
```

### 阶段 4 · 前端构建产物（本地 Mac 执行后上传）

`dist/` 不入 git（`Dockerfile.frontend` 直接 COPY），服务器无需装 Node：

```bash
npm run build                      # 本地（版本号提交之后构建）
scp -r dist/ root@47.79.228.253:/opt/ai-chat/
```

### 阶段 5 · 起服务 + 冒烟（六验证点）

```bash
cd /opt/ai-chat && docker compose up --build -d
docker compose ps                  # 双容器 healthy
curl -s https://www.maomaoxia.online/api/health   # {"status":"ok","db_version":10}
curl -sI http://www.maomaoxia.online/ | head -3   # 301 → https
curl -s https://www.maomaoxia.online/admin | head -5   # 返回 index.html（SPA 深路由）
ss -tlnp | grep -E ':(8080|8000)\b'               # 应只见 127.0.0.1 绑定
```

第六点浏览器验收：**立刻注册首个账号**（自动管理员）→ 对话流式 → 「用量与费用」分区 → admin 后台。

### 阶段 6 · 发布收尾（制度流程，见 process/release.md）

发布记录回填实际输出 → 打 tag（打在实际部署的 commit 上）→ `bash metrics/scripts/collect.sh ai-chat`（在项目仓库目录执行）→ registry 状态「已发布」。

## 3. 本次遇到的问题（实录）

1. **DEF-040：`.env` 单价三变量留空 → backend 启动崩溃（Restarting）**
   现象：`cp .env.example .env` 原样部署，pydantic 把空串传 `float | None` 字段解析失败 ValidationError。
   根因：`float | None` 的 None 语义只覆盖"变量不存在"，不覆盖"变量存在但空"；`.env.example` 注释却承诺"留空 = 未配置"。历轮 Compose 验证没踩到是本地 .env 已填值。
   修复：config.py `field_validator(mode="before")` 空串→None + 2 回归用例（a7c6c88）。
   教训：Optional 数值字段的"留空=未配置"契约要在配置层显式承载并配测试；新部署直接拿 .env.example 冒烟一次就是最便宜的验证。
2. **metrics 采集脚本在 macOS 自带 bash 3.2 崩溃**：双引号内 `$var，`（变量后跟全角标点）会被 bash 3.2 把多字节首字节并进变量名，`set -u` 报 unbound。修复：一律 `${var}` 花括号。写跨环境脚本时变量后紧跟 CJK 标点必须加花括号。
3. **apt dpkg 选项写法**：`-o "Dpkg::Options::=--force-confdef --force-confold"`（合并成一个值）会报 dpkg unknown option——两个选项必须写成两个独立 `-o`。
4. **提交门禁拦截两例**（v1.4.14/v1.4.19 本仓 hooks）：①代码/测试变更未同批暂存周报条目（台账四件套）；②提交标题含「——」或测试计数/验证结论词（如"全过"）。部署期间的提交预期这两类拦截，按提示补台账/改标题即可。
5. **Docker 绕过 ufw**：见 §1 关键决策——端口回环绑定，不依赖 ufw 挡容器端口。

## 4. 注意事项（运维必读）

- **首账号抢占**：服务一对外就注册首个账号（自动管理员）；配额 IP 注册限频 3/日 只是缓解不是防线。
- **root 密码与 SSH**：本次部署已装 Mac SSH 公钥（`~/.ssh/authorized_keys`）。若密码曾在任何渠道泄露，`passwd` 改掉；确认密钥长期可用后可关闭密码登录（`sshd_config` `PasswordAuthentication no`——先确认密钥能登再改，配错会锁死）。
- **证书**：Let's Encrypt 90 天，certbot systemd timer 自动续期；上线时 `certbot renew --dry-run` 验证过一次。
- **改 `.env` 生效方式**：`docker compose up -d --force-recreate backend`（env_file 是容器创建期注入，restart 不重读）。
- **启用联网搜索/深度研究**：填 `AI_CHAT_SEARCH_KEY` + 重建 backend 即可（admin 开关默认开）；deep-research 可用性 = 搜索可用（三与门），无需单独操作。验证：`curl -X POST https://api.tavily.com/search -H "Authorization: Bearer <key>" ...` 服务器实测。
- **日常发版流程**（代码更新）：本地测试过 → commit/push → 服务器 `git pull` → （前端有改动时）本地 `npm run build` + scp dist → `docker compose up --build -d` → 冒烟。
- **备份**：数据全在 `/opt/ai-chat/data/ai-chat.db`（SQLite 单文件）。停服后整拷 `data/` 目录最稳（运行中直拷有撕裂风险）；恢复 = 覆盖回 `data/` 再起服。
- **回滚**：`docker compose down`（分钟级下线，数据保留）；同形态内回退 `git checkout <上一 tag>` + `up --build -d`。v0.4.0 是静态站旧形态，不作线上回退目标。
- **看日志**：`docker compose logs -f backend`（建库/上游连通/工具网关问题都在这）。

## 5. 常用命令速查

```bash
# 状态与日志
docker compose ps && docker compose logs -f --tail 50 backend
# 重启后端（改 .env 后）
docker compose up -d --force-recreate backend
# 容器内确认配置已加载
docker exec ai-chat-backend python -c "from app.config import get_settings; s=get_settings(); print(bool(s.search_key), bool(s.unified_key))"
# 证书与续期
certbot certificates && certbot renew --dry-run
```
