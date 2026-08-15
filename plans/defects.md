# 缺陷登记 — ai-chat

> 编号前缀为 DEF（制度模板示例为 BUG，偏离已登记 tailoring.md，2026-08-15）。
> DEF-003~009 为 QA 审计 NCR-001 整改补录（2026-08-15）：原散记于 plans/iter-1-verify.md，修复先于登记，特此补录并标注原修复提交。

| 编号 | 日期 | 描述 | 严重度 | 状态 | 处置 |
|------|------|------|--------|------|------|
| DEF-001 | 2026-08-15 | `metrics/scripts/collect.sh` 以退出码 129 中止，终止点在 csv 写入之前；手动逐行复刻相同命令可正常写入。影响：度量采集需人工绕行，违反铁律 5 的自动化初衷 | 中 | 已修复 | 根因（iter-2 T4 排查）：129 是 git **用法错误退出码**而非 SIGHUP——`git for-each-ref` 无 `--since` 选项，`set -e` 使脚本在 tags 赋值行中止；"环境异常"为误诊。修复：改用 `--format='%(creatordate:short)'` + awk 日期过滤；验证 exit=0、csv 正常写入、tag 计数 4 正确（company-os 提交） |
| DEF-002 | 2026-08-15 | GLM 供应商真实流式未验证（key 余额不足 429/1113） | 低 | 已关闭（不验证） | CEO 决策（2026-08-15）：不充值 GLM、不补验，接受现状。依据：协议层按 OpenAI 兼容实现且 DeepSeek 实测通过，REQ-014 的多供应商可配置性由配置项与协议实现承载；GLM 实测留待日后有需要时再做。REQ-014 验收中"分别配置 DeepSeek 与 GLM 各完成一次流式对话"一项按 CEO 决策接受为部分达成 |
| DEF-003 | 2026-08-15 | （补录）IndexedDB 无法结构化克隆 Pinia 响应式代理，persist 报 DataCloneError，会话曾整段丢失。冒烟发现 | 严重 | 已修复 | 修复：persist 前深拷贝（提交 be69e97）；回归：刷新恢复 2 会话 6 消息实测通过 |
| DEF-004 | 2026-08-15 | （补录）设置页无返回对话入口，进入后卡死在设置视图。冒烟发现 | 一般 | 已修复 | 修复：侧栏新建/选择会话切回 chat 视图（提交 be69e97） |
| DEF-005 | 2026-08-15 | （补录）429 错误一律显示"请求频繁"误导用户（GLM 1113 实为余额不足）。冒烟发现 | 一般 | 已修复 | 修复：透传供应商具体原因（提交 be69e97） |
| DEF-006 | 2026-08-15 | （补录）发送消息后 AI 回复必须刷新页面才显示：`send()` 中 `aiMsg` 未经过 Pinia 响应式代理，流式追加不触发视图更新。CEO 试用发现 | 严重 | 已修复 | 修复：push 后从 `session.messages` 取回代理对象再变更（提交 061746f）；回归用例 + 浏览器实测（不刷新 3 秒 DOM 已 107 字） |
| DEF-007 | 2026-08-15 | （补录）chat 区布局宽度混乱：用户消息未右对齐（`.row-wrap` 缺 `justify-content`）。CEO 试用反馈"布局乱"走查发现 | 一般 | 已修复 | 修复：消息区布局重构为 DeepSeek 模式（提交 53c0343）+ 用户气泡单行显示（提交 3eee183）；DOM 实测走查表全过 |
| DEF-008 | 2026-08-15 | （补录）中文输入法选词按 Enter 会误发送（未判断 `e.isComposing`）。自查发现 | 一般 | 已修复 | 修复：选词回车不再发送（提交 061746f） |
| DEF-009 | 2026-08-15 | （补录）同一会话生成期间重复发送无防护；删除有后台生成的会话未终止其请求。自查发现 | 一般 | 已修复 | 修复：`send()` 生成中忽略；删除会话同步终止其 AbortController（提交 061746f） |
| DEF-010 | 2026-08-15 | （iter-2 遗留，iter-3 生产构建暴露）`PersistedMessage.status` 缺 `'stopped'`，致 `Session extends PersistedSession` 类型冲突（TS2430）。iter-2 未跑 `vue-tsc` 生产构建故未暴露，属构建期类型缺口而非运行时缺陷 | 低 | 已修复 | 修复：`src/db/idb.ts` 补 `'stopped'`（iter-3 提交 740c6a1）。根因：迭代准出未含生产构建（`npm test`=vitest 不做类型检查）；建议后续把生产构建（vue-tsc）纳入迭代准出固定动作（QA 审计观察项 2） |
| DEF-011 | 2026-08-15 | ComposerBox 输入区实现偏离已基线设计稿 iter-1（4.6 节）：布局由「textarea 在上 + 底部操作栏（hint + 发送按钮 36px）」改为「textarea 与按钮并排单行 + align-items:flex-end」；textarea 字号 15px（基线 14px/1.6）；容器 padding 10px 10px 10px 16px（基线 12px 12px 8px）；缺 shadow-1 阴影；缺底部「Enter 发送 · Shift+Enter 换行」hint；textarea 无自身内边距。现象：单行输入文字偏上、与发送按钮不对齐，CEO 反馈「输入框输入内容位置歪歪扭扭」 | 一般 | 已修复 | 处置（回基线设计稿 iter-1 4.6 节）：布局改回两行结构（textarea 上 + 底部 bar：hint + 发送按钮 36px）；textarea 字号回 14px/1.6；容器 padding 回 12px 12px 8px；补 shadow-1 阴影；textarea 补内边距。关联 CHG-002。修复提交 c934641（iter-4 T1）：62/62 测试、vue-tsc 生产构建、DOM 实测走查（712px 容器 / 686px textarea / 36px 按钮 / hint 12px 左对齐）全过 |
