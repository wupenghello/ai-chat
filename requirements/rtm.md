# 需求跟踪矩阵（RTM）— ai-chat

双向可追溯：需求 → 设计稿 → 实现 → 测试 → 状态。迭代收尾时必须与实际代码一致。

> 需求已基线（req-baseline-v1，2026-08-15 CEO 批准）。iter-1 已关闭（G4 过，v0.1.0 已发布）。iter-2 已关闭（2026-08-15，G4 过：开发 T0~T4 全完成、37/37 测试、24 条走查、QA 审计 3 NCR 全整改、复盘完成，见 retros/iter-2.md）。iter-3 计划已批准（Σ9，REQ-009/011/012/013，2026-08-15 CEO 确认，见 plans/iter-3.md）。设计稿 design-iter-3 已基线（2026-08-15 CEO 批准，6 项待澄清定夺）。iter-3 开发完成（2026-08-15：T1~T4、62/62 测试、走查 28 条全过，见 plans/iter-3-verify.md），待 QA 审计 + 复盘。

| 需求 | 描述摘要 | 优先级 | 设计稿 | 实现（文件/模块） | 测试（用例/文件） | 状态 | 所在迭代 |
|------|---------|--------|----------|-----------------|------------------|------|---------|
| REQ-001 | 发送消息并流式接收回复 | P0 | design/iter-1（已基线） | api/client.ts, ComposerBox, MessageBubble | client.spec / composer.spec | 已验证（DeepSeek 真实流式实测通过；GLM 待余额） | iter-1 |
| REQ-002 | 多轮上下文记忆（系统提示词 + 最近 20 轮截断） | P0 | 不涉及（数据层逻辑） | api/client.ts buildContext | client.spec | 已验证 | iter-1 |
| REQ-003 | 新建会话（生成中新建 = 中断并标注） | P0 | design/iter-1（已基线） | stores/sessions.ts, TheSidebar | sessions.spec | 已验证 | iter-1 |
| REQ-004 | 查看历史会话并切换（CHG-001：切换不中断，后台继续生成） | P0 | design/iter-1（已基线） | stores/sessions.ts, SessionListItem | sessions.spec（CHG-001 用例） | 已验证 | iter-1 |
| REQ-005 | 删除会话 | P0 | design/iter-1（已基线） | TheSidebar + ConfirmModal | sessions.spec | 已验证 | iter-1 |
| REQ-006 | 会话本地持久化与恢复（IndexedDB） | P0 | 不涉及（数据层） | db/idb.ts, stores/sessions.ts | sessions.spec + 浏览器实测（修复 Proxy 克隆缺陷后端到端通过） | 已验证 | iter-1 |
| REQ-007 | 调用异常与降级提示（401 引导至设置页） | P0 | design/iter-1（已基线） | api/client.ts, ErrorBubble, AppToast | client.spec / sessions.spec + 浏览器实测（未配置引导、429 原因透传） | 已验证 | iter-1 |
| REQ-008 | 系统提示词设置 | P1（CEO 已确认降级） | design/iter-2（已基线） | stores/settings.ts, SettingsForm, api/client.ts buildContext | settings.spec / sessions.spec + 走查（plans/iter-2-verify.md 24 条） | 已验证（"回复只用英文"端到端以请求体单测取证：system 恒居首位） | iter-2 |
| REQ-009 | 会话自动命名 | P1 | design/iter-3（已基线） | stores/sessions.ts（titleOf 省略号 + renamed） | sessions-naming.spec | 已验证 | iter-3 |
| REQ-010 | 停止生成 | P1 | design/iter-2（已基线） | stores/sessions.ts, ComposerBox, MessageBubble | sessions.spec / composer.spec / 集成用例 + 走查（含边界 19/20 实测） | 已验证 | iter-2 |
| REQ-011 | Markdown 渲染与代码块复制 | P1 | design/iter-3（已基线） | utils/markdown.ts, MessageBubble.vue | markdown.spec / MessageBubble.spec | 已验证 | iter-3 |
| REQ-012 | 会话重命名 | P2 | design/iter-3（已基线） | SessionListItem.vue, stores/sessions.ts（renameSession） | SessionListItem.spec / sessions-naming.spec | 已验证 | iter-3 |
| REQ-013 | 导出会话 | P2 | design/iter-3（已基线） | utils/export.ts, App.vue（顶栏导出） | export.spec | 已验证 | iter-3 |
| REQ-014 | API 供应商与密钥可配置（OpenAI 兼容，DeepSeek/GLM） | P0 | design/iter-1（已基线） | stores/settings.ts, SettingsForm | settings.spec / settings-form.spec + 浏览器实测 | 已验证（DeepSeek 实测通过；**GLM 部分按 CEO 决策 2026-08-15 不补验、接受部分达成**——不充值，见 defects.md DEF-002） | iter-1 |

## 状态定义

未开始 → 开发中 → 已实现 → 已验证（测试覆盖且有记录）→ 完成
另有：已变更（走变更记录）/ 已裁剪（写入 tailoring.md）

## 变更与裁剪备注

| 需求 | 动作 | 对应变更记录 | 日期 |
|------|------|-------------|------|
| （基线前无变更记录；CEO 决策记录见 spec.md 末节） | | | |
