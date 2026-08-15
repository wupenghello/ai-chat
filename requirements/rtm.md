# 需求跟踪矩阵（RTM）— ai-chat

双向可追溯：需求 → 设计稿 → 实现 → 测试 → 状态。迭代收尾时必须与实际代码一致。

> 需求已基线（req-baseline-v1，2026-08-15 CEO 批准）。当前迭代：**iter-1**（2026-08-17 ~ 08-28，目标 MVP 闭环）。UI 需求的交互原型已基线（design/proto/index.html），iter-1 设计稿由 T0 产出后回填。

| 需求 | 描述摘要 | 优先级 | 设计稿 | 实现（文件/模块） | 测试（用例/文件） | 状态 | 所在迭代 |
|------|---------|--------|----------|-----------------|------------------|------|---------|
| REQ-001 | 发送消息并流式接收回复 | P0 | design/iter-1（已基线） | api/client.ts, ComposerBox, MessageBubble | client.spec / composer.spec | 已验证（DeepSeek 真实流式实测通过；GLM 待余额） | iter-1 |
| REQ-002 | 多轮上下文记忆（系统提示词 + 最近 20 轮截断） | P0 | 不涉及（数据层逻辑） | api/client.ts buildContext | client.spec | 已验证 | iter-1 |
| REQ-003 | 新建会话（生成中新建 = 中断并标注） | P0 | design/iter-1（已基线） | stores/sessions.ts, TheSidebar | sessions.spec | 已验证 | iter-1 |
| REQ-004 | 查看历史会话并切换（CHG-001：切换不中断，后台继续生成） | P0 | design/iter-1（已基线） | stores/sessions.ts, SessionListItem | sessions.spec（CHG-001 用例） | 已验证 | iter-1 |
| REQ-005 | 删除会话 | P0 | design/iter-1（已基线） | TheSidebar + ConfirmModal | sessions.spec | 已验证 | iter-1 |
| REQ-006 | 会话本地持久化与恢复（IndexedDB） | P0 | 不涉及（数据层） | db/idb.ts, stores/sessions.ts | sessions.spec + 浏览器实测（修复 Proxy 克隆缺陷后端到端通过） | 已验证 | iter-1 |
| REQ-007 | 调用异常与降级提示（401 引导至设置页） | P0 | design/iter-1（已基线） | api/client.ts, ErrorBubble, AppToast | client.spec / sessions.spec + 浏览器实测（未配置引导、429 原因透传） | 已验证 | iter-1 |
| REQ-008 | 系统提示词设置 | P1（CEO 已确认降级） | 待设计师产出 | - | - | 未开始 | - |
| REQ-009 | 会话自动命名 | P1 | 待设计师产出 | - | - | 未开始 | - |
| REQ-010 | 停止生成 | P1 | 待设计师产出 | - | - | 未开始 | - |
| REQ-011 | Markdown 渲染与代码块复制 | P1 | 待设计师产出 | - | - | 未开始 | - |
| REQ-012 | 会话重命名 | P2 | 待设计师产出 | - | - | 未开始 | - |
| REQ-013 | 导出会话 | P2 | 待设计师产出 | - | - | 未开始 | - |
| REQ-014 | API 供应商与密钥可配置（OpenAI 兼容，DeepSeek/GLM） | P0 | design/iter-1（已基线） | stores/settings.ts, SettingsForm | settings.spec / settings-form.spec + 浏览器实测 | 已验证（DeepSeek 实测通过；**GLM 部分待 DEF-002 充值后补验**——QA 审计观察项 4 备注） | iter-1 |

## 状态定义

未开始 → 开发中 → 已实现 → 已验证（测试覆盖且有记录）→ 完成
另有：已变更（走变更记录）/ 已裁剪（写入 tailoring.md）

## 变更与裁剪备注

| 需求 | 动作 | 对应变更记录 | 日期 |
|------|------|-------------|------|
| （基线前无变更记录；CEO 决策记录见 spec.md 末节） | | | |
