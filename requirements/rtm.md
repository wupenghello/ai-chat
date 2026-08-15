# 需求跟踪矩阵（RTM）— ai-chat

双向可追溯：需求 → 设计稿 → 实现 → 测试 → 状态。迭代收尾时必须与实际代码一致。

> 需求已基线（req-baseline-v1，2026-08-15 CEO 批准）。iter-1 已关闭（G4 过，v0.1.0 已发布）。iter-2 已关闭（2026-08-15，G4 过：开发 T0~T4 全完成、37/37 测试、24 条走查、QA 审计 3 NCR 全整改、复盘完成，见 retros/iter-2.md）。iter-3 计划已批准（Σ9，REQ-009/011/012/013，2026-08-15 CEO 确认，见 plans/iter-3.md）。设计稿 design-iter-3 已基线（2026-08-15 CEO 批准，6 项待澄清定夺）。iter-3 已关闭（2026-08-15，G4 过：开发 T0~T4 全完成、62/62 测试、28 条走查、QA 审计 0 NCR 符合、复盘完成，见 retros/iter-3.md）。REQ-001~014 全部达成。iter-4 计划已批准（Σ9，REQ-015/016 + DEF-011，2026-08-15 CEO 确认，见 plans/iter-4.md）。iter-4 开发完成（T0~T3 全完成、79/79 测试、设计基线 design-iter-4）。iter-4 已关闭（2026-08-15，G4 过：开发 T0~T3 + CHG-003 全完成、79/79 测试、走查 28 条、QA 审计 5 NCR 全整改、周报含 Code Review、生产构建通过、复盘完成，见 retros/iter-4.md）。v0.3.0 已发布（CEO 批准，releases/v0.3.0.md）。iter-5 计划已批准（Σ8，REQ-017/018 + 复盘遗留 token 化，2026-08-15 CEO 确认，见 plans/iter-5.md）。iter-5 已关闭（2026-08-15，G4 过：T0~T3 全完成、85/85 测试、走查 17 条、QA 审计 5 NCR 全整改、周报含 Code Review（CEO 过目 2026-08-15）、生产构建通过、复盘完成，见 retros/iter-5.md）。v0.4.0 已发布（CEO 批准，releases/v0.4.0.md）。 iter-6 计划已批准（Σ10，2026-08-15 CEO 确认，见 plans/iter-6.md）。iter-6 已关闭（2026-08-16，G4 过：T0~T3 全完成 + CHG-004 落基线 v3、前端 120/120 + 后端 pytest 37/37、走查 27 条、QA 审计 6 NCR 全整改、Code Review CEO 过目 2026-08-16、生产构建通过、复盘完成，见 retros/iter-6.md）。基线 v2 需求 REQ-001~019 全部达成。CHG-004 已批准（req-baseline-v3，2026-08-15），REQ-020~025 进入排期；REQ-006/014/018 正文已按澄清结论改写。iter-6 计划已批准（Σ10 = M×2 + L×2，2026-08-15 CEO 批准，按草案原样通过）：REQ-020 全量（T0 设计/T1 后端/T2 前端）+ REQ-022 存储核心（T3）+ REQ-006 数据层换源（T3）；REQ-023 排 iter-7，REQ-024/021/025 排 iter-8（见 plans/iter-6.md 跨迭代切分）；随计划定案两项技术决策——仓库布局 monorepo（backend/ 目录 + 根 docker-compose.yml）、登录态 token 传递方式 = HttpOnly Cookie（均 2026-08-15 CEO 拍板；monorepo 以 changes.md CHG-004 补录落盘为准）。iter-7 计划已批准（Σ10 = M×2 + L×2，2026-08-16 CEO 批准，Σ10 方案）：REQ-023 流式代理端到端（T1，含 REQ-001/002 代理架构复验与 NCR-iter6-005 销账）+ REQ-014/018 密钥与档案迁服务端（T0 设计 + T2）+ REQ-022 断网重试细项（T3）；全链路 Compose 经 CEO 确认挪 iter-8 与 v0.5.0 发布形态同批，配额初始默认值随 iter-8 计划定（见 plans/iter-7.md）。

| 需求 | 描述摘要 | 优先级 | 设计稿 | 实现（文件/模块） | 测试（用例/文件） | 状态 | 所在迭代 |
|------|---------|--------|----------|-----------------|------------------|------|---------|
| REQ-001 | 发送消息并流式接收回复 | P0 | design/iter-1（已基线） | api/client.ts, ComposerBox, MessageBubble | client.spec / composer.spec | 已验证（基线 v1 口径：DeepSeek 真实流式实测；GLM 按 DEF-002 不补验）。**v3 注记（NCR-iter6-005）**：iter-6 为直连上游过渡态，复验排 iter-7 T1（切后端代理后按新验收复验；iter-7 计划已批准 2026-08-16） | iter-1（复验 iter-7 T1） |
| REQ-002 | 多轮上下文记忆（系统提示词 + 最近 20 轮截断） | P0 | 不涉及（数据层逻辑） | api/client.ts buildContext | client.spec | 已验证（基线 v1 口径）。**v3 注记（NCR-iter6-005）**：请求改经后端代理后复验，排 iter-7 T1（iter-7 计划已批准 2026-08-16） | iter-1（复验 iter-7 T1） |
| REQ-003 | 新建会话（生成中新建 = 中断并标注） | P0 | design/iter-1（已基线） | stores/sessions.ts, TheSidebar | sessions.spec | 已验证 | iter-1 |
| REQ-004 | 查看历史会话并切换（CHG-001：切换不中断，后台继续生成） | P0 | design/iter-1（已基线） | stores/sessions.ts, SessionListItem | sessions.spec（CHG-001 用例） | 已验证 | iter-1 |
| REQ-005 | 删除会话 | P0 | design/iter-1（已基线） | TheSidebar + ConfirmModal | sessions.spec | 已验证 | iter-1 |
| REQ-006 | 会话本地持久化与恢复（IndexedDB） | P0 | design/iter-6（已基线，2026-08-15 CEO 批准——未登录门禁/路由守卫部分；数据层本身不涉及设计稿） | db/idb.ts, stores/sessions.ts | sessions.spec + 浏览器实测（修复 Proxy 克隆缺陷后端到端通过） | 已验证（基线 v3 改写后：数据层换源随 iter-6 T3——服务端为唯一持久层，idb 迁移源角色不变，换源后按新验收口径复验） | iter-1（改写落地 iter-6 T3） |
| REQ-007 | 调用异常与降级提示（401 引导至设置页） | P0 | design/iter-1（已基线） | api/client.ts, ErrorBubble, AppToast | client.spec / sessions.spec + 浏览器实测（未配置引导、429 原因透传） | 已验证（基线 v1 口径）。**v3 注记（CHG-004/NCR-iter6-005）**：新增服务端层错误（登录态 401 跳登录已实现于 iter-6 T2、配额提示待 iter-8、上游经代理透传待 iter-7 复验） | iter-1 |
| REQ-008 | 系统提示词设置 | P1（CEO 已确认降级） | design/iter-2（已基线） | stores/settings.ts, SettingsForm, api/client.ts buildContext | settings.spec / sessions.spec + 走查（plans/iter-2-verify.md 24 条） | 已验证（"回复只用英文"端到端以请求体单测取证：system 恒居首位） | iter-2 |
| REQ-009 | 会话自动命名 | P1 | design/iter-3（已基线） | stores/sessions.ts（titleOf 省略号 + renamed） | sessions-naming.spec | 已验证 | iter-3 |
| REQ-010 | 停止生成 | P1 | design/iter-2（已基线） | stores/sessions.ts, ComposerBox, MessageBubble | sessions.spec / composer.spec / 集成用例 + 走查（含边界 19/20 实测） | 已验证 | iter-2 |
| REQ-011 | Markdown 渲染与代码块复制 | P1 | design/iter-3（已基线） | utils/markdown.ts, MessageBubble.vue | markdown.spec / MessageBubble.spec | 已验证 | iter-3 |
| REQ-012 | 会话重命名 | P2 | design/iter-3（已基线） | SessionListItem.vue, stores/sessions.ts（renameSession） | SessionListItem.spec / sessions-naming.spec | 已验证 | iter-3 |
| REQ-013 | 导出会话 | P2 | design/iter-3（已基线） | utils/export.ts, App.vue（顶栏导出） | export.spec | 已验证 | iter-3 |
| REQ-014 | API 供应商与密钥可配置（OpenAI 兼容，DeepSeek/GLM） | P0 | design/iter-1（已基线） | stores/settings.ts, SettingsForm | settings.spec / settings-form.spec + 浏览器实测 | 已验证（基线 v1 口径：DeepSeek 实测通过；GLM 按 CEO 决策 2026-08-15 不补验）。**v3 注记（CHG-004/NCR-iter6-005）**：v3 已改写为服务端双模式（统一 key/自填存服务端），「key 不落浏览器」新验收当前不成立——过渡态（key 仍存 localStorage），改写落地排 iter-7 T2（随 REQ-023 代理 T1 收口复验；iter-7 计划已批准 2026-08-16） | iter-1（改写落地 iter-7 T2） |
| REQ-015 | 消息编辑与重新生成（regenerate） | P1 | design/iter-4（已基线） | stores/sessions.ts editAndRegenerate（generation 纪元防竞态）, MessageBubble（编辑态）, MessageList/App | sessions.spec（4 用例）/ MessageBubble.spec（5 用例）+ 浏览器实测 | 已验证 | iter-4 |
| REQ-016 | 会话搜索 | P2 | design/iter-4（已基线） | utils/search.ts, TheSidebar（搜索框）, SessionListItem（高亮/片段） | search.spec（5 用例）+ 浏览器实测（命中/空态/清除） | 已验证 | iter-4 |
| REQ-017 | 暗色主题 | P2 | design/iter-5（已基线） | App.vue 令牌根 [data-theme=dark] 覆盖, composables/useTheme, 顶栏主题按钮 + SettingsForm 外观 segmented | 浏览器实测（暗色 #131417/#1E2026/#E6EAF0 命中令牌、切换即变、刷新保持）+ 全组件 token 化走查 | 已验证 | iter-5 |
| REQ-018 | 多供应商档案一键切换（REQ-014 增强） | P2 | design/iter-5（已基线） | stores/settings（profiles + 旧格式迁移 + setActiveProfile/removeProfile）, SettingsForm 档案列表/模态, TheSidebar 当前档案标签 | settings.spec（4 档案用例）/ settings-form.spec（4 用例）+ 浏览器实测（迁移/添加/切换/删除边界） | 已验证（**GLM 真实流式按 DEF-002 CEO 决策 2026-08-15 不补验、接受部分达成**——多档案切换性由配置/协议层与单测承载，参照 REQ-014 行注记）。**v3 改写落地排 iter-7 T2**（档案迁服务端存储、多设备一致验收随之复验；iter-7 计划已批准 2026-08-16） | iter-5（改写落地 iter-7 T2） |
| REQ-019 | 版本切换（编辑/重生成后切换新旧分支） | P1 | design/iter-4（已同步） | stores/sessions.ts（toggleVersion + branches + forkId） | sessions.spec（版本切换用例）+ MessageBubble.spec | 已验证 | iter-4 |
| REQ-020 | 注册与登录（用户名+密码，会话 token；用户名规则 2~32 字符/大小写不敏感唯一）〔CHG-004〕 | P0（CEO 已确认） | design/iter-6（已基线，2026-08-15 CEO 批准） | backend/（T1 完成）+ LoginView/路由守卫/侧栏登出入口（T2 完成）；HttpOnly Cookie SameSite=Lax | 前端 120/120（auth 7/LoginView 17/守卫 6 新增，NCR-iter6-002 整改后再增 3）+ 后端 pytest 37 用例 + 27 条完整走查（plans/iter-6-verify.md，2026-08-16）+ 浏览器端到端冒烟 | 已实现（T0~T3 完成 2026-08-15/16；compose 容器化验收通过；QA 审计 NCR-iter6-002 功能项已整改回基线） | iter-6（T0/T1/T2） |
| REQ-021 | 账号管理（改密码、注销/删号）〔CHG-004〕 | P1（CEO 已确认） | 待设计师产出（账号管理原型） | 待排期 | 待设计 | 未开始（基线 v3；排期 iter-8） | iter-8 |
| REQ-022 | 服务端会话云存储与多设备同步（LWW + 一次性本地迁移，REQ-006 承接）〔CHG-004〕 | P0（CEO 已确认） | 迁移入口（首次登录提示，待设计，iter-8） | 存储核心已实现（iter-6 T3）：backend/ sessions CRUD（复合主键 (user_id,id) 归属隔离、PUT 整档 LWW）+ db/persistence.ts 同接口换源（stores/api/idb 三处，IndexedDB 降级为迁移源不再写入）；断网重试已排 iter-7 T3（计划已批准 2026-08-16）；LWW 并发用例与迁移入口 iter-8 | 后端 test_sessions（16 用例：逐字恢复/LWW/归属隔离/401 门禁）+ 前端 117/117（新增 persistence 5 用例）+ 浏览器实测（新建/重命名/发消息写回、刷新与登出重登逐字恢复、IndexedDB 零写入，2026-08-16） | 已实现（核心 2026-08-16，待 QA 审计） | iter-6 起（T3 核心；断网重试 iter-7 T3；LWW 用例与迁移 iter-8） |
| REQ-023 | API 密钥服务端代管与流式代理（双模式：统一 key / 自填 key 解锁高配额）〔CHG-004〕 | P0（CEO 已确认） | 高级设置待重设计（随 REQ-014，design-iter-7 T0 承载） | iter-7 T1 承载（计划已批准 2026-08-16）：backend/ proxy 模块（SSE 实时转发 + 双模式档案解析 + 错误透传映射 + quota 检查位预留）+ api/client.ts 切端点 | 待设计 | 未开始（已列入 iter-7 T1；quota 实现排 iter-8；iter-6 内对话为直连上游过渡态） | iter-7（T0 设计 + T1） |
| REQ-024 | 用量配额与滥用防护（注册限频/每用户配额/统一 key 总量保护，配额与密钥模式联动）〔CHG-004〕 | P0（CEO 已确认） | 不涉及（复用错误提示体系） | 待排期（FastAPI quota 层） | 待设计 | 未开始（基线 v3；排期 iter-8，随 iter-7 代理层落地后；iter-6 注册不限频窗口由本地部署未公开缓解） | iter-8 |
| REQ-025 | 管理员 Web 后台（封禁/解封、按用户调配额、按用户按日用量列表）〔CHG-004〕 | P1（CEO 已确认） | 待设计师产出（管理后台原型） | 待排期（FastAPI admin 层 + 后台前端） | 待设计 | 未开始（基线 v3；排期 iter-8） | iter-8 |

## 状态定义

未开始 → 开发中 → 已实现 → 已验证（测试覆盖且有记录）→ 完成
另有：已变更（走变更记录）/ 已裁剪（写入 tailoring.md）

## 变更与裁剪备注

| 需求 | 动作 | 对应变更记录 | 日期 |
|------|------|-------------|------|
| （基线前无变更记录；CEO 决策记录见 spec.md 末节） | | | |
| REQ-006 / REQ-014 / REQ-018 / REQ-007 | 受 CHG-004 影响，正文与验收标准已按澄清结论正式改写（CHG-004 已批准，req-baseline-v3；影响明细见 changes.md CHG-004 影响评估） | CHG-004 | 2026-08-15 |
| REQ-020 ~ REQ-025 | CHG-004 新增，已批准（基线 v3），进入排期 | CHG-004 | 2026-08-15 |
