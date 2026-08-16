# iter-10 验证记录（2026-08-16）

> T1①含最小 UI 变更（档案加载失败态 + 重试按钮，复用既有表单按钮样式与令牌，无新视觉模式，design-iter-9 未含此触点——属既有需求异常分支补强，以组件级 DOM 断言承载走查）；T1②③、T2、T3 无 UI 变更，走查不适用（计划任务表已注明）。

## T1 技术债三项清理（来源：iter-7 Code Review 观察项 + iter-5 QA 审计观察项 4）

| 项 | 实现 | 取证 | 结果 |
|----|------|------|------|
| ① settings.boot() 失败可重试 | settings.ts 加 `bootFailed` 标记（boot 可重入，失败置标记、成功清除）；SettingsForm 档案区失败态显示「档案加载失败 + 重试」按钮，点击重新 boot，成功/失败均有 toast | settings.spec +1（失败→标记+空列表→重试成功→列表/activeProfileId/标记恢复）；settings-form.spec +1（失败态渲染 + 重试点击恢复、标记清除） | ✅ 不刷新页面即可恢复（iter-7 Code Review 观察项销账） |
| ② auth_sessions 过期行惰性清理 | 清理置于 `_issue_session` 签发事务内（login/register 共用路径，代价最小）：`DELETE FROM auth_sessions WHERE expires_at < now`；expires_at 一律由本函数以 UTC isoformat 写入，字典序=时间序，与 get_current_user 过期判断同口径 | test_auth.py TestSessionPurge +1：手造过期行 + 未过期行，登录后双断言（过期行被清除、有效行保留） | ✅（iter-5 QA 观察项销账） |
| ③ useTheme 单测 | 新建 useTheme.spec（vi.resetModules + 动态 import 隔离初始态）：初始读取（无值默认 light 且加载即落根 / 有 'dark' 按值初始化 / 非法值回退 light）、setTheme 三处同步（状态/localStorage `ai-chat-theme`/data-theme，含深→浅往返）、toggleTheme 浅↔暗往返 | useTheme.spec +6 全绿 | ✅（iter-5 观察项销账） |

## T2 spec「涉及页面」hygiene 14 条（来源：iter-9 QA 审计观察项 5）

14 条全部更新为与 RTM 设计稿列一致（REQ-003/004/005/007→iter-1；008/010→iter-2；009/011/012/013→iter-3；015/016/019→iter-4；017→iter-5；REQ-019 按 RTM 原文「已同步」照抄，不擅自改口径）。

**复核**：`grep -c '待设计师产出' spec.md` = **0 残留**；抽查 REQ-011/016/019 与 RTM 一致。iter-9 QA 审计观察项 5 **销账**。

## T3 Compose 形态流式首块延迟复测（来源：iter-8 Code Review 观察项）

**验收口径**（spec 非功能·性能）：经代理转发引入的流式首块额外延迟 ≤ 500ms。
**背景**：iter-8 取证「首块额外延迟为负（-41~-76ms）」依赖 backend 共享 AsyncClient 连接池复用 TLS，当时提示「全链路 Compose 部署形态变化后需复测」——本次在 T3 落地形态下复测。

**环境**：docker compose 全链路（ai-chat-frontend nginx :8080 → ai-chat-backend :8000 → 上游 DeepSeek），本机 macOS，统一 key 已配置，2026-08-16 实测。
**方法**：预热 1 次建连接池后，`curl -N -w %{time_starttransfer}` 各取样 3 次（TTFB = 流式首块到达）；直连基线为每次新 TLS 连接的 curl 独立请求（与 iter-8 同口径）。

| 样本 | 直连上游 | 经 Compose 全链路 |
|------|---------|------------------|
| #1 | 477 ms（TLS 冷启动） | 178 ms |
| #2 | 103 ms | 82 ms |
| #3 | 102 ms | 86 ms |
| 稳态平均 | 102.8 ms（#2/#3） | 84.2 ms（#2/#3） |

**结论：✅ 达标**——首块额外延迟（稳态）≈ **-19 ms**（经代理更快），远低于 ≤500ms 口径；与 iter-8 取证（-41~-76ms）同向：backend httpx 连接池复用 TLS 会话的收益覆盖 nginx 本地转发一跳的开销。

**附带验证**：经代理 TTFB 在百毫秒级即证明 nginx 未缓冲 SSE 流（`proxy_buffering off` 生效——若被缓冲，首块需等整流结束才到达，TTFB 将等于总时长数秒）。

iter-8 Code Review 观察项（性能取证复测）就此**销账**。
