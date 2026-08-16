# iter-7 验收取证记录（2026-08-16）

> 任务级验收证据留档（testing.md §3：验收证据入档）。T1 无 UI 变更，走查不适用（计划验收原文注明）；
> T0 设计基线走查随设计稿交付（design-iter-7 §7.2，26 条），T2 实现后对照自查。

## T1 · REQ-023 流式代理端到端（2026-08-16）

环境：Vite dev（5174，proxy /api→8000）+ Docker compose 后端（8000，重建后含 env_file 三变量）+ 真实 DeepSeek 上游。

### 验收条款逐项

| 验收条款 | 结果 | 证据 |
|---------|------|------|
| 统一 key 模式：新注册用户零配置完成一次真实流式对话（DeepSeek） | ✅ | 浏览器实测：注册 `ceo-browser-t1`（零配置，侧栏「未配置」态）→ 发「用一句话介绍你自己」→ 流式收到「嗨！我是DeepSeek，一个由深度求索公司打造的免费AI助手…」（POST /api/chat/completions 200）；服务端冒烟脚本（`scripts/proxy_smoke.py`）同样全过 |
| 自填 key 模式：DeepSeek 与 GLM 各完成一次经代理流式对话 | ✅（部分，CEO 决策接受） | DeepSeek ✅（自填三要素经 `provider` 过渡字段，pytest mock + 真实上游冒烟路径打通）；GLM **CEO 决策（2026-08-16）不补验、不提供 key**，接受部分达成——延续 DEF-002 口径（协议层 OpenAI 兼容 + provider 路由 pytest 覆盖，多供应商可配置性由配置项承载） |
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

## T2 · REQ-014/018 密钥与供应商档案迁服务端（2026-08-16）

环境：同 T1（容器重建后 db_version=3，profiles 迁移生效）。GLM 口径：CEO 决策 2026-08-16 不补验（DEF-002 延续），自填模式以 DeepSeek 实测承载。

### design-iter-7 §7.2 走查清单对照（26 条，v1.4.4 任务级门槛）

| # | 结果 | 证据 |
|---|------|------|
| 1 统一 key 默认态 | ✅ | 浏览器实测：状态卡「服务端统一密钥·当前模式」+ 零密钥输入框（首屏无 password input）|
| 2 配额行占位 | ✅ | 「每日 — 次对话 · 今日已用 —」破折号 + 琥珀「占位」胶囊，无编造数值 |
| 3 高级设置入口 | ✅ | 「在下方高级设置中添加自有密钥」链接 + 区头说明「密钥仅存服务端」 |
| 4 自填模式态 | ✅ | 实测设为当前后：主色描边+primary-l 底、显示「当前生效：我的DeepSeek」+「已解锁更高配额」徽标 + 回退按钮 |
| 5 设为当前=进自填 | ✅ | 实测：模式卡翻自填态 + toast；keyMode 由 activeProfileId 派生（settings-form.spec）|
| 6 回退路径 | ✅ | 实测：回退后卡翻统一态 + toast「自下一次请求生效」、档案保留（列表仍在）、无确认弹窗（ConfirmModal open=false）|
| 7 生成中切换（CHG-002）| ✅（架构保证）| 代理在请求开始时读 DB 生效档案（proxy.py），生成中切换/回退天然「当前回复旧配置跑完」；toast 文案已实现；浏览器逐帧窗口因上游响应过快未单独取证，路由语义由 pytest TestProfileRouting 承载 |
| 8 添加模态 | ✅ | 四字段+必填红描边+key 密文+说明「密钥仅存服务端」（settings-form.spec + 实测）|
| 9 编辑 key 不回显 | ✅ | 实测：编辑打开 key value 空 + label「已保存，不回显」+ placeholder「留空保持不变」；添加必填/编辑可空由 validateProfileInput(editing) 承载（settings.spec）|
| 10 档案列表 | ✅ | 实测：掩码 sk-****2c36（host·model·mask meta 行）、设为当前/编辑/删除、当前项禁删 title；后端 409 双保险（test_profiles）|
| 11 多设备一致 | ✅ | curl 第二设备登录同账号 GET /api/profiles：列表与 is_active 状态一致 |
| 12 生成中切换胶囊 | ✅ | pendingEffect「↻ 待生效」逻辑保留（iter-5 基线引用，sessions store 未动）|
| 13 保存反馈 | ✅ | 实测 toast「档案已保存」 |
| 14 存量上云提示条 | ⏸ | iter-8 落地（定夺④；本迭代旧字段停读不清，settings.spec 留回归用例）|
| 15 上游 401 气泡 | ✅ | 实测：无效 key 对话 → 「请求失败：API 密钥无效，请检查高级设置中的供应商配置」+「前往高级设置」→ 点击跳设置页并定位高级设置区。**走查中发现偏差当场修复**：原实现重试按钮仍渲染（设计稿明确 401/403 不提供重试），已改 `v-if="kind !== 'auth'"`（沿 v1.4.4 修复即登记口径，本表留痕）|
| 16-19 错误映射/中断/断网 | ✅ | T1 交付（见上方 T1 段；429/5xx/超时可重试、流中断胶囊、断网重试实测）|
| 20-21 配额占位 | ⏸ | REQ-024 iter-8 返回（文案通道已就绪：错误气泡 detail 直出）|
| 22 统一密钥未配置 | ✅ | T1 交付（503 + 文案，pytest）|
| 23 消亡分支留档 | ✅ | T1 已删「未配置即发送」拦截（App.vue 注释留档 + spec 消亡条目对照）|
| 24 亮暗双态 | ✅ | 实测暗色：body #131417 / mode-card #1E2026 / border #33363E——命中 tokens v1.3 暗色，无亮色残留；令牌取值全走 var() |
| 25 超长/多档案 | ✅ | iter-5 3.5 基线引用（p-name/p-sub ellipsis 类未动）|
| 26 适用性注明 | ✅ | 设置页不做 ≤480px（spec 兼容条款仅登录/注册）；T1/T3 走查不适用已注明 |

### REQ-014/018 验收条款取证

| 验收条款 | 结果 | 证据 |
|---------|------|------|
| 自填三要素存服务端受保护存储，浏览器 localStorage/IndexedDB 检索不到任何 key 与档案 | ✅ | 实测：保存档案+设为当前+对话后 `JSON.stringify(localStorage)` 无 key 明文、无档案数据（仅 systemPrompt；遗留 `profiles:[]` 空数组为旧版 persist 残留，无档案内容）；`indexedDB.databases()` 为空 |
| 另一设备登录后档案列表与当前生效档案一致 | ✅ | curl 第二设备（见走查 11）|
| 一键切换即时生效；生成中切换 CHG-002 语义 | ✅ | 切换实测（自填对话成功→回退→统一 key 对话成功）；CHG-002 架构保证（走查 7）|
| 清除自填配置后自动回退统一 key 模式 | ✅ | 实测：回退后新会话「1+2等于几？」→「3。」（统一 key 正常对话）|
| 自填 key 无效（上游 401 经代理透传）提示并引导回高级设置 | ✅ | 实测（走查 15）|
| 存量本地档案按 T0 定案方式上云且本地清除 | ⏸ iter-8 | spec REQ-018 定案「落地 iter-8」（design-iter-7 §2.3 同口径）——**计划该条与基线冲突，按基线执行**，tailoring 登记口径 |
| git 全量历史（前后端）检索不到任何真实 key | ✅ | `git grep $(git rev-list --all)` + 工作区 + docker logs + dist 四处 0 命中 |
| 受保护条款 5 项 | ✅ | ①git 检索 0 命中 ②日志 0 命中 ③响应体仅掩码（pytest 逐响应断言 + 网络面板实测）④编辑不回显（走查 9）⑤`/data/ai-chat.db` 权限 `-rw-------`（docker exec ls 实测）|
| 前后端测试全绿 | ✅ | 后端 69/69（+17：test_profiles.py 16 + 代理路由改写）+ ruff；前端 131/131（settings/settings-form 重写为服务端源语义）；vue-tsc 生产构建过 |

### 过程中发现并处置

- **走查 15 偏差当场修复**：上游 401 气泡的重试按钮未按映射表隐藏——已修（见上表），符合 v1.4.4「实现后自查 + 修复不豁免登记」。
- **T1 过渡态三口径全部收口销账**（tailoring 2026-08-16 条更新）：provider 请求字段已移除（代理改读 DB 生效档案）、自填直连分支已删除（generate 全走代理）、key 检索范围条款随前两条自然失效。
- SettingsForm.saveProfile 早期版本 `editingId === null` 早退挡住添加路径——settings-form.spec 用例暴露，提交前修复（测试先行发现，无线上影响）。

## T3 · REQ-022 断网暂存与自动重试（2026-08-16）

实现：persistence 层暂存队列（localStorage `ai-chat:pending-ops`）——写回失败且属临时性（网络层/5xx）入队，同会话压缩为最后操作（LWW 语义不被乱序破坏）；重放三触发（online 事件 + 入队 5s 退避 + 队列非空 30s 轮询）逐条按序执行，临时性失败中断本轮保序、毒丸（4xx）丢弃不卡死；提示「部分更改未同步，恢复网络后自动重试」（spec 定稿文案）同一积压期去重一次。无新 UI（复用 AppToast），走查不适用（计划验收原文注明）。

### 验收条款取证

| 验收条款 | 结果 | 证据 |
|---------|------|------|
| 断网状态完成的一轮对话，恢复网络后自动同步、另一设备可见 | ✅（口径注记）| 浏览器实测：停容器 → 发消息（代理不可达，错误气泡；会话整档含用户消息写回失败）→ 入队 + toast → 起容器 → 12s 内队列自动清空（cleared）→ **第二设备（curl 独立登录）GET /api/sessions 可见该会话，最后用户消息=「断网期间发出的消息」逐字一致**。注记：AI 回复本身需上游在线（架构事实），「断网状态下完成的一轮对话」按「断网窗口内产生的会话更改（含刚完成的对话轮次）暂存不丢」取证 |
| 连续失败提示「部分更改未同步」 | ✅ | 实测 toast 文案命中；去重语义（同积压期一次、清空后重置）由 pending-sync.spec 用例承载 |
| 重试不阻塞对话主流程 | ✅ | 发送即时反馈（错误气泡），暂存与重放在 persistence 层后台；重放互斥（replaying 标志）不并发 |
| 暂存队列按序重放，LWW 语义不被乱序破坏 | ✅ | 单测：同会话多次失败压缩为最后整档、put→delete 压缩为 delete、多会话按入队序重放、中途断网保留剩余队列 |
| 前端测试覆盖上述分支 | ✅ | pending-sync.spec 9 用例（入队/5xx/4xx 区分/压缩/按序/毒丸/提示去重/online 触发/在线不入队） |

### 测试与构建

- 前端 140/140（+9）；vue-tsc + 生产构建过；后端无改动（69/69 维持）。
