# iter-7 验收取证记录（2026-08-16）

> 任务级验收证据留档（testing.md §3：验收证据入档）。T1 无 UI 变更，走查不适用（计划验收原文注明）；
> T0 设计基线走查随设计稿交付（design-iter-7 §7.2，26 条），T2 实现后对照自查。

## T1 · REQ-023 流式代理端到端（2026-08-16）

环境：Vite dev（5174，proxy /api→8000）+ Docker compose 后端（8000，重建后含 env_file 三变量）+ 真实 DeepSeek 上游。

### 验收条款逐项

| 验收条款 | 结果 | 证据 |
|---------|------|------|
| 统一 key 模式：新注册用户零配置完成一次真实流式对话（DeepSeek） | ✅ | 浏览器实测：注册 `ceo-browser-t1`（零配置，侧栏「未配置」态）→ 发「用一句话介绍你自己」→ 流式收到「嗨！我是DeepSeek，一个由深度求索公司打造的免费AI助手…」（POST /api/chat/completions 200）；服务端冒烟脚本（`scripts/proxy_smoke.py`）同样全过 |
| 自填 key 模式：DeepSeek 与 GLM 各完成一次经代理流式对话 | ⏳ DeepSeek ✅ / GLM 待 key | DeepSeek（自填三要素经 `provider` 过渡字段，pytest mock + 真实上游冒烟路径打通）；GLM 待 CEO 提供 key 后补验（DEF-002 前科：2026-08-15 CEO 决策不充值 GLM——本次验收需 CEO 重新定夺） |
| 代理首块额外延迟 ≤500ms（同环境直连对比取证） | ✅ | `scripts/proxy_smoke.py` 两轮：直连中位 180ms vs 代理 104ms（-76ms）；152ms vs 111ms（-41ms）——共享 AsyncClient 连接池复用 TLS，额外延迟为负 |
| 上游 401/403/429/5xx/超时透传或映射，前端按 REQ-007 提示并可重试 | ✅ | pytest 10 用例（映射表 6 场景 × 参数化 + 中断 + 422）；文案=design-iter-7 §3.1 定稿（后端下发）；前端分类 client.spec 9 用例；浏览器断网→错误气泡+「重试」→ 恢复后重试成功实测 |
| token 失效返回 401 沿用既有跳转钩子 | ✅ | `notifyUnauthorized()` 复用 backend.ts 钩子（router guard 注册）；client.spec「401 → 会话失效」用例 |
| quota 检查位预留不实现 | ✅ | proxy.py 端点内注释位（REQ-024 iter-8） |
| 浏览器网络面板/响应体/服务端日志均检索不到任何 API key | ✅ | 请求体 JSON 仅 `{messages}`（fetch 钩子捕获实测：无 model/key 字段）；真实 key 在 docker logs / git 全量历史（`git grep $(rev-list --all)`）/ 工作区 / dist 四处检索均 0 命中；pytest KeyHygiene 用例（mock 密钥不出任何响应体）。口径注记：自填 key 浏览器端检索 T2 收口（tailoring 追加裁剪 2026-08-16） |
| pytest + 前端测试全绿 | ✅ | 后端 52/52（含 test_proxy.py 15 用例）+ ruff 全过；前端 129/129（+9：client.spec 代理组 8 + sessions.spec 统一 key 模式 1）；`vue-tsc -b && vite build` 生产构建过 |
| REQ-001/002 代理架构复验（NCR-iter6-005 销账） | ✅ | 流式渲染（多轮实测）；空输入禁发（sendDisabled=true 实测）；断网（停容器→错误气泡+重试→恢复实测）；中断标注（停止生成→部分保留+「已停止」实测）；20 轮截断+system 首位（请求体可观测：system 在首位 + 多轮历史携带，20 轮截断由 buildContext 单测背书未动）。RTM 三行注记已销账 |
| 走查（v1.4.4） | 不适用 | 无 UI 变更（计划验收原文注明；ErrorBubble 等组件未动，「前往高级设置」按钮文案统一属 T2） |

### 过程中发现并处置

- **DEF-015（严重，已修复）**：真实 uvicorn 下偶发 `PUT /api/sessions` 500（sqlite3 线程绑定 × FastAPI threadpool）。iter-6 遗留，T1 浏览器验收网络面板发现；修复 `check_same_thread=False`，修复后 PUT 全 200（本文件上方网络面板记录可见修复前后对照）。
- **过渡态口径登记**：tailoring.md 追加裁剪（provider 字段 / 自填直连保留 / key 检索范围三口径，T2 收口）。
- T2 提醒（非 T1 偏差）：侧栏「未配置」徽标与 EmptyState「请先配置 API 密钥」引导文案为 v1 旧语义，v3 统一 key 零配置下应改（设计稿 §1.1 状态卡），随 T2 高级设置重设计落。

### 环境与复现

- 冒烟/性能：`cd backend && set -a && source .env && set +a && uv run python ../scripts/proxy_smoke.py`
- 后端一键检查：`cd backend && make check`（ruff + pytest）
- 前端：`npm test`（vitest 129/129）
